// Feature: multilingual-prompt-optimizer, Property 11: Placeholder preservation during translation
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { Translator } from '../src/components/translator.ts';

/**
 * **Validates: Requirements 5.2**
 *
 * Property 11: Placeholder preservation during translation
 * For any text containing placeholder tokens inserted by the MixedContentParser,
 * after translation by the Translator, all original placeholder tokens SHALL
 * still be present in the translated text.
 */

const PLACEHOLDER_REGEX = /\{\{__PLACEHOLDER_\d+__\}\}/g;

/**
 * Mock fetch that simulates a translation backend.
 * It uppercases alphabetic text but preserves the internal __PHTKN__ markers
 * that the Translator swaps in before calling the backend.
 */
function createMockFetch() {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    // Simulate translation by uppercasing the text
    const translated = (body.q as string).toUpperCase();
    return {
      ok: true,
      status: 200,
      json: async () => ({ translatedText: translated }),
      text: async () => JSON.stringify({ translatedText: translated }),
    } as unknown as Response;
  });
}

/** Arbitrary for plain text fragments (no placeholder-like patterns) */
const plainTextArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .map((s) => s.replace(/[{}]/g, ' '));

/**
 * Generates text that interleaves plain text with 1-5 placeholder tokens.
 * Every placeholder is guaranteed to appear in the generated text.
 * Returns { text, placeholders } so we can verify each placeholder survives.
 */
const textWithPlaceholdersArb = fc
  .integer({ min: 1, max: 5 })
  .chain((count) =>
    fc.tuple(
      fc.array(plainTextArb, { minLength: count + 1, maxLength: count + 1 }),
      fc.array(fc.nat({ max: 999 }), { minLength: count, maxLength: count }),
    ),
  )
  .map(([texts, ids]) => {
    const placeholders = ids.map((n) => `{{__PLACEHOLDER_${n}__}}`);
    // Interleave: text0 PH0 text1 PH1 ... textN
    const parts: string[] = [];
    for (let i = 0; i < placeholders.length; i++) {
      parts.push(texts[i]);
      parts.push(placeholders[i]);
    }
    parts.push(texts[texts.length - 1]);
    return { text: parts.join(''), placeholders };
  });

describe('Translator - Property-Based Tests', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('Property 11: All placeholder tokens are preserved after translation', async () => {
    await fc.assert(
      fc.asyncProperty(textWithPlaceholdersArb, async ({ text, placeholders }) => {
        globalThis.fetch = createMockFetch();

        const translator = new Translator({
          backend: 'libretranslate',
          endpoint: 'http://mock-translate:5000',
        });

        const result = await translator.translate(text, 'pt', 'en');

        // Every original placeholder token must appear in the translated text
        for (const ph of placeholders) {
          expect(result.translatedText).toContain(ph);
        }

        // The count of placeholders in the output must match the input
        const inputMatches = text.match(PLACEHOLDER_REGEX) ?? [];
        const outputMatches = result.translatedText.match(PLACEHOLDER_REGEX) ?? [];
        expect(outputMatches.length).toBe(inputMatches.length);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 11: Text without placeholders is translated normally', async () => {
    await fc.assert(
      fc.asyncProperty(plainTextArb, async (text) => {
        globalThis.fetch = createMockFetch();

        const translator = new Translator({
          backend: 'libretranslate',
          endpoint: 'http://mock-translate:5000',
        });

        const result = await translator.translate(text, 'es', 'en');

        // No placeholders in input means none in output
        const outputMatches = result.translatedText.match(PLACEHOLDER_REGEX) ?? [];
        expect(outputMatches.length).toBe(0);

        // The text should have been transformed (uppercased by our mock)
        expect(result.translatedText).toBe(text.toUpperCase());
      }),
      { numRuns: 100 },
    );
  });

  it('Property 11: Placeholder order is preserved after translation', async () => {
    await fc.assert(
      fc.asyncProperty(textWithPlaceholdersArb, async ({ text, placeholders }) => {
        globalThis.fetch = createMockFetch();

        const translator = new Translator({
          backend: 'libretranslate',
          endpoint: 'http://mock-translate:5000',
        });

        const result = await translator.translate(text, 'fr', 'en');

        // Extract placeholders from input and output in order
        const inputPHs = text.match(PLACEHOLDER_REGEX) ?? [];
        const outputPHs = result.translatedText.match(PLACEHOLDER_REGEX) ?? [];

        // Same placeholders in the same order
        expect(outputPHs).toEqual(inputPHs);
      }),
      { numRuns: 100 },
    );
  });
});
