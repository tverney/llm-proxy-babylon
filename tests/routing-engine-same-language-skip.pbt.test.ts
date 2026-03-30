// Feature: multilingual-prompt-optimizer, Property 7: Same-language skip
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { RoutingEngine } from '../src/components/routing-engine.ts';
import type { ModelProfile, RoutingPolicy } from '../src/models/config.ts';
import type {
  ClassificationResult,
  LanguageDetectionResult,
  TaskCategory,
} from '../src/models/types.ts';

/**
 * **Validates: Requirements 4.1**
 *
 * Property 7: Same-language skip
 * For any prompt where the detected Original_Language matches the
 * Optimal_Language for the given Model_Profile and task type, the
 * RoutingEngine SHALL return a decision with action "skip".
 */

const ALL_CATEGORIES: TaskCategory[] = [
  'reasoning',
  'math',
  'code-generation',
  'creative-writing',
  'translation',
  'summarization',
  'general',
];

/** Arbitrary for a BCP-47 language tag used as both detected and optimal */
const arbLanguageTag = fc.constantFrom('en', 'pt', 'zh', 'ja', 'ko', 'de', 'fr', 'es', 'ar', 'ru');

/** Arbitrary for a non-culturally-specific category (to avoid the cultural override path) */
const arbCategory = fc.constantFrom(...ALL_CATEGORIES);

/** Arbitrary confidence in a normal range */
const arbConfidence = fc.double({ min: 0.7, max: 1.0, noNaN: true });

/** Arbitrary RoutingPolicy that aggressively translates everything */
const arbTranslateAllPolicy: fc.Arbitrary<RoutingPolicy> = fc.constant({
  rules: [
    {
      priority: 1,
      matchConditions: {},
      action: 'translate' as const,
      targetLanguage: 'en',
    },
  ],
});

describe('RoutingEngine - Property-Based Tests', () => {
  it('Property 7: Same-language skip — always skips when original matches optimal', () => {
    fc.assert(
      fc.property(
        arbLanguageTag,
        arbCategory,
        arbConfidence,
        arbTranslateAllPolicy,
        (lang, category, confidence, policy) => {
          const detection: LanguageDetectionResult = {
            primary: { tag: lang, confidence },
            all: [{ tag: lang, confidence }],
            isUndetermined: false,
          };

          const classification: ClassificationResult = {
            categories: [{ category, confidence: 0.9 }],
            primaryCategory: category,
          };

          // Model profile where defaultOptimalLanguage matches the detected language
          const modelProfile: ModelProfile = {
            modelId: 'test-model',
            supportedLanguages: [lang],
            languagePerformance: [{ languageTag: lang, performanceRating: 1.0 }],
            defaultOptimalLanguage: lang,
            endpoint: 'https://api.example.com/v1/chat/completions',
          };

          const engine = new RoutingEngine(policy);
          const decision = engine.evaluate(detection, classification, modelProfile);

          expect(decision.action).toBe('skip');
          expect(decision.optimalLanguage).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 7 (converse): different language does NOT trigger same-language skip', () => {
    fc.assert(
      fc.property(
        arbCategory,
        arbConfidence,
        (category, confidence) => {
          const detection: LanguageDetectionResult = {
            primary: { tag: 'pt', confidence },
            all: [{ tag: 'pt', confidence }],
            isUndetermined: false,
          };

          const classification: ClassificationResult = {
            categories: [{ category, confidence: 0.5 }],
            primaryCategory: category,
          };

          const modelProfile: ModelProfile = {
            modelId: 'test-model',
            supportedLanguages: ['en', 'pt'],
            languagePerformance: [
              { languageTag: 'en', performanceRating: 1.0 },
              { languageTag: 'pt', performanceRating: 0.9 },
            ],
            defaultOptimalLanguage: 'en',
            endpoint: 'https://api.example.com/v1/chat/completions',
          };

          // Policy that translates everything
          const policy: RoutingPolicy = {
            rules: [
              {
                priority: 1,
                matchConditions: {},
                action: 'translate',
                targetLanguage: 'en',
              },
            ],
          };

          const engine = new RoutingEngine(policy);
          const decision = engine.evaluate(detection, classification, modelProfile);

          // Should NOT skip — languages differ, so a rule should match
          expect(decision.action).not.toBe('skip');
        }
      ),
      { numRuns: 100 }
    );
  });
});
