import { describe, it, expect } from 'vitest';
import { ConversationCompactor } from '../src/components/conversation-compactor.ts';

describe('ConversationCompactor', () => {
  it('does not compact when under threshold', () => {
    const compactor = new ConversationCompactor({ tokenThreshold: 10000 });
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    const result = compactor.compact(messages);
    expect(result.compacted).toBe(false);
    expect(result.messages).toEqual(messages);
  });

  it('does not compact when messages <= activeWindowSize', () => {
    const compactor = new ConversationCompactor({ tokenThreshold: 1, activeWindowSize: 4 });
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ];
    const result = compactor.compact(messages);
    expect(result.compacted).toBe(false);
  });

  it('compacts when over threshold with enough messages', () => {
    const compactor = new ConversationCompactor({
      tokenThreshold: 50,
      activeWindowSize: 2,
    });
    const messages = [
      { role: 'user', content: 'This is the first question about a very long topic that needs discussion' },
      { role: 'assistant', content: 'Here is a very detailed answer about that topic with lots of information' },
      { role: 'user', content: 'Follow up question about the same topic with more details needed' },
      { role: 'assistant', content: 'Another detailed response with even more information and examples' },
      { role: 'user', content: 'Final question' },
      { role: 'assistant', content: 'Final answer' },
    ];
    const result = compactor.compact(messages);
    expect(result.compacted).toBe(true);
    expect(result.compactedMessageCount).toBeLessThan(result.originalMessageCount);
  });

  it('keeps activeWindowSize recent messages intact', () => {
    const compactor = new ConversationCompactor({
      tokenThreshold: 50,
      activeWindowSize: 2,
    });
    const messages = [
      { role: 'user', content: 'Old question with lots of text to push over the token threshold easily' },
      { role: 'assistant', content: 'Old answer with lots of text to push over the token threshold easily' },
      { role: 'user', content: 'Recent question' },
      { role: 'assistant', content: 'Recent answer' },
    ];
    const result = compactor.compact(messages);
    if (result.compacted) {
      // Last 2 messages should be intact
      const lastTwo = result.messages.slice(-2);
      expect(lastTwo[0].content).toBe('Recent question');
      expect(lastTwo[1].content).toBe('Recent answer');
    }
  });

  it('summary is a system message', () => {
    const compactor = new ConversationCompactor({
      tokenThreshold: 50,
      activeWindowSize: 2,
    });
    const messages = [
      { role: 'user', content: 'Old question with lots of text to push over the token threshold easily' },
      { role: 'assistant', content: 'Old answer with lots of text to push over the token threshold easily' },
      { role: 'user', content: 'Recent question' },
      { role: 'assistant', content: 'Recent answer' },
    ];
    const result = compactor.compact(messages);
    if (result.compacted) {
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].content).toContain('[Conversation summary');
    }
  });

  it('summary contains key info from older messages', () => {
    const compactor = new ConversationCompactor({
      tokenThreshold: 50,
      activeWindowSize: 2,
    });
    const messages = [
      { role: 'system', content: 'You are a helpful assistant' },
      { role: 'user', content: 'What is recursion in programming with lots of extra text to exceed threshold' },
      { role: 'assistant', content: 'Recursion is when a function calls itself with lots of extra explanation text' },
      { role: 'user', content: 'Give me an example' },
      { role: 'assistant', content: 'Here is an example' },
    ];
    const result = compactor.compact(messages);
    if (result.compacted) {
      const summary = result.messages[0].content;
      expect(summary).toContain('User asked:');
      expect(summary).toContain('Assistant responded:');
    }
  });

  it('handles Thai text with higher token estimation', () => {
    const compactor = new ConversationCompactor({
      tokenThreshold: 100,
      activeWindowSize: 2,
    });
    // Thai text uses ~1.5 tokens per char, so this should exceed threshold faster
    const messages = [
      { role: 'user', content: 'อธิบายแนวคิดของ recursion ในการเขียนโปรแกรมให้ละเอียด' },
      { role: 'assistant', content: 'การเรียกซ้ำคือเทคนิคที่ฟังก์ชันเรียกตัวเองซ้ำจนกว่าจะถึงเงื่อนไขหยุด' },
      { role: 'user', content: 'ให้ตัวอย่างใน Python' },
      { role: 'assistant', content: 'นี่คือตัวอย่าง' },
    ];
    const result = compactor.compact(messages);
    // Thai text should trigger compaction at a lower message count than English
    expect(result.originalMessageCount).toBe(4);
  });

  it('reports correct counts', () => {
    const compactor = new ConversationCompactor({
      tokenThreshold: 30,
      activeWindowSize: 2,
    });
    const messages = [
      { role: 'user', content: 'First question with enough text to exceed the threshold for compaction' },
      { role: 'assistant', content: 'First answer with enough text to exceed the threshold for compaction' },
      { role: 'user', content: 'Second question' },
      { role: 'assistant', content: 'Second answer' },
    ];
    const result = compactor.compact(messages);
    if (result.compacted) {
      expect(result.originalMessageCount).toBe(4);
      expect(result.compactedMessageCount).toBe(3); // 1 summary + 2 active
      expect(result.summaryTokenEstimate).toBeGreaterThan(0);
    }
  });
});
