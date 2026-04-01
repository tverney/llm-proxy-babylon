import { v4 as uuidv4 } from 'uuid';
import type {
  LLMRequest,
  LLMResponse,
  PipelineContext,
  LanguageInstructionConfig,
  RequestLog,
  QualityComparison,
  TokenUsage,
  TokenSavings,
} from '../models/types.ts';
import type { ModelProfile } from '../models/config.ts';
import { calculateCost } from '../config/model-costs.ts';
import { LanguageDetector } from '../components/language-detector.ts';
import { MixedContentParser } from '../components/mixed-content-parser.ts';
import { ContentClassifier } from '../components/content-classifier.ts';
import { RoutingEngine } from '../components/routing-engine.ts';
import { Translator } from '../components/translator.ts';
import { LLMForwarder } from '../components/llm-forwarder.ts';
import { MetricsCollector } from '../components/metrics-collector.ts';
import { ShadowEvaluator } from '../components/shadow-evaluator.ts';
import { ModelProfileRegistry } from '../config/model-profile-loader.ts';
import { ConversationCache } from '../components/conversation-cache.ts';
import { TokenCounter } from '../components/token-counter.ts';

export interface PipelineConfig {
  defaultLanguageInstructionConfig: LanguageInstructionConfig;
}

const DEFAULT_LANGUAGE_INSTRUCTION_CONFIG: LanguageInstructionConfig = {
  template: 'Please respond in {{language}} since the original question was asked in {{language}}',
  injectionMode: 'append_to_last_user',
};

export class Pipeline {
  private detector: LanguageDetector;
  private parser: MixedContentParser;
  private classifier: ContentClassifier;
  private routingEngine: RoutingEngine;
  private translator: Translator;
  private forwarder: LLMForwarder;
  private metrics: MetricsCollector;
  private shadowEvaluator: ShadowEvaluator;
  private profileRegistry: ModelProfileRegistry;
  private conversationCache: ConversationCache;
  private tokenCounter: TokenCounter;
  private config: PipelineConfig;

  constructor(opts: {
    detector: LanguageDetector;
    parser: MixedContentParser;
    classifier: ContentClassifier;
    routingEngine: RoutingEngine;
    translator: Translator;
    forwarder: LLMForwarder;
    metrics: MetricsCollector;
    shadowEvaluator: ShadowEvaluator;
    profileRegistry: ModelProfileRegistry;
    conversationCache?: ConversationCache;
    config?: Partial<PipelineConfig>;
  }) {
    this.detector = opts.detector;
    this.parser = opts.parser;
    this.classifier = opts.classifier;
    this.routingEngine = opts.routingEngine;
    this.translator = opts.translator;
    this.forwarder = opts.forwarder;
    this.metrics = opts.metrics;
    this.shadowEvaluator = opts.shadowEvaluator;
    this.profileRegistry = opts.profileRegistry;
    this.conversationCache = opts.conversationCache ?? new ConversationCache();
    this.tokenCounter = new TokenCounter();
    this.config = {
      defaultLanguageInstructionConfig:
        opts.config?.defaultLanguageInstructionConfig ?? DEFAULT_LANGUAGE_INSTRUCTION_CONFIG,
    };
  }

  /**
   * Prepare a request through the pipeline (detect, parse, classify, route, translate)
   * without forwarding to the LLM. Returns the prepared request and context.
   * Used for streaming — the caller handles forwarding via the stream interface.
   */
  async prepare(request: LLMRequest, conversationId?: string): Promise<{ preparedRequest: LLMRequest; context: PipelineContext }> {
    const requestId = uuidv4();
    const received = Date.now();
    const modelProfile = this.profileRegistry.get(request.model);
    const fullText = request.messages.map((m) => m.content).join('\n');

    const detection = this.detector.detect(fullText);
    const detectionDone = Date.now();
    const parsedContent = this.parser.parse(fullText);
    const parsingDone = Date.now();
    const classification = this.classifier.classify(fullText);
    const classificationDone = Date.now();
    const routingDecision = this.routingEngine.evaluate(detection, classification, modelProfile);
    const routingDone = Date.now();

    const ctx: PipelineContext = {
      requestId, originalRequest: request, detection, parsedContent,
      classification, routingDecision, modelProfile,
      timestamps: { received, detectionDone, parsingDone, classificationDone, routingDone, llmResponseReceived: 0, completed: 0 },
    };

    let finalRequest: LLMRequest;
    if (routingDecision.action === 'skip') {
      finalRequest = request;
    } else if (routingDecision.action === 'translate') {
      finalRequest = await this.handleTranslate(request, ctx, modelProfile, conversationId);
    } else {
      finalRequest = await this.handleHybrid(request, ctx, modelProfile);
    }

    return { preparedRequest: finalRequest, context: ctx };
  }

  /**
   * Get the routing trace from the last evaluate() call.
   */
  getLastRoutingTrace() {
    return this.routingEngine.getLastTrace();
  }

  /**
   * Process a single LLM request through the full pipeline:
   * detect → parse → classify → route → translate + inject language instruction → forward → respond
   */
  async process(request: LLMRequest, headers?: Record<string, string>, conversationId?: string): Promise<{ response: LLMResponse; context: PipelineContext }> {
    const requestId = uuidv4();
    const received = Date.now();
    const modelProfile = this.profileRegistry.get(request.model);

    // Concatenate all message contents for language detection and classification
    const fullText = request.messages.map((m) => m.content).join('\n');

    // 1. Detect language
    const detection = this.detector.detect(fullText);
    const detectionDone = Date.now();

    // 2. Parse mixed content
    const parsedContent = this.parser.parse(fullText);
    const parsingDone = Date.now();

    // 3. Classify task type
    const classification = this.classifier.classify(fullText);
    const classificationDone = Date.now();

    // 4. Route
    const routingDecision = this.routingEngine.evaluate(detection, classification, modelProfile);
    const routingDone = Date.now();

    // Build initial context (timestamps filled progressively)
    const ctx: PipelineContext = {
      requestId,
      originalRequest: request,
      detection,
      parsedContent,
      classification,
      routingDecision,
      modelProfile,
      timestamps: {
        received,
        detectionDone,
        parsingDone,
        classificationDone,
        routingDone,
        llmResponseReceived: 0,
        completed: 0,
      },
    };

    let finalRequest: LLMRequest;

    if (routingDecision.action === 'skip') {
      // Skip path: forward original prompt without modification (Req 7.3)
      finalRequest = request;
    } else if (routingDecision.action === 'translate') {
      // Translate path: translate all messages, append language instruction
      finalRequest = await this.handleTranslate(request, ctx, modelProfile, conversationId);
    } else {
      // Hybrid path: translate system messages only, keep user messages (Req 4.5)
      finalRequest = await this.handleHybrid(request, ctx, modelProfile);
    }

    // 6. Forward to LLM
    const llmResponse = await this.forwarder.forward(
      finalRequest,
      modelProfile.endpoint,
      headers,
      modelProfile.provider,
      modelProfile.awsRegion,
    );
    ctx.llmResponse = llmResponse;
    ctx.timestamps.llmResponseReceived = Date.now();

    // Extract token usage from LLM response
    ctx.tokenUsage = this.extractTokenUsage(llmResponse);

    // Compute token savings when translation was applied
    if (routingDecision.action !== 'skip' && ctx.tokenUsage) {
      ctx.tokenSavings = await this.computeTokenSavings(request, ctx.tokenUsage, modelProfile);
    }

    // Compute cost estimate
    if (ctx.tokenUsage) {
      const cost = calculateCost(
        request.model,
        ctx.tokenUsage.promptTokens,
        ctx.tokenUsage.completionTokens,
        ctx.tokenSavings?.tokensSaved,
      );
      ctx.costEstimate = {
        inputCostUSD: cost.inputCostUSD,
        outputCostUSD: cost.outputCostUSD,
        totalCostUSD: cost.totalCostUSD,
        savedInputCostUSD: cost.savedInputCostUSD,
      };
    }

    // 7. Shadow evaluation (if enabled for matched rule)
    let qualityComparison: QualityComparison | undefined;
    if (
      routingDecision.action !== 'skip' &&
      this.shadowEvaluator.isEnabled(routingDecision.matchedRule)
    ) {
      try {
        qualityComparison = await this.shadowEvaluator.evaluate(
          request,
          llmResponse,
          this.forwarder,
          modelProfile.endpoint,
        );
        ctx.qualityComparison = qualityComparison;
      } catch (err) {
        console.warn(
          `[Pipeline] Shadow evaluation failed for request ${requestId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    ctx.timestamps.completed = Date.now();

    // 8. Log metrics
    const translationLatencyMs = ctx.timestamps.translationDone
      ? ctx.timestamps.translationDone - routingDone
      : 0;

    const logEntry: RequestLog = {
      requestId,
      detectedLanguage: detection.primary.tag,
      taskType: classification.primaryCategory,
      routingDecision: routingDecision.action,
      targetLanguage: routingDecision.optimalLanguage,
      translationLatencyMs,
      totalLatencyMs: ctx.timestamps.completed - received,
      qualityDelta: qualityComparison?.delta,
    };
    this.metrics.log(logEntry);

    return { response: llmResponse, context: ctx };
  }

  /**
   * Handle the "translate" routing action.
   * Translates all user/system message text segments, reassembles, and appends language instruction.
   * On translation failure, falls back to original prompt without language instruction (Req 5.3).
   */
  private async handleTranslate(
    request: LLMRequest,
    ctx: PipelineContext,
    modelProfile: ModelProfile,
    conversationId?: string,
  ): Promise<LLMRequest> {
    const originalLang = ctx.detection.primary.tag;
    const targetLang = ctx.routingDecision.optimalLanguage!;
    const instructionConfig = this.getLanguageInstructionConfig(ctx);

    try {
      const { translated: translatedMessages, cacheHits, cacheMisses } = await this.translateMessages(
        request.messages,
        originalLang,
        targetLang,
        conversationId,
      );

      ctx.timestamps.translationDone = Date.now();
      ctx.translationCacheHits = cacheHits;
      ctx.translationCacheMisses = cacheMisses;

      // Build language instruction
      const instruction = this.translator.buildLanguageInstruction(originalLang, instructionConfig);
      ctx.languageInstruction = instruction;

      // Inject language instruction
      const finalMessages = this.injectLanguageInstruction(
        translatedMessages,
        instruction,
        instructionConfig.injectionMode,
      );

      ctx.translatedPrompt = finalMessages.map((m) => m.content).join('\n');

      return { ...request, messages: finalMessages };
    } catch (err) {
      // Translation fallback: forward original prompt without language instruction (Req 5.3)
      console.warn(
        `[Pipeline] Translation failed for request ${ctx.requestId}, forwarding original: ${err instanceof Error ? err.message : String(err)}`,
      );
      ctx.timestamps.translationDone = Date.now();
      return request;
    }
  }

  /**
   * Handle the "hybrid" routing action.
   * Translates system messages to optimal language, keeps user messages in original language,
   * and appends language instruction (Req 4.5).
   */
  private async handleHybrid(
    request: LLMRequest,
    ctx: PipelineContext,
    modelProfile: ModelProfile,
  ): Promise<LLMRequest> {
    const originalLang = ctx.detection.primary.tag;
    const targetLang = ctx.routingDecision.optimalLanguage!;
    const instructionConfig = this.getLanguageInstructionConfig(ctx);

    try {
      const finalMessages: Array<{ role: string; content: string }> = [];

      for (const msg of request.messages) {
        if (msg.role === 'system') {
          // Translate system messages
          const parsed = this.parser.parse(msg.content);
          const translatable = parsed.translatableSegments();
          const translated = await this.translator.translateBatch(
            translatable.map((s) => s.content),
            originalLang,
            targetLang,
          );
          const translatedMap = new Map<number, string>();
          translatable.forEach((seg, i) => {
            translatedMap.set(seg.position, translated[i].translatedText);
          });
          finalMessages.push({ role: msg.role, content: parsed.reassemble(translatedMap) });
        } else {
          // Keep user messages in original language
          finalMessages.push({ ...msg });
        }
      }

      ctx.timestamps.translationDone = Date.now();

      // Build and inject language instruction
      const instruction = this.translator.buildLanguageInstruction(originalLang, instructionConfig);
      ctx.languageInstruction = instruction;

      const messagesWithInstruction = this.injectLanguageInstruction(
        finalMessages,
        instruction,
        instructionConfig.injectionMode,
      );

      ctx.translatedPrompt = messagesWithInstruction.map((m) => m.content).join('\n');

      return { ...request, messages: messagesWithInstruction };
    } catch (err) {
      console.warn(
        `[Pipeline] Hybrid translation failed for request ${ctx.requestId}, forwarding original: ${err instanceof Error ? err.message : String(err)}`,
      );
      ctx.timestamps.translationDone = Date.now();
      return request;
    }
  }

  /**
   * Translate all messages using the mixed content parser to preserve non-translatable segments.
   * Uses conversation cache when a conversationId is provided.
   */
  private async translateMessages(
    messages: Array<{ role: string; content: string }>,
    from: string,
    to: string,
    conversationId?: string,
  ): Promise<{ translated: Array<{ role: string; content: string }>; cacheHits: number; cacheMisses: number }> {
    // If we have a conversation ID, use the cache
    if (conversationId) {
      return this.translateMessagesWithCache(messages, from, to, conversationId);
    }

    // No cache — translate everything
    const result: Array<{ role: string; content: string }> = [];
    for (const msg of messages) {
      const parsed = this.parser.parse(msg.content);
      const translatable = parsed.translatableSegments();

      if (translatable.length === 0) {
        result.push({ ...msg });
        continue;
      }

      const translated = await this.translator.translateBatch(
        translatable.map((s) => s.content),
        from,
        to,
      );

      const translatedMap = new Map<number, string>();
      translatable.forEach((seg, i) => {
        translatedMap.set(seg.position, translated[i].translatedText);
      });

      result.push({ role: msg.role, content: parsed.reassemble(translatedMap) });
    }

    return { translated: result, cacheHits: 0, cacheMisses: messages.length };
  }

  /**
   * Translate messages using the conversation cache.
   * Only translates messages that aren't already cached.
   */
  private async translateMessagesWithCache(
    messages: Array<{ role: string; content: string }>,
    from: string,
    to: string,
    conversationId: string,
  ): Promise<{ translated: Array<{ role: string; content: string }>; cacheHits: number; cacheMisses: number }> {
    const { hits, misses } = this.conversationCache.lookup(conversationId, messages);
    const result: Array<{ role: string; content: string }> = new Array(messages.length);

    // Fill in cache hits
    for (const hit of hits) {
      result[hit.index] = { role: messages[hit.index].role, content: hit.translatedContent };
    }

    // Translate cache misses
    const newTranslations: Array<{
      index: number; role: string; originalContent: string;
      translatedContent: string; sourceLanguage: string; targetLanguage: string;
    }> = [];

    for (const miss of misses) {
      const parsed = this.parser.parse(miss.content);
      const translatable = parsed.translatableSegments();

      if (translatable.length === 0) {
        result[miss.index] = { role: miss.role, content: miss.content };
        newTranslations.push({
          index: miss.index, role: miss.role, originalContent: miss.content,
          translatedContent: miss.content, sourceLanguage: from, targetLanguage: to,
        });
        continue;
      }

      const translated = await this.translator.translateBatch(
        translatable.map((s) => s.content), from, to,
      );

      const translatedMap = new Map<number, string>();
      translatable.forEach((seg, i) => {
        translatedMap.set(seg.position, translated[i].translatedText);
      });

      const translatedContent = parsed.reassemble(translatedMap);
      result[miss.index] = { role: miss.role, content: translatedContent };
      newTranslations.push({
        index: miss.index, role: miss.role, originalContent: miss.content,
        translatedContent, sourceLanguage: from, targetLanguage: to,
      });
    }

    // Store new translations in cache
    if (newTranslations.length > 0) {
      this.conversationCache.store(conversationId, newTranslations);
    }

    return { translated: result, cacheHits: hits.length, cacheMisses: misses.length };
  }

  /**
   * Inject a language instruction into the messages array.
   */
  private injectLanguageInstruction(
    messages: Array<{ role: string; content: string }>,
    instruction: string,
    mode: 'system_message' | 'append_to_last_user',
  ): Array<{ role: string; content: string }> {
    const result = messages.map((m) => ({ ...m }));

    if (mode === 'system_message') {
      result.push({ role: 'system', content: instruction });
    } else {
      // append_to_last_user: find last user message and append
      for (let i = result.length - 1; i >= 0; i--) {
        if (result[i].role === 'user') {
          result[i] = { ...result[i], content: result[i].content + '\n\n' + instruction };
          break;
        }
      }
    }

    return result;
  }

  /**
   * Get the language instruction config, preferring per-rule config if available.
   */
  private getLanguageInstructionConfig(ctx: PipelineContext): LanguageInstructionConfig {
    const rule = ctx.routingDecision.matchedRule;
    const mode = rule?.languageInstructionMode ?? this.config.defaultLanguageInstructionConfig.injectionMode;
    return {
      template: this.config.defaultLanguageInstructionConfig.template,
      injectionMode: mode,
    };
  }

  /**
   * Extract token usage from an LLM response (OpenAI-compatible format).
   */
  private extractTokenUsage(response: LLMResponse): TokenUsage | undefined {
    const raw = response.raw as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object') return undefined;
    const usage = raw.usage as Record<string, unknown> | undefined;
    if (!usage || typeof usage !== 'object') return undefined;

    const promptTokens = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
    const completionTokens = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0;
    const totalTokens = typeof usage.total_tokens === 'number' ? usage.total_tokens : promptTokens + completionTokens;

    return { promptTokens, completionTokens, totalTokens };
  }

  /**
   * Estimate token savings by comparing original message length to what was actually sent.
   * Uses a rough heuristic: non-Latin scripts average ~1.5-4 chars per token,
   * while English averages ~4 chars per token. The actual LLM prompt_tokens gives us
   * the real optimized count.
   */
  private async computeTokenSavings(originalRequest: LLMRequest, actualUsage: TokenUsage, modelProfile: ModelProfile): Promise<TokenSavings> {
    // Use precise Bedrock token counting when available, fall back to estimation
    const originalCount = await this.tokenCounter.countInputTokens(
      originalRequest.messages,
      originalRequest.model,
      modelProfile.provider,
      modelProfile.awsRegion,
    );

    const optimizedPromptTokens = actualUsage.promptTokens;
    const saved = originalCount.inputTokens - optimizedPromptTokens;

    return {
      originalPromptTokens: originalCount.inputTokens,
      optimizedPromptTokens,
      tokensSaved: Math.max(saved, 0),
      savingsPercent: originalCount.inputTokens > 0
        ? Math.max((saved / originalCount.inputTokens) * 100, 0)
        : 0,
    };
  }

  /**
   * Rough token count estimation based on script type.
   * CJK/Thai/Korean characters typically produce more tokens per character than Latin scripts.
   */
  private estimateTokenCount(text: string): number {
    let tokens = 0;
    for (const char of text) {
      const code = char.codePointAt(0) ?? 0;
      if (
        (code >= 0x0E00 && code <= 0x0E7F) || // Thai
        (code >= 0x3000 && code <= 0x9FFF) || // CJK
        (code >= 0xAC00 && code <= 0xD7AF) || // Korean Hangul
        (code >= 0x1100 && code <= 0x11FF)    // Korean Jamo
      ) {
        tokens += 1.5; // Non-Latin scripts: ~1-2 tokens per character
      } else {
        tokens += 0.25; // Latin scripts: ~4 chars per token
      }
    }
    return Math.ceil(tokens);
  }
}
