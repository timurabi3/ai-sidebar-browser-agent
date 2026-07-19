// ─────────────────────────────────────────────────────────────────────────────
// A minimal chrome.* mock so the side panel React app can render in a plain
// browser tab (Vite dev server) for DESIGN PREVIEW ONLY. It fakes the runtime
// port the panel connects to and replies with a seeded conversation + settings
// snapshot, so every visual surface (empty state, bubbles, tool cards, model
// picker, settings) can be inspected without loading the extension in Chrome.
//
// This file is NOT part of the extension build — it's only imported by
// preview/main.tsx via the preview/ Vite entry. It never ships in dist/.
// ─────────────────────────────────────────────────────────────────────────────

type Listener = (msg: unknown) => void;

interface FakePort {
  name: string;
  onMessage: { addListener: (cb: Listener) => void; removeListener: (cb: Listener) => void };
  onDisconnect: { addListener: (cb: () => void) => void };
  postMessage: (msg: unknown) => void;
  disconnect: () => void;
}

// A seeded conversation showing every message type at once, so the redesign can
// be judged against real content density.
const SEED_CONVERSATION = {
  id: 'preview',
  createdAt: Date.now(),
  messages: [
    {
      id: 'm1',
      role: 'user',
      content: 'Find every external link on this page and list the first few.',
      createdAt: Date.now() - 60000,
    },
    {
      id: 'm2',
      role: 'assistant',
      content:
        "I'll scan the DOM for anchor elements and filter to external hosts.",
      createdAt: Date.now() - 55000,
      model: 'Anthropic · claude-3-5-sonnet-latest',
      toolCalls: [
        {
          id: 'call_1',
          name: 'query_dom',
          arguments: { selector: 'a[href^="http"]', limit: 50 },
        },
      ],
    },
    {
      id: 'm3',
      role: 'tool',
      content: JSON.stringify(
        { matched: 12, sample: ['https://anthropic.com', 'https://vitejs.dev', 'https://react.dev'] },
        null,
        2,
      ),
      toolResult: {
        toolCallId: 'call_1',
        name: 'query_dom',
        content: '{"matched":12,"sample":["https://anthropic.com","https://vitejs.dev","https://react.dev"]}',
      },
      createdAt: Date.now() - 50000,
    },
    {
      id: 'm4',
      role: 'assistant',
      content:
        'Found 12 external links. The first three:\n\n1. anthropic.com\n2. vitejs.dev\n3. react.dev\n\nWant me to open any of them, or export the full list?',
      createdAt: Date.now() - 45000,
      model: 'Anthropic · claude-3-5-sonnet-latest',
    },
  ],
};

const SEED_SETTINGS = {
  activeProviderId: 'anthropic',
  activeModelId: 'claude-sonnet-5',
  providers: {
    // Key-connected (shows "connected" + API-key active badge).
    anthropic: { apiKey: 'sk-ant-preview' },
    // OAuth-connected (shows "connected" + sign-in active + Disconnect).
    gemini: { apiKey: '', oauth: { accessToken: '', accountLabel: 'you@gmail.com' } },
    // Both key AND sign-in (shows the "using sign-in, key kept as fallback" note).
    openrouter: {
      apiKey: 'sk-or-preview',
      oauth: { accessToken: '', accountLabel: 'OpenRouter account' },
    },
  },
  toolsEnabled: true,
  temperature: 0.7,
  maxToolIterations: 8,
  systemPrompt:
    'You are an AI agent embedded in the browser with tools to read and control the page.',
};

function makePort(name: string): FakePort {
  const listeners: Listener[] = [];
  const port: FakePort = {
    name,
    onMessage: {
      addListener: (cb) => listeners.push(cb),
      removeListener: (cb) => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      },
    },
    onDisconnect: { addListener: () => {} },
    postMessage: (msg: unknown) => {
      // Reply to a state subscription with a full snapshot. Matches the real
      // PanelToWorker protocol in src/lib/messaging.ts.
      const type = (msg as { type?: string })?.type;
      if (type === 'state:subscribe') {
        // `?empty` renders the empty state (serif greeting + example cards).
        const empty = typeof location !== 'undefined' && location.search.includes('empty');
        queueMicrotask(() =>
          listeners.forEach((l) =>
            l({
              type: 'state',
              conversation: empty
                ? { ...SEED_CONVERSATION, messages: [] }
                : SEED_CONVERSATION,
              settings: SEED_SETTINGS,
              configured: ['anthropic'],
              busy: false,
            }),
          ),
        );
      }
      if (type === 'chat:clear') {
        queueMicrotask(() =>
          listeners.forEach((l) =>
            l({
              type: 'state',
              conversation: { ...SEED_CONVERSATION, messages: [] },
              settings: SEED_SETTINGS,
              configured: ['anthropic'],
              busy: false,
            }),
          ),
        );
      }
    },
    disconnect: () => {},
  };
  return port;
}

export function installChromeMock() {
  const g = globalThis as unknown as { chrome?: unknown };
  if (g.chrome && (g.chrome as { runtime?: unknown }).runtime) return;
  // Mutable copy so RPCs (setKey, setProviderConfig, signIn…) visibly persist
  // within the preview session.
  const settingsState = JSON.parse(JSON.stringify(SEED_SETTINGS));

  g.chrome = {
    runtime: {
      connect: (opts: { name: string }) => makePort(opts?.name ?? 'port'),
      // One-shot settings RPC used by the settings panel (useSettings).
      sendMessage: async (msg: { type?: string; providerId?: string; apiKey?: string; config?: Record<string, unknown> }) => {
        switch (msg?.type) {
          case 'settings:get':
            return { ok: true, settings: settingsState };
          case 'settings:setKey':
            settingsState.providers[msg.providerId!] = {
              ...(settingsState.providers[msg.providerId!] ?? { apiKey: '' }),
              apiKey: msg.apiKey,
            };
            return { ok: true, settings: settingsState };
          case 'settings:setProviderConfig':
            settingsState.providers[msg.providerId!] = {
              ...(settingsState.providers[msg.providerId!] ?? { apiKey: '' }),
              ...msg.config,
            };
            return { ok: true, settings: settingsState };
          case 'settings:signIn':
            settingsState.providers[msg.providerId!] = {
              ...(settingsState.providers[msg.providerId!] ?? { apiKey: '' }),
              oauth: { accessToken: 'preview', accountLabel: 'preview account' },
            };
            return { ok: true, settings: settingsState };
          default:
            return { ok: true, settings: settingsState };
        }
      },
      onMessage: { addListener: () => {}, removeListener: () => {} },
      lastError: undefined,
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
      },
    },
    tabs: {
      query: async () => [{ id: 1, url: 'https://example.com', title: 'Example' }],
    },
  };
}

// Self-install on import so a `<script type="module" src="chrome-mock.ts">` placed
// before the app entry guarantees chrome.* exists before any app module runs.
installChromeMock();
