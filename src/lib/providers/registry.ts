import type { ProviderDefinition } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Provider registry. Adding a new OpenAI-compatible vendor is a data change
// only — no new adapter code. Anthropic and Gemini use dedicated adapters
// because their wire formats differ.
//
// Model lists are curated defaults for the picker; users can always type a
// custom model id in settings. Update these as vendors ship new models.
//
// Model IDs below were verified against each vendor's official docs on
// 2026-07-18. Notes on things that will bite if not tracked:
//   • Anthropic current line: Fable 5, Opus 4.8, Sonnet 5, Haiku 4.5.
//   • OpenAI current line: GPT-5.6 family (sol/terra/luna), GPT-5.5, GPT-4.1.
//   • Google: Gemini 3.5 Flash (GA) + Gemini 2.5 Pro (GA); 3.1 Pro is preview.
//   • DeepSeek: `deepseek-chat`/`deepseek-reasoner` are DEPRECATED 2026-07-24 →
//     use `deepseek-v4-flash` / `deepseek-v4-pro`.
//   • Moonshot: k2 discontinued 2026-05-25 → `kimi-k2.6` / `kimi-k3`.
//   • Zhipu/Z.ai: base URL moved to https://api.z.ai/v1; current `glm-5.2`.
//   • MiniMax: `MiniMax-M3` current flagship; `MiniMax-M2` still active.
// ─────────────────────────────────────────────────────────────────────────────

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    apiKeyUrl: 'https://openrouter.ai/keys',
    requiresKey: true,
    // OpenRouter supports OAuth PKCE — one sign-in unlocks many upstream models.
    oauth: 'openrouter',
    defaultModelId: 'anthropic/claude-sonnet-5',
    models: [
      { id: 'anthropic/claude-fable-5', label: 'Claude Fable 5', supportsTools: true },
      { id: 'anthropic/claude-opus-4.8', label: 'Claude Opus 4.8', supportsTools: true },
      { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', supportsTools: true },
      { id: 'openai/gpt-5.6', label: 'GPT-5.6', supportsTools: true, lockedTemperature: true },
      { id: 'openai/gpt-5.5', label: 'GPT-5.5', supportsTools: true, lockedTemperature: true },
      { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash', supportsTools: true },
      { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', supportsTools: true },
      { id: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6', supportsTools: true, lockedTemperature: true },
      { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro', supportsTools: true, lockedTemperature: true },
      { id: 'z-ai/glm-5.2', label: 'GLM 5.2', supportsTools: true },
      { id: 'minimax/minimax-m3', label: 'MiniMax M3', supportsTools: true },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    requiresKey: true,
    defaultModelId: 'gpt-5.6',
    models: [
      // GPT-5.x reasoning models reject temperature != 1 → locked.
      { id: 'gpt-5.6', label: 'GPT-5.6', supportsTools: true, lockedTemperature: true },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', supportsTools: true, lockedTemperature: true },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', supportsTools: true, lockedTemperature: true },
      { id: 'gpt-5.5', label: 'GPT-5.5', supportsTools: true, lockedTemperature: true },
      // GPT-4.1 still honors custom temperature.
      { id: 'gpt-4.1', label: 'GPT-4.1', supportsTools: true },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', supportsTools: true },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    requiresKey: true,
    // Anthropic Console/claude.ai use OAuth, but there is no public third-party
    // OAuth app flow for consumer/Pro subscriptions — surfaced as unsupported.
    oauth: 'unsupported',
    defaultModelId: 'claude-sonnet-5',
    models: [
      { id: 'claude-fable-5', label: 'Claude Fable 5', supportsTools: true },
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', supportsTools: true },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', supportsTools: true },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', supportsTools: true },
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    requiresKey: true,
    // Google offers OAuth 2.0; a real sign-in flow is wired for this provider.
    oauth: 'google',
    defaultModelId: 'gemini-3.5-flash',
    models: [
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', supportsTools: true },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', supportsTools: true },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', supportsTools: true },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', supportsTools: true },
    ],
  },
  {
    id: 'kimi',
    label: 'Kimi (Moonshot)',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    apiKeyUrl: 'https://platform.moonshot.ai/console/api-keys',
    requiresKey: true,
    defaultModelId: 'kimi-k2.6',
    models: [
      // Moonshot's k2.6/k3 reasoning models require temperature == 1 → omit it.
      { id: 'kimi-k2.6', label: 'Kimi K2.6', supportsTools: true, lockedTemperature: true },
      { id: 'kimi-k3', label: 'Kimi K3', supportsTools: true, lockedTemperature: true },
    ],
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.minimax.io/v1',
    apiKeyUrl: 'https://www.minimax.io/platform',
    requiresKey: true,
    defaultModelId: 'MiniMax-M3',
    models: [
      { id: 'MiniMax-M3', label: 'MiniMax M3', supportsTools: true },
      { id: 'MiniMax-M2.7', label: 'MiniMax M2.7', supportsTools: true },
      { id: 'MiniMax-M2', label: 'MiniMax M2', supportsTools: true },
    ],
  },
  {
    id: 'glm',
    label: 'Zhipu GLM (Z.ai)',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.z.ai/v1',
    apiKeyUrl: 'https://z.ai/manage-apikey/apikey-list',
    requiresKey: true,
    defaultModelId: 'glm-5.2',
    models: [
      { id: 'glm-5.2', label: 'GLM 5.2', supportsTools: true },
      { id: 'glm-5.1', label: 'GLM 5.1', supportsTools: true },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    requiresKey: true,
    defaultModelId: 'deepseek-v4-flash',
    models: [
      // DeepSeek V4 reasoning models reject non-default temperature → omit it.
      // They also 400 in thinking mode once tool calls span turns
      // ("reasoning_content must be passed back"). This is a tool-calling agent,
      // so we disable thinking to keep multi-turn tool use reliable.
      {
        id: 'deepseek-v4-flash',
        label: 'DeepSeek V4 Flash',
        supportsTools: true,
        lockedTemperature: true,
        requestExtras: { thinking: { type: 'disabled' } },
      },
      {
        id: 'deepseek-v4-pro',
        label: 'DeepSeek V4 Pro',
        supportsTools: true,
        lockedTemperature: true,
        requestExtras: { thinking: { type: 'disabled' } },
      },
    ],
  },
  {
    id: 'custom-openai',
    label: 'Custom (OpenAI-compatible)',
    kind: 'openai-compatible',
    // A local runtime (Ollama, LM Studio, vLLM) or a private proxy. Point the
    // base URL at your endpoint in settings.
    defaultBaseUrl: 'http://localhost:11434/v1',
    requiresKey: false,
    defaultModelId: 'llama3.1',
    models: [{ id: 'llama3.1', label: 'llama3.1 (edit in settings)', supportsTools: true }],
  },
];

export function getProviderDefinition(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
