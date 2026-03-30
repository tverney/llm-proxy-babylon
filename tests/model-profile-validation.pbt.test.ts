// Feature: multilingual-prompt-optimizer, Property 15: ModelProfile validation
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateModelProfile, ModelProfileValidationError } from '../src/config/model-profile-loader.ts';

/**
 * **Validates: Requirements 8.2, 8.3**
 *
 * Property 15: ModelProfile validation
 * For any object presented as a ModelProfile configuration, the validator SHALL
 * accept it if and only if it contains a model identifier, supported languages list,
 * per-language performance ratings, a default optimal language, and an endpoint.
 * Invalid or missing configurations SHALL be rejected with a descriptive error message.
 */

/** Arbitrary that generates a valid ModelProfile object. */
const validModelProfileArb = fc
  .record({
    modelId: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
    supportedLanguages: fc
      .array(fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0), { minLength: 1 }),
    languagePerformance: fc
      .array(
        fc.record({
          languageTag: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
          performanceRating: fc.double({ min: 0, max: 1, noNaN: true }),
        }),
        { minLength: 1 }
      ),
    defaultOptimalLanguage: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
    endpoint: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  });

describe('ModelProfile Validation - Property-Based Tests', () => {
  it('Property 15a: Valid ModelProfile objects are accepted', () => {
    fc.assert(
      fc.property(validModelProfileArb, (profile) => {
        const result = validateModelProfile(profile);

        expect(result.modelId).toBe(profile.modelId);
        expect(result.supportedLanguages).toEqual(profile.supportedLanguages);
        expect(result.languagePerformance).toEqual(profile.languagePerformance);
        expect(result.defaultOptimalLanguage).toBe(profile.defaultOptimalLanguage);
        expect(result.endpoint).toBe(profile.endpoint);
      }),
      { numRuns: 100 }
    );
  });

  it('Property 15b: Missing or empty modelId is rejected', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(undefined),
          fc.constant(''),
          fc.constant('   '),
          fc.constant(123),
        ),
        (badModelId) => {
          const profile = {
            modelId: badModelId,
            supportedLanguages: ['en'],
            languagePerformance: [{ languageTag: 'en', performanceRating: 1.0 }],
            defaultOptimalLanguage: 'en',
            endpoint: 'http://localhost',
          };
          expect(() => validateModelProfile(profile)).toThrow(ModelProfileValidationError);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 15c: Missing or empty supportedLanguages is rejected', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(undefined),
          fc.constant([]),
          fc.constant('en'),
          fc.constant(['']),
          fc.constant(['  ']),
        ),
        (badLangs) => {
          const profile = {
            modelId: 'test-model',
            supportedLanguages: badLangs,
            languagePerformance: [{ languageTag: 'en', performanceRating: 1.0 }],
            defaultOptimalLanguage: 'en',
            endpoint: 'http://localhost',
          };
          expect(() => validateModelProfile(profile)).toThrow(ModelProfileValidationError);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 15d: Invalid languagePerformance entries are rejected', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(undefined),
          fc.constant([]),
          fc.constant([{ languageTag: '', performanceRating: 0.5 }]),
          fc.constant([{ languageTag: 'en', performanceRating: -0.1 }]),
          fc.constant([{ languageTag: 'en', performanceRating: 1.1 }]),
          fc.constant([{ languageTag: 'en', performanceRating: 'high' }]),
          fc.constant([null]),
        ),
        (badPerf) => {
          const profile = {
            modelId: 'test-model',
            supportedLanguages: ['en'],
            languagePerformance: badPerf,
            defaultOptimalLanguage: 'en',
            endpoint: 'http://localhost',
          };
          expect(() => validateModelProfile(profile)).toThrow(ModelProfileValidationError);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 15e: Missing or empty defaultOptimalLanguage is rejected', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(undefined), fc.constant(''), fc.constant('   '), fc.constant(42)),
        (badLang) => {
          const profile = {
            modelId: 'test-model',
            supportedLanguages: ['en'],
            languagePerformance: [{ languageTag: 'en', performanceRating: 1.0 }],
            defaultOptimalLanguage: badLang,
            endpoint: 'http://localhost',
          };
          expect(() => validateModelProfile(profile)).toThrow(ModelProfileValidationError);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 15f: Missing or empty endpoint is rejected', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(undefined), fc.constant(''), fc.constant('   '), fc.constant(99)),
        (badEndpoint) => {
          const profile = {
            modelId: 'test-model',
            supportedLanguages: ['en'],
            languagePerformance: [{ languageTag: 'en', performanceRating: 1.0 }],
            defaultOptimalLanguage: 'en',
            endpoint: badEndpoint,
          };
          expect(() => validateModelProfile(profile)).toThrow(ModelProfileValidationError);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 15g: Non-object inputs are rejected', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(null), fc.constant(42), fc.constant('string'), fc.constant(true)),
        (badInput) => {
          expect(() => validateModelProfile(badInput)).toThrow(ModelProfileValidationError);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 15h: Rejected configs produce descriptive error messages', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant({ modelId: '' }),
          fc.constant({ modelId: 'x', supportedLanguages: [] }),
          fc.constant({ modelId: 'x', supportedLanguages: ['en'], languagePerformance: [] }),
          fc.constant(null),
        ),
        (badInput) => {
          try {
            validateModelProfile(badInput);
            expect.unreachable('Should have thrown');
          } catch (err) {
            expect(err).toBeInstanceOf(ModelProfileValidationError);
            expect((err as ModelProfileValidationError).message.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
