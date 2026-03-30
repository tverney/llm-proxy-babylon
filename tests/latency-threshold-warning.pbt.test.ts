// Feature: multilingual-prompt-optimizer, Property 21: Latency threshold warning
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { MetricsCollector } from '../src/components/metrics-collector.ts';
import type { RequestLog, TaskCategory, RoutingAction } from '../src/models/types.ts';

/**
 * **Validates: Requirements 10.3**
 *
 * Property 21: Latency threshold warning
 * For any request where the round-trip translation latency exceeds the configured
 * threshold, the Optimizer SHALL log a warning containing the request identifier
 * and the measured latency.
 */

const taskCategoryArb: fc.Arbitrary<TaskCategory> = fc.constantFrom(
  'reasoning', 'math', 'code-generation', 'creative-writing',
  'translation', 'summarization', 'culturally-specific', 'general',
);

const routingActionArb: fc.Arbitrary<RoutingAction> = fc.constantFrom(
  'translate', 'skip', 'hybrid',
);

const bcp47Arb = fc.constantFrom('en', 'fr', 'de', 'ja', 'zh', 'ko', 'es', 'pt', 'ar', 'ru');

function makeRequestLogArb(latencyArb: fc.Arbitrary<number>): fc.Arbitrary<RequestLog> {
  return fc.record({
    requestId: fc.uuid(),
    detectedLanguage: bcp47Arb,
    taskType: taskCategoryArb,
    routingDecision: routingActionArb,
    targetLanguage: fc.oneof(bcp47Arb, fc.constant(null)),
    translationLatencyMs: latencyArb,
    totalLatencyMs: fc.nat({ max: 30000 }),
  });
}

describe('Latency Threshold Warning - Property-Based Tests', () => {
  it('Property 21a: Logs a warning containing requestId and latency when threshold exceeded', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 5000 }), // threshold
        fc.integer({ min: 1, max: 10000 }),   // extra ms above threshold
        makeRequestLogArb(fc.constant(0)),     // base entry (latency overridden below)
        (threshold, extra, baseEntry) => {
          const collector = new MetricsCollector(threshold);
          const entry: RequestLog = {
            ...baseEntry,
            translationLatencyMs: threshold + extra, // guaranteed above threshold
          };

          const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
          try {
            collector.log(entry);

            expect(warnSpy).toHaveBeenCalledTimes(1);
            const msg = warnSpy.mock.calls[0][0] as string;
            expect(msg).toContain(entry.requestId);
            expect(msg).toContain(String(entry.translationLatencyMs));
          } finally {
            warnSpy.mockRestore();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 21b: No warning when latency is at or below threshold', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10000 }), // threshold
        makeRequestLogArb(fc.constant(0)),   // base entry
        (threshold, baseEntry) => {
          const collector = new MetricsCollector(threshold);

          // Latency exactly at threshold (not exceeding)
          const atThreshold: RequestLog = {
            ...baseEntry,
            translationLatencyMs: threshold,
          };

          // Latency below threshold
          const belowThreshold: RequestLog = {
            ...baseEntry,
            requestId: baseEntry.requestId + '-below',
            translationLatencyMs: Math.max(0, threshold - 1),
          };

          const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
          try {
            collector.log(atThreshold);
            collector.log(belowThreshold);

            expect(warnSpy).not.toHaveBeenCalled();
          } finally {
            warnSpy.mockRestore();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 21c: Warning count matches number of entries exceeding threshold', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 500, max: 3000 }), // threshold
        fc.array(
          fc.record({
            requestId: fc.uuid(),
            detectedLanguage: bcp47Arb,
            taskType: taskCategoryArb,
            routingDecision: routingActionArb,
            targetLanguage: fc.oneof(bcp47Arb, fc.constant(null)),
            translationLatencyMs: fc.nat({ max: 6000 }),
            totalLatencyMs: fc.nat({ max: 30000 }),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        (threshold, entries) => {
          const collector = new MetricsCollector(threshold);
          const expectedWarnings = entries.filter(e => e.translationLatencyMs > threshold).length;

          const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
          try {
            for (const entry of entries) {
              collector.log(entry);
            }

            expect(warnSpy).toHaveBeenCalledTimes(expectedWarnings);
          } finally {
            warnSpy.mockRestore();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 21d: Custom threshold via setLatencyThreshold is respected', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 3000 }),  // initial threshold
        fc.integer({ min: 3001, max: 8000 }), // new higher threshold
        makeRequestLogArb(fc.constant(0)),
        (initialThreshold, newThreshold, baseEntry) => {
          const collector = new MetricsCollector(initialThreshold);

          // Latency between initial and new threshold
          const midLatency = Math.floor((initialThreshold + newThreshold) / 2) + 1;
          const entry: RequestLog = {
            ...baseEntry,
            translationLatencyMs: midLatency,
          };

          const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
          try {
            // Should warn with initial (lower) threshold
            collector.log(entry);
            expect(warnSpy).toHaveBeenCalledTimes(1);

            warnSpy.mockClear();

            // Raise threshold — same latency should no longer warn
            collector.setLatencyThreshold(newThreshold);
            collector.log(entry);
            expect(warnSpy).not.toHaveBeenCalled();
          } finally {
            warnSpy.mockRestore();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
