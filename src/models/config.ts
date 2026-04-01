import type { RoutingAction, TaskCategory } from './types.ts';

export type TranslatorBackend = 'libretranslate' | 'amazon-translate' | 'deepl' | 'google' | 'custom';

export interface TranslatorConfig {
  backend: TranslatorBackend;
  endpoint: string;
  apiKey?: string;
  awsRegion?: string;
}

export interface LanguagePerformance {
  languageTag: string;
  performanceRating: number;
}

export type LLMProvider = 'openai' | 'bedrock';

export interface ModelProfile {
  modelId: string;
  supportedLanguages: string[];
  languagePerformance: LanguagePerformance[];
  defaultOptimalLanguage: string;
  endpoint: string;
  provider?: LLMProvider;
  awsRegion?: string;
}

export interface RoutingPolicyRule {
  priority: number;
  matchConditions: {
    taskTypes?: TaskCategory[];
    sourceLanguagePattern?: string;
    modelIdPattern?: string;
  };
  action: RoutingAction;
  targetLanguage?: string;
  shadowEvaluation?: boolean;
  languageInstructionMode?: 'system_message' | 'append_to_last_user';
  /**
   * When true, the LLM responds in its optimal language (English) and the
   * response is post-translated back to the user's original language using
   * the configured MT backend. This bypasses the language instruction injection.
   * Useful for low-resource languages where the LLM's own generation is lossy.
   * Only applies to non-streaming requests.
   */
  responseTranslation?: boolean;
}

export interface RoutingPolicy {
  rules: RoutingPolicyRule[];
}
