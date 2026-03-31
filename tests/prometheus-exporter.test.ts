import { describe, it, expect, beforeEach } from 'vitest';
import { PrometheusExporter } from '../src/components/prometheus-exporter.ts';

describe('PrometheusExporter', () => {
  let exporter: PrometheusExporter;

  beforeEach(() => {
    exporter = new PrometheusExporter();
  });

  it('exports zero counters when no data recorded', () => {
    const output = exporter.export();
    expect(output).toContain('llm_proxy_requests_total 0');
    expect(output).toContain('llm_proxy_translated_total 0');
    expect(output).toContain('llm_proxy_skipped_total 0');
    expect(output).toContain('llm_proxy_errors_total 0');
  });

  it('counts translated and skipped requests', () => {
    exporter.record({
      requestId: '1', detectedLanguage: 'th', taskType: 'general',
      routingDecision: 'translate', targetLanguage: 'en',
      translationLatencyMs: 100, totalLatencyMs: 500,
    });
    exporter.record({
      requestId: '2', detectedLanguage: 'en', taskType: 'general',
      routingDecision: 'skip', targetLanguage: null,
      translationLatencyMs: 0, totalLatencyMs: 200,
    });

    const output = exporter.export();
    expect(output).toContain('llm_proxy_requests_total 2');
    expect(output).toContain('llm_proxy_translated_total 1');
    expect(output).toContain('llm_proxy_skipped_total 1');
  });

  it('tracks per-language metrics', () => {
    exporter.record({
      requestId: '1', detectedLanguage: 'th', taskType: 'general',
      routingDecision: 'translate', targetLanguage: 'en',
      translationLatencyMs: 100, totalLatencyMs: 500,
      promptTokens: 49, savedTokens: 117,
    });
    exporter.record({
      requestId: '2', detectedLanguage: 'th', taskType: 'reasoning',
      routingDecision: 'translate', targetLanguage: 'en',
      translationLatencyMs: 150, totalLatencyMs: 600,
      promptTokens: 30, savedTokens: 80,
    });

    const output = exporter.export();
    expect(output).toContain('llm_proxy_language_requests_total{language="th"} 2');
    expect(output).toContain('llm_proxy_language_translated_total{language="th"} 2');
    expect(output).toContain('llm_proxy_language_tokens_saved_total{language="th"} 197');
  });

  it('tracks cache hits and misses', () => {
    exporter.record({
      requestId: '1', detectedLanguage: 'th', taskType: 'general',
      routingDecision: 'translate', targetLanguage: 'en',
      translationLatencyMs: 100, totalLatencyMs: 500,
      cacheHits: 3, cacheMisses: 1,
    });

    const output = exporter.export();
    expect(output).toContain('llm_proxy_cache_hits_total 3');
    expect(output).toContain('llm_proxy_cache_misses_total 1');
  });

  it('increments error counter', () => {
    exporter.recordError();
    exporter.recordError();
    const output = exporter.export();
    expect(output).toContain('llm_proxy_errors_total 2');
  });

  it('tracks total latency', () => {
    exporter.record({
      requestId: '1', detectedLanguage: 'en', taskType: 'general',
      routingDecision: 'skip', targetLanguage: null,
      translationLatencyMs: 0, totalLatencyMs: 300,
    });
    exporter.record({
      requestId: '2', detectedLanguage: 'th', taskType: 'general',
      routingDecision: 'translate', targetLanguage: 'en',
      translationLatencyMs: 150, totalLatencyMs: 700,
    });

    const output = exporter.export();
    expect(output).toContain('llm_proxy_latency_ms_total 1000');
    expect(output).toContain('llm_proxy_translation_latency_ms_total 150');
  });

  it('reset clears all counters', () => {
    exporter.record({
      requestId: '1', detectedLanguage: 'th', taskType: 'general',
      routingDecision: 'translate', targetLanguage: 'en',
      translationLatencyMs: 100, totalLatencyMs: 500,
    });
    exporter.reset();

    const output = exporter.export();
    expect(output).toContain('llm_proxy_requests_total 0');
    expect(output).not.toContain('language="th"');
  });

  it('output ends with newline', () => {
    const output = exporter.export();
    expect(output.endsWith('\n')).toBe(true);
  });

  it('includes HELP and TYPE annotations', () => {
    const output = exporter.export();
    expect(output).toContain('# HELP llm_proxy_requests_total');
    expect(output).toContain('# TYPE llm_proxy_requests_total counter');
  });
});
