// ─────────────────────────────────────────────────────────────────────────────
// Typed message-passing protocol. Two transports:
//
//   1. Long-lived Port (side panel <-> background) — carries the chat stream.
//      Survives the service worker's idle timeout better than one-shot messages
//      and gives us ordered, backpressure-friendly token delivery.
//
//   2. One-shot runtime/tabs messages (background <-> content) — request/response
//      RPC for executing DOM tools in the page.
//
// Everything is discriminated-union typed so a wrong message shape is a compile
// error, not a runtime surprise.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ChatMessage,
  Conversation,
  OAuthTokens,
  ProviderConfig,
  Settings,
  StreamEvent,
  ToolCall,
  ToolResult,
} from './types';

// ── Channel / event name constants ───────────────────────────────────────────

export const CHAT_PORT = 'chat' as const;

// ── Panel → Worker (over the chat Port) ──────────────────────────────────────

export type PanelToWorker =
  | { type: 'chat:send'; text: string }
  | { type: 'chat:stop' } // abort the in-flight turn
  | { type: 'chat:clear' } // wipe the active conversation
  | { type: 'state:subscribe' }; // request a full state snapshot

// ── Worker → Panel (over the chat Port) ──────────────────────────────────────

export type WorkerToPanel =
  | {
      type: 'state';
      conversation: Conversation;
      /** Settings with API keys redacted — the panel gets raw keys only via the settings RPC. */
      settings: Settings;
      /** Provider ids that have a key configured (derived, no key values). */
      configured: string[];
      busy: boolean;
    }
  | { type: 'stream'; messageId: string; event: StreamEvent }
  | { type: 'message:add'; message: ChatMessage } // full message committed to history
  | { type: 'message:update'; message: ChatMessage } // in-place replace (e.g. finalize)
  | { type: 'busy'; busy: boolean }
  | { type: 'error'; message: string };

// ── Panel/Worker one-shot RPC (settings live outside the streaming port) ──────

export type SettingsRpc =
  | { type: 'settings:get' }
  | { type: 'settings:update'; patch: Partial<Settings> }
  | { type: 'settings:setKey'; providerId: string; apiKey: string }
  | { type: 'settings:clearKey'; providerId: string }
  // Patch a single provider's config (baseUrl, extraHeaders, oauth) WITHOUT
  // ever touching its apiKey — prevents a base-URL save from clobbering the key.
  | {
      type: 'settings:setProviderConfig';
      providerId: string;
      config: Partial<Omit<ProviderConfig, 'apiKey'>>;
    }
  // OAuth token lifecycle (sign-in connector). Tokens live in the same
  // ProviderConfig, never leave the worker, and are stripped from snapshots.
  | { type: 'settings:setOAuth'; providerId: string; oauth: OAuthTokens }
  | { type: 'settings:clearOAuth'; providerId: string }
  // Run a provider's interactive sign-in flow IN THE WORKER (chrome.identity is
  // worker-only). On success the worker persists the tokens itself and returns
  // the updated settings; the panel never sees the token exchange.
  | { type: 'settings:signIn'; providerId: string; clientId?: string };

export type SettingsRpcResponse =
  | { ok: true; settings: Settings }
  | { ok: false; error: string };

// ── Worker → Content (tool execution RPC via chrome.tabs.sendMessage) ─────────

export type WorkerToContent =
  | { channel: 'tool'; toolCall: ToolCall }
  | { channel: 'ping' };

export type ContentToWorker =
  | { channel: 'tool:result'; result: ToolResult }
  | { channel: 'pong' };

// ── Typed helpers ────────────────────────────────────────────────────────────

/** Post a typed message from the panel to the worker over a connected port. */
export function postToWorker(port: chrome.runtime.Port, msg: PanelToWorker): void {
  port.postMessage(msg);
}

/** Post a typed message from the worker to the panel over a connected port. */
export function postToPanel(port: chrome.runtime.Port, msg: WorkerToPanel): void {
  port.postMessage(msg);
}

/** Fire a settings RPC from the panel and await the worker's typed response. */
export async function sendSettingsRpc(
  msg: SettingsRpc,
): Promise<SettingsRpcResponse> {
  const res = (await chrome.runtime.sendMessage(msg)) as SettingsRpcResponse | undefined;
  if (!res) return { ok: false, error: 'No response from service worker.' };
  return res;
}

/**
 * Execute a tool in a specific tab's content script and await its result. The
 * content script is declared for <all_urls> at document_idle, so on any normal
 * page it is already present. If sendMessage fails, the page is one where no
 * content script can run (chrome://, the Web Store, the New Tab page, PDF
 * viewer) — injection would fail there too — so we surface a clear error rather
 * than pretend to retry.
 */
export async function callContentTool(
  tabId: number,
  toolCall: ToolCall,
): Promise<ToolResult> {
  const msg: WorkerToContent = { channel: 'tool', toolCall };
  try {
    const res = (await chrome.tabs.sendMessage(tabId, msg)) as ContentToWorker | undefined;
    if (res && res.channel === 'tool:result') return res.result;
    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: 'Content script returned an unexpected response.',
      isError: true,
    };
  } catch (err) {
    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: `Could not reach the page (${
        err instanceof Error ? err.message : String(err)
      }). This page may block content scripts (e.g. chrome://, the Web Store, or the New Tab page).`,
      isError: true,
    };
  }
}
