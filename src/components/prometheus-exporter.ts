/**
 * Prometheus-format metrics exporter.
 * Tracks per-language and per-routing-decision metrics for production observability.
 */

import type { RequestLog } from '../models/types.ts';

interface LanguageMetrics {
  requests: number;
  translated: number;
  skipped: number;
  totalPromptTokens: number;
  totalSavedTokens: number;
  totalLatencyMs: number;
  totalTranslationLatencyMs: number;
  cacheHits: number;
  cacheMisses: number;
}

export class PrometheusExporter {
  private byLanguage = new Map<string, LanguageMetrics>();
  private totalRequests = 0;
  private totalTranslated = 0;
  private totalSkipped = 0;
  private totalErrors = 0;
  private totalLatencyMs = 0;
  private totalTranslationLatencyMs = 0;
  private totalCacheHits = 0;
  private totalCacheMisses = 0;

  record(entry: RequestLog & {
    promptTokens?: number;
    savedTokens?: number;
    cacheHits?: number;
    cacheMisses?: number;
  }): void {
    this.totalRequests++;
    this.totalLatencyMs += entry.totalLatencyMs;
    this.totalTranslationLatencyMs += entry.translationLatencyMs;

    if (entry.routingDecision === 'translate' || entry.routingDecision === 'hybrid') {
      this.totalTranslated++;
    } else {
      this.totalSkipped++;
    }

    if (entry.cacheHits) this.totalCacheHits += entry.cacheHits;
    if (entry.cacheMisses) this.totalCacheMisses += entry.cacheMisses;

    // Per-language tracking
    const lang = entry.detectedLanguage;
    let lm = this.byLanguage.get(lang);
    if (!lm) {
      lm = {
        requests: 0, translated: 0, skipped: 0,
        totalPromptTokens: 0, totalSavedTokens: 0,
        totalLatencyMs: 0, totalTranslationLatencyMs: 0,
        cacheHits: 0, cacheMisses: 0,
      };
      this.byLanguage.set(lang, lm);
    }

    lm.requests++;
    lm.totalLatencyMs += entry.totalLatencyMs;
    lm.totalTranslationLatencyMs += entry.translationLatencyMs;
    if (entry.routingDecision === 'translate' || entry.routingDecision === 'hybrid') {
      lm.translated++;
    } else {
      lm.skipped++;
    }
    if (entry.promptTokens) lm.totalPromptTokens += entry.promptTokens;
    if (entry.savedTokens) lm.totalSavedTokens += entry.savedTokens;
    if (entry.cacheHits) lm.cacheHits += entry.cacheHits;
    if (entry.cacheMisses) lm.cacheMisses += entry.cacheMisses;
  }

  recordError(): void {
    this.totalErrors++;
  }

  /**
   * Export all metrics in Prometheus text exposition format.
   */
  export(): string {
    const lines: string[] = [];

    // Global counters
    lines.push('# HELP llm_proxy_requests_total Total requests processed');
    lines.push('# TYPE llm_proxy_requests_total counter');
    lines.push(`llm_proxy_requests_total ${this.totalRequests}`);

    lines.push('# HELP llm_proxy_translated_total Requests where translation was applied');
    lines.push('# TYPE llm_proxy_translated_total counter');
    lines.push(`llm_proxy_translated_total ${this.totalTranslated}`);

    lines.push('# HELP llm_proxy_skipped_total Requests where translation was skipped');
    lines.push('# TYPE llm_proxy_skipped_total counter');
    lines.push(`llm_proxy_skipped_total ${this.totalSkipped}`);

    lines.push('# HELP llm_proxy_errors_total Pipeline errors');
    lines.push('# TYPE llm_proxy_errors_total counter');
    lines.push(`llm_proxy_errors_total ${this.totalErrors}`);

    lines.push('# HELP llm_proxy_latency_ms_total Total request latency in milliseconds');
    lines.push('# TYPE llm_proxy_latency_ms_total counter');
    lines.push(`llm_proxy_latency_ms_total ${this.totalLatencyMs}`);

    lines.push('# HELP llm_proxy_translation_latency_ms_total Total translation latency in milliseconds');
    lines.push('# TYPE llm_proxy_translation_latency_ms_total counter');
    lines.push(`llm_proxy_translation_latency_ms_total ${this.totalTranslationLatencyMs}`);

    lines.push('# HELP llm_proxy_cache_hits_total Conversation cache hits');
    lines.push('# TYPE llm_proxy_cache_hits_total counter');
    lines.push(`llm_proxy_cache_hits_total ${this.totalCacheHits}`);

    lines.push('# HELP llm_proxy_cache_misses_total Conversation cache misses');
    lines.push('# TYPE llm_proxy_cache_misses_total counter');
    lines.push(`llm_proxy_cache_misses_total ${this.totalCacheMisses}`);

    // Per-language metrics
    lines.push('# HELP llm_proxy_language_requests_total Requests per detected language');
    lines.push('# TYPE llm_proxy_language_requests_total counter');
    for (const [lang, m] of this.byLanguage) {
      lines.push(`llm_proxy_language_requests_total{language="${lang}"} ${m.requests}`);
    }

    lines.push('# HELP llm_proxy_language_translated_total Translated requests per language');
    lines.push('# TYPE llm_proxy_language_translated_total counter');
    for (const [lang, m] of this.byLanguage) {
      lines.push(`llm_proxy_language_translated_total{language="${lang}"} ${m.translated}`);
    }

    lines.push('# HELP llm_proxy_language_tokens_saved_total Tokens saved per language');
    lines.push('# TYPE llm_proxy_language_tokens_saved_total counter');
    for (const [lang, m] of this.byLanguage) {
      lines.push(`llm_proxy_language_tokens_saved_total{language="${lang}"} ${m.totalSavedTokens}`);
    }

    lines.push('# HELP llm_proxy_language_latency_ms_total Total latency per language in milliseconds');
    lines.push('# TYPE llm_proxy_language_latency_ms_total counter');
    for (const [lang, m] of this.byLanguage) {
      lines.push(`llm_proxy_language_latency_ms_total{language="${lang}"} ${m.totalLatencyMs}`);
    }

    return lines.join('\n') + '\n';
  }

  reset(): void {
    this.byLanguage.clear();
    this.totalRequests = 0;
    this.totalTranslated = 0;
    this.totalSkipped = 0;
    this.totalErrors = 0;
    this.totalLatencyMs = 0;
    this.totalTranslationLatencyMs = 0;
    this.totalCacheHits = 0;
    this.totalCacheMisses = 0;
  }
}
