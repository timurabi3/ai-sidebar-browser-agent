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
// OpenAI Chat Completions adapter. Speaks the `/chat/completions` streaming
// shape used by OpenAI, OpenRouter, Moonshot (Kimi), MiniMax, Zhipu (GLM),
// DeepSeek and local runtimes (Ollama/LM Studio/vLLM). Fully implements tool
// calling: streamed tool-call fragments are accumulated by index and emitted
// as complete ToolCall events at the end of the turn.
// ─────────────────────────────────────────────────────────────────────────────

interface OAIToolCallFragment {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OAIStreamChoice {
  delta?: {
    content?: string | null;
    tool_calls?: OAIToolCallFragment[];
  };
  finish_reason?: string | null;
}

interface OAIStreamChunk {
  choices?: OAIStreamChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** Convert our neutral message history into OpenAI wire messages. */
function toOpenAIMessages(messages: ChatMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === 'tool' && m.toolResult) {
      out.push({
        role: 'tool',
        tool_call_id: m.toolResult.toolCallId,
        content: m.toolResult.content,
      });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      out.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

/** Convert our neutral tool schemas into OpenAI `tools` array. */
function toOpenAITools(tools: ToolSchema[] | undefined): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export const openAICompatibleAdapter: ProviderAdapter = {
  async *streamChat(
    req: ChatCompletionRequest,
    def: ProviderDefinition,
    config: ProviderConfig,
  ): AsyncGenerator<StreamEvent> {
    const url = `${resolveBaseUrl(def, config)}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      ...(config.extraHeaders ?? {}),
    };

    const body = JSON.stringify({
      model: req.model,
      messages: toOpenAIMessages(req.messages),
      // Omit temperature entirely for locked-temperature models (the agent passes
      // undefined). Sending it would trigger HTTP 400 on Kimi/DeepSeek/reasoning models.
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      stream: true,
      stream_options: { include_usage: true },
      tools: toOpenAITools(req.tools),
      // Vendor-specific extras (e.g. DeepSeek V4 `thinking: { type: 'disabled' }`)
      // merged last so a model can override any default above if it must.
      ...(req.requestExtras ?? {}),
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

    // Accumulate streamed tool-call fragments keyed by their `index`.
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: string | undefined;
    let usage: OAIStreamChunk['usage'];

    for await (const data of parseSSE(res.body, req.signal)) {
      if (data === '[DONE]') break;
      let chunk: OAIStreamChunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue; // ignore keep-alive / malformed lines
      }
      if (chunk.usage) usage = chunk.usage;

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      const content = choice.delta?.content;
      if (content) yield { type: 'text', delta: content };

      for (const frag of choice.delta?.tool_calls ?? []) {
        const entry =
          toolAcc.get(frag.index) ?? { id: '', name: '', args: '' };
        if (frag.id) entry.id = frag.id;
        if (frag.function?.name) entry.name = frag.function.name;
        if (frag.function?.arguments) entry.args += frag.function.arguments;
        toolAcc.set(frag.index, entry);
      }

      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    // Emit fully-assembled tool calls before the done event.
    for (const entry of toolAcc.values()) {
      if (!entry.name) continue;
      yield {
        type: 'tool_call',
        toolCall: {
          id: entry.id || `call_${entry.name}_${toolAcc.size}`,
          name: entry.name,
          arguments: safeParseArgs(entry.args),
        },
      };
    }

    yield {
      type: 'done',
      finishReason,
      usage: usage
        ? {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
          }
        : undefined,
    };
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
