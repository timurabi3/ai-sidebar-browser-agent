import { uid } from '../lib/id';
import {
  CHAT_PORT,
  postToPanel,
  type PanelToWorker,
  type SettingsRpc,
  type SettingsRpcResponse,
} from '../lib/messaging';
import { getProviderDefinition } from '../lib/providers';
import { runOAuthSignIn } from '../lib/oauth';
import type { ChatMessage } from '../lib/types';
import { runAgentTurn } from './agent';
import {
  appendMessage,
  clearConversation,
  clearProviderKey,
  clearProviderOAuth,
  configuredProviderIds,
  getConversation,
  getSettings,
  redactSettings,
  saveSettings,
  setProviderConfig,
  setProviderKey,
  setProviderOAuth,
} from './store';

// ─────────────────────────────────────────────────────────────────────────────
// Service worker entry. Owns three things:
//   • The side-panel open behavior (toolbar click opens the panel).
//   • The chat Port (streaming turns to/from the panel).
//   • The settings RPC (get/update settings, set/clear keys) — the only path by
//     which keys enter the worker.
// ─────────────────────────────────────────────────────────────────────────────

// Open the side panel when the toolbar icon is clicked.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
    console.warn('[bg] setPanelBehavior failed:', err);
  });
});

// Only our own extension pages (the side panel) may use the chat port or the
// settings RPC. Content scripts share the same runtime messaging namespace but
// execute inside untrusted pages — without this check, code in a content-script
// context could call `settings:get` and read raw API keys. Extension-page
// senders always carry a chrome-extension://<our-id>/ URL; everything else is
// rejected.
const EXTENSION_ORIGIN = chrome.runtime.getURL('');
function isTrustedSender(sender: chrome.runtime.MessageSender | undefined): boolean {
  return !!sender?.url && sender.url.startsWith(EXTENSION_ORIGIN);
}

// ── Chat streaming Port ──────────────────────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== CHAT_PORT) return;
  if (!isTrustedSender(port.sender)) {
    port.disconnect();
    return;
  }

  // One in-flight turn per port; a new send or a stop aborts the previous.
  let controller: AbortController | null = null;
  let disconnected = false;

  const safePost = (fn: () => void) => {
    if (disconnected) return;
    try {
      fn();
    } catch {
      /* port closed mid-post; ignore */
    }
  };

  const sendState = async (busy: boolean) => {
    const conversation = await getConversation();
    const settings = await getSettings();
    safePost(() =>
      postToPanel(port, {
        type: 'state',
        conversation,
        settings: redactSettings(settings),
        configured: configuredProviderIds(settings),
        busy,
      }),
    );
  };

  port.onDisconnect.addListener(() => {
    disconnected = true;
    controller?.abort();
  });

  port.onMessage.addListener(async (msg: PanelToWorker) => {
    switch (msg.type) {
      case 'state:subscribe':
        await sendState(controller !== null);
        break;

      case 'chat:clear':
        controller?.abort();
        controller = null;
        await clearConversation();
        await sendState(false);
        break;

      case 'chat:stop':
        controller?.abort();
        controller = null;
        safePost(() => postToPanel(port, { type: 'busy', busy: false }));
        break;

      case 'chat:send': {
        const text = msg.text.trim();
        if (!text) return;

        controller?.abort();
        controller = new AbortController();
        const signal = controller.signal;

        // Commit the user message and reflect it immediately.
        const userMessage: ChatMessage = {
          id: uid('msg'),
          role: 'user',
          content: text,
          createdAt: Date.now(),
        };
        const conv = await appendMessage(userMessage);
        safePost(() => postToPanel(port, { type: 'message:add', message: userMessage }));
        safePost(() => postToPanel(port, { type: 'busy', busy: true }));

        try {
          await runAgentTurn(
            conv,
            {
              onMessage: (message) =>
                safePost(() => postToPanel(port, { type: 'message:add', message })),
              onMessageUpdate: (message) =>
                safePost(() => postToPanel(port, { type: 'message:update', message })),
              onTextDelta: (messageId, delta) =>
                safePost(() =>
                  postToPanel(port, {
                    type: 'stream',
                    messageId,
                    event: { type: 'text', delta },
                  }),
                ),
              onError: (message) =>
                safePost(() => postToPanel(port, { type: 'error', message })),
            },
            signal,
          );
        } finally {
          controller = null;
          safePost(() => postToPanel(port, { type: 'busy', busy: false }));
        }
        break;
      }
    }
  });
});

// ── Settings RPC (one-shot messages) ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: SettingsRpc, sender, sendResponse) => {
  // Reject settings RPC from anything that isn't one of our extension pages —
  // see isTrustedSender above. Returning false leaves the channel unanswered.
  if (!isTrustedSender(sender)) return false;
  handleSettingsRpc(msg)
    .then(sendResponse)
    .catch((err: unknown) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
  return true; // async response
});

async function handleSettingsRpc(msg: SettingsRpc): Promise<SettingsRpcResponse> {
  switch (msg.type) {
    case 'settings:get':
      return { ok: true, settings: await getSettings() };
    case 'settings:update':
      return { ok: true, settings: await saveSettings(msg.patch) };
    case 'settings:setKey':
      return { ok: true, settings: await setProviderKey(msg.providerId, msg.apiKey) };
    case 'settings:clearKey':
      return { ok: true, settings: await clearProviderKey(msg.providerId) };
    case 'settings:setProviderConfig':
      return { ok: true, settings: await setProviderConfig(msg.providerId, msg.config) };
    case 'settings:setOAuth':
      return { ok: true, settings: await setProviderOAuth(msg.providerId, msg.oauth) };
    case 'settings:clearOAuth':
      return { ok: true, settings: await clearProviderOAuth(msg.providerId) };
    case 'settings:signIn': {
      const def = getProviderDefinition(msg.providerId);
      if (!def) return { ok: false, error: `Unknown provider "${msg.providerId}".` };
      if (def.oauth !== 'openrouter' && def.oauth !== 'google') {
        return { ok: false, error: `${def.label} does not support sign-in.` };
      }
      const tokens = await runOAuthSignIn(def.oauth, { clientId: msg.clientId });
      return { ok: true, settings: await setProviderOAuth(msg.providerId, tokens) };
    }
    default:
      return { ok: false, error: 'Unknown settings RPC.' };
  }
}
