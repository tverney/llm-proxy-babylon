// Feature: multilingual-prompt-optimizer, Property 5: Classification output validity
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ContentClassifier } from '../src/components/content-classifier.ts';

/**
 * **Validates: Requirements 3.1, 3.2**
 *
 * Property 5: Classification output validity
 * For any prompt string, the ContentClassifier SHALL return a result where
 * every category is a member of the valid TaskCategory set and every
 * confidence score is in the range [0.0, 1.0], and at least one category
 * is returned.
 */

const VALID_CATEGORIES = new Set([
  'reasoning',
  'math',
  'code-generation',
  'creative-writing',
  'translation',
  'summarization',
  'culturally-specific',
  'general',
]);

describe('ContentClassifier - Property-Based Tests', () => {
  const classifier = new ContentClassifier();

  it('Property 5: Classification output validity', () => {
    fc.assert(
      fc.property(fc.string(), (input: string) => {
        const result = classifier.classify(input);

        // 1. At least one category is returned
        expect(result.categories.length).toBeGreaterThanOrEqual(1);

        // 2. Every category is a valid TaskCategory with confidence in [0.0, 1.0]
        for (const entry of result.categories) {
          expect(VALID_CATEGORIES.has(entry.category)).toBe(true);
          expect(typeof entry.confidence).toBe('number');
          expect(entry.confidence).toBeGreaterThanOrEqual(0.0);
          expect(entry.confidence).toBeLessThanOrEqual(1.0);
        }

        // 3. primaryCategory is a valid TaskCategory
        expect(VALID_CATEGORIES.has(result.primaryCategory)).toBe(true);

        // 4. primaryCategory matches the first entry in the categories array
        expect(result.primaryCategory).toBe(result.categories[0].category);
      }),
      { numRuns: 100 }
    );
  });
});
