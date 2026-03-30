// Feature: multilingual-prompt-optimizer, Property 14: Language instruction injection
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Translator } from '../src/components/translator.ts';
import type { LanguageInstructionConfig } from '../src/models/types.ts';

/**
 * **Validates: Requirements 7.1, 7.2**
 *
 * Property 14: Language instruction injection
 * For any request where the RoutingEngine decision is "translate" or "hybrid",
 * the Optimizer SHALL append a Language_Instruction to the prompt directing the
 * LLM to respond in the Original_Language, and the instruction SHALL contain
 * the Original_Language name.
 */

/** Known BCP-47 tags that the Translator maps to human-readable names. */
const KNOWN_LANGUAGE_TAGS = [
  'en', 'zh', 'es', 'hi', 'ar', 'pt', 'bn', 'ru', 'ja', 'de',
  'fr', 'ko', 'it', 'nl', 'pl', 'tr', 'vi', 'th', 'uk', 'ro',
  'el', 'hu', 'cs', 'sv', 'fi', 'da', 'no', 'he', 'id', 'ms',
  'ca', 'gl', 'eu', 'bg', 'hr', 'sr', 'sk', 'sl', 'lt', 'lv',
  'et', 'fa', 'ur', 'ta', 'te', 'ml', 'kn', 'mr', 'gu', 'pa',
  'sw', 'af', 'tl', 'fil',
];

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', zh: 'Chinese', es: 'Spanish', hi: 'Hindi', ar: 'Arabic',
  pt: 'Portuguese', bn: 'Bengali', ru: 'Russian', ja: 'Japanese', de: 'German',
  fr: 'French', ko: 'Korean', it: 'Italian', nl: 'Dutch', pl: 'Polish',
  tr: 'Turkish', vi: 'Vietnamese', th: 'Thai', uk: 'Ukrainian', ro: 'Romanian',
  el: 'Greek', hu: 'Hungarian', cs: 'Czech', sv: 'Swedish', fi: 'Finnish',
  da: 'Danish', no: 'Norwegian', he: 'Hebrew', id: 'Indonesian', ms: 'Malay',
  ca: 'Catalan', gl: 'Galician', eu: 'Basque', bg: 'Bulgarian', hr: 'Croatian',
  sr: 'Serbian', sk: 'Slovak', sl: 'Slovenian', lt: 'Lithuanian', lv: 'Latvian',
  et: 'Estonian', fa: 'Persian', ur: 'Urdu', ta: 'Tamil', te: 'Telugu',
  ml: 'Malayalam', kn: 'Kannada', mr: 'Marathi', gu: 'Gujarati', pa: 'Punjabi',
  sw: 'Swahili', af: 'Afrikaans', tl: 'Tagalog', fil: 'Filipino',
};

const knownTagArb = fc.constantFrom(...KNOWN_LANGUAGE_TAGS);

const injectionModeArb = fc.constantFrom<LanguageInstructionConfig['injectionMode']>(
  'system_message',
  'append_to_last_user',
);

/** Arbitrary for templates that contain at least one {{language}} placeholder. */
const templateArb = fc.tuple(
  fc.string({ minLength: 0, maxLength: 30 }).map(s => s.replace(/\{/g, '(').replace(/\}/g, ')')),
  fc.string({ minLength: 0, maxLength: 30 }).map(s => s.replace(/\{/g, '(').replace(/\}/g, ')')),
).map(([prefix, suffix]) => `${prefix}{{language}}${suffix}`);

/** Arbitrary for templates with multiple {{language}} occurrences. */
const multiPlaceholderTemplateArb = fc
  .integer({ min: 2, max: 4 })
  .chain(count =>
    fc.array(
      fc.string({ minLength: 0, maxLength: 15 }).map(s => s.replace(/\{/g, '(').replace(/\}/g, ')')),
      { minLength: count + 1, maxLength: count + 1 },
    ).map(parts => {
      const result: string[] = [];
      for (let i = 0; i < count; i++) {
        result.push(parts[i], '{{language}}');
      }
      result.push(parts[count]);
      return result.join('');
    }),
  );

describe('Translator - Language Instruction Injection Property Tests', () => {
  const translator = new Translator({
    backend: 'libretranslate',
    endpoint: 'http://mock:5000',
  });

  it('Property 14: Language instruction contains the original language name for known tags', () => {
    fc.assert(
      fc.property(knownTagArb, templateArb, injectionModeArb, (tag, template, mode) => {
        const config: LanguageInstructionConfig = { template, injectionMode: mode };
        const instruction = translator.buildLanguageInstruction(tag, config);

        const expectedName = LANGUAGE_NAMES[tag];
        expect(instruction).toContain(expectedName);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 14: Language instruction is a non-empty string', () => {
    fc.assert(
      fc.property(knownTagArb, templateArb, injectionModeArb, (tag, template, mode) => {
        const config: LanguageInstructionConfig = { template, injectionMode: mode };
        const instruction = translator.buildLanguageInstruction(tag, config);

        expect(typeof instruction).toBe('string');
        expect(instruction.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 14: All {{language}} placeholders are replaced with the language name', () => {
    fc.assert(
      fc.property(knownTagArb, multiPlaceholderTemplateArb, injectionModeArb, (tag, template, mode) => {
        const config: LanguageInstructionConfig = { template, injectionMode: mode };
        const instruction = translator.buildLanguageInstruction(tag, config);

        // No {{language}} placeholders should remain
        expect(instruction).not.toContain('{{language}}');

        // Count occurrences of the language name — should match placeholder count
        const placeholderCount = (template.match(/\{\{language\}\}/g) ?? []).length;
        const expectedName = LANGUAGE_NAMES[tag];
        const nameOccurrences = instruction.split(expectedName).length - 1;
        expect(nameOccurrences).toBe(placeholderCount);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 14: Unknown language tags fall back to the raw tag in the instruction', () => {
    const unknownTagArb = fc
      .string({ minLength: 2, maxLength: 8 })
      .filter(s => /^[a-z]{2,8}$/.test(s) && !(s in LANGUAGE_NAMES));

    fc.assert(
      fc.property(unknownTagArb, templateArb, injectionModeArb, (tag, template, mode) => {
        const config: LanguageInstructionConfig = { template, injectionMode: mode };
        const instruction = translator.buildLanguageInstruction(tag, config);

        // For unknown tags, the raw tag itself should appear in the instruction
        expect(instruction).toContain(tag);
        expect(instruction).not.toContain('{{language}}');
      }),
      { numRuns: 100 },
    );
  });
});
