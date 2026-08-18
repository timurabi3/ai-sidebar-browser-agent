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
const CONVERSATIONS_KEY = 'conversations.v1';
const LEGACY_CONVERSATION_KEY = 'conversation.v1';

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

// ── Conversations (multi) ────────────────────────────────────────────────────

interface ConversationStore {
  conversations: Conversation[];
  activeId: string;
}

/**
 * Serialize all store read-modify-write cycles through a single promise chain.
 * The agent loop and the panel can mutate conversations concurrently (append a
 * message, switch/delete), and chrome.storage has no transaction support — an
 * interleaved load→mutate→save would silently drop the earlier write. The lock
 * makes every mutation atomic relative to the others.
 */
let lock: Promise<unknown> = Promise.resolve();

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const run = lock.then(task, task);
  lock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function createEmptyConversation(): Conversation {
  const now = Date.now();
  return { id: uid('conv'), title: 'New chat', messages: [], createdAt: now, updatedAt: now };
}

function activeOf(store: ConversationStore): Conversation {
  return store.conversations.find((c) => c.id === store.activeId) ?? store.conversations[0];
}

/** Read the store, migrating the legacy single-conversation key on first load. */
async function readStore(): Promise<ConversationStore> {
  const raw = await chrome.storage.local.get([CONVERSATIONS_KEY, LEGACY_CONVERSATION_KEY]);
  const existing = raw[CONVERSATIONS_KEY] as ConversationStore | undefined;
  if (existing && Array.isArray(existing.conversations) && existing.conversations.length > 0) {
    return normalizeStore(existing);
  }

  // Upgrade path: wrap the old `conversation.v1` object into the new list.
  // No data loss — the existing conversation becomes the active one.
  const legacy = raw[LEGACY_CONVERSATION_KEY] as Conversation | undefined;
  if (legacy && legacy.id) {
    const store = normalizeStore({ conversations: [legacy], activeId: legacy.id });
    await chrome.storage.local.set({ [CONVERSATIONS_KEY]: store });
    await chrome.storage.local.remove(LEGACY_CONVERSATION_KEY);
    return store;
  }

  const fresh = createEmptyConversation();
  const store: ConversationStore = { conversations: [fresh], activeId: fresh.id };
  await chrome.storage.local.set({ [CONVERSATIONS_KEY]: store });
  return store;
}

/** Ensure a non-empty list and a valid activeId. */
function normalizeStore(store: ConversationStore): ConversationStore {
  const conversations = store.conversations.filter((c) => c && c.id);
  if (conversations.length === 0) {
    const fresh = createEmptyConversation();
    return { conversations: [fresh], activeId: fresh.id };
  }
  const activeId = conversations.some((c) => c.id === store.activeId)
    ? store.activeId
    : conversations[0].id;
  return { conversations, activeId };
}

async function writeStore(store: ConversationStore): Promise<void> {
  await chrome.storage.local.set({ [CONVERSATIONS_KEY]: store });
}

/** The active conversation (used by the agent loop and the port state snapshot). */
export function getActiveConversation(): Promise<Conversation> {
  return withLock(async () => activeOf(await readStore()));
}

/** All conversations, newest first (creation unshifts to the front). */
export function listConversations(): Promise<Conversation[]> {
  return withLock(async () => (await readStore()).conversations);
}

/** Create a new empty conversation and make it active. */
export function createConversation(): Promise<Conversation> {
  return withLock(async () => {
    const store = await readStore();
    const conv = createEmptyConversation();
    store.conversations.unshift(conv);
    store.activeId = conv.id;
    await writeStore(store);
    return conv;
  });
}

/** Switch the active conversation. No-op (returns active) if the id is unknown. */
export function switchConversation(id: string): Promise<Conversation> {
  return withLock(async () => {
    const store = await readStore();
    const conv = store.conversations.find((c) => c.id === id);
    if (!conv) return activeOf(store);
    store.activeId = id;
    await writeStore(store);
    return conv;
  });
}

/**
 * Delete a conversation. If it was active, activate the most recent remaining
 * conversation (or a fresh one if the list is now empty). Returns the removed
 * conversation, or null if no such id existed.
 */
export function deleteConversation(id: string): Promise<Conversation | null> {
  return withLock(async () => {
    const store = await readStore();
    const idx = store.conversations.findIndex((c) => c.id === id);
    if (idx < 0) return null;
    const [removed] = store.conversations.splice(idx, 1);
    if (store.activeId === id) {
      if (store.conversations.length === 0) {
        const fresh = createEmptyConversation();
        store.conversations.push(fresh);
        store.activeId = fresh.id;
      } else {
        store.activeId = store.conversations[0].id;
      }
    }
    await writeStore(store);
    return removed;
  });
}

/**
 * Append a message to a SPECIFIC conversation (by id, not "the active one").
 * Scoped to id so a turn in progress keeps writing to the conversation it
 * started in even if the user switches away mid-turn.
 */
export function appendMessage(
  conversationId: string,
  message: ChatMessage,
): Promise<Conversation> {
  return withLock(async () => {
    const store = await readStore();
    const conv = store.conversations.find((c) => c.id === conversationId) ?? activeOf(store);
    conv.messages.push(message);
    if (conv.title === 'New chat' && message.role === 'user') {
      conv.title = message.content.slice(0, 48) || 'New chat';
    }
    conv.updatedAt = Date.now();
    await writeStore(store);
    return conv;
  });
}

/** Replace (or append) a message within a specific conversation. */
export function replaceMessage(
  conversationId: string,
  message: ChatMessage,
): Promise<Conversation> {
  return withLock(async () => {
    const store = await readStore();
    const conv = store.conversations.find((c) => c.id === conversationId) ?? activeOf(store);
    const idx = conv.messages.findIndex((m) => m.id === message.id);
    if (idx >= 0) conv.messages[idx] = message;
    else conv.messages.push(message);
    conv.updatedAt = Date.now();
    await writeStore(store);
    return conv;
  });
}
