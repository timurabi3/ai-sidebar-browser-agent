# Privacy Policy — AI Sidebar (Browser Agent)

_Last updated: 2026-07-19_

AI Sidebar — Browser Agent ("the extension") is a Chrome extension that provides
an AI chat side panel with browser-automation tools. This policy describes what
data the extension handles and where it goes.

## The short version

- **We operate no servers and collect nothing.** The extension has no backend,
  no telemetry, no analytics, and no accounts of its own.
- **Your API keys stay on your device.** Keys and sign-in tokens are stored in
  Chrome's local extension storage (`chrome.storage.local`) and are only ever
  sent to the AI provider they belong to, to authenticate your requests.
- **Your chats stay on your device**, except that message content (and page
  content you ask the agent to read) is sent to the **AI provider you selected**
  in settings (e.g. OpenAI, Anthropic, Google, OpenRouter, DeepSeek, Moonshot,
  MiniMax, Zhipu, or your own local/self-hosted endpoint) in order to generate
  responses. That transmission happens directly from your browser to the
  provider — nothing passes through us.

## Data the extension stores locally

| Data | Where | Why |
|---|---|---|
| Provider API keys / OAuth tokens | `chrome.storage.local` (device only) | Authenticate your requests to the provider you configured |
| Chat history (one active conversation) | `chrome.storage.local` (device only) | Show your conversation when you reopen the panel |
| Settings (model, system prompt, temperature, base URLs) | `chrome.storage.local` (device only) | Remember your configuration |

You can delete all of this at any time by clearing the conversation in the
panel, removing keys in Settings, or uninstalling the extension.

## Data sent to third parties

Only one category of transmission exists: when you send a message (or the agent
reads the current page as part of answering you), the conversation content —
which may include text extracted from the page you are on — is sent to the AI
provider **you chose and configured yourself**, using **your own** API key or
sign-in. Each provider processes that data under its own privacy policy.
The extension never sends data to any endpoint other than the provider base URL
configured in your settings.

## What the extension does NOT do

- No collection of browsing history.
- No ads, no tracking, no fingerprinting, no analytics SDKs.
- No sale or sharing of any data with anyone.
- No remote code: all code ships inside the extension package.

## Permissions, briefly

The extension requests broad host access (`<all_urls>`) and scripting solely so
the agent can read and interact with the page **you are currently viewing when
you invoke it**. Page content is only read when you ask the agent to do
something, and it is only shared with your configured AI provider as described
above.

## Security notes

Chrome extensions have no hardware-backed secret store; API keys in
`chrome.storage.local` are stored unencrypted, readable by anyone with access
to your browser profile. The extension confines keys to its background service
worker — they are never exposed to web pages or content scripts.

## Contact

Questions or concerns: open an issue on this repository.
