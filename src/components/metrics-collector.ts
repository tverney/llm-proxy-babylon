import type { RequestLog, AggregateMetrics, RoutingAction } from '../models/types.ts';

export class MetricsCollector {
  private logs: RequestLog[] = [];
  private latencyThresholdMs: number;

  constructor(latencyThresholdMs: number = 2000) {
    this.latencyThresholdMs = latencyThresholdMs;
  }

  log(entry: RequestLog): void {
    this.logs.push(entry);

    if (entry.translationLatencyMs > this.latencyThresholdMs) {
      console.warn(
        `[MetricsCollector] High translation latency: request=${entry.requestId} latency=${entry.translationLatencyMs}ms threshold=${this.latencyThresholdMs}ms`
      );
    }
  }

  getMetrics(): AggregateMetrics {
    const total = this.logs.length;
    const translated = this.logs.filter(l => l.routingDecision === 'translate' || l.routingDecision === 'hybrid').length;
    const skipped = total - translated;
    const translationErrors = this.logs.filter(
      l => (l.routingDecision === 'translate' || l.routingDecision === 'hybrid') && l.translationLatencyMs === 0 && l.targetLanguage === null
    ).length;

    const avgTranslationLatency =
      total > 0
        ? this.logs.reduce((sum, l) => sum + l.translationLatencyMs, 0) / total
        : 0;

    const withQuality = this.logs.filter(l => l.qualityDelta !== undefined);
    const avgQualityDelta =
      withQuality.length > 0
        ? withQuality.reduce((sum, l) => sum + l.qualityDelta!, 0) / withQuality.length
        : 0;

    const improved = withQuality.filter(l => l.qualityDelta! > 0).length;
    const degraded = withQuality.filter(l => l.qualityDelta! < 0).length;

    return {
      totalRequests: total,
      translatedRequests: translated,
      skippedRequests: skipped,
      translationErrors,
      avgTranslationLatencyMs: avgTranslationLatency,
      avgQualityDelta: avgQualityDelta,
      translationImprovedPct: withQuality.length > 0 ? (improved / withQuality.length) * 100 : 0,
      translationDegradedPct: withQuality.length > 0 ? (degraded / withQuality.length) * 100 : 0,
    };
  }

  reset(): void {
    this.logs = [];
  }

  setLatencyThreshold(thresholdMs: number): void {
    this.latencyThresholdMs = thresholdMs;
  }
}
