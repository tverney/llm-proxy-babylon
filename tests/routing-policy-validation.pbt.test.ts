// Feature: multilingual-prompt-optimizer, Property 17: RoutingPolicy validation
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  validateRoutingPolicyRule,
  validateRoutingPolicy,
  RoutingPolicyValidationError,
} from '../src/config/routing-policy-loader.ts';

/**
 * **Validates: Requirements 9.2**
 *
 * Property 17: RoutingPolicy validation
 * For any object presented as a RoutingPolicy rule, the validator SHALL accept it
 * if and only if it contains a priority number, match conditions, and a valid action
 * (translate, skip, or hybrid).
 */

const validActionArb = fc.oneof(
  fc.constant('translate' as const),
  fc.constant('skip' as const),
  fc.constant('hybrid' as const)
);

const validMatchConditionsArb = fc.record({
  taskTypes: fc.option(
    fc.array(
      fc.oneof(
        fc.constant('reasoning' as const),
        fc.constant('math' as const),
        fc.constant('code-generation' as const),
        fc.constant('creative-writing' as const),
        fc.constant('general' as const)
      ),
      { minLength: 1 }
    ),
    { nil: undefined }
  ),
  sourceLanguagePattern: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
  modelIdPattern: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
});

const validRuleArb = fc.record({
  priority: fc.integer({ min: 0, max: 10000 }),
  matchConditions: validMatchConditionsArb,
  action: validActionArb,
});

describe('RoutingPolicy Validation - Property-Based Tests', () => {
  it('Property 17a: Valid RoutingPolicyRule objects are accepted', () => {
    fc.assert(
      fc.property(validRuleArb, (rule) => {
        const result = validateRoutingPolicyRule(rule);
        expect(result.priority).toBe(rule.priority);
        expect(result.action).toBe(rule.action);
        expect(result.matchConditions).toEqual(rule.matchConditions);
      }),
      { numRuns: 100 }
    );
  });

  it('Property 17b: Valid RoutingPolicy with unique priorities is accepted', () => {
    fc.assert(
      fc.property(
        fc.array(validRuleArb, { minLength: 1, maxLength: 10 }).map((rules) => {
          // Ensure unique priorities by assigning index-based priorities
          return rules.map((r, i) => ({ ...r, priority: i + 1 }));
        }),
        (rules) => {
          const policy = { rules };
          const result = validateRoutingPolicy(policy);
          expect(result.rules).toHaveLength(rules.length);
          for (let i = 0; i < rules.length; i++) {
            expect(result.rules[i].priority).toBe(rules[i].priority);
            expect(result.rules[i].action).toBe(rules[i].action);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 17c: Missing or invalid priority is rejected', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(undefined),
          fc.constant('high'),
          fc.constant(null),
          fc.constant(NaN),
          fc.constant(Infinity),
        ),
        (badPriority) => {
          const rule = {
            priority: badPriority,
            matchConditions: {},
            action: 'skip',
          };
          expect(() => validateRoutingPolicyRule(rule)).toThrow(RoutingPolicyValidationError);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 17d: Missing or invalid matchConditions is rejected', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.constant('conditions'),
          fc.constant(42),
        ),
        (badConditions) => {
          const rule = {
            priority: 1,
            matchConditions: badConditions,
            action: 'translate',
          };
          expect(() => validateRoutingPolicyRule(rule)).toThrow(RoutingPolicyValidationError);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 17e: Missing or invalid action is rejected', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(undefined),
          fc.constant(''),
          fc.constant('forward'),
          fc.constant('TRANSLATE'),
          fc.constant(123),
          fc.constant(null),
        ),
        (badAction) => {
          const rule = {
            priority: 1,
            matchConditions: {},
            action: badAction,
          };
          expect(() => validateRoutingPolicyRule(rule)).toThrow(RoutingPolicyValidationError);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 17f: Non-object rule inputs are rejected', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(42),
          fc.constant('string'),
          fc.constant(true),
          fc.constant(undefined),
        ),
        (badInput) => {
          expect(() => validateRoutingPolicyRule(badInput)).toThrow(RoutingPolicyValidationError);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 17g: Non-object policy inputs are rejected', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(42),
          fc.constant('string'),
          fc.constant(true),
        ),
        (badInput) => {
          expect(() => validateRoutingPolicy(badInput)).toThrow(RoutingPolicyValidationError);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 17h: Policy with non-array rules is rejected', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant({ rules: 'not-array' }),
          fc.constant({ rules: 42 }),
          fc.constant({ rules: null }),
          fc.constant({}),
        ),
        (badPolicy) => {
          expect(() => validateRoutingPolicy(badPolicy)).toThrow(RoutingPolicyValidationError);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 17i: Rejected configs produce descriptive error messages', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant({ priority: 'bad', matchConditions: {}, action: 'skip' }),
          fc.constant({ priority: 1, matchConditions: null, action: 'skip' }),
          fc.constant({ priority: 1, matchConditions: {}, action: 'invalid' }),
          fc.constant(null),
        ),
        (badInput) => {
          try {
            validateRoutingPolicyRule(badInput);
            expect.unreachable('Should have thrown');
          } catch (err) {
            expect(err).toBeInstanceOf(RoutingPolicyValidationError);
            expect((err as RoutingPolicyValidationError).message.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
