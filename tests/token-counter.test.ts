import { describe, it, expect } from 'vitest';
import { TokenCounter } from '../src/components/token-counter.ts';

describe('TokenCounter', () => {
  const counter = new TokenCounter();

  describe('estimateTokens', () => {
    it('estimates Latin text at ~4 chars per token', () => {
      const messages = [{ role: 'user', content: 'Hello world, this is a test message' }];
      const estimate = counter.estimateTokens(messages);
      // ~35 chars / 4 = ~9 tokens
      expect(estimate).toBeGreaterThan(5);
      expect(estimate).toBeLessThan(15);
    });

    it('estimates Thai text at ~1.5 chars per token (more tokens)', () => {
      const messages = [{ role: 'user', content: 'อธิบาย recursion ในการเขียนโปรแกรม' }];
      const estimate = counter.estimateTokens(messages);
      // Thai chars produce more tokens than Latin
      expect(estimate).toBeGreaterThan(20);
    });

    it('estimates Korean text at higher token count', () => {
      const messages = [{ role: 'user', content: '프로그래밍에서 재귀의 개념을 설명해주세요' }];
      const estimate = counter.estimateTokens(messages);
      expect(estimate).toBeGreaterThan(15);
    });

    it('handles mixed script text', () => {
      const messages = [{ role: 'user', content: 'อธิบาย bubble sort algorithm' }];
      const estimate = counter.estimateTokens(messages);
      expect(estimate).toBeGreaterThan(5);
    });

    it('handles empty messages', () => {
      const messages = [{ role: 'user', content: '' }];
      const estimate = counter.estimateTokens(messages);
      expect(estimate).toBe(0);
    });

    it('combines multiple messages', () => {
      const single = counter.estimateTokens([{ role: 'user', content: 'Hello world' }]);
      const double = counter.estimateTokens([
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello world' },
      ]);
      expect(double).toBeGreaterThan(single);
    });
  });

  describe('countInputTokens', () => {
    it('falls back to estimation for openai provider', async () => {
      const result = await counter.countInputTokens(
        [{ role: 'user', content: 'Hello world' }],
        'gpt-4o',
        'openai',
      );
      expect(result.method).toBe('estimation');
      expect(result.inputTokens).toBeGreaterThan(0);
    });

    it('falls back to estimation when no provider specified', async () => {
      const result = await counter.countInputTokens(
        [{ role: 'user', content: 'Hello world' }],
        'some-model',
      );
      expect(result.method).toBe('estimation');
    });

    it('Thai text estimates more tokens than English equivalent', async () => {
      const english = await counter.countInputTokens(
        [{ role: 'user', content: 'Explain recursion in programming' }],
        'test',
      );
      const thai = await counter.countInputTokens(
        [{ role: 'user', content: 'อธิบาย recursion ในการเขียนโปรแกรม' }],
        'test',
      );
      expect(thai.inputTokens).toBeGreaterThan(english.inputTokens);
    });
  });
});
