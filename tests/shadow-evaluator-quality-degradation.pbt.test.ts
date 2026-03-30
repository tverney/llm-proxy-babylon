// Feature: multilingual-prompt-optimizer, Property 23: Quality degradation warning
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { ShadowEvaluator } from '../src/components/shadow-evaluator.ts';
import type { LLMResponse } from '../src/models/types.ts';

/**
 * **Validates: Requirements 11.4**
 *
 * Property 23: Quality degradation warning
 * For any quality comparison where the baseline response overall score exceeds
 * the translated response overall score by more than the configured threshold,
 * the Optimizer SHALL log a warning indicating potential quality degradation.
 */

/** Build an LLMResponse from raw content string. */
function makeLLMResponse(content: string): LLMResponse {
  return {
    raw: { choices: [{ message: { role: 'assistant', content } }] },
    content,
    statusCode: 200,
  };
}

/**
 * Craft a response whose heuristic quality score is controllable.
 * Higher-quality text includes connectors, numbered lists, code blocks, numbers,
 * and CamelCase terms — all signals the ShadowEvaluator's heuristics reward.
 */
function makeHighQualityContent(): string {
  return [
    'However, furthermore, the system additionally provides TypeScript support.',
    'Therefore the architecture consequently improves performance by 42%.',
    '',
    '1. First step in the process',
    '2. Second step with moreover details',
    '3. Third step thus completing the flow',
    '',
    '```typescript',
    'const value = 100;',
    '```',
    '',
    '## Summary',
    'The CamelCase approach yields 99 improvements hence the recommendation.',
  ].join('\n');
}

function makeLowQualityContent(): string {
  return 'ok';
}

describe('Quality Degradation Warning - Property-Based Tests', () => {
  it('Property 23a: warns when baseline outperforms translated by more than threshold', async () => {
    const thresholdArb = fc.double({ min: 0.01, max: 0.5, noNaN: true });

    const cases: Array<{ threshold: number }> = [];
    fc.assert(
      fc.property(thresholdArb, (threshold) => {
        cases.push({ threshold });
      }),
      { numRuns: 100 },
    );

    for (const { threshold } of cases) {
      const evaluator = new ShadowEvaluator({
        enabled: true,
        degradationThreshold: threshold,
      });

      // Translated response is low quality, baseline is high quality
      const translatedResponse = makeLLMResponse(makeLowQualityContent());
      const baselineResponse = makeLLMResponse(makeHighQualityContent());

      const translatedScore = evaluator.computeQualityScore(translatedResponse);
      const baselineScore = evaluator.computeQualityScore(baselineResponse);
      const gap = baselineScore.overall - translatedScore.overall;

      // Only test when the gap actually exceeds the threshold
      if (gap <= threshold) continue;

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const mockForwarder = {
        forward: async () => baselineResponse,
        forwardStream: async function* () { /* noop */ },
      };

      await evaluator.evaluate(
        { model: 'test', messages: [{ role: 'user', content: 'test' }] },
        translatedResponse,
        mockForwarder,
        'http://mock/v1/chat/completions',
      );

      expect(warnSpy).toHaveBeenCalled();
      const warnMsg = warnSpy.mock.calls[0][0] as string;
      expect(warnMsg).toContain('Quality degradation');

      warnSpy.mockRestore();
    }
  });

  it('Property 23b: does NOT warn when gap is within threshold', async () => {
    // Use a very large threshold so the gap never exceeds it
    const evaluator = new ShadowEvaluator({
      enabled: true,
      degradationThreshold: 10, // impossibly high
    });

    const contentArb = fc.oneof(
      fc.constant(''),
      fc.string({ minLength: 0, maxLength: 300 }),
      fc.constant(makeHighQualityContent()),
      fc.constant(makeLowQualityContent()),
    );

    const cases: Array<{ translated: LLMResponse; baseline: LLMResponse }> = [];
    fc.assert(
      fc.property(contentArb, contentArb, (tContent, bContent) => {
        cases.push({
          translated: makeLLMResponse(tContent),
          baseline: makeLLMResponse(bContent),
        });
      }),
      { numRuns: 100 },
    );

    for (const { translated, baseline } of cases) {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const mockForwarder = {
        forward: async () => baseline,
        forwardStream: async function* () { /* noop */ },
      };

      await evaluator.evaluate(
        { model: 'test', messages: [{ role: 'user', content: 'test' }] },
        translated,
        mockForwarder,
        'http://mock/v1/chat/completions',
      );

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    }
  });

  it('Property 23c: warning message contains score details', async () => {
    const evaluator = new ShadowEvaluator({
      enabled: true,
      degradationThreshold: 0.01, // very low threshold to guarantee warning
    });

    const translatedResponse = makeLLMResponse(makeLowQualityContent());
    const baselineResponse = makeLLMResponse(makeHighQualityContent());

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mockForwarder = {
      forward: async () => baselineResponse,
      forwardStream: async function* () { /* noop */ },
    };

    const comparison = await evaluator.evaluate(
      { model: 'test', messages: [{ role: 'user', content: 'test' }] },
      translatedResponse,
      mockForwarder,
      'http://mock/v1/chat/completions',
    );

    expect(warnSpy).toHaveBeenCalled();
    const warnMsg = warnSpy.mock.calls[0][0] as string;

    // Warning should contain the actual score values
    expect(warnMsg).toContain(comparison.baselineScore.overall.toFixed(3));
    expect(warnMsg).toContain(comparison.translatedScore.overall.toFixed(3));
    expect(warnMsg).toContain(comparison.delta.toFixed(3));

    warnSpy.mockRestore();
  });

  it('Property 23d: degradation detection is consistent with threshold across random thresholds', async () => {
    const translatedResponse = makeLLMResponse(makeLowQualityContent());
    const baselineResponse = makeLLMResponse(makeHighQualityContent());

    // Pre-compute the actual gap using default weights
    const refEvaluator = new ShadowEvaluator({ enabled: true });
    const tScore = refEvaluator.computeQualityScore(translatedResponse).overall;
    const bScore = refEvaluator.computeQualityScore(baselineResponse).overall;
    const actualGap = bScore - tScore;

    // Only run if there is a meaningful gap
    if (actualGap <= 0) return;

    const thresholdArb = fc.double({ min: 0.001, max: 1.0, noNaN: true });

    const thresholds: number[] = [];
    fc.assert(
      fc.property(thresholdArb, (t) => { thresholds.push(t); }),
      { numRuns: 100 },
    );

    for (const threshold of thresholds) {
      const evaluator = new ShadowEvaluator({
        enabled: true,
        degradationThreshold: threshold,
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const mockForwarder = {
        forward: async () => baselineResponse,
        forwardStream: async function* () { /* noop */ },
      };

      await evaluator.evaluate(
        { model: 'test', messages: [{ role: 'user', content: 'test' }] },
        translatedResponse,
        mockForwarder,
        'http://mock/v1/chat/completions',
      );

      if (actualGap > threshold) {
        expect(warnSpy, `threshold=${threshold}, gap=${actualGap}`).toHaveBeenCalled();
      } else {
        expect(warnSpy, `threshold=${threshold}, gap=${actualGap}`).not.toHaveBeenCalled();
      }

      warnSpy.mockRestore();
    }
  });
});
