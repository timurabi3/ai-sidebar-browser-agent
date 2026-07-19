import type { ContentToWorker, WorkerToContent } from '../lib/messaging';
import { executeDomTool } from './dom-tools';

// ─────────────────────────────────────────────────────────────────────────────
// Content script. Runs in every page (ISOLATED world) with full DOM read/write.
// Its only job: listen for tool-execution requests from the background worker,
// run the corresponding DOM tool, and reply with the result.
//
// It holds NO API keys and no chat state — that all lives in the worker. Keeping
// this surface tiny is the security boundary: a compromised page can only ever
// see the DOM it already owns, never the user's credentials.
//
// A MAIN-world bridge (to read the page's own JS variables / framework internals)
// can be layered on later via chrome.scripting.executeScript({ world: 'MAIN' }).
// Left as a deliberate extension point — not enabled by default.
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: WorkerToContent, _sender, sendResponse: (r: ContentToWorker) => void) => {
    if (message.channel === 'ping') {
      sendResponse({ channel: 'pong' });
      return; // sync response
    }

    if (message.channel === 'tool') {
      // Async work — return true to keep the message channel open until we reply.
      executeDomTool(message.toolCall).then((result) => {
        sendResponse({ channel: 'tool:result', result });
      });
      return true;
    }

    return undefined;
  },
);
