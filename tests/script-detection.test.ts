import { describe, it, expect } from 'vitest';
import { LanguageDetector } from '../src/components/language-detector.ts';

describe('Script-based Language Detection', () => {
  const detector = new LanguageDetector();

  it('detects Thai script correctly', () => {
    const result = detector.detect('อธิบาย recursion ในการเขียนโปรแกรม');
    expect(result.primary.tag).toBe('th');
    expect(result.primary.confidence).toBe(1);
    expect(result.isUndetermined).toBe(false);
  });

  it('detects Korean Hangul correctly', () => {
    const result = detector.detect('프로그래밍에서 재귀의 개념을 설명해주세요');
    expect(result.primary.tag).toBe('ko');
    expect(result.primary.confidence).toBe(1);
  });

  it('detects Japanese Hiragana/Katakana correctly', () => {
    const result = detector.detect('プログラミングにおける再帰の概念を説明してください');
    expect(result.primary.tag).toBe('ja');
    expect(result.primary.confidence).toBe(1);
  });

  it('detects Arabic script correctly', () => {
    const result = detector.detect('اشرح مفهوم التكرار في البرمجة وأعطني مثالاً بسيطاً');
    expect(result.primary.tag).toBe('ar');
    expect(result.primary.confidence).toBe(1);
  });

  it('detects Hindi (Devanagari) correctly', () => {
    const result = detector.detect('प्रोग्रामिंग में रिकर्शन की अवधारणा समझाइए');
    expect(result.primary.tag).toBe('hi');
    expect(result.primary.confidence).toBe(1);
  });

  it('detects Bengali script correctly', () => {
    const result = detector.detect('প্রোগ্রামিংয়ে রিকার্সনের ধারণা ব্যাখ্যা করুন');
    expect(result.primary.tag).toBe('bn');
    expect(result.primary.confidence).toBe(1);
  });

  it('detects Tamil script correctly', () => {
    const result = detector.detect('நிரலாக்கத்தில் மறுநிகழ்வு என்ற கருத்தை விளக்குங்கள்');
    expect(result.primary.tag).toBe('ta');
    expect(result.primary.confidence).toBe(1);
  });

  it('falls back to franc for Latin-script languages', () => {
    // Portuguese — Latin script, franc should handle it
    const result = detector.detect('Explique o conceito de recursão na programação e dê um exemplo simples em Python');
    expect(result.isUndetermined).toBe(false);
    // franc should detect Portuguese, not script-based detection
    expect(result.primary.tag).not.toBe('und');
  });

  it('falls back to franc for English', () => {
    const result = detector.detect('Explain the concept of recursion in programming and give a simple example');
    expect(result.primary.tag).toBe('en');
    expect(result.isUndetermined).toBe(false);
  });

  it('handles mixed Thai + English text', () => {
    const result = detector.detect('อธิบาย bubble sort algorithm ว่าทำไมถึงช้า');
    expect(result.primary.tag).toBe('th');
    expect(result.primary.confidence).toBe(1);
  });

  it('handles mixed Korean + English text', () => {
    const result = detector.detect('bubble sort가 왜 O(n²)인지 설명해주세요');
    expect(result.primary.tag).toBe('ko');
    expect(result.primary.confidence).toBe(1);
  });

  it('still returns undetermined for very short text', () => {
    const result = detector.detect('สวัสดี');
    expect(result.isUndetermined).toBe(true);
  });

  it('handles Cyrillic as Russian by default', () => {
    const result = detector.detect('Объясните концепцию рекурсии в программировании');
    expect(result.primary.tag).toBe('ru');
    expect(result.primary.confidence).toBe(1);
  });
});
