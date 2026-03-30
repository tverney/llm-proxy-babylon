// Feature: multilingual-prompt-optimizer, Property 1: Language detection output validity
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { LanguageDetector } from '../src/components/language-detector.ts';

/**
 * **Validates: Requirements 1.1**
 *
 * Property 1: Language detection output validity
 * For any prompt string, the LanguageDetector SHALL return a result where
 * the primary language tag is a valid BCP-47 tag and the confidence score
 * is in the range [0.0, 1.0], and all entries in the `all` array also have
 * valid BCP-47 tags and confidence scores in [0.0, 1.0].
 */

// BCP-47 tag pattern: primary language subtag (2-8 alpha chars),
// optionally followed by subtags separated by hyphens
const BCP47_REGEX = /^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/;

describe('LanguageDetector - Property-Based Tests', () => {
  const detector = new LanguageDetector();

  it('Property 1: Language detection output validity', () => {
    fc.assert(
      fc.property(fc.string(), (input: string) => {
        const result = detector.detect(input);

        // 1. The result always has a `primary` field with a `tag` (string) and `confidence` (number in [0.0, 1.0])
        expect(typeof result.primary.tag).toBe('string');
        expect(result.primary.tag.length).toBeGreaterThan(0);
        expect(typeof result.primary.confidence).toBe('number');
        expect(result.primary.confidence).toBeGreaterThanOrEqual(0.0);
        expect(result.primary.confidence).toBeLessThanOrEqual(1.0);

        // Primary tag must be a valid BCP-47 tag (or 'und' for undetermined)
        expect(
          result.primary.tag === 'und' || BCP47_REGEX.test(result.primary.tag)
        ).toBe(true);

        // 2. The `all` array is non-empty
        expect(result.all.length).toBeGreaterThan(0);

        // 3. Every entry in `all` has a valid string `tag` and `confidence` in [0.0, 1.0]
        for (const entry of result.all) {
          expect(typeof entry.tag).toBe('string');
          expect(entry.tag.length).toBeGreaterThan(0);
          expect(
            entry.tag === 'und' || BCP47_REGEX.test(entry.tag)
          ).toBe(true);
          expect(typeof entry.confidence).toBe('number');
          expect(entry.confidence).toBeGreaterThanOrEqual(0.0);
          expect(entry.confidence).toBeLessThanOrEqual(1.0);
        }

        // 4. `isUndetermined` is a boolean
        expect(typeof result.isUndetermined).toBe('boolean');
      }),
      { numRuns: 100 }
    );
  });
});
