# AI Sidebar — Browser Agent (Manifest V3)

A deeply-integrated AI side panel with full browser-agent control over the DOM.
Claude-style minimalist dark UI, multi-provider API connectors, and a tool-calling
layer that lets models read and act on the current page (click, type, scroll,
extract, navigate).

Stack: **Vite + React + TypeScript + Tailwind CSS**, Chrome MV3 (`chrome.sidePanel`).

---

## Quick start

```bash
npm install
npm run dev      # dev build with HMR (crxjs) → dist/ is watched
# or
npm run build    # production build → dist/
```

Load in Chrome:

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select the `dist/` folder.
3. Click the toolbar icon (or open the side panel) to launch the UI.
4. Open **Settings (⚙)** → add an API key for any provider → pick a model
   (top-left) → chat.

> `npm run dev` keeps `dist/` live-rebuilding. After the first `Load unpacked`,
> code changes hot-reload the panel; manifest/permission changes need a manual
> **Reload** on the extensions page.

---

## Architecture

Three isolated JS contexts, connected only by typed message passing
(`src/lib/messaging.ts`):

```
┌─────────────────┐   Port (stream)   ┌──────────────────────┐  tabs.sendMessage  ┌───────────────┐
│  Side Panel     │ ◀───────────────▶ │  Service Worker      │ ◀───────────────▶ │ Content Script │
│  (React UI)     │   settings RPC    │  (state/keys/agent)  │   tool exec RPC    │  (DOM r/w)     │
└─────────────────┘                   └──────────────────────┘                    └───────────────┘
```

- **Side panel** (`src/sidepanel/`) — React UI. Holds no API logic; all
  streaming/message-passing is in `state/usePanelPort.ts`, all settings in
  `state/useSettings.ts`. Components are presentational.
- **Service worker** (`src/background/`) — the only context that sees API keys.
  Owns persistence (`store.ts`), the agent loop (`agent.ts`), and message
  routing (`index.ts`).
- **Content script** (`src/content/`) — tiny surface: receives tool calls, runs
  DOM tools (`dom-tools.ts`), returns results. No keys, no chat state.

### Provider layer (`src/lib/providers/`)

One adapter per wire format, all normalized to a `StreamEvent` async generator:

| Adapter | Covers |
|---|---|
| `openai-compatible.ts` | OpenRouter, OpenAI, Kimi (Moonshot), MiniMax, GLM (Zhipu), DeepSeek, local (Ollama/LM Studio/vLLM) |
| `anthropic.ts` | Anthropic Messages API |
| `gemini.ts` | Google Gemini `streamGenerateContent` |

Adding an OpenAI-clone vendor = one entry in `registry.ts` (data only). All three
adapters fully implement **streaming + tool calling** (assembling streamed
tool-call fragments into complete calls).

### Tool-calling layer (`src/lib/tools/` + `src/content/dom-tools.ts`)

Provider-neutral JSON-Schema tools with a `runsIn` hint (`content` = DOM tools in
the page, `background` = tab-level tools in the worker). Current tools:
`get_page_content`, `query_dom`, `click_element`, `type_text`, `scroll_page`,
`wait_for_element`, `get_page_metadata`, `navigate`.

The **agent loop** (`background/agent.ts`) streams a completion → executes any
requested tools → feeds results back → repeats until the model stops or the
iteration cap is hit.

Element addressing uses a `ref` scheme: `get_page_content` / `query_dom` stamp a
`data-ai-ref` attribute and hand the model a ref (`e12`) that later tool calls
resolve back to the live element.

---

## Security posture (be honest)

MV3 has **no secure key enclave**. Keys live in `chrome.storage.local` and are
readable if the extension is unpacked. The boundary this project actually
enforces: **keys never leave the service worker** — they are not sent to content
scripts or into page context, and are redacted from the streaming state snapshot
(`store.ts › redactSettings`). The trusted, same-origin side panel sees them only
while the user is actively editing them in Settings.

`host_permissions: <all_urls>` + full DOM access is required for a "full browser
control" agent. Narrow it per deployment if you want to scope the agent to
specific origins.

---

## Extension points

- **MAIN-world bridge** — read the page's own JS variables / framework internals
  via `chrome.scripting.executeScript({ world: 'MAIN' })`. Deliberately not
  enabled by default (see `src/content/index.ts`).
- **Attachment scope** — the paperclip currently attaches a single
  `get_page_content` text snapshot (capped at 12k chars) plus title/URL.
  Future: screenshot capture, user text-selection scope.
- **Conversation rename** — history titles auto-derive from the first user
  message (truncated 48 chars); explicit rename is a UI nicety for later.

## Conversation history & attachments (implemented)

- **Multi-conversation history** — `store.ts` persists a `Conversation[]` plus
  `activeId` under `conversations.v1`, migrating any legacy `conversation.v1`
  on upgrade. The side panel's clock icon opens the history dropdown: new
  chat, switch, hover-delete.
- **Page attachments** — the composer paperclip snapshots the active tab
  (title, URL, extracted text via the content script) into an attachment chip
  that is sent to the provider as `[Attached page context]`. Remove with ✕.

---

## Project layout

```
src/
  manifest.config.ts        MV3 manifest (crxjs defineManifest)
  lib/
    types.ts                shared contract across all three contexts
    messaging.ts            typed message-passing protocol
    id.ts
    providers/              provider registry + adapters
    tools/registry.ts       tool schemas + routing
  background/               service worker: store, agent loop, entry
  content/                  content script + DOM tools
  sidepanel/                React UI
    state/                  port + settings hooks (all the logic)
    components/             presentational components
  styles/index.css          design tokens (the redesign knob) + component classes
```
