// Feature: multilingual-prompt-optimizer, Property 3: Low confidence yields undetermined
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { LanguageDetector } from '../src/components/language-detector.ts';

/**
 * **Validates: Requirements 1.3**
 *
 * Property 3: Low confidence yields undetermined
 * For any LanguageDetectionResult where all entries in the `all` array have
 * confidence scores below the configured threshold, the result SHALL have
 * `isUndetermined` set to true.
 */

describe('LanguageDetector - Property-Based Tests', () => {
  it('Property 3: Low confidence yields undetermined', () => {
    // Strategy: generate a threshold in (0, 1], then feed text to the detector
    // with that threshold. If every detected language's confidence falls below
    // the threshold, isUndetermined must be true.
    //
    // We use real text strings so franc produces realistic confidence values,
    // and vary the threshold to exercise the boundary.

    const thresholdArb = fc.double({ min: 0.01, max: 1.0, noNaN: true });
    const textArb = fc.string({ minLength: 10, maxLength: 200 });

    fc.assert(
      fc.property(thresholdArb, textArb, (threshold: number, input: string) => {
        const detector = new LanguageDetector();
        detector.setConfidenceThreshold(threshold);

        const result = detector.detect(input);

        // Only assert the property when all detected confidences are below threshold
        const allBelowThreshold = result.all.every(
          (d) => d.confidence < threshold
        );

        if (allBelowThreshold) {
          expect(result.isUndetermined).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});
