/**
 * Conversation Compactor
 *
 * When a conversation's translated message history exceeds a token threshold,
 * automatically summarizes older messages into a compact English summary.
 * This keeps the LLM context window lean for long multi-turn conversations
 * in non-English languages, where token inflation compounds per turn.
 *
 * Strategy:
 * - Keep the N most recent messages intact (the "active window")
 * - Summarize everything before the active window into a single system message
 * - The summary is in English (already translated), so it's token-efficient
 */

export interface CompactorConfig {
  /** Max estimated tokens before compaction triggers (default 4000) */
  tokenThreshold?: number;
  /** Number of recent messages to keep intact (default 4) */
  activeWindowSize?: number;
  /** Max tokens for the summary itself (default 500) */
  maxSummaryTokens?: number;
}

export interface CompactionResult {
  compacted: boolean;
  originalMessageCount: number;
  compactedMessageCount: number;
  summaryTokenEstimate: number;
  messages: Array<{ role: string; content: string }>;
}

export class ConversationCompactor {
  private tokenThreshold: number;
  private activeWindowSize: number;
  private maxSummaryTokens: number;

  constructor(config?: CompactorConfig) {
    this.tokenThreshold = config?.tokenThreshold ?? 4000;
    this.activeWindowSize = config?.activeWindowSize ?? 4;
    this.maxSummaryTokens = config?.maxSummaryTokens ?? 500;
  }

  /**
   * Check if compaction is needed and compact if so.
   * Returns the original messages if under threshold, or compacted messages if over.
   */
  compact(messages: Array<{ role: string; content: string }>): CompactionResult {
    const estimatedTokens = this.estimateTokens(messages);

    if (estimatedTokens <= this.tokenThreshold || messages.length <= this.activeWindowSize) {
      return {
        compacted: false,
        originalMessageCount: messages.length,
        compactedMessageCount: messages.length,
        summaryTokenEstimate: 0,
        messages,
      };
    }

    // Split into older messages (to summarize) and active window (to keep)
    const splitPoint = messages.length - this.activeWindowSize;
    const olderMessages = messages.slice(0, splitPoint);
    const activeMessages = messages.slice(splitPoint);

    // Build a summary of the older messages
    const summary = this.buildSummary(olderMessages);
    const summaryTokenEstimate = this.estimateTokensForText(summary);

    // Construct compacted message list: summary as system message + active window
    const compactedMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: summary },
      ...activeMessages,
    ];

    return {
      compacted: true,
      originalMessageCount: messages.length,
      compactedMessageCount: compactedMessages.length,
      summaryTokenEstimate,
      messages: compactedMessages,
    };
  }

  /**
   * Build a summary of older messages.
   * Extracts key information from each message into a condensed format.
   */
  private buildSummary(messages: Array<{ role: string; content: string }>): string {
    const parts: string[] = ['[Conversation summary of earlier messages]'];

    for (const msg of messages) {
      const truncated = this.truncateContent(msg.content, 200);
      if (msg.role === 'system') {
        parts.push(`System context: ${truncated}`);
      } else if (msg.role === 'user') {
        parts.push(`User asked: ${truncated}`);
      } else if (msg.role === 'assistant') {
        parts.push(`Assistant responded: ${truncated}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Truncate content to a max character length, adding ellipsis if truncated.
   */
  private truncateContent(content: string, maxChars: number): string {
    if (content.length <= maxChars) return content;
    return content.slice(0, maxChars) + '...';
  }

  /**
   * Estimate token count for a list of messages.
   */
  private estimateTokens(messages: Array<{ role: string; content: string }>): number {
    return messages.reduce((sum, m) => sum + this.estimateTokensForText(m.content), 0);
  }

  /**
   * Estimate tokens for a text string using script-aware heuristic.
   */
  private estimateTokensForText(text: string): number {
    let tokens = 0;
    for (const char of text) {
      const code = char.codePointAt(0) ?? 0;
      if (
        (code >= 0x0E00 && code <= 0x0E7F) || // Thai
        (code >= 0x3000 && code <= 0x9FFF) || // CJK
        (code >= 0xAC00 && code <= 0xD7AF) || // Korean Hangul
        (code >= 0x1100 && code <= 0x11FF)    // Korean Jamo
      ) {
        tokens += 1.5;
      } else {
        tokens += 0.25;
      }
    }
    return Math.ceil(tokens);
  }
}
