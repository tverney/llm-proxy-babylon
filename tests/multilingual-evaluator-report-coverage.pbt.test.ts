// Feature: multilingual-prompt-optimizer, Property 27: Evaluation report covers all requested languages
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { MultilingualEvaluator } from '../src/components/multilingual-evaluator.ts';
import type { LLMResponse } from '../src/models/types.ts';
import type { ModelProfile, TranslatorConfig } from '../src/models/config.ts';
import { LLMForwarder } from '../src/components/llm-forwarder.ts';

/**
 * **Validates: Requirements 12.1, 12.2, 12.3, 12.5**
 *
 * Property 27: Evaluation report covers all requested languages
 * For any evaluation request with a prompt and N target languages, the
 * MultilingualEvaluator SHALL return a report containing exactly N language
 * results plus one baseline result, and the ranking array SHALL contain
 * exactly N+1 entries.
 */

const BCP47_TAGS = ['fr', 'de', 'es', 'ja', 'ko', 'zh', 'pt', 'it', 'ru', 'ar', 'nl', 'sv', 'pl', 'tr', 'vi'];

/** Arbitrary for a non-empty subset of BCP-47 language tags (unique). */
const targetLanguagesArb = fc
  .shuffledSubarray(BCP47_TAGS, { minLength: 1, maxLength: 8 })
  .filter((arr) => arr.length > 0);

/** Arbitrary for a non-empty prompt string. */
const promptArb = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0);

const translatorConfig: TranslatorConfig = {
  backend: 'libretranslate',
  endpoint: 'http://localhost:5000',
};

function makeModelProfile(): ModelProfile {
  return {
    modelId: 'test-model',
    supportedLanguages: ['en', ...BCP47_TAGS],
    languagePerformance: [{ languageTag: 'en', performanceRating: 1.0 }],
    defaultOptimalLanguage: 'en',
    endpoint: 'http://localhost:8080/v1/chat/completions',
  };
}

function makeMockResponse(content: string): LLMResponse {
  return {
    raw: { choices: [{ message: { content } }] },
    content,
    statusCode: 200,
  };
}

/** Mock translator.translate to avoid real HTTP calls. */
function mockTranslator(evaluator: MultilingualEvaluator): void {
  vi.spyOn((evaluator as any).translator, 'translate').mockImplementation(
    (async (text: any, from: any, to: any) => ({
      translatedText: `[${to}] ${text}`,
      sourceLanguage: from,
      targetLanguage: to,
    })) as any,
  );
}

describe('Evaluation Report Covers All Requested Languages - Property-Based Tests', () => {
  it('Property 27a: report contains exactly N language results for N target languages', async () => {
    const cases: Array<{ prompt: string; langs: string[] }> = [];

    fc.assert(
      fc.property(promptArb, targetLanguagesArb, (prompt, langs) => {
        cases.push({ prompt, langs });
      }),
      { numRuns: 100 },
    );

    for (const { prompt, langs } of cases) {
      const evaluator = new MultilingualEvaluator({ translatorConfig });
      mockTranslator(evaluator);

      const forwarder = new LLMForwarder();
      vi.spyOn(forwarder, 'forward').mockImplementation(async () =>
        makeMockResponse('A reasonable response with detail.'),
      );

      const report = await evaluator.evaluate(prompt, langs, makeModelProfile(), forwarder);

      // Exactly N language results (Req 12.2)
      expect(report.results).toHaveLength(langs.length);

      // Each requested language appears exactly once in results (Req 12.1)
      const resultLanguages = report.results.map((r) => r.language);
      expect(new Set(resultLanguages).size).toBe(langs.length);
      for (const lang of langs) {
        expect(resultLanguages).toContain(lang);
      }

      vi.restoreAllMocks();
    }
  });

  it('Property 27b: report includes baseline result (Req 12.3)', async () => {
    const cases: Array<{ prompt: string; langs: string[] }> = [];

    fc.assert(
      fc.property(promptArb, targetLanguagesArb, (prompt, langs) => {
        cases.push({ prompt, langs });
      }),
      { numRuns: 100 },
    );

    for (const { prompt, langs } of cases) {
      const evaluator = new MultilingualEvaluator({ translatorConfig });
      mockTranslator(evaluator);

      const forwarder = new LLMForwarder();
      vi.spyOn(forwarder, 'forward').mockImplementation(async () =>
        makeMockResponse('Baseline response content.'),
      );

      const report = await evaluator.evaluate(prompt, langs, makeModelProfile(), forwarder);

      // Baseline language is 'en'
      expect(report.baselineLanguage).toBe('en');
      // Baseline score exists and has valid fields
      expect(report.baselineScore).toBeDefined();
      expect(report.baselineScore.overall).toBeGreaterThanOrEqual(0);
      expect(report.baselineScore.overall).toBeLessThanOrEqual(1);

      vi.restoreAllMocks();
    }
  });

  it('Property 27c: ranking array contains exactly N+1 entries (all languages + baseline)', async () => {
    const cases: Array<{ prompt: string; langs: string[] }> = [];

    fc.assert(
      fc.property(promptArb, targetLanguagesArb, (prompt, langs) => {
        cases.push({ prompt, langs });
      }),
      { numRuns: 100 },
    );

    for (const { prompt, langs } of cases) {
      const evaluator = new MultilingualEvaluator({ translatorConfig });
      mockTranslator(evaluator);

      const forwarder = new LLMForwarder();
      vi.spyOn(forwarder, 'forward').mockImplementation(async () =>
        makeMockResponse('Some response.'),
      );

      const report = await evaluator.evaluate(prompt, langs, makeModelProfile(), forwarder);

      // Ranking has N target languages + 1 baseline = N+1 entries (Req 12.5)
      expect(report.ranking).toHaveLength(langs.length + 1);

      // Ranking contains the baseline language
      expect(report.ranking).toContain('en');

      // Ranking contains all target languages
      for (const lang of langs) {
        expect(report.ranking).toContain(lang);
      }

      vi.restoreAllMocks();
    }
  });

  it('Property 27d: ranking is sorted in descending order of overall quality score', async () => {
    const cases: Array<{ prompt: string; langs: string[] }> = [];

    fc.assert(
      fc.property(promptArb, targetLanguagesArb, (prompt, langs) => {
        cases.push({ prompt, langs });
      }),
      { numRuns: 100 },
    );

    for (const { prompt, langs } of cases) {
      const evaluator = new MultilingualEvaluator({ translatorConfig });

      // Return varied-length responses to produce different quality scores
      let callIdx = 0;
      const responses = [
        'A comprehensive and detailed response covering all aspects thoroughly.',
        'Short.',
        'Medium length response with some detail.',
        'Another response. Furthermore, it has connectors. Additionally, it is structured.',
        'Brief answer.',
        'Detailed response with examples. Moreover, it addresses the question. Also includes analysis.',
        'Ok.',
        'Response with technical terms like TypeScript and CamelCase patterns.',
        'Very thorough response. However, it also considers edge cases. Furthermore, it provides context.',
      ];

      mockTranslator(evaluator);

      const forwarder = new LLMForwarder();
      vi.spyOn(forwarder, 'forward').mockImplementation(async () => {
        const content = responses[callIdx % responses.length];
        callIdx++;
        return makeMockResponse(content);
      });

      const report = await evaluator.evaluate(prompt, langs, makeModelProfile(), forwarder);

      // Verify ranking is sorted descending by overall score
      for (let i = 0; i < report.ranking.length - 1; i++) {
        const currLang = report.ranking[i];
        const nextLang = report.ranking[i + 1];
        const currScore =
          currLang === 'en'
            ? report.baselineScore.overall
            : report.results.find((r) => r.language === currLang)!.qualityScore.overall;
        const nextScore =
          nextLang === 'en'
            ? report.baselineScore.overall
            : report.results.find((r) => r.language === nextLang)!.qualityScore.overall;
        expect(currScore).toBeGreaterThanOrEqual(nextScore);
      }

      vi.restoreAllMocks();
    }
  });

  it('Property 27e: deltaFromBaseline is correctly computed for each language result', async () => {
    const cases: Array<{ prompt: string; langs: string[] }> = [];

    fc.assert(
      fc.property(promptArb, targetLanguagesArb, (prompt, langs) => {
        cases.push({ prompt, langs });
      }),
      { numRuns: 100 },
    );

    for (const { prompt, langs } of cases) {
      const evaluator = new MultilingualEvaluator({ translatorConfig });
      mockTranslator(evaluator);

      const forwarder = new LLMForwarder();
      let callCount = 0;
      vi.spyOn(forwarder, 'forward').mockImplementation(async () => {
        callCount++;
        // Vary response length to get different scores
        const content = callCount === 1
          ? 'Baseline: comprehensive response with detail and analysis.'
          : `Language response #${callCount}. Some content here.`;
        return makeMockResponse(content);
      });

      const report = await evaluator.evaluate(prompt, langs, makeModelProfile(), forwarder);

      // Each result's deltaFromBaseline should equal its overall minus baseline overall
      for (const result of report.results) {
        const expectedDelta = result.qualityScore.overall - report.baselineScore.overall;
        expect(result.deltaFromBaseline).toBeCloseTo(expectedDelta, 10);
      }

      vi.restoreAllMocks();
    }
  });
});
