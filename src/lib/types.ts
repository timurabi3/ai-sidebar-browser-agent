// ─────────────────────────────────────────────────────────────────────────────
// Shared domain types. This module is the contract between the side panel (UI),
// the background service worker (orchestration/keys) and the content script
// (DOM). It imports nothing runtime-specific so all three contexts can use it.
// ─────────────────────────────────────────────────────────────────────────────

export type Role = 'system' | 'user' | 'assistant' | 'tool';

/** A single tool invocation requested by the model. */
export interface ToolCall {
  id: string;
  name: string;
  /** Parsed arguments. Providers hand us JSON strings; we parse at the boundary. */
  arguments: Record<string, unknown>;
}

/** The result of executing a ToolCall, fed back to the model on the next turn. */
export interface ToolResult {
  toolCallId: string;
  name: string;
  /** Stringified result content (JSON or plain text). */
  content: string;
  isError?: boolean;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  /** Present on assistant messages that requested tools. */
  toolCalls?: ToolCall[];
  /** Present on tool messages. */
  toolResult?: ToolResult;
  createdAt: number;
  /** UI/streaming flag — true while tokens are still arriving. */
  pending?: boolean;
  /** Populated on error turns for surfacing in the UI. */
  error?: string;
  /** Provider/model that produced an assistant message (for display). */
  model?: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// ── Providers ────────────────────────────────────────────────────────────────

/**
 * Provider families. `openai-compatible` is a single adapter that speaks the
 * OpenAI `/chat/completions` shape and covers OpenRouter, OpenAI, Moonshot
 * (Kimi), MiniMax, Zhipu (GLM), DeepSeek and any other OpenAI-clone endpoint.
 */
export type ProviderKind = 'openai-compatible' | 'anthropic' | 'gemini';

export interface ModelInfo {
  id: string;
  label: string;
  /** Context window in tokens, for display only. */
  contextWindow?: number;
  supportsTools?: boolean;
  /**
   * True for reasoning-class models that reject any `temperature` other than 1
   * (Kimi K2.6/K3, DeepSeek V4, OpenAI GPT-5.x reasoning, etc.). When set, the
   * agent omits `temperature` from the request entirely so the vendor applies
   * its own required default instead of returning HTTP 400.
   */
  lockedTemperature?: boolean;
  /**
   * Extra top-level fields merged verbatim into the request body for this model.
   * Vendor-specific escape hatch — e.g. DeepSeek V4 needs
   * `{ thinking: { type: 'disabled' } }` so tool-call turns don't 400 with
   * "reasoning_content must be passed back". Only honored by the
   * openai-compatible adapter (the only kind these models use).
   */
  requestExtras?: Record<string, unknown>;
}

/**
 * Which sign-in flow (if any) a provider supports as an alternative to an API
 * key. `undefined` = key only. A concrete flow id ('openrouter' | 'google') is
 * wired in src/lib/oauth. `'unsupported'` means the provider has an auth product
 * but no public third-party OAuth (e.g. Claude/ChatGPT consumer subscriptions) —
 * the UI shows the option but honestly marks it unavailable rather than faking it.
 */
export type OAuthCapability = 'openrouter' | 'google' | 'unsupported';

export interface ProviderDefinition {
  /** Stable id, e.g. "openrouter", "anthropic", "openai", "kimi", "glm". */
  id: string;
  label: string;
  kind: ProviderKind;
  /** Default REST base URL. Overridable per user in settings. */
  defaultBaseUrl: string;
  /** URL where the user obtains an API key (shown in settings). */
  apiKeyUrl?: string;
  /** Curated default model list; users may type a custom model id too. */
  models: ModelInfo[];
  /** Whether this provider needs an API key at all (local runtimes may not). */
  requiresKey: boolean;
  /** Preferred default model id when this provider is first selected. */
  defaultModelId?: string;
  /** Sign-in capability, if any (see OAuthCapability). */
  oauth?: OAuthCapability;
}

// ── Settings (persisted, worker-owned) ───────────────────────────────────────

/**
 * OAuth tokens for a provider that supports sign-in. Stored in ProviderConfig,
 * worker-only, stripped from any snapshot sent to the panel/page.
 */
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Absolute epoch-ms expiry of the access token, if known. */
  expiresAt?: number;
  /** OAuth token type — almost always "Bearer". */
  tokenType?: string;
  /** Human label for the connected account, shown in the UI (e.g. an email). */
  accountLabel?: string;
}

/** Per-provider user configuration. `apiKey`/`oauth` never leave the worker. */
export interface ProviderConfig {
  apiKey: string;
  /** Optional override of the provider's default base URL. */
  baseUrl?: string;
  /** Optional extra headers (e.g. OpenRouter HTTP-Referer / X-Title). */
  extraHeaders?: Record<string, string>;
  /** OAuth tokens if the user connected this provider via sign-in. */
  oauth?: OAuthTokens;
}

export interface Settings {
  /** Currently selected provider id + model id. */
  activeProviderId: string;
  activeModelId: string;
  /** provider id -> config. */
  providers: Record<string, ProviderConfig>;
  systemPrompt: string;
  temperature: number;
  /** Master switch for the browser-agent tools. */
  toolsEnabled: boolean;
  /** Max agent loop iterations before forcing a stop. */
  maxToolIterations: number;
}

// ── The request the agent builds and hands to a provider ─────────────────────

export interface ChatCompletionRequest {
  model: string;
  /** Ordered, provider-neutral message history (already includes system). */
  messages: ChatMessage[];
  /**
   * Sampling temperature, or `undefined` to omit it from the request (required
   * for models with a locked temperature — see ModelInfo.lockedTemperature).
   */
  temperature?: number;
  /** Tool schemas the model may call, or undefined to disable tools. */
  tools?: ToolSchema[];
  /** Vendor-specific body fields merged verbatim (see ModelInfo.requestExtras). */
  requestExtras?: Record<string, unknown>;
  signal?: AbortSignal;
}

// ── Tool schema (provider-neutral, JSON-Schema based) ────────────────────────

export interface ToolSchema {
  name: string;
  description: string;
  /** JSON Schema for the tool's parameters (object type). */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ── Streaming events yielded by every provider adapter ───────────────────────

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'done'; finishReason?: string; usage?: TokenUsage }
  | { type: 'error'; message: string };

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}
