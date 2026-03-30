// Feature: multilingual-prompt-optimizer, Property 24: Shadow disabled means no extra LLM calls
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ShadowEvaluator } from '../src/components/shadow-evaluator.ts';
import type { LLMRequest, LLMResponse } from '../src/models/types.ts';
import type { RoutingPolicyRule } from '../src/models/config.ts';
import type { RoutingAction, TaskCategory } from '../src/models/types.ts';

/**
 * **Validates: Requirements 11.7**
 *
 * Property 24: Shadow disabled means no extra LLM calls
 * For any request where shadow evaluation is disabled, the Optimizer SHALL
 * make exactly one LLM API call (the primary request) and no additional calls.
 *
 * We verify this by asserting that when isEnabled() returns false, the
 * evaluate() method is never invoked — and if it were, the mock forwarder
 * tracks that zero LLM calls are made through the shadow path.
 */

const routingActionArb: fc.Arbitrary<RoutingAction> = fc.constantFrom('translate', 'skip', 'hybrid');

const taskCategoryArb: fc.Arbitrary<TaskCategory> = fc.constantFrom(
  'reasoning', 'math', 'code-generation', 'creative-writing',
  'translation', 'summarization', 'culturally-specific', 'general',
);

/** Arbitrary for a routing policy rule with shadowEvaluation explicitly false. */
const disabledShadowRuleArb: fc.Arbitrary<RoutingPolicyRule> = fc.record({
  priority: fc.integer({ min: 1, max: 100 }),
  matchConditions: fc.record({
    taskTypes: fc.option(fc.array(taskCategoryArb, { minLength: 1, maxLength: 3 }), { nil: undefined }),
    sourceLanguagePattern: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
    modelIdPattern: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
  }),
  action: routingActionArb,
  shadowEvaluation: fc.constant(false),
});

/** Arbitrary for a routing policy rule with shadowEvaluation undefined (inherits global). */
const undefinedShadowRuleArb: fc.Arbitrary<RoutingPolicyRule> = fc.record({
  priority: fc.integer({ min: 1, max: 100 }),
  matchConditions: fc.record({
    taskTypes: fc.option(fc.array(taskCategoryArb, { minLength: 1, maxLength: 3 }), { nil: undefined }),
    sourceLanguagePattern: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
    modelIdPattern: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
  }),
  action: routingActionArb,
  shadowEvaluation: fc.constant(undefined),
});

const llmRequestArb: fc.Arbitrary<LLMRequest> = fc.record({
  model: fc.string({ minLength: 1, maxLength: 20 }),
  messages: fc.array(
    fc.record({
      role: fc.constantFrom('system', 'user', 'assistant'),
      content: fc.string({ minLength: 1, maxLength: 200 }),
    }),
    { minLength: 1, maxLength: 5 },
  ),
});

const llmResponseArb: fc.Arbitrary<LLMResponse> = fc.string({ minLength: 0, maxLength: 300 }).map(content => ({
  raw: { choices: [{ message: { role: 'assistant', content } }] },
  content,
  statusCode: 200,
}));

/** Creates a mock forwarder that counts how many times forward() is called. */
function createTrackingForwarder(baselineResponse: LLMResponse) {
  let callCount = 0;
  return {
    get callCount() { return callCount; },
    forward: async () => { callCount++; return baselineResponse; },
    forwardStream: async function* () { /* noop */ },
  };
}

describe('Shadow Disabled No Extra LLM Calls - Property-Based Tests', () => {
  it('Property 24a: isEnabled returns false when global is disabled and rule has no override', () => {
    fc.assert(
      fc.property(undefinedShadowRuleArb, (rule) => {
        const evaluator = new ShadowEvaluator({ enabled: false });
        expect(evaluator.isEnabled(rule)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 24b: isEnabled returns false when rule explicitly disables shadow', () => {
    fc.assert(
      fc.property(disabledShadowRuleArb, fc.boolean(), (rule, globalEnabled) => {
        // Per-rule shadowEvaluation: false overrides even a globally enabled setting
        const evaluator = new ShadowEvaluator({ enabled: globalEnabled });
        expect(evaluator.isEnabled(rule)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 24c: isEnabled returns false when rule is null and global is disabled', () => {
    const evaluator = new ShadowEvaluator({ enabled: false });
    fc.assert(
      fc.property(fc.constant(null), (rule) => {
        expect(evaluator.isEnabled(rule)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 24d: no LLM calls when shadow is disabled and evaluate is guarded by isEnabled', async () => {
    // Simulates the correct pipeline behavior: check isEnabled before calling evaluate.
    // When disabled, the forwarder should never be called for shadow evaluation.
    const cases: Array<{
      request: LLMRequest;
      response: LLMResponse;
      baseline: LLMResponse;
      rule: RoutingPolicyRule;
    }> = [];

    fc.assert(
      fc.property(
        llmRequestArb, llmResponseArb, llmResponseArb, disabledShadowRuleArb,
        (request, response, baseline, rule) => {
          cases.push({ request, response, baseline, rule });
        },
      ),
      { numRuns: 100 },
    );

    for (const { request, response, baseline, rule } of cases) {
      const evaluator = new ShadowEvaluator({ enabled: true }); // global enabled, but rule overrides
      const forwarder = createTrackingForwarder(baseline);

      // Pipeline guard: only call evaluate when isEnabled returns true
      if (evaluator.isEnabled(rule)) {
        await evaluator.evaluate(request, response, forwarder, 'http://mock/v1/chat/completions');
      }

      // Since rule.shadowEvaluation is false, isEnabled returns false,
      // so evaluate is never called and forwarder gets zero calls.
      expect(forwarder.callCount).toBe(0);
    }
  });

  it('Property 24e: evaluate makes exactly one LLM call when shadow IS enabled (control test)', async () => {
    // Positive control: when shadow is enabled, evaluate() makes exactly one call.
    const cases: Array<{ request: LLMRequest; response: LLMResponse; baseline: LLMResponse }> = [];

    fc.assert(
      fc.property(llmRequestArb, llmResponseArb, llmResponseArb, (request, response, baseline) => {
        cases.push({ request, response, baseline });
      }),
      { numRuns: 100 },
    );

    for (const { request, response, baseline } of cases) {
      const evaluator = new ShadowEvaluator({ enabled: true });
      const forwarder = createTrackingForwarder(baseline);

      // Shadow is enabled globally, no rule override
      if (evaluator.isEnabled(null)) {
        await evaluator.evaluate(request, response, forwarder, 'http://mock/v1/chat/completions');
      }

      // evaluate() calls forwarder.forward() exactly once for the baseline
      expect(forwarder.callCount).toBe(1);
    }
  });
});
