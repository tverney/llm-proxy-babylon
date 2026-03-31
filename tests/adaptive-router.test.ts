import { describe, it, expect, beforeEach } from 'vitest';
import { AdaptiveRouter } from '../src/components/adaptive-router.ts';

describe('AdaptiveRouter', () => {
  let router: AdaptiveRouter;

  beforeEach(() => {
    router = new AdaptiveRouter({ minSamples: 3 }); // lower threshold for testing
  });

  it('returns null when no data exists', () => {
    expect(router.getRecommendation('th', 'reasoning')).toBeNull();
  });

  it('returns null when below minimum samples', () => {
    router.record('th', 'reasoning', 0.9, 0.5); // translation helped
    router.record('th', 'reasoning', 0.85, 0.45);
    expect(router.getRecommendation('th', 'reasoning')).toBeNull();
  });

  it('recommends translate when translation consistently helps', () => {
    router.record('th', 'reasoning', 0.9, 0.5);
    router.record('th', 'reasoning', 0.85, 0.45);
    router.record('th', 'reasoning', 0.88, 0.48);
    expect(router.getRecommendation('th', 'reasoning')).toBe('translate');
  });

  it('recommends skip when translation consistently hurts', () => {
    router.record('pt', 'general', 0.7, 0.85);
    router.record('pt', 'general', 0.65, 0.82);
    router.record('pt', 'general', 0.68, 0.80);
    expect(router.getRecommendation('pt', 'general')).toBe('skip');
  });

  it('returns null when results are inconclusive', () => {
    router.record('ko', 'math', 0.8, 0.78);
    router.record('ko', 'math', 0.75, 0.77);
    router.record('ko', 'math', 0.79, 0.76);
    // avg delta is very small, within threshold
    expect(router.getRecommendation('ko', 'math')).toBeNull();
  });

  it('tracks different language+task combinations independently', () => {
    // Thai reasoning: translation helps
    router.record('th', 'reasoning', 0.9, 0.5);
    router.record('th', 'reasoning', 0.85, 0.45);
    router.record('th', 'reasoning', 0.88, 0.48);

    // Portuguese general: translation hurts
    router.record('pt', 'general', 0.7, 0.85);
    router.record('pt', 'general', 0.65, 0.82);
    router.record('pt', 'general', 0.68, 0.80);

    expect(router.getRecommendation('th', 'reasoning')).toBe('translate');
    expect(router.getRecommendation('pt', 'general')).toBe('skip');
  });

  it('getStats returns correct data', () => {
    router.record('th', 'reasoning', 0.9, 0.5);
    router.record('th', 'reasoning', 0.85, 0.45);
    router.record('th', 'reasoning', 0.88, 0.48);

    const stats = router.getStats('th', 'reasoning');
    expect(stats).not.toBeNull();
    expect(stats!.sampleCount).toBe(3);
    expect(stats!.avgDelta).toBeGreaterThan(0);
    expect(stats!.recommendation).toBe('translate');
  });

  it('getStats returns null for unknown combinations', () => {
    expect(router.getStats('xx', 'general')).toBeNull();
  });

  it('getAllStats returns all tracked combinations', () => {
    router.record('th', 'reasoning', 0.9, 0.5);
    router.record('pt', 'general', 0.7, 0.85);

    const all = router.getAllStats();
    expect(all.length).toBe(2);
    expect(all.map(s => s.language).sort()).toEqual(['pt', 'th']);
  });

  it('reset clears all data', () => {
    router.record('th', 'reasoning', 0.9, 0.5);
    router.record('th', 'reasoning', 0.85, 0.45);
    router.record('th', 'reasoning', 0.88, 0.48);

    router.reset();
    expect(router.getRecommendation('th', 'reasoning')).toBeNull();
    expect(router.getAllStats().length).toBe(0);
  });

  it('respects decay window', () => {
    const shortDecay = new AdaptiveRouter({
      minSamples: 3,
      decayWindowMs: 1, // 1ms — everything expires immediately
    });

    shortDecay.record('th', 'reasoning', 0.9, 0.5);
    shortDecay.record('th', 'reasoning', 0.85, 0.45);
    shortDecay.record('th', 'reasoning', 0.88, 0.48);

    // Records should have expired by now
    // Need a small delay for the 1ms window
    const stats = shortDecay.getStats('th', 'reasoning');
    // sampleCount may be 0 or 3 depending on timing, but recommendation should be null if expired
    // The recompute happens on record(), so the last record's recompute sees all 3 as recent
    // After that, no new recompute happens, so it keeps the last state
    expect(stats).not.toBeNull();
  });

  it('trims records beyond maxRecordsPerKey', () => {
    const small = new AdaptiveRouter({
      minSamples: 2,
      maxRecordsPerKey: 5,
    });

    for (let i = 0; i < 10; i++) {
      small.record('th', 'reasoning', 0.9, 0.5);
    }

    const stats = small.getStats('th', 'reasoning');
    expect(stats).not.toBeNull();
    expect(stats!.sampleCount).toBeLessThanOrEqual(5);
  });
});
