import { describe, it, expect, vi, afterEach } from 'vitest';
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
import type { LLMResponse, RoutingAction } from '../src/models/types.ts';
import type { ModelProfile } from '../src/models/config.ts';

/**
 * Tests for response translation — post-translating the LLM's English response
 * back to the user's original language via the MT backend.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

const profile: ModelProfile = {
  modelId: 'test-model',
  supportedLanguages: ['en'],
  languagePerformance: [{ languageTag: 'en', performanceRating: 1.0 }],
  defaultOptimalLanguage: 'en',
  endpoint: 'http://mock-llm/v1/chat/completions',
};

const mockLLMResponse: LLMResponse = {
  raw: {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content: 'Recursion is when a function calls itself.' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
  },
  content: 'Recursion is when a function calls itself.',
  statusCode: 200,
};

function buildPipeline(opts: {
  responseTranslation: boolean;
  mockTranslatedResponse?: string;
  mockTranslateThrows?: boolean;
}) {
  const registry = new ModelProfileRegistry([profile]);
  const forwarder = new LLMForwarder();
  vi.spyOn(forwarder, 'forward').mockResolvedValue(mockLLMResponse);

  const detector = new LanguageDetector();
  vi.spyOn(detector, 'detect').mockReturnValue({
    primary: { tag: 'th', confidence: 0.99 },
    all: [{ tag: 'th', confidence: 0.99 }],
    isUndetermined: false,
  });

  const translator = new Translator({ backend: 'libretranslate', endpoint: 'http://unused' });

  // Mock prompt translation (input side)
  vi.spyOn(translator, 'translateBatch').mockImplementation(async (texts) =>
    texts.map((t) => ({ translatedText: `[en] ${t}`, sourceLanguage: 'th', targetLanguage: 'en' })),
  );

  // Mock response translation (output side)
  if (opts.mockTranslateThrows) {
    vi.spyOn(translator, 'translate').mockRejectedValue(new Error('MT backend unavailable'));
  } else {
    const translated = opts.mockTranslatedResponse ?? 'การเรียกซ้ำคือเมื่อฟังก์ชันเรียกตัวเอง';
    vi.spyOn(translator, 'translate').mockResolvedValue({
      translatedText: translated,
      sourceLanguage: 'en',
      targetLanguage: 'th',
    });
  }

  vi.spyOn(translator, 'buildLanguageInstruction').mockReturnValue(
    'Please respond in Thai since the original question was asked in Thai',
  );

  const routingEngine = new RoutingEngine({
    rules: [{
      priority: 1,
      matchConditions: {},
      action: 'translate' as RoutingAction,
      targetLanguage: 'en',
      responseTranslation: opts.responseTranslation,
    }],
  });

  return { pipeline: new Pipeline({
    detector,
    parser: new MixedContentParser(),
    classifier: new ContentClassifier(),
    routingEngine,
    translator,
    forwarder,
    metrics: new MetricsCollector(),
    shadowEvaluator: new ShadowEvaluator({ enabled: false }),
    profileRegistry: registry,
  }), translator, forwarder };
}

describe('Response Translation', () => {
  it('post-translates the LLM response when responseTranslation is enabled', async () => {
    const { pipeline } = buildPipeline({ responseTranslation: true });

    const { response, context } = await pipeline.process({
      model: 'test-model',
      messages: [{ role: 'user', content: 'อธิบาย recursion' }],
    });

    // Response content should be the Thai translation, not the English original
    expect(response.content).toBe('การเรียกซ้ำคือเมื่อฟังก์ชันเรียกตัวเอง');
    expect(context.responseTranslation).toBeDefined();
    expect(context.responseTranslation!.applied).toBe(true);
    expect(context.responseTranslation!.originalContent).toBe('Recursion is when a function calls itself.');
    expect(context.responseTranslation!.translatedContent).toBe('การเรียกซ้ำคือเมื่อฟังก์ชันเรียกตัวเอง');
    expect(context.responseTranslation!.sourceLanguage).toBe('en');
    expect(context.responseTranslation!.targetLanguage).toBe('th');
    expect(context.responseTranslation!.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('patches the raw response payload with translated content', async () => {
    const { pipeline } = buildPipeline({ responseTranslation: true });

    const { response } = await pipeline.process({
      model: 'test-model',
      messages: [{ role: 'user', content: 'อธิบาย recursion' }],
    });

    const raw = response.raw as Record<string, unknown>;
    const choices = raw.choices as Array<Record<string, unknown>>;
    const message = choices[0].message as Record<string, unknown>;
    expect(message.content).toBe('การเรียกซ้ำคือเมื่อฟังก์ชันเรียกตัวเอง');
  });

  it('skips language instruction when responseTranslation is enabled', async () => {
    const { pipeline } = buildPipeline({ responseTranslation: true });

    const { context } = await pipeline.process({
      model: 'test-model',
      messages: [{ role: 'user', content: 'อธิบาย recursion' }],
    });

    // Language instruction should NOT be injected
    expect(context.languageInstruction).toBeUndefined();
  });

  it('injects language instruction when responseTranslation is disabled', async () => {
    const { pipeline } = buildPipeline({ responseTranslation: false });

    const { context } = await pipeline.process({
      model: 'test-model',
      messages: [{ role: 'user', content: 'อธิบาย recursion' }],
    });

    // Language instruction SHOULD be injected
    expect(context.languageInstruction).toBe(
      'Please respond in Thai since the original question was asked in Thai',
    );
    // No response translation should occur
    expect(context.responseTranslation).toBeUndefined();
  });

  it('does not post-translate the response when responseTranslation is not set on the rule', async () => {
    const { pipeline } = buildPipeline({ responseTranslation: false });

    const { response } = await pipeline.process({
      model: 'test-model',
      messages: [{ role: 'user', content: 'อธิบาย recursion' }],
    });

    // Response should be the original English content from the LLM
    expect(response.content).toBe('Recursion is when a function calls itself.');
  });

  it('falls back to original response when MT backend fails', async () => {
    const { pipeline } = buildPipeline({
      responseTranslation: true,
      mockTranslateThrows: true,
    });

    const { response, context } = await pipeline.process({
      model: 'test-model',
      messages: [{ role: 'user', content: 'อธิบาย recursion' }],
    });

    // Should return the original English response on failure
    expect(response.content).toBe('Recursion is when a function calls itself.');
    expect(context.responseTranslation).toBeDefined();
    expect(context.responseTranslation!.applied).toBe(false);
  });

  it('records responseTranslationDone timestamp', async () => {
    const { pipeline } = buildPipeline({ responseTranslation: true });

    const { context } = await pipeline.process({
      model: 'test-model',
      messages: [{ role: 'user', content: 'อธิบาย recursion' }],
    });

    expect(context.timestamps.responseTranslationDone).toBeDefined();
    expect(context.timestamps.responseTranslationDone!).toBeGreaterThanOrEqual(
      context.timestamps.llmResponseReceived,
    );
  });

  it('does not set responseTranslationDone when feature is disabled', async () => {
    const { pipeline } = buildPipeline({ responseTranslation: false });

    const { context } = await pipeline.process({
      model: 'test-model',
      messages: [{ role: 'user', content: 'อธิบาย recursion' }],
    });

    expect(context.timestamps.responseTranslationDone).toBeUndefined();
  });

  it('calls translator.translate with correct source and target languages', async () => {
    const { pipeline, translator } = buildPipeline({ responseTranslation: true });

    await pipeline.process({
      model: 'test-model',
      messages: [{ role: 'user', content: 'อธิบาย recursion' }],
    });

    expect(translator.translate).toHaveBeenCalledWith(
      'Recursion is when a function calls itself.',
      'en',
      'th',
    );
  });

  it('preserves non-content fields in the raw response', async () => {
    const { pipeline } = buildPipeline({ responseTranslation: true });

    const { response } = await pipeline.process({
      model: 'test-model',
      messages: [{ role: 'user', content: 'อธิบาย recursion' }],
    });

    const raw = response.raw as Record<string, unknown>;
    expect(raw.id).toBe('chatcmpl-test');
    expect(raw.object).toBe('chat.completion');
    expect(raw.usage).toEqual({ prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 });

    const choices = raw.choices as Array<Record<string, unknown>>;
    expect(choices[0].finish_reason).toBe('stop');
    expect(choices[0].index).toBe(0);
  });
});
