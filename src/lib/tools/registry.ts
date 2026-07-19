import type { ToolSchema } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Browser-agent tool registry. Provider-neutral JSON-Schema definitions plus a
// `runsIn` hint so the agent loop knows whether to dispatch a call to the page
// (content script) or handle it at the tab level (background service worker).
//
// The content script implements every `content` tool (src/content/dom-tools.ts);
// the background worker implements every `background` tool (src/background/agent.ts).
// Adding a tool = add a schema here + an implementation in the matching place.
// ─────────────────────────────────────────────────────────────────────────────

export type ToolRunsIn = 'content' | 'background';

export interface ToolEntry {
  runsIn: ToolRunsIn;
  schema: ToolSchema;
}

export const TOOLS: ToolEntry[] = [
  {
    runsIn: 'content',
    schema: {
      name: 'get_page_content',
      description:
        'Read the current page. mode "text" returns visible readable text; ' +
        '"interactive" returns a numbered list of clickable/typeable elements ' +
        'each tagged with a ref you can pass to click_element / type_text; ' +
        '"html" returns a cleaned HTML outline. Always read before acting.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['text', 'interactive', 'html'],
            description: 'What to extract. Default "text".',
          },
          maxChars: {
            type: 'number',
            description: 'Truncate output to this many characters. Default 12000.',
          },
        },
      },
    },
  },
  {
    runsIn: 'content',
    schema: {
      name: 'query_dom',
      description:
        'Run a CSS selector against the page and return info about matching ' +
        'elements (tag, text, attributes, and a ref for interaction).',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'A CSS selector.' },
          limit: { type: 'number', description: 'Max elements to return. Default 20.' },
        },
        required: ['selector'],
      },
    },
  },
  {
    runsIn: 'content',
    schema: {
      name: 'click_element',
      description:
        'Click an element. Prefer a ref from get_page_content; a CSS selector ' +
        'also works. Scrolls the element into view first.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'A ref like "e12" from get_page_content.' },
          selector: { type: 'string', description: 'CSS selector (used if no ref).' },
        },
      },
    },
  },
  {
    runsIn: 'content',
    schema: {
      name: 'type_text',
      description:
        'Type text into an input, textarea or contenteditable element. Fires ' +
        'the input/change events frameworks (React etc.) listen for. Set ' +
        'submit=true to press Enter afterwards.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'A ref from get_page_content.' },
          selector: { type: 'string', description: 'CSS selector (used if no ref).' },
          text: { type: 'string', description: 'The text to type.' },
          submit: { type: 'boolean', description: 'Press Enter after typing. Default false.' },
          clear: { type: 'boolean', description: 'Clear the field first. Default true.' },
        },
        required: ['text'],
      },
    },
  },
  {
    runsIn: 'content',
    schema: {
      name: 'scroll_page',
      description: 'Scroll the page (or an element) up/down/top/bottom.',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['up', 'down', 'top', 'bottom'],
            description: 'Scroll direction. Default "down".',
          },
          amount: { type: 'number', description: 'Pixels for up/down. Default one viewport.' },
          selector: { type: 'string', description: 'Optional scroll a specific element.' },
        },
      },
    },
  },
  {
    runsIn: 'content',
    schema: {
      name: 'wait_for_element',
      description: 'Wait until an element matching the selector appears (or times out).',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector to wait for.' },
          timeoutMs: { type: 'number', description: 'Max wait in ms. Default 8000.' },
        },
        required: ['selector'],
      },
    },
  },
  {
    runsIn: 'background',
    schema: {
      name: 'get_page_metadata',
      description: 'Get the active tab URL and title.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    runsIn: 'background',
    schema: {
      name: 'navigate',
      description: 'Navigate the active tab to a URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Absolute URL to load.' },
        },
        required: ['url'],
      },
    },
  },
];

/** Schemas to hand a provider (only when tools are enabled). */
export function getToolSchemas(): ToolSchema[] {
  return TOOLS.map((t) => t.schema);
}

export function findTool(name: string): ToolEntry | undefined {
  return TOOLS.find((t) => t.schema.name === name);
}
