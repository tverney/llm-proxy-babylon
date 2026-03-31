/**
 * Global Translation Cache
 *
 * Caches translations by content hash + language pair, shared across all
 * conversations and users. If 1,000 users send the same system prompt in Thai,
 * it's translated once and served from cache for the other 999.
 *
 * This is separate from the per-conversation cache (ConversationCache),
 * which tracks message positions within a conversation. The global cache
 * operates at the translation layer — any call to translate() checks here first.
 */

export interface GlobalCacheEntry {
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  cachedAt: number;
  hitCount: number;
}

export interface GlobalTranslationCacheConfig {
  maxEntries?: number;  // max cached translations (default 10,000)
  ttlMs?: number;       // time-to-live per entry (default 1 hour)
}

/**
 * Simple content hash for cache keys.
 * Combines the text content with source/target language pair.
 */
function hashKey(text: string, from: string, to: string): string {
  let hash = 0;
  const str = `${from}:${to}:${text}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

export class GlobalTranslationCache {
  private cache = new Map<string, GlobalCacheEntry>();
  private maxEntries: number;
  private ttlMs: number;

  // Stats
  private totalHits = 0;
  private totalMisses = 0;

  constructor(config?: GlobalTranslationCacheConfig) {
    this.maxEntries = config?.maxEntries ?? 10_000;
    this.ttlMs = config?.ttlMs ?? 60 * 60 * 1000; // 1 hour
  }

  /**
   * Look up a cached translation.
   * Returns the translated text if found and not expired, null otherwise.
   */
  get(text: string, from: string, to: string): string | null {
    const key = hashKey(text, from, to);
    const entry = this.cache.get(key);

    if (!entry) {
      this.totalMisses++;
      return null;
    }

    // Check TTL
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(key);
      this.totalMisses++;
      return null;
    }

    entry.hitCount++;
    this.totalHits++;
    return entry.translatedText;
  }

  /**
   * Store a translation in the global cache.
   */
  set(text: string, from: string, to: string, translatedText: string): void {
    this.evictIfNeeded();

    const key = hashKey(text, from, to);
    this.cache.set(key, {
      translatedText,
      sourceLanguage: from,
      targetLanguage: to,
      cachedAt: Date.now(),
      hitCount: 0,
    });
  }

  /**
   * Get cache statistics.
   */
  getStats(): {
    entries: number;
    totalHits: number;
    totalMisses: number;
    hitRate: number;
  } {
    const total = this.totalHits + this.totalMisses;
    return {
      entries: this.cache.size,
      totalHits: this.totalHits,
      totalMisses: this.totalMisses,
      hitRate: total > 0 ? this.totalHits / total : 0,
    };
  }

  /** Total entries in cache */
  get size(): number {
    return this.cache.size;
  }

  /** Clear all cached translations */
  clear(): void {
    this.cache.clear();
    this.totalHits = 0;
    this.totalMisses = 0;
  }

  /**
   * Evict expired entries, then LRU if still over limit.
   */
  private evictIfNeeded(): void {
    if (this.cache.size < this.maxEntries) return;

    // Evict expired first
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.cachedAt > this.ttlMs) {
        this.cache.delete(key);
      }
    }

    // If still over limit, evict least-hit entries
    if (this.cache.size >= this.maxEntries) {
      let minKey: string | null = null;
      let minHits = Infinity;
      for (const [key, entry] of this.cache) {
        if (entry.hitCount < minHits) {
          minHits = entry.hitCount;
          minKey = key;
        }
      }
      if (minKey) this.cache.delete(minKey);
    }
  }
}
