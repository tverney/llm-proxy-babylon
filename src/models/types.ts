import type { ModelProfile, RoutingPolicyRule } from './config.ts';

export interface DetectedLanguage {
  tag: string;        // BCP-47 language tag
  confidence: number; // 0.0 to 1.0
}

export interface LanguageDetectionResult {
  primary: DetectedLanguage;
  all: DetectedLanguage[];
  isUndetermined: boolean;
}

export type SegmentType = 'text' | 'code_block' | 'inline_code' | 'url' | 'json' | 'xml' | 'yaml' | 'sql';

export interface Segment {
  type: SegmentType;
  content: string;
  position: number;
}

export interface ParsedContent {
  segments: Segment[];
  translatableSegments(): Segment[];
  nonTranslatableSegments(): Segment[];
  reassemble(translatedTexts: Map<number, string>): string;
}

export type TaskCategory =
  | 'reasoning'
  | 'math'
  | 'code-generation'
  | 'creative-writing'
  | 'translation'
  | 'summarization'
  | 'culturally-specific'
  | 'general';

export interface ClassificationResult {
  categories: Array<{ category: TaskCategory; confidence: number }>;
  primaryCategory: TaskCategory;
}

export type RoutingAction = 'translate' | 'skip' | 'hybrid';

export interface RoutingDecision {
  action: RoutingAction;
  optimalLanguage: string | null;
  matchedRule: RoutingPolicyRule | null;
  reason: string;
}

export interface TranslationResult {
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface LanguageInstructionConfig {
  template: string;
  injectionMode: 'system_message' | 'append_to_last_user';
}

export interface LLMRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  [key: string]: unknown;
}

export interface LLMResponse {
  raw: unknown;
  content: string;
  statusCode: number;
}

export interface QualityScore {
  coherence: number;
  completeness: number;
  factualConsistency: number;
  instructionAdherence: number;
  overall: number;
}

export interface QualityComparison {
  translatedScore: QualityScore;
  baselineScore: QualityScore;
  delta: number;
  translationImproved: boolean;
}

export interface RequestLog {
  requestId: string;
  detectedLanguage: string;
  taskType: TaskCategory;
  routingDecision: RoutingAction;
  targetLanguage: string | null;
  translationLatencyMs: number;
  totalLatencyMs: number;
  qualityDelta?: number;
}

export interface AggregateMetrics {
  totalRequests: number;
  translatedRequests: number;
  skippedRequests: number;
  translationErrors: number;
  avgTranslationLatencyMs: number;
  avgQualityDelta: number;
  translationImprovedPct: number;
  translationDegradedPct: number;
}

export interface LanguageEvaluationResult {
  language: string;
  response: LLMResponse;
  qualityScore: QualityScore;
  deltaFromBaseline: number;
}

export interface EvaluationReport {
  prompt: string;
  baselineLanguage: string;
  baselineScore: QualityScore;
  results: LanguageEvaluationResult[];
  ranking: string[];
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TokenSavings {
  originalPromptTokens: number;   // tokens if sent in original language
  optimizedPromptTokens: number;  // tokens actually sent (after translation)
  tokensSaved: number;            // difference
  savingsPercent: number;         // percentage saved
}

export interface CostEstimate {
  inputCostUSD: number;
  outputCostUSD: number;
  totalCostUSD: number;
  savedInputCostUSD: number;
}

export interface PipelineContext {
  requestId: string;
  originalRequest: LLMRequest;
  detection: LanguageDetectionResult;
  parsedContent: ParsedContent;
  classification: ClassificationResult;
  routingDecision: RoutingDecision;
  modelProfile: ModelProfile;
  translatedPrompt?: string;
  languageInstruction?: string;
  llmResponse?: LLMResponse;
  qualityComparison?: QualityComparison;
  tokenUsage?: TokenUsage;
  tokenSavings?: TokenSavings;
  costEstimate?: CostEstimate;
  translationCacheHits?: number;
  translationCacheMisses?: number;
  compaction?: {
    originalMessages: number;
    compactedMessages: number;
    summaryTokens: number;
  };
  timestamps: {
    received: number;
    detectionDone: number;
    parsingDone: number;
    classificationDone: number;
    routingDone: number;
    translationDone?: number;
    llmResponseReceived: number;
    completed: number;
  };
}
