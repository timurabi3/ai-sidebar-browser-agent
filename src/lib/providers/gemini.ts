import type {
  ChatCompletionRequest,
  ChatMessage,
  ProviderConfig,
  ProviderDefinition,
  StreamEvent,
  ToolSchema,
} from '../types';
import { describeHttpError, resolveBaseUrl, type ProviderAdapter } from './base';

// ─────────────────────────────────────────────────────────────────────────────
// Google Gemini adapter. Uses streamGenerateContent with alt=sse. Gemini's
// wire format is quite different: roles are "user"/"model", system prompt goes
// in system_instruction, tool calls are functionCall parts and results are
// functionResponse parts. functionCall args arrive complete (not streamed), so
// no per-fragment accumulation is needed.
// ─────────────────────────────────────────────────────────────────────────────

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[]; role?: string };
  finishReason?: string;
}

interface GeminiStreamChunk {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

function toGeminiContents(messages: ChatMessage[]): {
  systemInstruction?: { parts: { text: string }[] };
  contents: unknown[];
} {
  let system = '';
  const contents: { role: 'user' | 'model'; parts: GeminiPart[] }[] = [];

  const push = (role: 'user' | 'model', part: GeminiPart) => {
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(part);
    else contents.push({ role, parts: [part] });
  };

  for (const m of messages) {
    if (m.role === 'system') {
      system += (system ? '\n\n' : '') + m.content;
      continue;
    }
    if (m.role === 'tool' && m.toolResult) {
      push('user', {
        functionResponse: {
          name: m.toolResult.name,
          response: { result: m.toolResult.content },
        },
      });
      continue;
    }
    if (m.role === 'assistant') {
      if (m.content) push('model', { text: m.content });
      for (const tc of m.toolCalls ?? []) {
        push('model', { functionCall: { name: tc.name, args: tc.arguments } });
      }
      continue;
    }
    push('user', { text: m.content });
  }

  return {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents,
  };
}

function toGeminiTools(tools: ToolSchema[] | undefined): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    },
  ];
}

export const geminiAdapter: ProviderAdapter = {
  async *streamChat(
    req: ChatCompletionRequest,
    def: ProviderDefinition,
    config: ProviderConfig,
  ): AsyncGenerator<StreamEvent> {
    const base = resolveBaseUrl(def, config);
    const url = `${base}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`;
    const { systemInstruction, contents } = toGeminiContents(req.messages);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // API key travels in a header, never in the URL query (see CLAUDE.md rule).
      'x-goog-api-key': config.apiKey,
      ...(config.extraHeaders ?? {}),
    };

    const body = JSON.stringify({
      systemInstruction,
      contents,
      // Only set temperature when provided; locked-temperature models omit it.
      generationConfig:
        req.temperature !== undefined ? { temperature: req.temperature } : {},
      tools: toGeminiTools(req.tools),
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

    let finishReason: string | undefined;
    let usage: GeminiStreamChunk['usageMetadata'];
    let toolIdx = 0;

    // Gemini's SSE frames are `data: {json}` lines; reuse a minimal reader.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (req.signal?.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;

          let chunk: GeminiStreamChunk;
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue;
          }
          if (chunk.usageMetadata) usage = chunk.usageMetadata;

          const cand = chunk.candidates?.[0];
          for (const part of cand?.content?.parts ?? []) {
            if (part.text) yield { type: 'text', delta: part.text };
            if (part.functionCall) {
              yield {
                type: 'tool_call',
                toolCall: {
                  id: `call_${part.functionCall.name}_${toolIdx++}`,
                  name: part.functionCall.name,
                  arguments: part.functionCall.args ?? {},
                },
              };
            }
          }
          if (cand?.finishReason) finishReason = cand.finishReason;
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield {
      type: 'done',
      finishReason,
      usage: usage
        ? {
            promptTokens: usage.promptTokenCount,
            completionTokens: usage.candidatesTokenCount,
            totalTokens: usage.totalTokenCount,
          }
        : undefined,
    };
  },
};

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
