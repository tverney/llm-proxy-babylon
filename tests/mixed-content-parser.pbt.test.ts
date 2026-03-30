// Feature: multilingual-prompt-optimizer, Property 4: Mixed content parse-reassemble round trip
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { MixedContentParser } from '../src/components/mixed-content-parser.ts';

/**
 * **Validates: Requirements 2.2, 2.3, 2.4**
 *
 * Property 4: Mixed content parse-reassemble round trip
 * For any prompt string, parsing it with the MixedContentParser and then
 * reassembling the segments without any translation SHALL produce a string
 * identical to the original prompt.
 */

const parser = new MixedContentParser();

/**
 * Arbitrary that generates prompts with a mix of plain text and
 * non-translatable segments (code blocks, inline code, URLs, JSON, XML, SQL).
 */
const alphaNumArb = fc.string({ minLength: 1, maxLength: 30 })
  .map((s) => s.replace(/`/g, 'x'));

const codeBlockArb = alphaNumArb.map((body) => '```\n' + body + '\n```');

const inlineCodeArb = fc.string({ minLength: 1, maxLength: 15 })
  .map((s) => s.replace(/`/g, 'x'))
  .map((body) => '`' + body + '`');

const urlArb = fc.constantFrom(
  'https://example.com',
  'https://api.test.io/v1/data',
  'http://localhost:3000/path?q=1',
);

const jsonArb = fc.constantFrom(
  '{"name": "test"}',
  '{"key": "value", "num": 1}',
  '{"id": "abc123"}',
);

const sqlArb = fc.constantFrom(
  'SELECT id FROM users;',
  'INSERT INTO logs VALUES (1);',
  'DELETE FROM temp;',
  'UPDATE items SET qty = 0;',
);

const plainTextArb = fc.string({ minLength: 1, maxLength: 50 })
  .map((s) => s.replace(/[`<{]/g, ' '));

const segmentArb = fc.oneof(
  { weight: 4, arbitrary: plainTextArb },
  { weight: 1, arbitrary: codeBlockArb },
  { weight: 1, arbitrary: inlineCodeArb },
  { weight: 1, arbitrary: urlArb },
  { weight: 1, arbitrary: jsonArb },
  { weight: 1, arbitrary: sqlArb },
);

const mixedPromptArb = fc.array(segmentArb, { minLength: 1, maxLength: 6 })
  .map((parts) => parts.join(' '));

describe('MixedContentParser - Property-Based Tests', () => {
  it('Property 4: Parse-reassemble round trip with arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (prompt: string) => {
        const parsed = parser.parse(prompt);
        const reassembled = parsed.reassemble(new Map());
        expect(reassembled).toBe(prompt);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 4: Parse-reassemble round trip with mixed content prompts', () => {
    fc.assert(
      fc.property(mixedPromptArb, (prompt: string) => {
        const parsed = parser.parse(prompt);
        const reassembled = parsed.reassemble(new Map());
        expect(reassembled).toBe(prompt);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 4: Segment ordering is preserved', () => {
    fc.assert(
      fc.property(mixedPromptArb, (prompt: string) => {
        const parsed = parser.parse(prompt);
        // Positions must be strictly increasing
        for (let i = 1; i < parsed.segments.length; i++) {
          expect(parsed.segments[i].position).toBeGreaterThan(parsed.segments[i - 1].position);
        }
        // Concatenation of all segment contents equals the original prompt
        const concatenated = parsed.segments.map((s) => s.content).join('');
        expect(concatenated).toBe(prompt);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 4: Non-translatable segments are never of type text', () => {
    fc.assert(
      fc.property(mixedPromptArb, (prompt: string) => {
        const parsed = parser.parse(prompt);
        for (const seg of parsed.nonTranslatableSegments()) {
          expect(seg.type).not.toBe('text');
        }
        for (const seg of parsed.translatableSegments()) {
          expect(seg.type).toBe('text');
        }
      }),
      { numRuns: 100 },
    );
  });
});
