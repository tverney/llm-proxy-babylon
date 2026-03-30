// Feature: multilingual-prompt-optimizer, Property 18: Duplicate priority rejection
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  validateRoutingPolicy,
  RoutingPolicyValidationError,
} from '../src/config/routing-policy-loader.ts';

/**
 * **Validates: Requirements 9.3**
 *
 * Property 18: Duplicate priority rejection
 * For any RoutingPolicy configuration containing two or more rules with the same
 * priority number, the validator SHALL reject the configuration and report the
 * conflicting priorities.
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

describe('Duplicate Priority Rejection - Property-Based Tests', () => {
  it('Property 18a: Policy with duplicate priorities is rejected', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }),
        validRuleArb,
        validRuleArb,
        (duplicatePriority, rule1, rule2) => {
          const policy = {
            rules: [
              { ...rule1, priority: duplicatePriority },
              { ...rule2, priority: duplicatePriority },
            ],
          };
          expect(() => validateRoutingPolicy(policy)).toThrow(RoutingPolicyValidationError);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 18b: Rejection error message mentions the conflicting priority', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }),
        validRuleArb,
        validRuleArb,
        (duplicatePriority, rule1, rule2) => {
          const policy = {
            rules: [
              { ...rule1, priority: duplicatePriority },
              { ...rule2, priority: duplicatePriority },
            ],
          };
          try {
            validateRoutingPolicy(policy);
            expect.unreachable('Should have thrown');
          } catch (err) {
            expect(err).toBeInstanceOf(RoutingPolicyValidationError);
            const msg = (err as RoutingPolicyValidationError).message;
            expect(msg).toContain(String(duplicatePriority));
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 18c: Duplicate among many unique rules is still rejected', () => {
    fc.assert(
      fc.property(
        fc.array(validRuleArb, { minLength: 2, maxLength: 8 }).chain((rules) => {
          // Assign unique priorities, then duplicate one
          const uniqueRules = rules.map((r, i) => ({ ...r, priority: i + 1 }));
          return fc.integer({ min: 0, max: uniqueRules.length - 1 }).map((dupIdx) => {
            // Pick a source index different from dupIdx to copy its priority
            const sourceIdx = dupIdx === 0 ? 1 : 0;
            const withDup = uniqueRules.map((r, i) =>
              i === dupIdx ? { ...r, priority: uniqueRules[sourceIdx].priority } : r
            );
            return { rules: withDup, conflictingPriority: uniqueRules[sourceIdx].priority };
          });
        }),
        ({ rules, conflictingPriority }) => {
          expect(() => validateRoutingPolicy({ rules })).toThrow(RoutingPolicyValidationError);
          try {
            validateRoutingPolicy({ rules });
          } catch (err) {
            expect((err as RoutingPolicyValidationError).message).toContain(
              String(conflictingPriority)
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 18d: Policy with all unique priorities is accepted', () => {
    fc.assert(
      fc.property(
        fc.array(validRuleArb, { minLength: 1, maxLength: 10 }).map((rules) =>
          rules.map((r, i) => ({ ...r, priority: i + 1 }))
        ),
        (rules) => {
          const result = validateRoutingPolicy({ rules });
          expect(result.rules).toHaveLength(rules.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
