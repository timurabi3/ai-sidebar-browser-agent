import type {
  ChatCompletionRequest,
  ProviderConfig,
  ProviderDefinition,
  StreamEvent,
} from '../types';

/**
 * A provider adapter turns a provider-neutral ChatCompletionRequest into
 * vendor-specific HTTP calls and yields a normalized stream of StreamEvents.
 *
 * The whole rest of the app (agent loop, UI) only ever sees StreamEvent —
 * vendor differences are fully absorbed here.
 */
export interface ProviderAdapter {
  streamChat(
    req: ChatCompletionRequest,
    def: ProviderDefinition,
    config: ProviderConfig,
  ): AsyncGenerator<StreamEvent>;
}

/** Resolve the effective base URL (user override wins), trimmed of trailing /. */
export function resolveBaseUrl(def: ProviderDefinition, config: ProviderConfig): string {
  const raw = (config.baseUrl?.trim() || def.defaultBaseUrl).replace(/\/+$/, '');
  return raw;
}

/**
 * Parse a Server-Sent-Events byte stream into individual `data:` payload
 * strings. Shared by the OpenAI-compatible and Anthropic adapters (both use
 * SSE). Yields the raw text after `data: `; callers JSON.parse and interpret.
 */
export async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line. Process complete events.
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of rawEvent.split('\n')) {
          const trimmed = line.trimStart();
          if (trimmed.startsWith('data:')) {
            yield trimmed.slice(5).trimStart();
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Build a readable error message from a failed fetch Response. */
export async function describeHttpError(res: Response): Promise<string> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      detail = json?.error?.message ?? json?.message ?? text;
    } catch {
      detail = text;
    }
  } catch {
    /* ignore */
  }
  return `HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 500)}` : ''}`;
}
