import type { OAuthTokens } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// OAuth sign-in flows. Uses chrome.identity.launchWebAuthFlow, which opens the
// provider's consent page in a managed popup and captures the redirect back to
// the extension's own https://<id>.chromiumapp.org/ callback — no server needed.
//
// Only providers with a real, documented third-party OAuth flow are implemented:
//   • OpenRouter — PKCE; the token exchange returns a usable API key.
//   • Google     — OAuth 2.0 implicit/PKCE for Generative Language API scope.
// Providers whose consumer subscriptions have NO public OAuth (Anthropic
// Claude Pro, OpenAI ChatGPT Plus) are marked 'unsupported' in the registry and
// never reach this module — the UI explains why instead of faking a flow.
//
// This module runs in the SERVICE WORKER (chrome.identity is worker-available in
// MV3) and returns OAuthTokens that the store persists. Tokens never touch a
// page or content script.
// ─────────────────────────────────────────────────────────────────────────────

/** Base64url without padding, from raw bytes. */
function base64UrlEncode(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A cryptographically-random PKCE code verifier (43–128 chars). */
function randomVerifier(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes.buffer);
}

async function s256Challenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(digest);
}

/** The extension's own OAuth redirect URL (https://<id>.chromiumapp.org/). */
function redirectUrl(): string {
  return chrome.identity.getRedirectURL();
}

/** Parse query/fragment params out of the final redirect URL. */
function parseRedirectParams(url: string): URLSearchParams {
  const u = new URL(url);
  // Providers may return params in the query (?code=) or the fragment (#access_token=).
  const merged = new URLSearchParams(u.search);
  if (u.hash) {
    const frag = new URLSearchParams(u.hash.replace(/^#/, ''));
    frag.forEach((v, k) => merged.set(k, v));
  }
  return merged;
}

// ── OpenRouter (PKCE → API key) ──────────────────────────────────────────────

async function signInOpenRouter(): Promise<OAuthTokens> {
  const verifier = randomVerifier();
  const challenge = await s256Challenge(verifier);
  const cb = redirectUrl();

  const authUrl =
    `https://openrouter.ai/auth?callback_url=${encodeURIComponent(cb)}` +
    `&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`;

  const finalUrl = await launchWebAuthFlow(authUrl);
  const params = parseRedirectParams(finalUrl);
  const code = params.get('code');
  if (!code) throw new Error('OpenRouter did not return an authorization code.');

  // Exchange the code for a usable API key.
  const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter token exchange failed (HTTP ${res.status}).`);
  }
  const json = (await res.json()) as { key?: string };
  if (!json.key) throw new Error('OpenRouter token exchange returned no key.');

  return { accessToken: json.key, tokenType: 'Bearer', accountLabel: 'OpenRouter account' };
}

// ── Google (OAuth 2.0, Generative Language scope) ────────────────────────────
// NOTE: requires a Google Cloud OAuth client id. The user provides it in
// settings (there is no way to ship a public client secret safely in an
// extension). We use the implicit/token flow which needs only a client id.

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/generative-language.retriever';

async function signInGoogle(clientId: string): Promise<OAuthTokens> {
  if (!clientId) {
    throw new Error(
      'Google sign-in needs an OAuth client ID. Create one in Google Cloud Console ' +
        '(OAuth 2.0 Client, type "Web application") and add the redirect URL shown in settings.',
    );
  }
  const cb = redirectUrl();
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(cb)}` +
    '&response_type=token' +
    `&scope=${encodeURIComponent(GOOGLE_SCOPE)}` +
    '&prompt=consent';

  const finalUrl = await launchWebAuthFlow(authUrl);
  const params = parseRedirectParams(finalUrl);
  const token = params.get('access_token');
  if (!token) throw new Error('Google did not return an access token.');
  const expiresIn = Number(params.get('expires_in') ?? '3600');

  return {
    accessToken: token,
    tokenType: 'Bearer',
    expiresAt: Date.now() + expiresIn * 1000,
    accountLabel: 'Google account',
  };
}

// ── launchWebAuthFlow promise wrapper ────────────────────────────────────────

function launchWebAuthFlow(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (responseUrl) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message ?? 'Sign-in was cancelled.'));
      if (!responseUrl) return reject(new Error('Sign-in returned no redirect.'));
      resolve(responseUrl);
    });
  });
}

// ── Public entry ─────────────────────────────────────────────────────────────

/**
 * Run the sign-in flow for a provider's oauth capability. `clientId` is only
 * used by flows that require one (Google). Returns tokens to persist, or throws
 * a user-readable error.
 */
export async function runOAuthSignIn(
  capability: 'openrouter' | 'google',
  opts?: { clientId?: string },
): Promise<OAuthTokens> {
  switch (capability) {
    case 'openrouter':
      return signInOpenRouter();
    case 'google':
      return signInGoogle(opts?.clientId ?? '');
    default:
      throw new Error(`No sign-in flow for "${capability}".`);
  }
}
