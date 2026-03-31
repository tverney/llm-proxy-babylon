/**
 * Adaptive Router
 *
 * Learns from shadow evaluation quality comparisons over time to automatically
 * adjust routing decisions. Tracks per-language+task quality deltas and
 * overrides static routing rules when data shows translation helps or hurts.
 */

import type { RoutingAction, TaskCategory } from '../models/types.ts';

interface QualityRecord {
  translatedQuality: number;
  baselineQuality: number;
  delta: number;  // positive = translation helped
  timestamp: number;
}

interface AdaptiveEntry {
  records: QualityRecord[];
  avgDelta: number;
  sampleCount: number;
  recommendation: RoutingAction | null;  // null = defer to static rules
}

export interface AdaptiveRouterConfig {
  minSamples?: number;          // minimum samples before making recommendations (default 10)
  helpThreshold?: number;       // delta above which translation is recommended (default 0.05)
  hurtThreshold?: number;       // delta below which skip is recommended (default -0.05)
  maxRecordsPerKey?: number;    // max records to keep per language+task (default 100)
  decayWindowMs?: number;       // only consider records within this window (default 7 days)
}

export class AdaptiveRouter {
  private data = new Map<string, AdaptiveEntry>();
  private minSamples: number;
  private helpThreshold: number;
  private hurtThreshold: number;
  private maxRecords: number;
  private decayWindowMs: number;

  constructor(config?: AdaptiveRouterConfig) {
    this.minSamples = config?.minSamples ?? 10;
    this.helpThreshold = config?.helpThreshold ?? 0.05;
    this.hurtThreshold = config?.hurtThreshold ?? -0.05;
    this.maxRecords = config?.maxRecordsPerKey ?? 100;
    this.decayWindowMs = config?.decayWindowMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days
  }

  private key(language: string, taskType: TaskCategory): string {
    return `${language}:${taskType}`;
  }

  /**
   * Record a quality comparison from shadow evaluation.
   */
  record(language: string, taskType: TaskCategory, translatedQuality: number, baselineQuality: number): void {
    const k = this.key(language, taskType);
    let entry = this.data.get(k);
    if (!entry) {
      entry = { records: [], avgDelta: 0, sampleCount: 0, recommendation: null };
      this.data.set(k, entry);
    }

    const delta = translatedQuality - baselineQuality;
    entry.records.push({ translatedQuality, baselineQuality, delta, timestamp: Date.now() });

    // Trim old records
    if (entry.records.length > this.maxRecords) {
      entry.records = entry.records.slice(-this.maxRecords);
    }

    // Recompute from recent records within decay window
    this.recompute(entry);
  }

  /**
   * Get the adaptive recommendation for a language+task combination.
   * Returns null if not enough data — caller should fall back to static rules.
   */
  getRecommendation(language: string, taskType: TaskCategory): RoutingAction | null {
    const entry = this.data.get(this.key(language, taskType));
    if (!entry || entry.sampleCount < this.minSamples) return null;
    return entry.recommendation;
  }

  /**
   * Get stats for a language+task combination (useful for debug/metrics).
   */
  getStats(language: string, taskType: TaskCategory): {
    avgDelta: number;
    sampleCount: number;
    recommendation: RoutingAction | null;
  } | null {
    const entry = this.data.get(this.key(language, taskType));
    if (!entry) return null;
    return {
      avgDelta: entry.avgDelta,
      sampleCount: entry.sampleCount,
      recommendation: entry.recommendation,
    };
  }

  /**
   * Get all tracked language+task combinations and their recommendations.
   */
  getAllStats(): Array<{
    language: string;
    taskType: string;
    avgDelta: number;
    sampleCount: number;
    recommendation: RoutingAction | null;
  }> {
    const results: Array<{
      language: string; taskType: string;
      avgDelta: number; sampleCount: number; recommendation: RoutingAction | null;
    }> = [];

    for (const [k, entry] of this.data) {
      const [language, taskType] = k.split(':');
      results.push({
        language, taskType,
        avgDelta: entry.avgDelta,
        sampleCount: entry.sampleCount,
        recommendation: entry.recommendation,
      });
    }

    return results;
  }

  private recompute(entry: AdaptiveEntry): void {
    const cutoff = Date.now() - this.decayWindowMs;
    const recent = entry.records.filter(r => r.timestamp >= cutoff);

    entry.sampleCount = recent.length;

    if (recent.length === 0) {
      entry.avgDelta = 0;
      entry.recommendation = null;
      return;
    }

    entry.avgDelta = recent.reduce((sum, r) => sum + r.delta, 0) / recent.length;

    if (recent.length >= this.minSamples) {
      if (entry.avgDelta > this.helpThreshold) {
        entry.recommendation = 'translate';
      } else if (entry.avgDelta < this.hurtThreshold) {
        entry.recommendation = 'skip';
      } else {
        entry.recommendation = null; // inconclusive, defer to static rules
      }
    } else {
      entry.recommendation = null;
    }
  }

  reset(): void {
    this.data.clear();
  }
}
