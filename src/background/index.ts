import { uid } from '../lib/id';
import {
  CHAT_PORT,
  callContentTool,
  postToPanel,
  type PageContextRpc,
  type PageContextRpcResponse,
  type PanelToWorker,
  type SettingsRpc,
  type SettingsRpcResponse,
} from '../lib/messaging';
import { getProviderDefinition } from '../lib/providers';
import { runOAuthSignIn } from '../lib/oauth';
import type { ChatMessage, PageContext, ToolCall } from '../lib/types';
import { getActiveTab, runAgentTurn } from './agent';
import {
  appendMessage,
  clearProviderKey,
  clearProviderOAuth,
  configuredProviderIds,
  createConversation,
  deleteConversation,
  getActiveConversation,
  getSettings,
  listConversations,
  redactSettings,
  saveSettings,
  setProviderConfig,
  setProviderKey,
  setProviderOAuth,
  switchConversation,
} from './store';

// ─────────────────────────────────────────────────────────────────────────────
// Service worker entry. Owns three things:
//   • The side-panel open behavior (toolbar click opens the panel).
//   • The chat Port (streaming turns to/from the panel + conversation lifecycle).
//   • The settings + page-context RPCs — the only paths by which keys enter the
//     worker, and the path by which the panel captures the current page.
// ─────────────────────────────────────────────────────────────────────────────

// Open the side panel when the toolbar icon is clicked.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
    console.warn('[bg] setPanelBehavior failed:', err);
  });
});

// ── Chat streaming Port ──────────────────────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== CHAT_PORT) return;

  // One in-flight turn per port; a new send, a switch, or a stop aborts the previous.
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
    const conversation = await getActiveConversation();
    const conversations = await listConversations();
    const settings = await getSettings();
    safePost(() =>
      postToPanel(port, {
        type: 'state',
        conversation,
        conversations,
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

      case 'conversation:new':
        controller?.abort();
        controller = null;
        await createConversation();
        await sendState(false);
        break;

      case 'conversation:switch':
        controller?.abort();
        controller = null;
        await switchConversation(msg.id);
        await sendState(false);
        break;

      case 'conversation:delete':
        controller?.abort();
        controller = null;
        await deleteConversation(msg.id);
        await sendState(false);
        break;

      case 'chat:stop':
        controller?.abort();
        controller = null;
        safePost(() => postToPanel(port, { type: 'busy', busy: false }));
        break;

      case 'chat:send': {
        const text = msg.text.trim();
        if (!text && !msg.attachment) return;

        controller?.abort();
        controller = new AbortController();
        const signal = controller.signal;

        const content = msg.attachment ? composeMessage(text, msg.attachment) : text;

        // Commit the user message and reflect it immediately.
        const active = await getActiveConversation();
        const userMessage: ChatMessage = {
          id: uid('msg'),
          role: 'user',
          content,
          createdAt: Date.now(),
        };
        const conv = await appendMessage(active.id, userMessage);
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

// ── One-shot RPCs (settings + page context) ─────────────────────────────────

chrome.runtime.onMessage.addListener(
  (msg: SettingsRpc | PageContextRpc, _sender, sendResponse) => {
    if (msg.type === 'page:getContext') {
      handlePageContextRpc()
        .then(sendResponse)
        .catch((err: unknown) =>
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
      return true;
    }
    handleSettingsRpc(msg)
      .then(sendResponse)
      .catch((err: unknown) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
    return true; // async response
  },
);

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

// ── Page-context capture (attachment) ────────────────────────────────────────

async function handlePageContextRpc(): Promise<PageContextRpcResponse> {
  const tab = await getActiveTab();
  if (!tab?.id) return { ok: false, error: 'No active tab to capture.' };

  const url = tab.url ?? '';
  const title = tab.title ?? '';

  const toolCall: ToolCall = {
    id: uid('tool'),
    name: 'get_page_content',
    arguments: { mode: 'text', maxChars: 12000 },
  };
  const result = await callContentTool(tab.id, toolCall);

  if (result.isError) {
    // Text extraction is unavailable on pages that block content scripts
    // (chrome://, the Web Store, PDF viewer, …). Not fatal — attach the page
    // identity anyway so the model still knows what the user is looking at.
    return { ok: true, context: { title, url, text: '' } };
  }

  // get_page_content (mode text) prefixes "URL: …\nTitle: …\n\n" before the
  // visible text. We already captured URL/title from the tab, so strip the
  // header to keep `text` as pure page content.
  const text = result.content.replace(/^URL: [^\n]*\nTitle: [^\n]*\n\n/, '');
  return { ok: true, context: { title, url, text } };
}

/** Fold a page snapshot into the outgoing user message. */
function composeMessage(text: string, attachment: PageContext): string {
  const parts: string[] = [];
  if (text) parts.push(text);

  const block: string[] = ['[Attached page context]'];
  if (attachment.title) block.push(`Title: ${attachment.title}`);
  if (attachment.url) block.push(`URL: ${attachment.url}`);
  if (attachment.text) block.push('', 'Page text:', attachment.text);

  parts.push(block.join('\n'));
  return parts.join('\n\n');
}
