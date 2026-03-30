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
}

export interface RoutingPolicy {
  rules: RoutingPolicyRule[];
}
