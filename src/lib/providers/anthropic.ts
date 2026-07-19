import type {
  ChatCompletionRequest,
  ChatMessage,
  ProviderConfig,
  ProviderDefinition,
  StreamEvent,
  ToolSchema,
} from '../types';
import {
  describeHttpError,
  parseSSE,
  resolveBaseUrl,
  type ProviderAdapter,
} from './base';

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic Messages API adapter (streaming). Differences from OpenAI absorbed
// here: system prompt is a top-level field (not a message), tool results are
// `tool_result` content blocks on a user turn, and tool calls arrive as
// `tool_use` blocks assembled from `input_json_delta` events.
//
// dangerous-direct-browser-access header lets the extension call the API from
// the service worker (no CORS proxy needed).
// ─────────────────────────────────────────────────────────────────────────────

const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicBlockStart {
  type: 'text' | 'tool_use';
  id?: string;
  name?: string;
}

/** Split our flat history into an Anthropic system string + messages array. */
function toAnthropicPayload(messages: ChatMessage[]): {
  system: string;
  messages: unknown[];
} {
  let system = '';
  const out: { role: 'user' | 'assistant'; content: unknown[] }[] = [];

  const pushContent = (role: 'user' | 'assistant', block: unknown) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(block);
    else out.push({ role, content: [block] });
  };

  for (const m of messages) {
    if (m.role === 'system') {
      system += (system ? '\n\n' : '') + m.content;
      continue;
    }
    if (m.role === 'tool' && m.toolResult) {
      pushContent('user', {
        type: 'tool_result',
        tool_use_id: m.toolResult.toolCallId,
        content: m.toolResult.content,
        is_error: m.toolResult.isError ?? false,
      });
      continue;
    }
    if (m.role === 'assistant') {
      if (m.content) pushContent('assistant', { type: 'text', text: m.content });
      for (const tc of m.toolCalls ?? []) {
        pushContent('assistant', {
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        });
      }
      continue;
    }
    // user
    pushContent('user', { type: 'text', text: m.content });
  }

  return { system, messages: out };
}

function toAnthropicTools(tools: ToolSchema[] | undefined): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

export const anthropicAdapter: ProviderAdapter = {
  async *streamChat(
    req: ChatCompletionRequest,
    def: ProviderDefinition,
    config: ProviderConfig,
  ): AsyncGenerator<StreamEvent> {
    const url = `${resolveBaseUrl(def, config)}/messages`;
    const { system, messages } = toAnthropicPayload(req.messages);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      // Allows calling the API directly from an extension origin.
      'anthropic-dangerous-direct-browser-access': 'true',
      ...(config.extraHeaders ?? {}),
    };

    const body = JSON.stringify({
      model: req.model,
      system: system || undefined,
      messages,
      // Omit temperature for locked-temperature models (agent passes undefined).
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      max_tokens: 4096,
      stream: true,
      tools: toAnthropicTools(req.tools),
    });

    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers, body, signal: req.signal });
    } catch (err) {
      yield { type: 'error', message: `Network error: ${errText(err)}` };
      return;
    }
    if (!res.ok || !res.body) {
      yield { type: 'error', message: await describeHttpError(res) };
      return;
    }

    // Track the currently-open content block. tool_use inputs stream as
    // partial JSON via input_json_delta and are assembled per block index.
    const blocks = new Map<number, { type: string; id?: string; name?: string; json: string }>();
    let finishReason: string | undefined;

    for await (const data of parseSSE(res.body, req.signal)) {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(data);
      } catch {
        continue;
      }
      const type = ev.type as string;

      switch (type) {
        case 'content_block_start': {
          const idx = ev.index as number;
          const block = ev.content_block as AnthropicBlockStart;
          blocks.set(idx, {
            type: block.type,
            id: block.id,
            name: block.name,
            json: '',
          });
          break;
        }
        case 'content_block_delta': {
          const idx = ev.index as number;
          const delta = ev.delta as { type: string; text?: string; partial_json?: string };
          if (delta.type === 'text_delta' && delta.text) {
            yield { type: 'text', delta: delta.text };
          } else if (delta.type === 'input_json_delta' && delta.partial_json) {
            const b = blocks.get(idx);
            if (b) b.json += delta.partial_json;
          }
          break;
        }
        case 'content_block_stop': {
          const idx = ev.index as number;
          const b = blocks.get(idx);
          if (b && b.type === 'tool_use' && b.name) {
            yield {
              type: 'tool_call',
              toolCall: {
                id: b.id ?? `call_${b.name}`,
                name: b.name,
                arguments: safeParseArgs(b.json),
              },
            };
          }
          break;
        }
        case 'message_delta': {
          const delta = ev.delta as { stop_reason?: string } | undefined;
          if (delta?.stop_reason) finishReason = delta.stop_reason;
          break;
        }
        case 'error': {
          const errObj = ev.error as { message?: string } | undefined;
          yield { type: 'error', message: errObj?.message ?? 'Anthropic stream error.' };
          return;
        }
        case 'message_stop':
          break;
      }
    }

    yield { type: 'done', finishReason };
  },
};

function safeParseArgs(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : { value: parsed };
  } catch {
    return { _raw: raw };
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
