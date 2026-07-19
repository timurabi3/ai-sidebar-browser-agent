import type { ToolCall, ToolResult } from '../lib/types';

// ─────────────────────────────────────────────────────────────────────────────
// DOM tool implementations. These run in the content script (ISOLATED world),
// which has full read/write access to the page's DOM. Each returns a ToolResult
// whose `content` is fed back to the model verbatim, so keep outputs concise and
// information-dense.
//
// Element addressing uses a `ref` scheme: get_page_content / query_dom stamp a
// `data-ai-ref` attribute on elements and hand the model that ref. Later tool
// calls resolve the ref back to the live element — stable even if the DOM around
// it shifts, and cheaper for the model than re-deriving selectors.
// ─────────────────────────────────────────────────────────────────────────────

const REF_ATTR = 'data-ai-ref';
let refCounter = 0;

function assignRef(el: Element): string {
  const existing = el.getAttribute(REF_ATTR);
  if (existing) return existing;
  const ref = `e${++refCounter}`;
  el.setAttribute(REF_ATTR, ref);
  return ref;
}

function resolveElement(args: Record<string, unknown>): HTMLElement | null {
  const ref = typeof args.ref === 'string' ? args.ref : undefined;
  const selector = typeof args.selector === 'string' ? args.selector : undefined;
  if (ref) {
    const el = document.querySelector<HTMLElement>(`[${REF_ATTR}="${cssEscape(ref)}"]`);
    if (el) return el;
  }
  if (selector) {
    try {
      return document.querySelector<HTMLElement>(selector);
    } catch {
      return null;
    }
  }
  return null;
}

function cssEscape(value: string): string {
  return (window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&'));
}

function isVisible(el: Element): boolean {
  const style = window.getComputedStyle(el as HTMLElement);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
    return false;
  const rect = (el as HTMLElement).getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function accessibleName(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();
  const he = el as HTMLElement;
  const text = (he.innerText || he.textContent || '').trim().replace(/\s+/g, ' ');
  if (text) return text.slice(0, 120);
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) return placeholder.trim();
  const title = el.getAttribute('title');
  if (title) return title.trim();
  const value = (el as HTMLInputElement).value;
  if (value) return value.slice(0, 120);
  const alt = el.getAttribute('alt');
  if (alt) return alt.trim();
  return '';
}

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type=hidden])',
  'textarea',
  'select',
  '[role=button]',
  '[role=link]',
  '[role=tab]',
  '[role=menuitem]',
  '[role=checkbox]',
  '[role=switch]',
  '[contenteditable=""]',
  '[contenteditable=true]',
  '[onclick]',
].join(',');

// ── Tool: get_page_content ───────────────────────────────────────────────────

function getPageContent(args: Record<string, unknown>): string {
  const mode = (args.mode as string) || 'text';
  const maxChars = typeof args.maxChars === 'number' ? args.maxChars : 12000;

  if (mode === 'interactive') {
    const els = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR)).filter(isVisible);
    const lines: string[] = [];
    for (const el of els.slice(0, 200)) {
      const ref = assignRef(el);
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || tag;
      const name = accessibleName(el);
      const type = (el as HTMLInputElement).type;
      lines.push(
        `[${ref}] <${tag}${type ? ` type=${type}` : ''} role=${role}> ${name || '(no label)'}`,
      );
    }
    return truncate(
      `Interactive elements (${lines.length}):\n${lines.join('\n')}`,
      maxChars,
    );
  }

  if (mode === 'html') {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('script,style,noscript,svg,iframe').forEach((n) => n.remove());
    return truncate(clone.innerHTML.replace(/\s+/g, ' ').trim(), maxChars);
  }

  // default: readable text
  const text = (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
  return truncate(`URL: ${location.href}\nTitle: ${document.title}\n\n${text}`, maxChars);
}

// ── Tool: query_dom ──────────────────────────────────────────────────────────

function queryDom(args: Record<string, unknown>): string {
  const selector = String(args.selector ?? '');
  const limit = typeof args.limit === 'number' ? args.limit : 20;
  let els: Element[];
  try {
    els = Array.from(document.querySelectorAll(selector));
  } catch {
    return `Invalid selector: ${selector}`;
  }
  if (els.length === 0) return `No elements match: ${selector}`;
  const out = els.slice(0, limit).map((el) => {
    const ref = assignRef(el);
    const attrs: string[] = [];
    for (const a of Array.from(el.attributes)) {
      if (a.name === REF_ATTR) continue;
      attrs.push(`${a.name}="${a.value.slice(0, 60)}"`);
    }
    return `[${ref}] <${el.tagName.toLowerCase()} ${attrs.join(' ')}> ${accessibleName(el)}`;
  });
  return `Matched ${els.length} (showing ${out.length}):\n${out.join('\n')}`;
}

// ── Tool: click_element ──────────────────────────────────────────────────────

function clickElement(args: Record<string, unknown>): string {
  const el = resolveElement(args);
  if (!el) return `No element found for ${describeTarget(args)}.`;
  el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
  const label = accessibleName(el) || el.tagName.toLowerCase();
  // Dispatch a realistic click sequence for stubborn handlers.
  const opts = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.click();
  return `Clicked "${label}".`;
}

// ── Tool: type_text ──────────────────────────────────────────────────────────

function typeText(args: Record<string, unknown>): string {
  const el = resolveElement(args);
  if (!el) return `No input found for ${describeTarget(args)}.`;
  const text = String(args.text ?? '');
  const submit = args.submit === true;
  const clear = args.clear !== false;

  el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
  el.focus();

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setNativeValue(el, clear ? text : el.value + text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (el.isContentEditable) {
    if (clear) el.textContent = '';
    document.execCommand('insertText', false, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    return `Element ${describeTarget(args)} is not typeable.`;
  }

  if (submit) {
    const enter = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };
    el.dispatchEvent(new KeyboardEvent('keydown', enter));
    el.dispatchEvent(new KeyboardEvent('keyup', enter));
    const form = (el as HTMLElement).closest('form');
    if (form) form.requestSubmit?.();
  }
  return `Typed into "${accessibleName(el) || el.tagName.toLowerCase()}"${
    submit ? ' and submitted' : ''
  }.`;
}

/**
 * React (and other frameworks) track input values on the element instance and
 * ignore direct `.value =` writes. Setting via the prototype's native setter
 * makes the framework's onChange fire correctly.
 */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

// ── Tool: scroll_page ────────────────────────────────────────────────────────

function scrollPage(args: Record<string, unknown>): string {
  const direction = (args.direction as string) || 'down';
  const amount = typeof args.amount === 'number' ? args.amount : window.innerHeight * 0.9;
  const target =
    typeof args.selector === 'string'
      ? document.querySelector<HTMLElement>(args.selector) ?? window
      : window;

  const scroller = target === window ? window : (target as HTMLElement);
  switch (direction) {
    case 'up':
      scrollBy(scroller, -amount);
      break;
    case 'down':
      scrollBy(scroller, amount);
      break;
    case 'top':
      scrollTo(scroller, 0);
      break;
    case 'bottom':
      scrollTo(
        scroller,
        target === window ? document.body.scrollHeight : (target as HTMLElement).scrollHeight,
      );
      break;
  }
  return `Scrolled ${direction}.`;
}

function scrollBy(scroller: Window | HTMLElement, delta: number): void {
  if (scroller === window) window.scrollBy({ top: delta, behavior: 'instant' as ScrollBehavior });
  else (scroller as HTMLElement).scrollTop += delta;
}
function scrollTo(scroller: Window | HTMLElement, top: number): void {
  if (scroller === window) window.scrollTo({ top, behavior: 'instant' as ScrollBehavior });
  else (scroller as HTMLElement).scrollTop = top;
}

// ── Tool: wait_for_element ───────────────────────────────────────────────────

async function waitForElement(args: Record<string, unknown>): Promise<string> {
  const selector = String(args.selector ?? '');
  const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 8000;
  const start = Date.now();
  return new Promise<string>((resolve) => {
    const check = () => {
      let found: Element | null = null;
      try {
        found = document.querySelector(selector);
      } catch {
        resolve(`Invalid selector: ${selector}`);
        return;
      }
      if (found) {
        resolve(`Element appeared: ${selector}`);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(`Timed out after ${timeoutMs}ms waiting for: ${selector}`);
        return;
      }
      requestAnimationFrame(() => setTimeout(check, 120));
    };
    check();
  });
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

function describeTarget(args: Record<string, unknown>): string {
  return (args.ref as string) || (args.selector as string) || '(no ref/selector)';
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]` : s;
}

/** Execute a DOM tool call and return a normalized ToolResult. */
export async function executeDomTool(toolCall: ToolCall): Promise<ToolResult> {
  const { name, id, arguments: args } = toolCall;
  try {
    let content: string;
    switch (name) {
      case 'get_page_content':
        content = getPageContent(args);
        break;
      case 'query_dom':
        content = queryDom(args);
        break;
      case 'click_element':
        content = clickElement(args);
        break;
      case 'type_text':
        content = typeText(args);
        break;
      case 'scroll_page':
        content = scrollPage(args);
        break;
      case 'wait_for_element':
        content = await waitForElement(args);
        break;
      default:
        return {
          toolCallId: id,
          name,
          content: `Unknown content tool: ${name}`,
          isError: true,
        };
    }
    return { toolCallId: id, name, content };
  } catch (err) {
    return {
      toolCallId: id,
      name,
      content: `Tool "${name}" threw: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}
