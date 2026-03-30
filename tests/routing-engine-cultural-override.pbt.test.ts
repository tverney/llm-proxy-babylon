// Feature: multilingual-prompt-optimizer, Property 6: Culturally-specific override
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
 * **Validates: Requirements 3.3**
 *
 * Property 6: Culturally-specific override
 * For any prompt where the ContentClassifier returns "culturally-specific"
 * with confidence above 0.8, the RoutingEngine SHALL return a decision
 * with action "skip", regardless of the Model_Profile or other routing rules.
 */

const NON_CULTURAL_CATEGORIES: TaskCategory[] = [
  'reasoning',
  'math',
  'code-generation',
  'creative-writing',
  'translation',
  'summarization',
  'general',
];

/** Arbitrary that produces a confidence strictly above 0.8 */
const highCulturalConfidence = fc.double({ min: 0.800001, max: 1.0, noNaN: true });

/** Arbitrary for a non-English BCP-47 tag */
const nonEnglishTag = fc.constantFrom('pt', 'zh', 'ja', 'ko', 'de', 'fr', 'es', 'ar', 'ru');

/** Arbitrary ModelProfile with English as optimal */
const arbModelProfile: fc.Arbitrary<ModelProfile> = fc.record({
  modelId: fc.constantFrom('gpt-4o', 'gpt-3.5-turbo', 'claude-3'),
  supportedLanguages: fc.constant(['en', 'zh', 'ja', 'ko', 'de', 'fr', 'es']),
  languagePerformance: fc.constant([
    { languageTag: 'en', performanceRating: 1.0 },
    { languageTag: 'zh', performanceRating: 0.92 },
  ]),
  defaultOptimalLanguage: fc.constant('en'),
  endpoint: fc.constant('https://api.example.com/v1/chat/completions'),
});

/** Arbitrary RoutingPolicy that would normally translate non-English prompts */
const arbTranslatePolicy: fc.Arbitrary<RoutingPolicy> = fc.constant({
  rules: [
    {
      priority: 1,
      matchConditions: {
        taskTypes: ['culturally-specific'] as TaskCategory[],
      },
      action: 'translate' as const,
      targetLanguage: 'en',
    },
    {
      priority: 2,
      matchConditions: {
        sourceLanguagePattern: '^(?!en).*$',
      },
      action: 'translate' as const,
      targetLanguage: 'en',
    },
  ],
});

describe('RoutingEngine - Property-Based Tests', () => {
  it('Property 6: Culturally-specific override — always skips when confidence > 0.8', () => {
    fc.assert(
      fc.property(
        nonEnglishTag,
        highCulturalConfidence,
        arbModelProfile,
        arbTranslatePolicy,
        fc.array(fc.constantFrom(...NON_CULTURAL_CATEGORIES), { minLength: 0, maxLength: 3 }),
        (lang, culturalConf, modelProfile, policy, extraCategories) => {
          const detection: LanguageDetectionResult = {
            primary: { tag: lang, confidence: 0.95 },
            all: [{ tag: lang, confidence: 0.95 }],
            isUndetermined: false,
          };

          // Build classification with culturally-specific above 0.8 plus optional extras
          const categories: Array<{ category: TaskCategory; confidence: number }> = [
            { category: 'culturally-specific', confidence: culturalConf },
            ...extraCategories.map((c) => ({ category: c, confidence: 0.5 })),
          ];

          const classification: ClassificationResult = {
            categories,
            primaryCategory: 'culturally-specific',
          };

          const engine = new RoutingEngine(policy);
          const decision = engine.evaluate(detection, classification, modelProfile);

          // The routing engine MUST skip regardless of policy rules
          expect(decision.action).toBe('skip');
          expect(decision.optimalLanguage).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 6 (boundary): confidence exactly 0.8 does NOT trigger cultural override', () => {
    fc.assert(
      fc.property(
        nonEnglishTag,
        arbModelProfile,
        arbTranslatePolicy,
        (lang, modelProfile, policy) => {
          const detection: LanguageDetectionResult = {
            primary: { tag: lang, confidence: 0.95 },
            all: [{ tag: lang, confidence: 0.95 }],
            isUndetermined: false,
          };

          const classification: ClassificationResult = {
            categories: [{ category: 'culturally-specific', confidence: 0.8 }],
            primaryCategory: 'culturally-specific',
          };

          const engine = new RoutingEngine(policy);
          const decision = engine.evaluate(detection, classification, modelProfile);

          // At exactly 0.8, the override should NOT apply — rules take over
          expect(decision.action).not.toBe('skip');
        }
      ),
      { numRuns: 100 }
    );
  });
});
