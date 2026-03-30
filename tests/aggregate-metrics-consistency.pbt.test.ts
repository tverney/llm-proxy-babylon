// Feature: multilingual-prompt-optimizer, Property 20: Aggregate metrics consistency
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { MetricsCollector } from '../src/components/metrics-collector.ts';
import type { RequestLog, TaskCategory, RoutingAction } from '../src/models/types.ts';

/**
 * **Validates: Requirements 10.2, 11.5**
 *
 * Property 20: Aggregate metrics consistency
 * For any sequence of N processed requests, the aggregate metrics SHALL satisfy:
 * - totalRequests equals N
 * - translatedRequests plus skippedRequests equals totalRequests
 * - translationErrors is less than or equal to translatedRequests
 * - avgTranslationLatencyMs equals the mean of individual translation latencies
 * - (when shadow evaluation data exists) avgQualityDelta equals the mean of
 *   individual score deltas, translationImprovedPct equals the percentage of
 *   requests with positive delta, and translationDegradedPct equals the
 *   percentage with negative delta.
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

const requestLogArb: fc.Arbitrary<RequestLog> = fc.record({
  requestId: fc.uuid(),
  detectedLanguage: bcp47Arb,
  taskType: taskCategoryArb,
  routingDecision: routingActionArb,
  targetLanguage: fc.oneof(bcp47Arb, fc.constant(null)),
  translationLatencyMs: fc.nat({ max: 10000 }),
  totalLatencyMs: fc.nat({ max: 30000 }),
});

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

/** Mixed: some entries with quality delta, some without. */
const mixedRequestLogArb: fc.Arbitrary<RequestLog> = fc.oneof(
  requestLogArb,
  requestLogWithQualityArb,
);

describe('Aggregate Metrics Consistency - Property-Based Tests', () => {
  it('Property 20a: totalRequests equals N for any sequence of N logs', () => {
    fc.assert(
      fc.property(
        fc.array(mixedRequestLogArb, { minLength: 0, maxLength: 50 }),
        (entries) => {
          const collector = new MetricsCollector();
          for (const entry of entries) collector.log(entry);

          const metrics = collector.getMetrics();
          expect(metrics.totalRequests).toBe(entries.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 20b: translatedRequests + skippedRequests equals totalRequests', () => {
    fc.assert(
      fc.property(
        fc.array(mixedRequestLogArb, { minLength: 1, maxLength: 50 }),
        (entries) => {
          const collector = new MetricsCollector();
          for (const entry of entries) collector.log(entry);

          const metrics = collector.getMetrics();
          expect(metrics.translatedRequests + metrics.skippedRequests).toBe(
            metrics.totalRequests,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 20c: translationErrors <= translatedRequests', () => {
    fc.assert(
      fc.property(
        fc.array(mixedRequestLogArb, { minLength: 1, maxLength: 50 }),
        (entries) => {
          const collector = new MetricsCollector();
          for (const entry of entries) collector.log(entry);

          const metrics = collector.getMetrics();
          expect(metrics.translationErrors).toBeLessThanOrEqual(
            metrics.translatedRequests,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 20d: avgTranslationLatencyMs equals mean of individual latencies', () => {
    fc.assert(
      fc.property(
        fc.array(mixedRequestLogArb, { minLength: 1, maxLength: 50 }),
        (entries) => {
          const collector = new MetricsCollector();
          for (const entry of entries) collector.log(entry);

          const metrics = collector.getMetrics();
          const expectedAvg =
            entries.reduce((sum, e) => sum + e.translationLatencyMs, 0) /
            entries.length;

          expect(metrics.avgTranslationLatencyMs).toBeCloseTo(expectedAvg, 5);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 20e: avgQualityDelta equals mean of individual quality deltas', () => {
    fc.assert(
      fc.property(
        fc.array(requestLogWithQualityArb, { minLength: 1, maxLength: 50 }),
        (entries) => {
          const collector = new MetricsCollector();
          for (const entry of entries) collector.log(entry);

          const metrics = collector.getMetrics();
          const expectedAvg =
            entries.reduce((sum, e) => sum + e.qualityDelta!, 0) / entries.length;

          expect(metrics.avgQualityDelta).toBeCloseTo(expectedAvg, 5);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 20f: translationImprovedPct equals percentage with positive delta', () => {
    fc.assert(
      fc.property(
        fc.array(requestLogWithQualityArb, { minLength: 1, maxLength: 50 }),
        (entries) => {
          const collector = new MetricsCollector();
          for (const entry of entries) collector.log(entry);

          const metrics = collector.getMetrics();
          const improved = entries.filter((e) => e.qualityDelta! > 0).length;
          const expectedPct = (improved / entries.length) * 100;

          expect(metrics.translationImprovedPct).toBeCloseTo(expectedPct, 5);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 20g: translationDegradedPct equals percentage with negative delta', () => {
    fc.assert(
      fc.property(
        fc.array(requestLogWithQualityArb, { minLength: 1, maxLength: 50 }),
        (entries) => {
          const collector = new MetricsCollector();
          for (const entry of entries) collector.log(entry);

          const metrics = collector.getMetrics();
          const degraded = entries.filter((e) => e.qualityDelta! < 0).length;
          const expectedPct = (degraded / entries.length) * 100;

          expect(metrics.translationDegradedPct).toBeCloseTo(expectedPct, 5);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 20h: quality metrics default to zero when no shadow data exists', () => {
    fc.assert(
      fc.property(
        fc.array(requestLogArb, { minLength: 1, maxLength: 50 }),
        (entries) => {
          const collector = new MetricsCollector();
          for (const entry of entries) collector.log(entry);

          const metrics = collector.getMetrics();
          expect(metrics.avgQualityDelta).toBe(0);
          expect(metrics.translationImprovedPct).toBe(0);
          expect(metrics.translationDegradedPct).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 20i: reset clears all metrics to zero state', () => {
    fc.assert(
      fc.property(
        fc.array(mixedRequestLogArb, { minLength: 1, maxLength: 50 }),
        (entries) => {
          const collector = new MetricsCollector();
          for (const entry of entries) collector.log(entry);

          collector.reset();
          const metrics = collector.getMetrics();

          expect(metrics.totalRequests).toBe(0);
          expect(metrics.translatedRequests).toBe(0);
          expect(metrics.skippedRequests).toBe(0);
          expect(metrics.translationErrors).toBe(0);
          expect(metrics.avgTranslationLatencyMs).toBe(0);
          expect(metrics.avgQualityDelta).toBe(0);
          expect(metrics.translationImprovedPct).toBe(0);
          expect(metrics.translationDegradedPct).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
