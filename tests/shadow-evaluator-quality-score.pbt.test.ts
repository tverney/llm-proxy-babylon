// Feature: multilingual-prompt-optimizer, Property 22: Quality score range validity
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ShadowEvaluator } from '../src/components/shadow-evaluator.ts';
import type { LLMResponse, QualityScore } from '../src/models/types.ts';

/**
 * **Validates: Requirements 11.2**
 *
 * Property 22: Quality score range validity
 * For any pair of LLM responses evaluated by the ShadowEvaluator, all quality
 * scores (coherence, completeness, factualConsistency, instructionAdherence,
 * overall) SHALL be in the range [0.0, 1.0].
 */

/** Arbitrary for LLM response content — covers empty, short, long, and structured text. */
const llmResponseContentArb = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 0, maxLength: 500 }),
  // Structured content with lists, headings, code blocks
  fc.tuple(
    fc.string({ minLength: 1, maxLength: 100 }),
    fc.array(fc.string({ minLength: 1, maxLength: 80 }), { minLength: 1, maxLength: 5 }),
  ).map(([intro, items]) =>
    `${intro}\n\n` + items.map((item, i) => `${i + 1}. ${item}`).join('\n'),
  ),
  // Content with code blocks and connectors
  fc.tuple(
    fc.string({ minLength: 1, maxLength: 100 }),
    fc.string({ minLength: 1, maxLength: 200 }),
  ).map(([text, code]) =>
    `${text}\n\nHowever, furthermore:\n\n\`\`\`\n${code}\n\`\`\``,
  ),
  // Content with numbers and technical terms
  fc.tuple(
    fc.string({ minLength: 10, maxLength: 300 }),
    fc.integer({ min: 1, max: 99999 }),
  ).map(([text, num]) => `${text} The value is ${num}. CamelCase terms like TypeScript.`),
);

/** Arbitrary for an LLMResponse with generated content. */
const llmResponseArb: fc.Arbitrary<LLMResponse> = llmResponseContentArb.map(content => ({
  raw: { choices: [{ message: { role: 'assistant', content } }] },
  content,
  statusCode: 200,
}));

/** Assert all fields of a QualityScore are in [0.0, 1.0]. */
function assertScoreInRange(score: QualityScore, label: string): void {
  const fields: (keyof QualityScore)[] = [
    'coherence', 'completeness', 'factualConsistency', 'instructionAdherence', 'overall',
  ];
  for (const field of fields) {
    expect(score[field], `${label}.${field}`).toBeGreaterThanOrEqual(0.0);
    expect(score[field], `${label}.${field}`).toBeLessThanOrEqual(1.0);
  }
}

describe('Quality Score Range Validity - Property-Based Tests', () => {
  it('Property 22a: computeQualityScore returns all scores in [0.0, 1.0] for any response', () => {
    const evaluator = new ShadowEvaluator({ enabled: true });

    fc.assert(
      fc.property(llmResponseArb, (response) => {
        const score = evaluator.computeQualityScore(response);
        assertScoreInRange(score, 'score');
      }),
      { numRuns: 100 },
    );
  });

  it('Property 22b: evaluate() returns both translated and baseline scores in [0.0, 1.0]', async () => {
    const cases: Array<{ translated: LLMResponse; baseline: LLMResponse }> = [];

    fc.assert(
      fc.property(llmResponseArb, llmResponseArb, (translated, baseline) => {
        cases.push({ translated, baseline });
      }),
      { numRuns: 100 },
    );

    const evaluator = new ShadowEvaluator({ enabled: true });

    for (const { translated, baseline } of cases) {
      // Mock forwarder that returns the baseline response
      const mockForwarder = {
        forward: async () => baseline,
        forwardStream: async function* () { /* noop */ },
      };

      const comparison = await evaluator.evaluate(
        { model: 'test', messages: [{ role: 'user', content: 'test' }] },
        translated,
        mockForwarder,
        'http://mock/v1/chat/completions',
      );

      assertScoreInRange(comparison.translatedScore, 'translatedScore');
      assertScoreInRange(comparison.baselineScore, 'baselineScore');
    }
  });

  it('Property 22c: delta equals translatedScore.overall minus baselineScore.overall', async () => {
    const cases: Array<{ translated: LLMResponse; baseline: LLMResponse }> = [];

    fc.assert(
      fc.property(llmResponseArb, llmResponseArb, (translated, baseline) => {
        cases.push({ translated, baseline });
      }),
      { numRuns: 100 },
    );

    const evaluator = new ShadowEvaluator({ enabled: true });

    for (const { translated, baseline } of cases) {
      const mockForwarder = {
        forward: async () => baseline,
        forwardStream: async function* () { /* noop */ },
      };

      const comparison = await evaluator.evaluate(
        { model: 'test', messages: [{ role: 'user', content: 'test' }] },
        translated,
        mockForwarder,
        'http://mock/v1/chat/completions',
      );

      const expectedDelta = comparison.translatedScore.overall - comparison.baselineScore.overall;
      expect(comparison.delta).toBeCloseTo(expectedDelta, 10);
      expect(comparison.translationImproved).toBe(expectedDelta > 0);
    }
  });

  it('Property 22d: custom weights still produce scores in [0.0, 1.0]', () => {
    const weightsArb = fc.record({
      coherence: fc.double({ min: 0, max: 10, noNaN: true }),
      completeness: fc.double({ min: 0, max: 10, noNaN: true }),
      factualConsistency: fc.double({ min: 0, max: 10, noNaN: true }),
      instructionAdherence: fc.double({ min: 0, max: 10, noNaN: true }),
    });

    fc.assert(
      fc.property(weightsArb, llmResponseArb, (weights, response) => {
        const evaluator = new ShadowEvaluator({ enabled: true, weights });
        const score = evaluator.computeQualityScore(response);
        assertScoreInRange(score, 'customWeightScore');
      }),
      { numRuns: 100 },
    );
  });
});
