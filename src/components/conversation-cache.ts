/**
 * Conversation Translation Cache
 *
 * Caches translated messages per conversation so that multi-turn conversations
 * only translate each message once. On subsequent requests, previously translated
 * messages are pulled from cache and only new messages are translated.
 *
 * This dramatically reduces both translation API calls and LLM token costs
 * for multi-turn conversations in non-English languages.
 */

export interface CachedMessage {
  originalHash: string;
  role: string;
  originalContent: string;
  translatedContent: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface ConversationEntry {
  conversationId: string;
  messages: CachedMessage[];
  createdAt: number;
  lastAccessedAt: number;
}

export interface ConversationCacheConfig {
  maxConversations?: number;   // max cached conversations (default 1000)
  ttlMs?: number;              // time-to-live per conversation (default 30 min)
}

/**
 * Simple hash for message content to detect duplicates.
 */
function hashMessage(role: string, content: string): string {
  let hash = 0;
  const str = `${role}:${content}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

export class ConversationCache {
  private cache = new Map<string, ConversationEntry>();
  private maxConversations: number;
  private ttlMs: number;

  constructor(config?: ConversationCacheConfig) {
    this.maxConversations = config?.maxConversations ?? 1000;
    this.ttlMs = config?.ttlMs ?? 30 * 60 * 1000; // 30 minutes
  }

  /**
   * Look up cached translations for a conversation's messages.
   * Returns which messages are already translated (cache hits) and which need translation.
   */
  lookup(
    conversationId: string,
    messages: Array<{ role: string; content: string }>,
  ): {
    hits: Array<{ index: number; translatedContent: string }>;
    misses: Array<{ index: number; role: string; content: string }>;
  } {
    const entry = this.cache.get(conversationId);
    const hits: Array<{ index: number; translatedContent: string }> = [];
    const misses: Array<{ index: number; role: string; content: string }> = [];

    if (!entry) {
      // No cache for this conversation — everything is a miss
      messages.forEach((msg, i) => misses.push({ index: i, role: msg.role, content: msg.content }));
      return { hits, misses };
    }

    // Check TTL
    if (Date.now() - entry.lastAccessedAt > this.ttlMs) {
      this.cache.delete(conversationId);
      messages.forEach((msg, i) => misses.push({ index: i, role: msg.role, content: msg.content }));
      return { hits, misses };
    }

    entry.lastAccessedAt = Date.now();

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const hash = hashMessage(msg.role, msg.content);

      // Check if this exact message exists in the cache at the same position
      const cached = entry.messages[i];
      if (cached && cached.originalHash === hash) {
        hits.push({ index: i, translatedContent: cached.translatedContent });
      } else {
        misses.push({ index: i, role: msg.role, content: msg.content });
      }
    }

    return { hits, misses };
  }

  /**
   * Store translated messages in the cache for a conversation.
   */
  store(
    conversationId: string,
    messages: Array<{
      index: number;
      role: string;
      originalContent: string;
      translatedContent: string;
      sourceLanguage: string;
      targetLanguage: string;
    }>,
  ): void {
    this.evictIfNeeded();

    let entry = this.cache.get(conversationId);
    if (!entry) {
      entry = {
        conversationId,
        messages: [],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };
      this.cache.set(conversationId, entry);
    }

    entry.lastAccessedAt = Date.now();

    for (const msg of messages) {
      const cached: CachedMessage = {
        originalHash: hashMessage(msg.role, msg.originalContent),
        role: msg.role,
        originalContent: msg.originalContent,
        translatedContent: msg.translatedContent,
        sourceLanguage: msg.sourceLanguage,
        targetLanguage: msg.targetLanguage,
      };
      entry.messages[msg.index] = cached;
    }
  }

  /**
   * Get cache stats for a conversation (useful for debug output).
   */
  getStats(conversationId: string): { cachedMessages: number; lastAccessed: number } | null {
    const entry = this.cache.get(conversationId);
    if (!entry) return null;
    return {
      cachedMessages: entry.messages.filter(Boolean).length,
      lastAccessed: entry.lastAccessedAt,
    };
  }

  /** Total conversations in cache */
  get size(): number {
    return this.cache.size;
  }

  /** Clear all cached conversations */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Evict oldest conversations if cache is full.
   */
  private evictIfNeeded(): void {
    if (this.cache.size < this.maxConversations) return;

    // Evict expired first
    const now = Date.now();
    for (const [id, entry] of this.cache) {
      if (now - entry.lastAccessedAt > this.ttlMs) {
        this.cache.delete(id);
      }
    }

    // If still over limit, evict oldest
    if (this.cache.size >= this.maxConversations) {
      let oldestId: string | null = null;
      let oldestTime = Infinity;
      for (const [id, entry] of this.cache) {
        if (entry.lastAccessedAt < oldestTime) {
          oldestTime = entry.lastAccessedAt;
          oldestId = id;
        }
      }
      if (oldestId) this.cache.delete(oldestId);
    }
  }
}
