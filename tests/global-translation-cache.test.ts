import { describe, it, expect, beforeEach } from 'vitest';
import { GlobalTranslationCache } from '../src/components/global-translation-cache.ts';

describe('GlobalTranslationCache', () => {
  let cache: GlobalTranslationCache;

  beforeEach(() => {
    cache = new GlobalTranslationCache();
  });

  it('returns null for uncached text', () => {
    expect(cache.get('hello', 'en', 'th')).toBeNull();
  });

  it('returns cached translation after set', () => {
    cache.set('hello', 'en', 'th', 'สวัสดี');
    expect(cache.get('hello', 'en', 'th')).toBe('สวัสดี');
  });

  it('distinguishes different language pairs for same text', () => {
    cache.set('hello', 'en', 'th', 'สวัสดี');
    cache.set('hello', 'en', 'ja', 'こんにちは');
    expect(cache.get('hello', 'en', 'th')).toBe('สวัสดี');
    expect(cache.get('hello', 'en', 'ja')).toBe('こんにちは');
  });

  it('distinguishes different text for same language pair', () => {
    cache.set('hello', 'en', 'th', 'สวัสดี');
    cache.set('goodbye', 'en', 'th', 'ลาก่อน');
    expect(cache.get('hello', 'en', 'th')).toBe('สวัสดี');
    expect(cache.get('goodbye', 'en', 'th')).toBe('ลาก่อน');
  });

  it('tracks hit and miss counts', () => {
    cache.set('hello', 'en', 'th', 'สวัสดี');
    cache.get('hello', 'en', 'th'); // hit
    cache.get('hello', 'en', 'th'); // hit
    cache.get('missing', 'en', 'th'); // miss

    const stats = cache.getStats();
    expect(stats.totalHits).toBe(2);
    expect(stats.totalMisses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(2 / 3);
  });

  it('reports correct entry count', () => {
    cache.set('a', 'en', 'th', 'x');
    cache.set('b', 'en', 'th', 'y');
    expect(cache.size).toBe(2);
    expect(cache.getStats().entries).toBe(2);
  });

  it('clear removes all entries and resets stats', () => {
    cache.set('hello', 'en', 'th', 'สวัสดี');
    cache.get('hello', 'en', 'th');
    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get('hello', 'en', 'th')).toBeNull();
    const stats = cache.getStats();
    expect(stats.totalHits).toBe(0);
    expect(stats.totalMisses).toBe(1); // the get after clear
  });

  it('evicts entries when max is reached', () => {
    const small = new GlobalTranslationCache({ maxEntries: 3 });
    small.set('a', 'en', 'th', '1');
    small.set('b', 'en', 'th', '2');
    small.set('c', 'en', 'th', '3');
    small.set('d', 'en', 'th', '4'); // should evict one

    expect(small.size).toBeLessThanOrEqual(3);
  });

  it('expired entries return null', () => {
    const shortTtl = new GlobalTranslationCache({ ttlMs: 1 });
    shortTtl.set('hello', 'en', 'th', 'สวัสดี');

    // Wait for expiry
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }

    expect(shortTtl.get('hello', 'en', 'th')).toBeNull();
  });

  it('same system prompt cached globally across users', () => {
    const systemPrompt = 'You are a helpful assistant that answers questions about Thai tax law.';
    cache.set(systemPrompt, 'en', 'th', 'คุณเป็นผู้ช่วยที่มีประโยชน์...');

    // Simulate 100 different users hitting the same system prompt
    let hits = 0;
    for (let i = 0; i < 100; i++) {
      const result = cache.get(systemPrompt, 'en', 'th');
      if (result !== null) hits++;
    }

    expect(hits).toBe(100);
    expect(cache.getStats().totalHits).toBe(100);
  });
});
