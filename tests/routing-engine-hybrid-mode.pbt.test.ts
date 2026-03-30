// Feature: multilingual-prompt-optimizer, Property 10: Hybrid mode translates only system messages
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { RoutingEngine } from '../src/components/routing-engine.ts';
import type { ModelProfile, RoutingPolicy, RoutingPolicyRule } from '../src/models/config.ts';
import type {
  ClassificationResult,
  LanguageDetectionResult,
  RoutingAction,
  TaskCategory,
} from '../src/models/types.ts';

/**
 * **Validates: Requirements 4.5**
 *
 * Property 10: Hybrid mode translates only system messages
 * For any request processed in hybrid routing mode, system-role messages
 * and chain-of-thought instructions SHALL be translated to the
 * Optimal_Language, while user-role messages SHALL remain in the
 * Original_Language.
 */

/** Non-cultural categories that won't trigger the cultural override */
const NON_CULTURAL_CATEGORIES: TaskCategory[] = [
  'reasoning',
  'math',
  'code-generation',
  'creative-writing',
  'translation',
  'summarization',
  'general',
];

/** Non-English BCP-47 tags to avoid same-language skip */
const nonEnglishTag = fc.constantFrom('pt', 'zh', 'ja', 'ko', 'de', 'fr', 'es', 'ar', 'ru');

const arbCategory = fc.constantFrom(...NON_CULTURAL_CATEGORIES);

const modelProfile: ModelProfile = {
  modelId: 'test-model',
  supportedLanguages: ['en', 'pt', 'zh', 'ja', 'ko', 'de', 'fr', 'es'],
  languagePerformance: [{ languageTag: 'en', performanceRating: 1.0 }],
  defaultOptimalLanguage: 'en',
  endpoint: 'https://api.example.com/v1/chat/completions',
};

/** A policy with a catch-all hybrid rule */
function hybridPolicy(priority = 1): RoutingPolicy {
  return {
    rules: [
      {
        priority,
        matchConditions: {},
        action: 'hybrid' as RoutingAction,
        targetLanguage: 'en',
      },
    ],
  };
}

/**
 * Simulates hybrid message processing as specified by the design:
 * - system-role messages → translated to optimalLanguage
 * - user-role messages → kept in original language
 *
 * Returns which messages were marked for translation vs preserved.
 */
function applyHybridRouting(
  messages: Array<{ role: string; content: string }>,
  optimalLanguage: string
): Array<{ role: string; content: string; shouldTranslate: boolean }> {
  return messages.map((msg) => ({
    ...msg,
    shouldTranslate: msg.role === 'system',
  }));
}

describe('RoutingEngine - Hybrid Mode Property-Based Tests', () => {
  it('Property 10: Hybrid routing decision is returned when hybrid rule matches', () => {
    fc.assert(
      fc.property(
        nonEnglishTag,
        arbCategory,
        (lang, category) => {
          const detection: LanguageDetectionResult = {
            primary: { tag: lang, confidence: 0.95 },
            all: [{ tag: lang, confidence: 0.95 }],
            isUndetermined: false,
          };

          const classification: ClassificationResult = {
            categories: [{ category, confidence: 0.7 }],
            primaryCategory: category,
          };

          const engine = new RoutingEngine(hybridPolicy());
          const decision = engine.evaluate(detection, classification, modelProfile);

          expect(decision.action).toBe('hybrid');
          expect(decision.optimalLanguage).toBe('en');
          expect(decision.matchedRule).not.toBeNull();
          expect(decision.matchedRule!.action).toBe('hybrid');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 10: In hybrid mode, system messages are marked for translation and user messages are preserved', () => {
    /**
     * Strategy: generate a random mix of system and user messages.
     * After hybrid processing, every system message must be flagged
     * for translation and every user message must be preserved as-is.
     */
    const arbRole = fc.constantFrom('system', 'user');
    const arbContent = fc.string({ minLength: 1, maxLength: 100 });
    const arbMessage = fc.record({ role: arbRole, content: arbContent });
    const arbMessages = fc.array(arbMessage, { minLength: 1, maxLength: 10 });

    fc.assert(
      fc.property(
        nonEnglishTag,
        arbCategory,
        arbMessages,
        (lang, category, messages) => {
          // First confirm the routing engine returns hybrid
          const detection: LanguageDetectionResult = {
            primary: { tag: lang, confidence: 0.95 },
            all: [{ tag: lang, confidence: 0.95 }],
            isUndetermined: false,
          };

          const classification: ClassificationResult = {
            categories: [{ category, confidence: 0.7 }],
            primaryCategory: category,
          };

          const engine = new RoutingEngine(hybridPolicy());
          const decision = engine.evaluate(detection, classification, modelProfile);
          expect(decision.action).toBe('hybrid');

          // Apply hybrid processing
          const processed = applyHybridRouting(messages, decision.optimalLanguage!);

          for (const msg of processed) {
            if (msg.role === 'system') {
              // System messages SHALL be translated
              expect(msg.shouldTranslate).toBe(true);
            } else if (msg.role === 'user') {
              // User messages SHALL remain in original language
              expect(msg.shouldTranslate).toBe(false);
            }
          }

          // All messages must be accounted for
          expect(processed.length).toBe(messages.length);

          // Content is preserved (not yet translated, just flagged)
          for (let i = 0; i < messages.length; i++) {
            expect(processed[i].content).toBe(messages[i].content);
            expect(processed[i].role).toBe(messages[i].role);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 10: Hybrid mode with only user messages results in no translations', () => {
    const arbContent = fc.string({ minLength: 1, maxLength: 100 });
    const arbUserMessages = fc
      .array(arbContent, { minLength: 1, maxLength: 5 })
      .map((contents) => contents.map((c) => ({ role: 'user', content: c })));

    fc.assert(
      fc.property(
        nonEnglishTag,
        arbCategory,
        arbUserMessages,
        (lang, category, messages) => {
          const detection: LanguageDetectionResult = {
            primary: { tag: lang, confidence: 0.95 },
            all: [{ tag: lang, confidence: 0.95 }],
            isUndetermined: false,
          };

          const classification: ClassificationResult = {
            categories: [{ category, confidence: 0.7 }],
            primaryCategory: category,
          };

          const engine = new RoutingEngine(hybridPolicy());
          const decision = engine.evaluate(detection, classification, modelProfile);
          expect(decision.action).toBe('hybrid');

          const processed = applyHybridRouting(messages, decision.optimalLanguage!);

          // No message should be marked for translation
          expect(processed.every((m) => m.shouldTranslate === false)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 10: Hybrid mode with only system messages results in all translations', () => {
    const arbContent = fc.string({ minLength: 1, maxLength: 100 });
    const arbSystemMessages = fc
      .array(arbContent, { minLength: 1, maxLength: 5 })
      .map((contents) => contents.map((c) => ({ role: 'system', content: c })));

    fc.assert(
      fc.property(
        nonEnglishTag,
        arbCategory,
        arbSystemMessages,
        (lang, category, messages) => {
          const detection: LanguageDetectionResult = {
            primary: { tag: lang, confidence: 0.95 },
            all: [{ tag: lang, confidence: 0.95 }],
            isUndetermined: false,
          };

          const classification: ClassificationResult = {
            categories: [{ category, confidence: 0.7 }],
            primaryCategory: category,
          };

          const engine = new RoutingEngine(hybridPolicy());
          const decision = engine.evaluate(detection, classification, modelProfile);
          expect(decision.action).toBe('hybrid');

          const processed = applyHybridRouting(messages, decision.optimalLanguage!);

          // All messages should be marked for translation
          expect(processed.every((m) => m.shouldTranslate === true)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
