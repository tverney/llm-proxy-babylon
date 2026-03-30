import { describe, it, expect } from 'vitest';
import { LanguageDetector } from '../src/components/language-detector.ts';

describe('LanguageDetector', () => {
  const detector = new LanguageDetector();

  it('detects English text', () => {
    const result = detector.detect('This is a test sentence in English for language detection');
    expect(result.primary.tag).toBe('en');
    expect(result.primary.confidence).toBeGreaterThan(0);
    expect(result.primary.confidence).toBeLessThanOrEqual(1);
    expect(result.isUndetermined).toBe(false);
  });

  it('detects Portuguese text', () => {
    const result = detector.detect('Esta é uma frase em português para testar a detecção de idioma');
    expect(result.primary.tag).toBe('pt');
    expect(result.isUndetermined).toBe(false);
  });

  it('returns undetermined for short text (<10 chars)', () => {
    expect(detector.detect('hi').isUndetermined).toBe(true);
    expect(detector.detect('').isUndetermined).toBe(true);
    expect(detector.detect('123456789').isUndetermined).toBe(true);
  });

  it('returns undetermined for whitespace-only text', () => {
    expect(detector.detect('         ').isUndetermined).toBe(true);
  });

  it('returns multiple detected languages in all array', () => {
    const result = detector.detect('This is a test sentence in English for language detection');
    expect(result.all.length).toBeGreaterThan(1);
    result.all.forEach(lang => {
      expect(lang.confidence).toBeGreaterThanOrEqual(0);
      expect(lang.confidence).toBeLessThanOrEqual(1);
      expect(typeof lang.tag).toBe('string');
    });
  });

  it('returns undetermined when all confidences below threshold', () => {
    const d = new LanguageDetector();
    d.setConfidenceThreshold(1.1); // impossibly high threshold
    const result = d.detect('This is a test sentence in English for language detection');
    expect(result.isUndetermined).toBe(true);
    // Still returns detected languages even when undetermined
    expect(result.all.length).toBeGreaterThan(0);
  });

  it('allows configuring confidence threshold', () => {
    const d = new LanguageDetector();
    d.setConfidenceThreshold(0.5);
    const result = d.detect('This is a test sentence in English for language detection');
    expect(result.isUndetermined).toBe(false);
  });
});
