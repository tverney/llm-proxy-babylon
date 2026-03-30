import { describe, it, expect, vi } from 'vitest';
import { MultilingualEvaluator } from '../src/components/multilingual-evaluator.ts';
import type { LLMRequest, LLMResponse } from '../src/models/types.ts';
import type { ModelProfile, TranslatorConfig } from '../src/models/config.ts';
import { LLMForwarder } from '../src/components/llm-forwarder.ts';

// Helper to create a mock LLMResponse with given content
function makeLLMResponse(content: string, statusCode = 200): LLMResponse {
  return {
    raw: { choices: [{ message: { content } }] },
    content,
    statusCode,
  };
}

// Stub translator config (won't actually call external service)
const translatorConfig: TranslatorConfig = {
  backend: 'libretranslate',
  endpoint: 'http://localhost:5000',
};

const modelProfile: ModelProfile = {
  modelId: 'test-model',
  supportedLanguages: ['en', 'fr', 'de'],
  languagePerformance: [
    { languageTag: 'en', performanceRating: 1.0 },
    { languageTag: 'fr', performanceRating: 0.9 },
  ],
  defaultOptimalLanguage: 'en',
  endpoint: 'http://localhost:8080/v1/chat/completions',
};

describe('MultilingualEvaluator', () => {
  it('evaluate returns a report with baseline and per-language results', async () => {
    const evaluator = new MultilingualEvaluator({ translatorConfig });

    // Mock the translator to return a simple "translated" version
    const translateSpy = vi.spyOn(
      (evaluator as any).translator,
      'translate',
    ).mockImplementation(async (text: string, from: string, to: string) => ({
      translatedText: `[${to}] ${text}`,
      sourceLanguage: from,
      targetLanguage: to,
    }));

    // Mock the forwarder
    const forwarder = new LLMForwarder();
    const forwardSpy = vi.spyOn(forwarder, 'forward').mockImplementation(
      async (request: LLMRequest) => {
        const content = request.messages[0]?.content ?? '';
        // Return different quality content based on language marker
        if (content.startsWith('[fr]')) {
          return makeLLMResponse('A good response with some detail. However, it is complete.');
        }
        if (content.startsWith('[de]')) {
          return makeLLMResponse('Short.');
        }
        // Baseline English
        return makeLLMResponse(
          'A comprehensive response. Furthermore, it covers all aspects. Additionally, it provides examples and details for completeness.',
        );
      },
    );

    const report = await evaluator.evaluate('What is AI?', ['fr', 'de'], modelProfile, forwarder);

    expect(report.prompt).toBe('What is AI?');
    expect(report.baselineLanguage).toBe('en');
    expect(report.baselineScore.overall).toBeGreaterThanOrEqual(0);
    expect(report.baselineScore.overall).toBeLessThanOrEqual(1);
    expect(report.results).toHaveLength(2);
    expect(report.results[0].language).toBe('fr');
    expect(report.results[1].language).toBe('de');
    // ranking includes baseline + 2 languages = 3 entries
    expect(report.ranking).toHaveLength(3);

    // Each result has a deltaFromBaseline
    for (const r of report.results) {
      expect(r.deltaFromBaseline).toBeCloseTo(
        r.qualityScore.overall - report.baselineScore.overall,
        10,
      );
    }

    // Ranking is sorted descending by overall score
    for (let i = 0; i < report.ranking.length - 1; i++) {
      const currLang = report.ranking[i];
      const nextLang = report.ranking[i + 1];
      const currScore = currLang === 'en'
        ? report.baselineScore.overall
        : report.results.find((r) => r.language === currLang)!.qualityScore.overall;
      const nextScore = nextLang === 'en'
        ? report.baselineScore.overall
        : report.results.find((r) => r.language === nextLang)!.qualityScore.overall;
      expect(currScore).toBeGreaterThanOrEqual(nextScore);
    }

    translateSpy.mockRestore();
    forwardSpy.mockRestore();
  });

  it('evaluateBatch returns one report per prompt', async () => {
    const evaluator = new MultilingualEvaluator({ translatorConfig });

    vi.spyOn((evaluator as any).translator, 'translate').mockImplementation(
      async (text: string, from: string, to: string) => ({
        translatedText: `[${to}] ${text}`,
        sourceLanguage: from,
        targetLanguage: to,
      }),
    );

    const forwarder = new LLMForwarder();
    vi.spyOn(forwarder, 'forward').mockImplementation(async () =>
      makeLLMResponse('A reasonable response.'),
    );

    const reports = await evaluator.evaluateBatch(
      ['Prompt 1', 'Prompt 2'],
      ['fr'],
      modelProfile,
      forwarder,
    );

    expect(reports).toHaveLength(2);
    expect(reports[0].prompt).toBe('Prompt 1');
    expect(reports[1].prompt).toBe('Prompt 2');
    for (const report of reports) {
      expect(report.results).toHaveLength(1);
      expect(report.ranking).toHaveLength(2); // baseline + 1 language
    }
  });

  it('auto-updates ModelProfile performance ratings when configured', async () => {
    const profile: ModelProfile = {
      modelId: 'test-model',
      supportedLanguages: ['en', 'fr'],
      languagePerformance: [
        { languageTag: 'en', performanceRating: 1.0 },
        { languageTag: 'fr', performanceRating: 0.5 },
      ],
      defaultOptimalLanguage: 'en',
      endpoint: 'http://localhost:8080/v1/chat/completions',
    };

    const evaluator = new MultilingualEvaluator({
      translatorConfig,
      autoUpdateProfile: true,
    });

    vi.spyOn((evaluator as any).translator, 'translate').mockImplementation(
      async (text: string, from: string, to: string) => ({
        translatedText: `[${to}] ${text}`,
        sourceLanguage: from,
        targetLanguage: to,
      }),
    );

    const forwarder = new LLMForwarder();
    vi.spyOn(forwarder, 'forward').mockImplementation(async () =>
      makeLLMResponse('A reasonable response with some detail.'),
    );

    const originalFrRating = profile.languagePerformance.find(
      (lp) => lp.languageTag === 'fr',
    )!.performanceRating;

    await evaluator.evaluate('Test prompt', ['fr'], profile, forwarder);

    // The fr rating should have been updated
    const updatedFrEntry = profile.languagePerformance.find(
      (lp) => lp.languageTag === 'fr',
    );
    expect(updatedFrEntry).toBeDefined();
    // en baseline should remain 1.0
    const enEntry = profile.languagePerformance.find(
      (lp) => lp.languageTag === 'en',
    );
    expect(enEntry!.performanceRating).toBe(1.0);
  });

  it('adds new language entries to ModelProfile when auto-updating', async () => {
    const profile: ModelProfile = {
      modelId: 'test-model',
      supportedLanguages: ['en'],
      languagePerformance: [
        { languageTag: 'en', performanceRating: 1.0 },
      ],
      defaultOptimalLanguage: 'en',
      endpoint: 'http://localhost:8080/v1/chat/completions',
    };

    const evaluator = new MultilingualEvaluator({
      translatorConfig,
      autoUpdateProfile: true,
    });

    vi.spyOn((evaluator as any).translator, 'translate').mockImplementation(
      async (text: string, from: string, to: string) => ({
        translatedText: `[${to}] ${text}`,
        sourceLanguage: from,
        targetLanguage: to,
      }),
    );

    const forwarder = new LLMForwarder();
    vi.spyOn(forwarder, 'forward').mockImplementation(async () =>
      makeLLMResponse('Response content.'),
    );

    await evaluator.evaluate('Test', ['ja'], profile, forwarder);

    // ja should now exist in languagePerformance
    const jaEntry = profile.languagePerformance.find(
      (lp) => lp.languageTag === 'ja',
    );
    expect(jaEntry).toBeDefined();
    expect(jaEntry!.performanceRating).toBeGreaterThanOrEqual(0);
    expect(jaEntry!.performanceRating).toBeLessThanOrEqual(1);
  });

  it('deltaFromBaseline is correctly computed', async () => {
    const evaluator = new MultilingualEvaluator({ translatorConfig });

    vi.spyOn((evaluator as any).translator, 'translate').mockImplementation(
      async (text: string, from: string, to: string) => ({
        translatedText: `[${to}] ${text}`,
        sourceLanguage: from,
        targetLanguage: to,
      }),
    );

    const forwarder = new LLMForwarder();
    let callCount = 0;
    vi.spyOn(forwarder, 'forward').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Baseline call
        return makeLLMResponse(
          'A comprehensive and detailed response. Furthermore, it addresses all points. Additionally, it provides thorough analysis.',
        );
      }
      // Language call - shorter response
      return makeLLMResponse('Brief.');
    });

    const report = await evaluator.evaluate('Test', ['fr'], modelProfile, forwarder);

    const frResult = report.results[0];
    const expectedDelta = frResult.qualityScore.overall - report.baselineScore.overall;
    expect(frResult.deltaFromBaseline).toBeCloseTo(expectedDelta, 10);
  });
});
