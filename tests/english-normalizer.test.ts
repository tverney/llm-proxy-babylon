import { describe, it, expect } from 'vitest';
import { EnglishNormalizer } from '../src/components/english-normalizer.ts';

describe('EnglishNormalizer — Brazilian English', () => {
  const normalizer = new EnglishNormalizer(0); // no min confidence for testing

  describe('preposition errors', () => {
    it('fixes "depends of" → "depends on"', () => {
      const result = normalizer.normalize('The result depends of the input');
      expect(result.normalized).toContain('depends on');
      expect(result.wasNormalized).toBe(true);
    });

    it('fixes "explain me" → "explain to me"', () => {
      const result = normalizer.normalize('Can you explain me how recursion works?');
      expect(result.normalized).toContain('explain to me');
    });

    it('fixes "go to home" → "go home"', () => {
      const result = normalizer.normalize('I need to go to home now');
      expect(result.normalized).toContain('go home');
    });

    it('fixes "married with" → "married to"', () => {
      const result = normalizer.normalize('She is married with John');
      expect(result.normalized).toContain('married to');
    });
  });

  describe('calques from Portuguese', () => {
    it('fixes "I have X years" → "I am X years old"', () => {
      const result = normalizer.normalize('I have 25 years');
      expect(result.normalized).toContain('I am 25 years old');
    });

    it('fixes "make a question" → "ask a question"', () => {
      const result = normalizer.normalize('I want to make a question about Python');
      expect(result.normalized).toContain('ask a question');
    });

    it('fixes "have a doubt" → "have a question"', () => {
      const result = normalizer.normalize('I have a doubt about this code');
      expect(result.normalized).toContain('have a question');
    });

    it('fixes "say me" → "tell me"', () => {
      const result = normalizer.normalize('Can you say me the answer?');
      expect(result.normalized).toContain('tell me');
    });
  });

  describe('comparative errors', () => {
    it('fixes "more easy" → "easier"', () => {
      const result = normalizer.normalize('This is more easy than that');
      expect(result.normalized).toContain('easier');
    });

    it('fixes "more big" → "bigger"', () => {
      const result = normalizer.normalize('The array is more big now');
      expect(result.normalized).toContain('bigger');
    });

    it('fixes "more good" → "better"', () => {
      const result = normalizer.normalize('This solution is more good');
      expect(result.normalized).toContain('better');
    });
  });

  describe('no false positives', () => {
    it('does not modify standard English', () => {
      const result = normalizer.normalize('Can you explain how recursion works in Python?');
      expect(result.wasNormalized).toBe(false);
      expect(result.normalized).toBe('Can you explain how recursion works in Python?');
    });

    it('does not modify technical content', () => {
      const code = 'function factorial(n) { return n <= 1 ? 1 : n * factorial(n-1); }';
      const result = normalizer.normalize(code);
      expect(result.wasNormalized).toBe(false);
    });
  });

  describe('normalizeMessages', () => {
    it('only normalizes user messages', () => {
      const messages = [
        { role: 'system', content: 'You depends of the config' },
        { role: 'user', content: 'Can you explain me this code?' },
        { role: 'assistant', content: 'Sure, let me explain.' },
      ];
      const result = normalizer.normalizeMessages(messages);
      // System message should NOT be normalized
      expect(result.messages[0].content).toContain('depends of');
      // User message should be normalized
      expect(result.messages[1].content).toContain('explain to me');
      // Assistant message untouched
      expect(result.messages[2].content).toBe('Sure, let me explain.');
    });

    it('reports patterns found across all messages', () => {
      const messages = [
        { role: 'user', content: 'I have a doubt about this. Can you explain me?' },
      ];
      const result = normalizer.normalizeMessages(messages);
      expect(result.anyNormalized).toBe(true);
      expect(result.totalPatternsFound.length).toBeGreaterThan(0);
    });

    it('returns unchanged messages when no patterns found', () => {
      const messages = [
        { role: 'user', content: 'What is the time complexity of merge sort?' },
      ];
      const result = normalizer.normalizeMessages(messages);
      expect(result.anyNormalized).toBe(false);
      expect(result.messages).toEqual(messages);
    });
  });

  describe('multiple patterns in one text', () => {
    it('fixes multiple errors in a single message', () => {
      const result = normalizer.normalize(
        'I have a doubt. Can you explain me why this depends of the input? It is more easy to understand.'
      );
      expect(result.normalized).toContain('have a question');
      expect(result.normalized).toContain('explain to me');
      expect(result.normalized).toContain('depends on');
      expect(result.normalized).toContain('easier');
      expect(result.patternsFound.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('confidence scoring', () => {
    it('returns higher confidence for more patterns', () => {
      const low = normalizer.normalize('This depends of the input');
      const high = normalizer.normalize(
        'I have a doubt. Can you explain me? It depends of the input and is more easy.'
      );
      expect(high.confidence).toBeGreaterThanOrEqual(low.confidence);
      expect(high.patternsFound.length).toBeGreaterThan(low.patternsFound.length);
    });
  });
});
