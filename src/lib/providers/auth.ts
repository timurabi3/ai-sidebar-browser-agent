import type { ProviderConfig, ProviderDefinition } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Effective-auth resolution. A provider may have BOTH an API key and an OAuth
// sign-in configured. Policy (chosen by the user): SIGN-IN WINS. This module is
// the single place that decides which credential a request uses, so the agent
// and adapters never each re-implement the priority (a classic source of the
// "which one is actually being used?" confusion).
//
// It returns a *derived* ProviderConfig whose `apiKey` slot carries the bearer
// the adapter should send, plus the auth method label for the UI. OAuth flows
// that need a non-Bearer scheme (none of ours currently) would extend this.
// ─────────────────────────────────────────────────────────────────────────────

export type AuthMethod = 'oauth' | 'apiKey' | 'none';

export interface ResolvedAuth {
  /** Config the adapter should use (apiKey carries the effective bearer). */
  config: ProviderConfig;
  /** Which credential was chosen — surfaced to the UI as the active method. */
  method: AuthMethod;
  /** True if the provider requires auth but none is available. */
  missing: boolean;
}

export function resolveAuth(
  def: ProviderDefinition,
  config: ProviderConfig | undefined,
): ResolvedAuth {
  const cfg: ProviderConfig = config ?? { apiKey: '' };

  // Sign-in wins: if a valid OAuth access token is present, use it as the bearer.
  const oauthToken = cfg.oauth?.accessToken?.trim();
  if (oauthToken) {
    return {
      method: 'oauth',
      missing: false,
      config: {
        ...cfg,
        apiKey: oauthToken,
        extraHeaders: {
          ...(cfg.extraHeaders ?? {}),
          // OAuth-authenticated calls send a Bearer; some providers also key off
          // a token-type header. Adapters that use x-api-key (Anthropic) or
          // x-goog-api-key (Gemini) still read config.apiKey, so the token flows
          // through uniformly regardless of the header name the adapter picks.
        },
      },
    };
  }

  const apiKey = cfg.apiKey?.trim();
  if (apiKey) {
    return { method: 'apiKey', missing: false, config: { ...cfg, apiKey } };
  }

  return {
    method: 'none',
    missing: def.requiresKey,
    config: { ...cfg, apiKey: '' },
  };
}
