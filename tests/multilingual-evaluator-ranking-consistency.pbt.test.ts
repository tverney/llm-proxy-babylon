// Feature: multilingual-prompt-optimizer, Property 29: Evaluation ranking consistency
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { MultilingualEvaluator } from '../src/components/multilingual-evaluator.ts';
import type { LLMResponse } from '../src/models/types.ts';
import type { ModelProfile, TranslatorConfig } from '../src/models/config.ts';
import { LLMForwarder } from '../src/components/llm-forwarder.ts';

/**
 * **Validates: Requirements 12.5**
 *
 * Property 29: Evaluation ranking consistency
 * For any evaluation report, the ranking array SHALL be sorted in descending
 * order of overall quality score, and the first entry SHALL be the language
 * with the highest overall score.
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

/**
 * Varied mock responses that produce different quality scores via the
 * ShadowEvaluator heuristics (coherence, completeness, factualConsistency,
 * instructionAdherence).
 */
const VARIED_RESPONSES = [
  'A comprehensive and detailed response covering all aspects thoroughly. However, we must also consider edge cases. Furthermore, the analysis shows clear patterns. Additionally, the data supports this conclusion. Moreover, the evidence is compelling.',
  'Short.',
  'Medium length response with some detail and a few points to consider.',
  'Another response. Furthermore, it has connectors. Additionally, it is structured.\n1. First point\n2. Second point\n3. Third point',
  'Brief answer with minimal content.',
  'Detailed response with examples. Moreover, it addresses the question. Also includes analysis.\n- Bullet one\n- Bullet two\n```code block here```',
  'Ok.',
  'Response with technical terms like TypeScript and CamelCase patterns. Contains 42 items and 7 categories.',
  'Very thorough response. However, it also considers edge cases. Furthermore, it provides context. The number 100 is significant. Additionally, "quoted material" adds depth.',
];

describe('Evaluation Ranking Consistency - Property-Based Tests', () => {
  it('Property 29a: ranking is sorted in descending order of overall quality score', async () => {
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

      let callIdx = 0;
      const forwarder = new LLMForwarder();
      vi.spyOn(forwarder, 'forward').mockImplementation(async () => {
        const content = VARIED_RESPONSES[callIdx % VARIED_RESPONSES.length];
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

  it('Property 29b: first ranking entry has the highest overall score', async () => {
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

      let callIdx = 0;
      const forwarder = new LLMForwarder();
      vi.spyOn(forwarder, 'forward').mockImplementation(async () => {
        const content = VARIED_RESPONSES[callIdx % VARIED_RESPONSES.length];
        callIdx++;
        return makeMockResponse(content);
      });

      const report = await evaluator.evaluate(prompt, langs, makeModelProfile(), forwarder);

      // Collect all scores (baseline + language results)
      const allScores: Array<{ language: string; overall: number }> = [
        { language: 'en', overall: report.baselineScore.overall },
        ...report.results.map((r) => ({ language: r.language, overall: r.qualityScore.overall })),
      ];

      const maxScore = Math.max(...allScores.map((s) => s.overall));

      // The first entry in ranking must have the highest overall score
      const firstLang = report.ranking[0];
      const firstScore =
        firstLang === 'en'
          ? report.baselineScore.overall
          : report.results.find((r) => r.language === firstLang)!.qualityScore.overall;

      expect(firstScore).toBe(maxScore);

      vi.restoreAllMocks();
    }
  });
});
