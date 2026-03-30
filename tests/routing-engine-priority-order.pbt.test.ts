// Feature: multilingual-prompt-optimizer, Property 8: Priority-ordered rule matching
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { RoutingEngine } from '../src/components/routing-engine.ts';
import type { ModelProfile, RoutingPolicy, RoutingPolicyRule } from '../src/models/config.ts';
import type {
  ClassificationResult,
  LanguageDetectionResult,
  RoutingAction,
  TaskCategory,
} from '../src/models/types.ts';

/**
 * **Validates: Requirements 4.3**
 *
 * Property 8: Priority-ordered rule matching
 * For any set of RoutingPolicy rules and any input (language detection,
 * classification, model profile), the RoutingEngine SHALL return the action
 * from the matching rule with the lowest priority number among all rules
 * whose match conditions are satisfied.
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

const ACTIONS: RoutingAction[] = ['translate', 'skip', 'hybrid'];

/** Non-English tags so we don't hit the same-language skip path */
const nonEnglishTag = fc.constantFrom('pt', 'zh', 'ja', 'ko', 'de', 'fr', 'es', 'ar', 'ru');

/** Arbitrary for a non-culturally-specific category (avoids cultural override) */
const arbCategory = fc.constantFrom(...NON_CULTURAL_CATEGORIES);

/** Model profile with English as optimal (ensures non-English input won't same-language skip) */
const modelProfile: ModelProfile = {
  modelId: 'test-model',
  supportedLanguages: ['en', 'pt', 'zh', 'ja', 'ko', 'de', 'fr', 'es'],
  languagePerformance: [{ languageTag: 'en', performanceRating: 1.0 }],
  defaultOptimalLanguage: 'en',
  endpoint: 'https://api.example.com/v1/chat/completions',
};

/**
 * Build a rule that unconditionally matches any input (no matchConditions filters).
 * Each rule gets a unique priority and a specific action.
 */
function buildCatchAllRule(priority: number, action: RoutingAction): RoutingPolicyRule {
  return {
    priority,
    matchConditions: {},
    action,
    targetLanguage: 'en',
  };
}

describe('RoutingEngine - Property-Based Tests', () => {
  it('Property 8: Priority-ordered rule matching — lowest priority number wins', () => {
    /**
     * Strategy: generate 2-5 rules with unique priorities and random actions.
     * All rules use empty matchConditions so they all match any input.
     * The engine must pick the rule with the lowest priority number.
     */
    const arbRulesWithExpected = fc
      .uniqueArray(fc.integer({ min: 1, max: 100 }), { minLength: 2, maxLength: 5 })
      .chain((priorities) =>
        fc
          .tuple(...priorities.map(() => fc.constantFrom(...ACTIONS)))
          .map((actions) => {
            const rules = priorities.map((p, i) => buildCatchAllRule(p, actions[i]));
            const lowestPriority = Math.min(...priorities);
            const expectedIdx = priorities.indexOf(lowestPriority);
            return { rules, expectedAction: actions[expectedIdx], expectedPriority: lowestPriority };
          })
      );

    fc.assert(
      fc.property(
        nonEnglishTag,
        arbCategory,
        arbRulesWithExpected,
        (lang, category, { rules, expectedAction, expectedPriority }) => {
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

          // The engine must select the rule with the lowest priority number
          expect(decision.action).toBe(expectedAction);
          if (expectedAction !== 'skip') {
            expect(decision.matchedRule).not.toBeNull();
            expect(decision.matchedRule!.priority).toBe(expectedPriority);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 8: selective matching — lowest matching priority wins over lower non-matching', () => {
    /**
     * Strategy: create two rules with distinct priorities.
     * The lower-priority rule does NOT match (wrong taskType filter).
     * The higher-priority rule DOES match (catch-all).
     * The engine must skip the non-matching lower-priority rule and pick the matching one.
     */
    const arbActionPair = fc.tuple(
      fc.constantFrom(...ACTIONS),
      fc.constantFrom(...ACTIONS)
    );

    fc.assert(
      fc.property(
        nonEnglishTag,
        arbActionPair,
        (lang, [nonMatchAction, matchAction]) => {
          // Rule at priority 1 only matches 'translation' task type
          const nonMatchingRule: RoutingPolicyRule = {
            priority: 1,
            matchConditions: { taskTypes: ['translation'] },
            action: nonMatchAction,
            targetLanguage: 'en',
          };

          // Rule at priority 10 matches everything
          const matchingRule: RoutingPolicyRule = {
            priority: 10,
            matchConditions: {},
            action: matchAction,
            targetLanguage: 'en',
          };

          const detection: LanguageDetectionResult = {
            primary: { tag: lang, confidence: 0.95 },
            all: [{ tag: lang, confidence: 0.95 }],
            isUndetermined: false,
          };

          // Use 'reasoning' so it won't match the 'translation' filter on rule 1
          const classification: ClassificationResult = {
            categories: [{ category: 'reasoning', confidence: 0.9 }],
            primaryCategory: 'reasoning',
          };

          const policy: RoutingPolicy = { rules: [nonMatchingRule, matchingRule] };
          const engine = new RoutingEngine(policy);
          const decision = engine.evaluate(detection, classification, modelProfile);

          // Must pick the matching rule (priority 10), not the non-matching one (priority 1)
          expect(decision.action).toBe(matchAction);
          if (matchAction !== 'skip') {
            expect(decision.matchedRule).not.toBeNull();
            expect(decision.matchedRule!.priority).toBe(10);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 8: insertion order does not matter — rules are sorted by priority', () => {
    /**
     * Strategy: generate rules in random order. The engine must still
     * pick the one with the lowest priority number.
     */
    fc.assert(
      fc.property(
        nonEnglishTag,
        arbCategory,
        fc.shuffledSubarray([10, 20, 30, 40, 50], { minLength: 2, maxLength: 5 }),
        (lang, category, priorities) => {
          // Assign 'translate' to the lowest priority, 'hybrid' to all others
          const lowestPriority = Math.min(...priorities);
          const rules: RoutingPolicyRule[] = priorities.map((p) => ({
            priority: p,
            matchConditions: {},
            action: (p === lowestPriority ? 'translate' : 'hybrid') as RoutingAction,
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

          // Must always pick 'translate' (the lowest priority rule)
          expect(decision.action).toBe('translate');
          expect(decision.matchedRule).not.toBeNull();
          expect(decision.matchedRule!.priority).toBe(lowestPriority);
        }
      ),
      { numRuns: 100 }
    );
  });
});
