import type { ProviderDefinition } from '../types';
import type { ProviderAdapter } from './base';
import { anthropicAdapter } from './anthropic';
import { geminiAdapter } from './gemini';
import { openAICompatibleAdapter } from './openai-compatible';

export { PROVIDERS, getProviderDefinition } from './registry';
export type { ProviderAdapter } from './base';

/** Map a provider definition to the adapter that speaks its wire format. */
export function getAdapter(def: ProviderDefinition): ProviderAdapter {
  switch (def.kind) {
    case 'anthropic':
      return anthropicAdapter;
    case 'gemini':
      return geminiAdapter;
    case 'openai-compatible':
    default:
      return openAICompatibleAdapter;
  }
}
