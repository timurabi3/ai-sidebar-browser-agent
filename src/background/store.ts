import { uid } from '../lib/id';
import type {
  ChatMessage,
  Conversation,
  OAuthTokens,
  ProviderConfig,
  Settings,
} from '../lib/types';

// ─────────────────────────────────────────────────────────────────────────────
// Worker-owned persistence. Everything lives in chrome.storage.local. This is
// the ONLY module that reads/writes API keys.
//
// Honesty about "secure key handling" (MV3 has no secure enclave): keys sit in
// chrome.storage.local, which is readable if someone unpacks the extension. The
// real boundary we enforce is that keys never travel to a content script or into
// page context — only the worker and the (trusted, same-origin) side panel see
// them. `redactSettings()` strips them from any snapshot that doesn't need them.
// ─────────────────────────────────────────────────────────────────────────────

const SETTINGS_KEY = 'settings.v1';
const CONVERSATION_KEY = 'conversation.v1';

export const DEFAULT_SETTINGS: Settings = {
  activeProviderId: 'openrouter',
  activeModelId: 'anthropic/claude-sonnet-5',
  providers: {},
  systemPrompt:
    'You are an AI agent embedded in the user\'s browser with tools to read and ' +
    'control the current web page. Read the page before acting. Use one tool at a ' +
    'time, observe the result, then decide the next step. Be concise.\n\n' +
    'You have a limited number of tool calls per turn. Work efficiently: don\'t ' +
    're-check something you already read, don\'t call a tool "just to be sure" if ' +
    'the last result already answered it, and once you have enough information to ' +
    'answer, stop calling tools and answer. If you run out of tool calls, answer ' +
    'with what you have and say plainly what you couldn\'t verify.',
  temperature: 0.7,
  toolsEnabled: true,
  maxToolIterations: 8,
};

// ── Settings ─────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = raw[SETTINGS_KEY] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}), providers: stored?.providers ?? {} };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  // Never let a patch clobber the providers map wholesale unless intended.
  const next: Settings = {
    ...current,
    ...patch,
    providers: patch.providers ?? current.providers,
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/**
 * Normalize a pasted API key. This is the #1 cause of "401 invalid key": copying
 * a key drags a trailing newline, a leading space, or (from PDFs/chat) a
 * zero-width or non-breaking space into the string, all of which the provider
 * rejects. We strip every whitespace char (keys are never whitespace-containing)
 * plus the usual invisible unicode gremlins.
 */
export function sanitizeApiKey(raw: string): string {
  return raw
    .replace(/[\s​‌‍﻿ ]/g, '') // whitespace + zero-width/nbsp
    .trim();
}

export async function setProviderKey(
  providerId: string,
  apiKey: string,
): Promise<Settings> {
  const current = await getSettings();
  const existing: ProviderConfig = current.providers[providerId] ?? { apiKey: '' };
  const next: Settings = {
    ...current,
    providers: {
      ...current.providers,
      [providerId]: { ...existing, apiKey: sanitizeApiKey(apiKey) },
    },
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/** Set/replace OAuth tokens for a provider (never touches the apiKey). */
export async function setProviderOAuth(
  providerId: string,
  oauth: OAuthTokens,
): Promise<Settings> {
  const current = await getSettings();
  const existing: ProviderConfig = current.providers[providerId] ?? { apiKey: '' };
  const next: Settings = {
    ...current,
    providers: { ...current.providers, [providerId]: { ...existing, oauth } },
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/** Disconnect a provider's sign-in (never touches the apiKey). */
export async function clearProviderOAuth(providerId: string): Promise<Settings> {
  const current = await getSettings();
  const existing = current.providers[providerId];
  if (!existing) return current;
  const { oauth: _drop, ...rest } = existing;
  const next: Settings = {
    ...current,
    providers: { ...current.providers, [providerId]: rest },
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/**
 * Patch non-secret provider config (baseUrl, extraHeaders). Deliberately CANNOT
 * accept `apiKey` — the type excludes it — so a base-URL save can never wipe the
 * key. This was the original Bug 1/Bug 4 root cause.
 */
export async function setProviderConfig(
  providerId: string,
  config: Partial<Omit<ProviderConfig, 'apiKey' | 'oauth'>>,
): Promise<Settings> {
  const current = await getSettings();
  const existing: ProviderConfig = current.providers[providerId] ?? { apiKey: '' };
  const next: Settings = {
    ...current,
    providers: {
      ...current.providers,
      [providerId]: { ...existing, ...config },
    },
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function clearProviderKey(providerId: string): Promise<Settings> {
  const current = await getSettings();
  const providers = { ...current.providers };
  if (providers[providerId]) providers[providerId] = { ...providers[providerId], apiKey: '' };
  const next: Settings = { ...current, providers };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/**
 * Strip secrets (API keys AND OAuth tokens) from a settings object before it
 * goes anywhere non-essential (the panel snapshot). We keep non-secret config
 * (baseUrl, extraHeaders) and a boolean-ish marker so the UI can still show
 * "connected" without ever receiving the secret values.
 */
export function redactSettings(settings: Settings): Settings {
  const providers: Record<string, ProviderConfig> = {};
  for (const [id, cfg] of Object.entries(settings.providers)) {
    providers[id] = {
      ...cfg,
      apiKey: '', // never expose the key
      // Preserve whether an OAuth connection exists (+ its label) but drop tokens.
      oauth: cfg.oauth
        ? { accessToken: '', accountLabel: cfg.oauth.accountLabel }
        : undefined,
    };
  }
  return { ...settings, providers };
}

/** Provider ids that are usable — have a non-empty key OR an OAuth connection. */
export function configuredProviderIds(settings: Settings): string[] {
  return Object.entries(settings.providers)
    .filter(([, cfg]) => (cfg.apiKey && cfg.apiKey.length > 0) || !!cfg.oauth)
    .map(([id]) => id);
}

// ── Conversation ─────────────────────────────────────────────────────────────

export async function getConversation(): Promise<Conversation> {
  const raw = await chrome.storage.local.get(CONVERSATION_KEY);
  const stored = raw[CONVERSATION_KEY] as Conversation | undefined;
  if (stored) return stored;
  return createEmptyConversation();
}

export function createEmptyConversation(): Conversation {
  const now = Date.now();
  return { id: uid('conv'), title: 'New chat', messages: [], createdAt: now, updatedAt: now };
}

export async function saveConversation(conv: Conversation): Promise<void> {
  conv.updatedAt = Date.now();
  await chrome.storage.local.set({ [CONVERSATION_KEY]: conv });
}

export async function appendMessage(message: ChatMessage): Promise<Conversation> {
  const conv = await getConversation();
  conv.messages.push(message);
  if (conv.title === 'New chat' && message.role === 'user') {
    conv.title = message.content.slice(0, 48) || 'New chat';
  }
  await saveConversation(conv);
  return conv;
}

export async function replaceMessage(message: ChatMessage): Promise<Conversation> {
  const conv = await getConversation();
  const idx = conv.messages.findIndex((m) => m.id === message.id);
  if (idx >= 0) conv.messages[idx] = message;
  else conv.messages.push(message);
  await saveConversation(conv);
  return conv;
}

export async function clearConversation(): Promise<Conversation> {
  const fresh = createEmptyConversation();
  await saveConversation(fresh);
  return fresh;
}
