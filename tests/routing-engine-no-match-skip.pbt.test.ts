// Feature: multilingual-prompt-optimizer, Property 9: No-match defaults to skip
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { RoutingEngine } from '../src/components/routing-engine.ts';
import type { ModelProfile, RoutingPolicy, RoutingPolicyRule } from '../src/models/config.ts';
import type {
  ClassificationResult,
  LanguageDetectionResult,
  TaskCategory,
} from '../src/models/types.ts';

/**
 * **Validates: Requirements 4.4**
 *
 * Property 9: No-match defaults to skip
 * For any input where no RoutingPolicy rule's match conditions are satisfied,
 * the RoutingEngine SHALL return a decision with action "skip".
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

/** Non-English tags so we don't hit the same-language skip path */
const nonEnglishTag = fc.constantFrom('pt', 'zh', 'ja', 'ko', 'de', 'fr', 'es', 'ar', 'ru');

const arbCategory = fc.constantFrom(...NON_CULTURAL_CATEGORIES);

const modelProfile: ModelProfile = {
  modelId: 'test-model',
  supportedLanguages: ['en', 'pt', 'zh', 'ja', 'ko', 'de', 'fr', 'es'],
  languagePerformance: [{ languageTag: 'en', performanceRating: 1.0 }],
  defaultOptimalLanguage: 'en',
  endpoint: 'https://api.example.com/v1/chat/completions',
};

describe('RoutingEngine - Property-Based Tests', () => {
  it('Property 9: No-match defaults to skip — empty policy', () => {
    /**
     * With zero rules loaded, no rule can ever match, so every input
     * must produce action "skip" with matchedRule null.
     */
    fc.assert(
      fc.property(
        nonEnglishTag,
        arbCategory,
        (lang, category) => {
          const detection: LanguageDetectionResult = {
            primary: { tag: lang, confidence: 0.95 },
            all: [{ tag: lang, confidence: 0.95 }],
            isUndetermined: false,
          };

          const classification: ClassificationResult = {
            categories: [{ category, confidence: 0.5 }],
            primaryCategory: category,
          };

          const engine = new RoutingEngine({ rules: [] });
          const decision = engine.evaluate(detection, classification, modelProfile);

          expect(decision.action).toBe('skip');
          expect(decision.matchedRule).toBeNull();
          expect(decision.optimalLanguage).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 9: No-match defaults to skip — all rules have non-matching conditions', () => {
    /**
     * Generate 1-5 rules that each require a specific task type that
     * differs from the input's category. None should match, so the
     * engine must default to skip.
     */
    const arbNonMatchingRules = fc
      .tuple(
        arbCategory,
        fc.uniqueArray(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 5 })
      )
      .map(([inputCategory, priorities]) => {
        // Pick a task type that is guaranteed to differ from the input
        const otherCategories = NON_CULTURAL_CATEGORIES.filter((c) => c !== inputCategory);
        const requiredType = otherCategories[0];
        const rules: RoutingPolicyRule[] = priorities.map((p) => ({
          priority: p,
          matchConditions: { taskTypes: [requiredType] },
          action: 'translate' as const,
          targetLanguage: 'en',
        }));
        return { inputCategory, rules };
      });

    fc.assert(
      fc.property(
        nonEnglishTag,
        arbNonMatchingRules,
        (lang, { inputCategory, rules }) => {
          const detection: LanguageDetectionResult = {
            primary: { tag: lang, confidence: 0.95 },
            all: [{ tag: lang, confidence: 0.95 }],
            isUndetermined: false,
          };

          const classification: ClassificationResult = {
            categories: [{ category: inputCategory, confidence: 0.9 }],
            primaryCategory: inputCategory,
          };

          const policy: RoutingPolicy = { rules };
          const engine = new RoutingEngine(policy);
          const decision = engine.evaluate(detection, classification, modelProfile);

          expect(decision.action).toBe('skip');
          expect(decision.matchedRule).toBeNull();
          expect(decision.optimalLanguage).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 9: No-match defaults to skip — rules with non-matching language pattern', () => {
    /**
     * All rules require sourceLanguagePattern "^en$" but input is always
     * non-English, so nothing matches → skip.
     */
    fc.assert(
      fc.property(
        nonEnglishTag,
        arbCategory,
        fc.uniqueArray(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 3 }),
        (lang, category, priorities) => {
          const rules: RoutingPolicyRule[] = priorities.map((p) => ({
            priority: p,
            matchConditions: { sourceLanguagePattern: '^en$' },
            action: 'translate' as const,
            targetLanguage: 'en',
          }));

          const detection: LanguageDetectionResult = {
            primary: { tag: lang, confidence: 0.95 },
            all: [{ tag: lang, confidence: 0.95 }],
            isUndetermined: false,
          };

          const classification: ClassificationResult = {
            categories: [{ category, confidence: 0.5 }],
            primaryCategory: category,
          };

          const policy: RoutingPolicy = { rules };
          const engine = new RoutingEngine(policy);
          const decision = engine.evaluate(detection, classification, modelProfile);

          expect(decision.action).toBe('skip');
          expect(decision.matchedRule).toBeNull();
          expect(decision.optimalLanguage).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 9: No-match defaults to skip — rules with non-matching model ID pattern', () => {
    /**
     * All rules require modelIdPattern "^gpt-4$" but the model profile
     * uses "test-model", so nothing matches → skip.
     */
    fc.assert(
      fc.property(
        nonEnglishTag,
        arbCategory,
        fc.integer({ min: 1, max: 50 }),
        (lang, category, priority) => {
          const rules: RoutingPolicyRule[] = [
            {
              priority,
              matchConditions: { modelIdPattern: '^gpt-4$' },
              action: 'translate' as const,
              targetLanguage: 'en',
            },
          ];

          const detection: LanguageDetectionResult = {
            primary: { tag: lang, confidence: 0.95 },
            all: [{ tag: lang, confidence: 0.95 }],
            isUndetermined: false,
          };

          const classification: ClassificationResult = {
            categories: [{ category, confidence: 0.5 }],
            primaryCategory: category,
          };

          const policy: RoutingPolicy = { rules };
          const engine = new RoutingEngine(policy);
          const decision = engine.evaluate(detection, classification, modelProfile);

          expect(decision.action).toBe('skip');
          expect(decision.matchedRule).toBeNull();
          expect(decision.optimalLanguage).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});
