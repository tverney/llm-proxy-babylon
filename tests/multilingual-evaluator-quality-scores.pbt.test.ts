// Feature: multilingual-prompt-optimizer, Property 28: Evaluation quality scores validity
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { MultilingualEvaluator } from '../src/components/multilingual-evaluator.ts';
import type { LLMResponse } from '../src/models/types.ts';
import type { ModelProfile, TranslatorConfig } from '../src/models/config.ts';
import { LLMForwarder } from '../src/components/llm-forwarder.ts';

/**
 * **Validates: Requirements 12.4**
 *
 * Property 28: Evaluation quality scores validity
 * For any evaluation report produced by the MultilingualEvaluator, all quality
 * scores (per-language and baseline) SHALL have coherence, completeness,
 * factualConsistency, instructionAdherence, and overall values in the range
 * [0.0, 1.0], and each deltaFromBaseline SHALL equal the language's overall
 * score minus the baseline's overall score.
 */

const BCP47_TAGS = ['fr', 'de', 'es', 'ja', 'ko', 'zh', 'pt', 'it', 'ru', 'ar'];

const targetLanguagesArb = fc
  .shuffledSubarray(BCP47_TAGS, { minLength: 1, maxLength: 5 })
  .filter((arr) => arr.length > 0);

const promptArb = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0);

/** Arbitrary for varied LLM response content to exercise different score paths. */
const responseContentArb = fc.oneof(
  fc.constant('Short.'),
  fc.constant('A comprehensive and detailed response covering all aspects thoroughly.'),
  fc.constant(''),
  fc.constant('1. First item\n2. Second item\n3. Third item'),
  fc.constant('However, the analysis shows 42 results. Furthermore, TypeScript is used.'),
  fc.string({ minLength: 0, maxLength: 300 }),
);

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

function mockTranslator(evaluator: MultilingualEvaluator): void {
  vi.spyOn((evaluator as any).translator, 'translate').mockImplementation(
    (async (text: any, from: any, to: any) => ({
      translatedText: `[${to}] ${text}`,
      sourceLanguage: from,
      targetLanguage: to,
    })) as any,
  );
}

function assertValidQualityScore(score: { coherence: number; completeness: number; factualConsistency: number; instructionAdherence: number; overall: number }): void {
  for (const field of ['coherence', 'completeness', 'factualConsistency', 'instructionAdherence', 'overall'] as const) {
    expect(score[field]).toBeGreaterThanOrEqual(0.0);
    expect(score[field]).toBeLessThanOrEqual(1.0);
  }
}

describe('Evaluation Quality Scores Validity - Property-Based Tests', () => {
  it('Property 28a: all quality score fields are in [0.0, 1.0] for baseline and per-language results', async () => {
    const cases: Array<{ prompt: string; langs: string[]; responses: string[] }> = [];

    fc.assert(
      fc.property(
        promptArb,
        targetLanguagesArb,
        fc.array(responseContentArb, { minLength: 10, maxLength: 10 }),
        (prompt, langs, responses) => {
          cases.push({ prompt, langs, responses });
        },
      ),
      { numRuns: 100 },
    );

    for (const { prompt, langs, responses } of cases) {
      const evaluator = new MultilingualEvaluator({ translatorConfig });
      mockTranslator(evaluator);

      let callIdx = 0;
      const forwarder = new LLMForwarder();
      vi.spyOn(forwarder, 'forward').mockImplementation(async () => {
        const content = responses[callIdx % responses.length];
        callIdx++;
        return makeMockResponse(content);
      });

      const report = await evaluator.evaluate(prompt, langs, makeModelProfile(), forwarder);

      // Baseline score fields in [0, 1]
      assertValidQualityScore(report.baselineScore);

      // Each per-language result score fields in [0, 1]
      for (const result of report.results) {
        assertValidQualityScore(result.qualityScore);
      }

      vi.restoreAllMocks();
    }
  });

  it('Property 28b: deltaFromBaseline equals language overall minus baseline overall', async () => {
    const cases: Array<{ prompt: string; langs: string[]; responses: string[] }> = [];

    fc.assert(
      fc.property(
        promptArb,
        targetLanguagesArb,
        fc.array(responseContentArb, { minLength: 10, maxLength: 10 }),
        (prompt, langs, responses) => {
          cases.push({ prompt, langs, responses });
        },
      ),
      { numRuns: 100 },
    );

    for (const { prompt, langs, responses } of cases) {
      const evaluator = new MultilingualEvaluator({ translatorConfig });
      mockTranslator(evaluator);

      let callIdx = 0;
      const forwarder = new LLMForwarder();
      vi.spyOn(forwarder, 'forward').mockImplementation(async () => {
        const content = responses[callIdx % responses.length];
        callIdx++;
        return makeMockResponse(content);
      });

      const report = await evaluator.evaluate(prompt, langs, makeModelProfile(), forwarder);

      for (const result of report.results) {
        const expectedDelta = result.qualityScore.overall - report.baselineScore.overall;
        expect(result.deltaFromBaseline).toBeCloseTo(expectedDelta, 10);
      }

      vi.restoreAllMocks();
    }
  });
});
