// Feature: multilingual-prompt-optimizer, Property 25: Response structure preservation
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
import type { LLMRequest, LLMResponse, RoutingAction } from '../src/models/types.ts';
import type { ModelProfile } from '../src/models/config.ts';

/**
 * **Validates: Requirements 13.2**
 *
 * Property 25: Response structure preservation
 * For any LLM response, the Optimizer SHALL return a response to the caller
 * with the same JSON structure as the original LLM response, with only the
 * text content fields potentially modified by translation.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Model profile for English-optimal (skip path) ──
const englishProfile: ModelProfile = {
  modelId: 'test-model',
  supportedLanguages: ['en'],
  languagePerformance: [{ languageTag: 'en', performanceRating: 1.0 }],
  defaultOptimalLanguage: 'en',
  endpoint: 'http://mock-llm/v1/chat/completions',
};

// ── Arbitraries ──

/** Arbitrary for OpenAI-style raw response with nested structure. */
const openAiRawArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 30 }),
  object: fc.constantFrom('chat.completion', 'chat.completion.chunk'),
  created: fc.nat(),
  model: fc.string({ minLength: 1, maxLength: 30 }),
  choices: fc.array(
    fc.record({
      index: fc.nat({ max: 10 }),
      message: fc.record({
        role: fc.constantFrom('assistant'),
        content: fc.string({ minLength: 1, maxLength: 200 }),
      }),
      finish_reason: fc.constantFrom('stop', 'length', 'content_filter'),
    }),
    { minLength: 1, maxLength: 3 },
  ),
  usage: fc.record({
    prompt_tokens: fc.nat({ max: 5000 }),
    completion_tokens: fc.nat({ max: 5000 }),
    total_tokens: fc.nat({ max: 10000 }),
  }),
});

/** Arbitrary for additional top-level fields that may appear in LLM responses. */
const extraFieldsArb = fc.record({
  system_fingerprint: fc.string({ minLength: 5, maxLength: 30 }),
  created: fc.nat(),
  custom_metadata: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 10 }),
    fc.oneof(fc.string({ maxLength: 50 }), fc.integer(), fc.boolean()),
    { minKeys: 0, maxKeys: 5 },
  ),
  service_tier: fc.constantFrom('default', 'premium', undefined),
});

/** Build a pipeline for the skip path (English input + English-optimal model). */
function buildSkipPipeline(mockResponse: LLMResponse): Pipeline {
  const registry = new ModelProfileRegistry([englishProfile]);
  const forwarder = new LLMForwarder();
  vi.spyOn(forwarder, 'forward').mockResolvedValue(mockResponse);

  return new Pipeline({
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
}

/**
 * Build a pipeline for the translate path.
 * Mocks: language detector (returns 'pt'), routing engine (returns 'translate'),
 * translator (returns translated text), and forwarder (returns controlled response).
 */
function buildTranslatePipeline(mockResponse: LLMResponse): Pipeline {
  const registry = new ModelProfileRegistry([englishProfile]);
  const forwarder = new LLMForwarder();
  vi.spyOn(forwarder, 'forward').mockResolvedValue(mockResponse);

  const detector = new LanguageDetector();
  vi.spyOn(detector, 'detect').mockReturnValue({
    primary: { tag: 'pt', confidence: 0.95 },
    all: [{ tag: 'pt', confidence: 0.95 }],
    isUndetermined: false,
  });

  const translator = new Translator({ backend: 'libretranslate', endpoint: 'http://unused' });
  vi.spyOn(translator, 'translateBatch').mockImplementation(async (texts) =>
    texts.map((t) => ({ translatedText: `[translated] ${t}`, sourceLanguage: 'pt', targetLanguage: 'en' })),
  );
  vi.spyOn(translator, 'buildLanguageInstruction').mockReturnValue(
    'Please respond in Portuguese since the original question was asked in Portuguese',
  );

  const routingEngine = new RoutingEngine({
    rules: [
      {
        priority: 1,
        matchConditions: {},
        action: 'translate' as RoutingAction,
        targetLanguage: 'en',
      },
    ],
  });

  return new Pipeline({
    detector,
    parser: new MixedContentParser(),
    classifier: new ContentClassifier(),
    routingEngine,
    translator,
    forwarder,
    metrics: new MetricsCollector(),
    shadowEvaluator: new ShadowEvaluator({ enabled: false }),
    profileRegistry: registry,
  });
}

/**
 * Build a pipeline for the hybrid path.
 * Mocks: language detector (returns 'pt'), routing engine (returns 'hybrid'),
 * translator (returns translated text), and forwarder (returns controlled response).
 */
function buildHybridPipeline(mockResponse: LLMResponse): Pipeline {
  const registry = new ModelProfileRegistry([englishProfile]);
  const forwarder = new LLMForwarder();
  vi.spyOn(forwarder, 'forward').mockResolvedValue(mockResponse);

  const detector = new LanguageDetector();
  vi.spyOn(detector, 'detect').mockReturnValue({
    primary: { tag: 'pt', confidence: 0.95 },
    all: [{ tag: 'pt', confidence: 0.95 }],
    isUndetermined: false,
  });

  const translator = new Translator({ backend: 'libretranslate', endpoint: 'http://unused' });
  vi.spyOn(translator, 'translateBatch').mockImplementation(async (texts) =>
    texts.map((t) => ({ translatedText: `[translated] ${t}`, sourceLanguage: 'pt', targetLanguage: 'en' })),
  );
  vi.spyOn(translator, 'buildLanguageInstruction').mockReturnValue(
    'Please respond in Portuguese since the original question was asked in Portuguese',
  );

  const routingEngine = new RoutingEngine({
    rules: [
      {
        priority: 1,
        matchConditions: {},
        action: 'hybrid' as RoutingAction,
        targetLanguage: 'en',
      },
    ],
  });

  return new Pipeline({
    detector,
    parser: new MixedContentParser(),
    classifier: new ContentClassifier(),
    routingEngine,
    translator,
    forwarder,
    metrics: new MetricsCollector(),
    shadowEvaluator: new ShadowEvaluator({ enabled: false }),
    profileRegistry: registry,
  });
}

describe('Response Structure Preservation - Property-Based Tests', () => {
  it('Property 25a: Skip path preserves arbitrary OpenAI-style raw response structure', async () => {
    const cases: Array<{ raw: Record<string, unknown>; content: string }> = [];

    fc.assert(
      fc.property(openAiRawArb, (raw) => {
        const content = raw.choices[0]?.message?.content ?? '';
        cases.push({ raw: { ...raw }, content });
      }),
      { numRuns: 100 },
    );

    for (const { raw, content } of cases) {
      const mockResponse: LLMResponse = { raw, content, statusCode: 200 };
      const pipeline = buildSkipPipeline(mockResponse);

      const request: LLMRequest = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello, how are you today?' }],
      };

      const { response } = await pipeline.process(request);

      // The raw response must be deeply equal — no fields added, removed, or changed
      expect(response.raw).toEqual(raw);
      expect(response.content).toBe(content);
      expect(response.statusCode).toBe(200);
    }
  });

  it('Property 25b: Translate path preserves arbitrary OpenAI-style raw response structure', async () => {
    const cases: Array<{ raw: Record<string, unknown>; content: string }> = [];

    fc.assert(
      fc.property(openAiRawArb, (raw) => {
        const content = raw.choices[0]?.message?.content ?? '';
        cases.push({ raw: { ...raw }, content });
      }),
      { numRuns: 100 },
    );

    for (const { raw, content } of cases) {
      const mockResponse: LLMResponse = { raw, content, statusCode: 200 };
      const pipeline = buildTranslatePipeline(mockResponse);

      const request: LLMRequest = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Olá, como você está hoje?' }],
      };

      const { response } = await pipeline.process(request);

      // Even though translation occurred on the REQUEST side,
      // the RESPONSE raw structure must be identical to what the LLM returned
      expect(response.raw).toEqual(raw);
      expect(response.content).toBe(content);
      expect(response.statusCode).toBe(200);
    }
  });

  it('Property 25c: Hybrid path preserves arbitrary OpenAI-style raw response structure', async () => {
    const cases: Array<{ raw: Record<string, unknown>; content: string }> = [];

    fc.assert(
      fc.property(openAiRawArb, (raw) => {
        const content = raw.choices[0]?.message?.content ?? '';
        cases.push({ raw: { ...raw }, content });
      }),
      { numRuns: 100 },
    );

    for (const { raw, content } of cases) {
      const mockResponse: LLMResponse = { raw, content, statusCode: 200 };
      const pipeline = buildHybridPipeline(mockResponse);

      const request: LLMRequest = {
        model: 'test-model',
        messages: [
          { role: 'system', content: 'Você é um assistente útil.' },
          { role: 'user', content: 'Olá, como você está hoje?' },
        ],
      };

      const { response } = await pipeline.process(request);

      // Hybrid translates system messages in the request, but the response is untouched
      expect(response.raw).toEqual(raw);
      expect(response.content).toBe(content);
      expect(response.statusCode).toBe(200);
    }
  });

  it('Property 25d: Pipeline preserves arbitrary additional top-level fields in raw response', async () => {
    const cases: Array<{ raw: Record<string, unknown>; content: string; action: string }> = [];

    const routingActionArb = fc.constantFrom('skip', 'translate', 'hybrid');

    fc.assert(
      fc.property(openAiRawArb, extraFieldsArb, routingActionArb, (baseRaw, extras, action) => {
        // Merge extra fields into the base raw response
        const raw = { ...baseRaw, ...extras };
        const content = baseRaw.choices[0]?.message?.content ?? '';
        cases.push({ raw, content, action });
      }),
      { numRuns: 100 },
    );

    for (const { raw, content, action } of cases) {
      const mockResponse: LLMResponse = { raw, content, statusCode: 200 };

      let pipeline: Pipeline;
      let request: LLMRequest;

      if (action === 'skip') {
        pipeline = buildSkipPipeline(mockResponse);
        request = {
          model: 'test-model',
          messages: [{ role: 'user', content: 'Hello, how are you today?' }],
        };
      } else if (action === 'translate') {
        pipeline = buildTranslatePipeline(mockResponse);
        request = {
          model: 'test-model',
          messages: [{ role: 'user', content: 'Olá, como você está hoje?' }],
        };
      } else {
        pipeline = buildHybridPipeline(mockResponse);
        request = {
          model: 'test-model',
          messages: [
            { role: 'system', content: 'Você é um assistente útil.' },
            { role: 'user', content: 'Olá, como você está hoje?' },
          ],
        };
      }

      const { response } = await pipeline.process(request);

      // All fields including arbitrary extras must be preserved
      expect(response.raw).toEqual(raw);
      expect(response.content).toBe(content);
      expect(response.statusCode).toBe(200);
    }
  });
});
