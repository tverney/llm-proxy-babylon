// Feature: multilingual-prompt-optimizer, Property 16: Unknown model fallback
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ModelProfileRegistry, DEFAULT_MODEL_PROFILE } from '../src/config/model-profile-loader.ts';
import { RoutingEngine } from '../src/components/routing-engine.ts';
import type { RoutingPolicy } from '../src/models/config.ts';
import type { LanguageDetectionResult, ClassificationResult } from '../src/models/types.ts';

/**
 * **Validates: Requirements 8.4**
 *
 * Property 16: Unknown model fallback
 * For any request specifying a model identifier not found in any loaded ModelProfile,
 * the Optimizer SHALL use a default ModelProfile that routes all non-English prompts
 * through English translation.
 */

/** Set of known model IDs loaded into the registry for testing. */
const KNOWN_MODEL_IDS = ['gpt-4', 'claude-3', 'llama-70b'];

/** Registry pre-loaded with a few known profiles. */
function buildRegistry(): ModelProfileRegistry {
  return new ModelProfileRegistry(
    KNOWN_MODEL_IDS.map((id) => ({
      modelId: id,
      supportedLanguages: ['en', 'fr'],
      languagePerformance: [
        { languageTag: 'en', performanceRating: 1.0 },
        { languageTag: 'fr', performanceRating: 0.8 },
      ],
      defaultOptimalLanguage: 'en',
      endpoint: `https://api.example.com/${id}`,
    }))
  );
}

/** Arbitrary that generates model ID strings guaranteed NOT to be in the known set. */
const unknownModelIdArb = fc
  .string({ minLength: 1 })
  .filter((s) => !KNOWN_MODEL_IDS.includes(s));

/** Arbitrary for a non-English BCP-47 language tag. */
const nonEnglishLangArb = fc.constantFrom('fr', 'de', 'es', 'ja', 'zh', 'ko', 'ar', 'pt', 'ru', 'hi');

describe('Unknown Model Fallback - Property-Based Tests', () => {
  it('Property 16a: Unknown model IDs return the default profile', () => {
    const registry = buildRegistry();

    fc.assert(
      fc.property(unknownModelIdArb, (modelId) => {
        const profile = registry.get(modelId);

        expect(profile.modelId).toBe('__default__');
        expect(profile.defaultOptimalLanguage).toBe('en');
        expect(profile.supportedLanguages).toEqual(['en']);
        expect(profile.languagePerformance).toEqual([
          { languageTag: 'en', performanceRating: 1.0 },
        ]);
      }),
      { numRuns: 100 }
    );
  });

  it('Property 16b: Default profile has defaultOptimalLanguage "en"', () => {
    fc.assert(
      fc.property(unknownModelIdArb, (modelId) => {
        const registry = buildRegistry();
        const profile = registry.get(modelId);

        expect(profile.defaultOptimalLanguage).toBe('en');
      }),
      { numRuns: 100 }
    );
  });

  it('Property 16c: RoutingEngine with default profile translates non-English prompts to English', () => {
    const translatePolicy: RoutingPolicy = {
      rules: [
        {
          priority: 1,
          matchConditions: {},
          action: 'translate',
        },
      ],
    };
    const engine = new RoutingEngine(translatePolicy);
    const registry = buildRegistry();

    fc.assert(
      fc.property(unknownModelIdArb, nonEnglishLangArb, (modelId, langTag) => {
        const defaultProfile = registry.get(modelId);

        const detection: LanguageDetectionResult = {
          primary: { tag: langTag, confidence: 0.95 },
          all: [{ tag: langTag, confidence: 0.95 }],
          isUndetermined: false,
        };

        const classification: ClassificationResult = {
          categories: [{ category: 'general', confidence: 0.9 }],
          primaryCategory: 'general',
        };

        const decision = engine.evaluate(detection, classification, defaultProfile);

        expect(decision.action).toBe('translate');
        expect(decision.optimalLanguage).toBe('en');
      }),
      { numRuns: 100 }
    );
  });

  it('Property 16d: Known model IDs do NOT return the default profile', () => {
    const registry = buildRegistry();

    fc.assert(
      fc.property(fc.constantFrom(...KNOWN_MODEL_IDS), (modelId) => {
        const profile = registry.get(modelId);

        expect(profile.modelId).toBe(modelId);
        expect(profile.modelId).not.toBe('__default__');
      }),
      { numRuns: 100 }
    );
  });
});
