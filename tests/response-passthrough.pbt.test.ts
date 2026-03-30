// Feature: multilingual-prompt-optimizer, Property 13: Response passthrough when not translated
import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import { Pipeline } from '../src/pipeline/pipeline.ts';
import { LanguageDetector } from '../src/components/language-detector.ts';
import { MixedContentParser } from '../src/components/mixed-content-parser.ts';
import { ContentClassifier } from '../src/components/content-classifier.ts';
import { RoutingEngine } from '../src/components/routing-engine.ts';
import { Translator } from '../src/components/translator.ts';
import { LLMForwarder } from '../src/components/llm-forwarder.ts';
import { MetricsCollector } from '../src/components/metrics-collector.ts';
import { ShadowEvaluator } from '../src/components/shadow-evaluator.ts';
import { ModelProfileRegistry } from '../src/config/model-profile-loader.ts';
import type { LLMRequest, LLMResponse } from '../src/models/types.ts';
import type { ModelProfile } from '../src/models/config.ts';

/**
 * **Validates: Requirements 7.3**
 *
 * Property 13: Response passthrough when not translated
 * For any request where the RoutingEngine decision is "skip", the Optimizer
 * SHALL return the LLM response without any modification to its content or structure.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

/** Arbitrary for LLM response content strings. */
const responseContentArb = fc.string({ minLength: 1, maxLength: 500 });

/** Arbitrary for HTTP success status codes. */
const statusCodeArb = fc.constantFrom(200, 201);

/** Arbitrary for raw OpenAI-style response bodies. */
const rawResponseArb = (content: string) =>
  fc.constant({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  });

/** Arbitrary for user message content (English text to trigger same-language skip). */
const userMessageArb = fc.string({ minLength: 10, maxLength: 200 });

/**
 * Creates a Pipeline where the RoutingEngine always returns "skip" (by using
 * English input with an English-optimal model profile) and the LLMForwarder
 * returns a controlled response.
 */
function buildSkipPipeline(mockResponse: LLMResponse): Pipeline {
  const profile: ModelProfile = {
    modelId: 'test-model',
    supportedLanguages: ['en'],
    languagePerformance: [{ languageTag: 'en', performanceRating: 1.0 }],
    defaultOptimalLanguage: 'en',
    endpoint: 'http://mock-llm/v1/chat/completions',
  };

  const registry = new ModelProfileRegistry([profile]);
  const forwarder = new LLMForwarder();

  // Mock the forwarder to return our controlled response
  vi.spyOn(forwarder, 'forward').mockResolvedValue(mockResponse);

  // Use a routing engine with no rules — combined with English input and
  // English optimal language, the engine will always skip.
  const routingEngine = new RoutingEngine({ rules: [] });

  return new Pipeline({
    detector: new LanguageDetector(),
    parser: new MixedContentParser(),
    classifier: new ContentClassifier(),
    routingEngine,
    translator: new Translator({ backend: 'libretranslate', endpoint: 'http://unused' }),
    forwarder,
    metrics: new MetricsCollector(),
    shadowEvaluator: new ShadowEvaluator({ enabled: false }),
    profileRegistry: registry,
  });
}

describe('Response Passthrough When Not Translated - Property-Based Tests', () => {
  it('Property 13a: Skip routing returns LLM response content unmodified', async () => {
    const cases: Array<{ content: string; statusCode: number; raw: unknown }> = [];

    fc.assert(
      fc.property(responseContentArb, statusCodeArb, (content, statusCode) => {
        cases.push({
          content,
          statusCode,
          raw: {
            id: 'chatcmpl-test',
            object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          },
        });
      }),
      { numRuns: 100 },
    );

    for (const { content, statusCode, raw } of cases) {
      const mockResponse: LLMResponse = { raw, content, statusCode };
      const pipeline = buildSkipPipeline(mockResponse);

      const request: LLMRequest = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello, how are you today?' }],
      };

      const { response } = await pipeline.process(request);

      // Content must be identical
      expect(response.content).toBe(content);
      // Status code must be identical
      expect(response.statusCode).toBe(statusCode);
      // Raw response must be identical (same reference)
      expect(response.raw).toEqual(raw);
    }
  });

  it('Property 13b: Skip routing does not modify the raw response structure', async () => {
    const cases: Array<{ content: string; raw: Record<string, unknown> }> = [];

    fc.assert(
      fc.property(responseContentArb, (content) => {
        cases.push({
          content,
          raw: {
            id: 'chatcmpl-unique',
            object: 'chat.completion',
            created: 1234567890,
            model: 'test-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 15, total_tokens: 20 },
          },
        });
      }),
      { numRuns: 100 },
    );

    for (const { content, raw } of cases) {
      const mockResponse: LLMResponse = { raw, content, statusCode: 200 };
      const pipeline = buildSkipPipeline(mockResponse);

      const request: LLMRequest = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Tell me about TypeScript' }],
      };

      const { response } = await pipeline.process(request);

      // The raw field must be deeply equal — no fields added, removed, or changed
      expect(response.raw).toEqual(raw);
    }
  });

  it('Property 13c: Skip routing decision is recorded in pipeline context', async () => {
    const cases: Array<{ content: string }> = [];

    fc.assert(
      fc.property(responseContentArb, (content) => {
        cases.push({ content });
      }),
      { numRuns: 100 },
    );

    for (const { content } of cases) {
      const mockResponse: LLMResponse = {
        raw: { choices: [{ message: { role: 'assistant', content } }] },
        content,
        statusCode: 200,
      };
      const pipeline = buildSkipPipeline(mockResponse);

      const request: LLMRequest = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Explain generics in TypeScript' }],
      };

      const { context } = await pipeline.process(request);

      // Routing decision must be skip
      expect(context.routingDecision.action).toBe('skip');
      // No translated prompt should exist
      expect(context.translatedPrompt).toBeUndefined();
      // No language instruction should exist
      expect(context.languageInstruction).toBeUndefined();
    }
  });

  it('Property 13d: Forwarder receives the original request unmodified on skip', async () => {
    const cases: Array<{ userMsg: string }> = [];

    fc.assert(
      fc.property(userMessageArb, (userMsg) => {
        cases.push({ userMsg });
      }),
      { numRuns: 100 },
    );

    for (const { userMsg } of cases) {
      const mockResponse: LLMResponse = {
        raw: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
        content: 'ok',
        statusCode: 200,
      };

      const profile: ModelProfile = {
        modelId: 'test-model',
        supportedLanguages: ['en'],
        languagePerformance: [{ languageTag: 'en', performanceRating: 1.0 }],
        defaultOptimalLanguage: 'en',
        endpoint: 'http://mock-llm/v1/chat/completions',
      };

      const registry = new ModelProfileRegistry([profile]);
      const forwarder = new LLMForwarder();
      const forwardSpy = vi.spyOn(forwarder, 'forward').mockResolvedValue(mockResponse);

      const pipeline = new Pipeline({
        detector: new LanguageDetector(),
        parser: new MixedContentParser(),
        classifier: new ContentClassifier(),
        routingEngine: new RoutingEngine({ rules: [] }),
        translator: new Translator({ backend: 'libretranslate', endpoint: 'http://unused' }),
        forwarder,
        metrics: new MetricsCollector(),
        shadowEvaluator: new ShadowEvaluator({ enabled: false }),
        profileRegistry: registry,
      });

      const request: LLMRequest = {
        model: 'test-model',
        messages: [{ role: 'user', content: userMsg as string }],
      };

      await pipeline.process(request);

      // The forwarder must have been called with the exact original request
      expect(forwardSpy).toHaveBeenCalledWith(request, profile.endpoint, undefined, profile.provider, profile.awsRegion);

      vi.restoreAllMocks();
    }
  });
});
