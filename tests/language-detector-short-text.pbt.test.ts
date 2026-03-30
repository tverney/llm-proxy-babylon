// Feature: multilingual-prompt-optimizer, Property 2: Short text yields undetermined
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { LanguageDetector } from '../src/components/language-detector.ts';

/**
 * **Validates: Requirements 1.4**
 *
 * Property 2: Short text yields undetermined
 * For any string containing fewer than 10 characters of natural language text,
 * the LanguageDetector SHALL return a result where `isUndetermined` is true.
 */

describe('LanguageDetector - Property-Based Tests', () => {
  const detector = new LanguageDetector();

  it('Property 2: Short text yields undetermined', () => {
    // Generate arbitrary strings whose trimmed/collapsed whitespace form is < 10 chars
    const shortTextArb = fc.string({ maxLength: 30 }).filter((s) => {
      const normalized = s.replace(/\s+/g, ' ').trim();
      return normalized.length < 10;
    });

    fc.assert(
      fc.property(shortTextArb, (input: string) => {
        const result = detector.detect(input);
        expect(result.isUndetermined).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
