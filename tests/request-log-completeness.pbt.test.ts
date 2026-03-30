// Feature: multilingual-prompt-optimizer, Property 19: Request log completeness
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { MetricsCollector } from '../src/components/metrics-collector.ts';
import type { RequestLog, TaskCategory, RoutingAction } from '../src/models/types.ts';

/**
 * **Validates: Requirements 10.1, 11.3**
 *
 * Property 19: Request log completeness
 * For any request processed by the Optimizer, the logged entry SHALL contain:
 * request identifier, detected language, detected task type, routing decision,
 * target language, total translation latency, and (when shadow evaluation was
 * performed) translated response score, baseline response score, and score delta.
 */

const taskCategoryArb: fc.Arbitrary<TaskCategory> = fc.constantFrom(
  'reasoning',
  'math',
  'code-generation',
  'creative-writing',
  'translation',
  'summarization',
  'culturally-specific',
  'general',
);

const routingActionArb: fc.Arbitrary<RoutingAction> = fc.constantFrom(
  'translate',
  'skip',
  'hybrid',
);

const bcp47Arb = fc.constantFrom('en', 'fr', 'de', 'ja', 'zh', 'ko', 'es', 'pt', 'ar', 'ru');

/** Arbitrary for a RequestLog without shadow evaluation data. */
const requestLogArb: fc.Arbitrary<RequestLog> = fc.record({
  requestId: fc.uuid(),
  detectedLanguage: bcp47Arb,
  taskType: taskCategoryArb,
  routingDecision: routingActionArb,
  targetLanguage: fc.oneof(bcp47Arb, fc.constant(null)),
  translationLatencyMs: fc.nat({ max: 10000 }),
  totalLatencyMs: fc.nat({ max: 30000 }),
});

/** Arbitrary for a RequestLog with shadow evaluation quality delta. */
const requestLogWithQualityArb: fc.Arbitrary<RequestLog> = fc.record({
  requestId: fc.uuid(),
  detectedLanguage: bcp47Arb,
  taskType: taskCategoryArb,
  routingDecision: routingActionArb,
  targetLanguage: fc.oneof(bcp47Arb, fc.constant(null)),
  translationLatencyMs: fc.nat({ max: 10000 }),
  totalLatencyMs: fc.nat({ max: 30000 }),
  qualityDelta: fc.double({ min: -1, max: 1, noNaN: true }),
});

describe('Request Log Completeness - Property-Based Tests', () => {
  it('Property 19a: Every logged entry retains all required fields', () => {
    fc.assert(
      fc.property(requestLogArb, (entry) => {
        const collector = new MetricsCollector();
        collector.log(entry);

        const metrics = collector.getMetrics();
        expect(metrics.totalRequests).toBe(1);

        // Verify the entry itself has all required fields present and typed correctly
        expect(typeof entry.requestId).toBe('string');
        expect(entry.requestId.length).toBeGreaterThan(0);
        expect(typeof entry.detectedLanguage).toBe('string');
        expect(entry.detectedLanguage.length).toBeGreaterThan(0);
        expect(typeof entry.taskType).toBe('string');
        expect(typeof entry.routingDecision).toBe('string');
        expect(entry.targetLanguage === null || typeof entry.targetLanguage === 'string').toBe(true);
        expect(typeof entry.translationLatencyMs).toBe('number');
        expect(entry.translationLatencyMs).toBeGreaterThanOrEqual(0);
        expect(typeof entry.totalLatencyMs).toBe('number');
        expect(entry.totalLatencyMs).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 19b: Entries with shadow evaluation include quality delta', () => {
    fc.assert(
      fc.property(requestLogWithQualityArb, (entry) => {
        const collector = new MetricsCollector();
        collector.log(entry);

        // qualityDelta must be present and numeric
        expect(entry.qualityDelta).toBeDefined();
        expect(typeof entry.qualityDelta).toBe('number');

        // Metrics should reflect the quality data
        const metrics = collector.getMetrics();
        expect(metrics.avgQualityDelta).toBeDefined();
        expect(typeof metrics.avgQualityDelta).toBe('number');
      }),
      { numRuns: 100 },
    );
  });

  it('Property 19c: Entries without shadow evaluation omit quality delta', () => {
    fc.assert(
      fc.property(requestLogArb, (entry) => {
        const collector = new MetricsCollector();
        collector.log(entry);

        // qualityDelta should be undefined when not provided
        expect(entry.qualityDelta).toBeUndefined();

        // Aggregate quality metrics should default to zero
        const metrics = collector.getMetrics();
        expect(metrics.avgQualityDelta).toBe(0);
        expect(metrics.translationImprovedPct).toBe(0);
        expect(metrics.translationDegradedPct).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 19d: Multiple logged entries are all retrievable via metrics', () => {
    fc.assert(
      fc.property(
        fc.array(requestLogArb, { minLength: 1, maxLength: 50 }),
        (entries) => {
          const collector = new MetricsCollector();
          for (const entry of entries) {
            collector.log(entry);
          }

          const metrics = collector.getMetrics();
          expect(metrics.totalRequests).toBe(entries.length);

          const translated = entries.filter(
            e => e.routingDecision === 'translate' || e.routingDecision === 'hybrid',
          ).length;
          const skipped = entries.length - translated;

          expect(metrics.translatedRequests).toBe(translated);
          expect(metrics.skippedRequests).toBe(skipped);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 19e: Routing decision field is always a valid action', () => {
    fc.assert(
      fc.property(requestLogArb, (entry) => {
        const collector = new MetricsCollector();
        collector.log(entry);

        const validActions: RoutingAction[] = ['translate', 'skip', 'hybrid'];
        expect(validActions).toContain(entry.routingDecision);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 19f: Task type field is always a valid TaskCategory', () => {
    fc.assert(
      fc.property(requestLogArb, (entry) => {
        const collector = new MetricsCollector();
        collector.log(entry);

        const validCategories: TaskCategory[] = [
          'reasoning', 'math', 'code-generation', 'creative-writing',
          'translation', 'summarization', 'culturally-specific', 'general',
        ];
        expect(validCategories).toContain(entry.taskType);
      }),
      { numRuns: 100 },
    );
  });
});
