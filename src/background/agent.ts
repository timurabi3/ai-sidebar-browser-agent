import { uid } from '../lib/id';
import { callContentTool } from '../lib/messaging';
import { getAdapter, getProviderDefinition } from '../lib/providers';
import { resolveAuth } from '../lib/providers/auth';
import { findTool, getToolSchemas } from '../lib/tools/registry';
import type {
  ChatMessage,
  Conversation,
  Settings,
  ToolCall,
  ToolResult,
} from '../lib/types';
import { appendMessage, getSettings } from './store';

// ─────────────────────────────────────────────────────────────────────────────
// The agent loop. Given the current conversation, it:
//   1. Streams a completion from the active provider (with tools if enabled).
//   2. If the model requested tools, executes them (content script for DOM tools,
//      here in the worker for tab-level tools), appends the results, and loops.
//   3. Otherwise finalizes the assistant message and stops.
//
// All output is delivered through the `emit` callback so the caller (the port
// handler) can relay it to the side panel. The loop owns no UI concerns.
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentEvents {
  /** A brand-new message was committed to history (assistant/tool). */
  onMessage: (message: ChatMessage) => void;
  /** An existing message changed (e.g. streaming text, finalize). */
  onMessageUpdate: (message: ChatMessage) => void;
  /** A raw text delta for the currently-streaming assistant message. */
  onTextDelta: (messageId: string, delta: string) => void;
  /** Fatal error for the whole turn. */
  onError: (message: string) => void;
}

/** Run one full user turn (may span several model calls via tools). */
export async function runAgentTurn(
  conversation: Conversation,
  events: AgentEvents,
  signal: AbortSignal,
): Promise<void> {
  const settings = await getSettings();
  const def = getProviderDefinition(settings.activeProviderId);
  if (!def) {
    events.onError(`Unknown provider "${settings.activeProviderId}". Pick one in settings.`);
    return;
  }
  // Resolve effective auth (sign-in wins over API key). `config` below carries
  // the chosen bearer in its apiKey slot; adapters are auth-method agnostic.
  const auth = resolveAuth(def, settings.providers[settings.activeProviderId]);
  if (auth.missing) {
    events.onError(
      `${def.label} isn't connected. Add an API key or sign in from settings (⚙).`,
    );
    return;
  }
  const config = auth.config;

  const adapter = getAdapter(def);
  const toolSchemas = settings.toolsEnabled ? getToolSchemas() : undefined;
  const maxIterations = Math.max(1, settings.maxToolIterations);

  // Resolve the effective sampling temperature. Reasoning-class models
  // (Kimi K2.6/K3, DeepSeek V4, OpenAI GPT-5.x reasoning, …) reject any
  // temperature other than 1 with HTTP 400 — for those we omit the field so
  // the vendor applies its own required default. Unknown/custom model ids fall
  // through to the user's configured temperature.
  const activeModel = def.models.find((m) => m.id === settings.activeModelId);
  const temperature = activeModel?.lockedTemperature ? undefined : settings.temperature;
  // Vendor-specific body fields (e.g. DeepSeek V4 disables thinking so tool-call
  // turns don't 400 on the required reasoning_content round-trip).
  const requestExtras = activeModel?.requestExtras;

  // Local working copy of the message history; grows as tools run.
  let history = buildHistory(conversation, settings);

  // Dedup guard: if the model calls the exact same tool+arguments twice in one
  // turn, the repeat is almost never real progress — it's the model re-checking
  // something it already has the answer to. Short-circuit with the cached
  // result instead of spending a full iteration on a real round-trip.
  const seenCalls = new Map<string, ToolResult>();

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (signal.aborted) return;

    // On the last iteration, stop offering tools and force a final answer from
    // whatever's been gathered so far, instead of silently hitting the hard cap.
    const isLastIteration = iteration === maxIterations - 1;
    const iterationTools = isLastIteration ? undefined : toolSchemas;
    if (isLastIteration && toolSchemas) {
      history.push({
        id: uid('msg'),
        role: 'system',
        content:
          'You are out of tool calls for this turn. Do not request any more tools. ' +
          'Answer now using only what you have already gathered, and say plainly ' +
          'if something remains unverified.',
        createdAt: Date.now(),
      });
    }

    // The assistant message we stream into for this model call.
    const assistant: ChatMessage = {
      id: uid('msg'),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      pending: true,
      model: `${def.label} · ${settings.activeModelId}`,
    };
    events.onMessage(assistant);

    const pendingToolCalls: ToolCall[] = [];
    let streamError: string | undefined;

    try {
      const stream = adapter.streamChat(
        {
          model: settings.activeModelId,
          messages: history,
          temperature,
          tools: iterationTools,
          requestExtras,
          signal,
        },
        def,
        config,
      );

      for await (const ev of stream) {
        if (signal.aborted) return;
        switch (ev.type) {
          case 'text':
            assistant.content += ev.delta;
            events.onTextDelta(assistant.id, ev.delta);
            break;
          case 'tool_call':
            pendingToolCalls.push(ev.toolCall);
            break;
          case 'error':
            streamError = ev.message;
            break;
          case 'done':
            break;
        }
      }
    } catch (err) {
      streamError = err instanceof Error ? err.message : String(err);
    }

    if (streamError) {
      assistant.pending = false;
      assistant.error = streamError;
      events.onMessageUpdate(assistant);
      await appendMessage(assistant);
      events.onError(streamError);
      return;
    }

    // Finalize the assistant message for this iteration.
    assistant.pending = false;
    if (pendingToolCalls.length > 0) assistant.toolCalls = pendingToolCalls;
    events.onMessageUpdate(assistant);
    await appendMessage(assistant);
    history.push(assistant);

    // No tools requested → the turn is complete.
    if (pendingToolCalls.length === 0) return;

    // Execute each requested tool, append a tool result message, then loop so
    // the model can see the results and continue.
    for (const toolCall of pendingToolCalls) {
      if (signal.aborted) return;

      const callKey = `${toolCall.name}:${JSON.stringify(toolCall.arguments)}`;
      const cached = seenCalls.get(callKey);
      const result = cached
        ? {
            ...cached,
            toolCallId: toolCall.id,
            content:
              `[repeated call — not re-run] You already called ${toolCall.name} with ` +
              `these exact arguments. Prior result:\n${cached.content}`,
          }
        : await executeTool(toolCall);
      if (!cached) seenCalls.set(callKey, result);

      const toolMessage: ChatMessage = {
        id: uid('msg'),
        role: 'tool',
        content: result.content,
        toolResult: result,
        createdAt: Date.now(),
      };
      events.onMessage(toolMessage);
      await appendMessage(toolMessage);
      history.push(toolMessage);
    }
  }

  events.onError(
    `Reached the tool-iteration limit (${maxIterations}). Stopping to avoid a loop.`,
  );
}

// ── Tool execution routing ───────────────────────────────────────────────────

async function executeTool(toolCall: ToolCall): Promise<ToolResult> {
  const entry = findTool(toolCall.name);
  if (!entry) {
    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: `Unknown tool: ${toolCall.name}`,
      isError: true,
    };
  }

  if (entry.runsIn === 'background') {
    return executeBackgroundTool(toolCall);
  }

  // Content tool — route to the active tab's content script.
  const tab = await getActiveTab();
  if (!tab?.id) {
    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: 'No active tab to run this tool against.',
      isError: true,
    };
  }
  return callContentTool(tab.id, toolCall);
}

/** Tab-level tools that don't touch the DOM run here in the worker. */
async function executeBackgroundTool(toolCall: ToolCall): Promise<ToolResult> {
  const { name, id, arguments: args } = toolCall;
  try {
    switch (name) {
      case 'get_page_metadata': {
        const tab = await getActiveTab();
        return {
          toolCallId: id,
          name,
          content: JSON.stringify({ url: tab?.url ?? null, title: tab?.title ?? null }),
        };
      }
      case 'navigate': {
        const tab = await getActiveTab();
        const url = String(args.url ?? '');
        if (!tab?.id) throw new Error('No active tab.');
        if (!/^https?:\/\//i.test(url)) throw new Error(`Refusing non-http(s) URL: ${url}`);
        await chrome.tabs.update(tab.id, { url });
        return { toolCallId: id, name, content: `Navigating to ${url}` };
      }
      default:
        return { toolCallId: id, name, content: `Unhandled background tool: ${name}`, isError: true };
    }
  } catch (err) {
    return {
      toolCallId: id,
      name,
      content: `Tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

// ── History assembly ─────────────────────────────────────────────────────────

/** Prepend the system prompt (if any) to the persisted history. */
function buildHistory(conversation: Conversation, settings: Settings): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  if (settings.systemPrompt.trim()) {
    msgs.push({
      id: 'system',
      role: 'system',
      content: settings.systemPrompt,
      createdAt: 0,
    });
  }
  // Exclude any pending/streaming placeholders and error-only turns.
  for (const m of conversation.messages) {
    if (m.pending) continue;
    msgs.push(m);
  }
  return msgs;
}
