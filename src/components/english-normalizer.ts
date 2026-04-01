/**
 * Non-Native English Normalizer
 *
 * Detects and normalizes non-native English patterns to improve LLM response quality.
 * Research shows LLMs give lower-quality responses to non-native English speakers,
 * even when writing in English (Reusens et al., "Native Design Bias", 2024).
 *
 * This normalizer rephrases common non-native patterns into standard English
 * before sending to the LLM, closing the quality gap across English dialects.
 *
 * Currently supports: Brazilian English patterns
 * Extensible to other L1 backgrounds (Spanish, Hindi, Japanese, etc.)
 */

export interface NormalizationResult {
  normalized: string;
  wasNormalized: boolean;
  patternsFound: string[];
  confidence: number;  // 0-1, how confident we are this is non-native English
}

/**
 * A pattern rule: regex to match, replacement, and a label for debugging.
 */
interface PatternRule {
  pattern: RegExp;
  replacement: string;
  label: string;
}

/**
 * Brazilian English patterns — common errors from Portuguese L1 speakers.
 * Based on contrastive analysis of Portuguese-English interference.
 */
const BRAZILIAN_ENGLISH_PATTERNS: PatternRule[] = [
  // False cognates and calques
  { pattern: /\bactually\b(?=.*\b(currently|nowadays)\b)/gi, replacement: 'currently', label: 'false-cognate: actually→currently' },
  { pattern: /\bpretend(?:s|ed|ing)?\s+to\b/gi, replacement: 'intend$1 to', label: 'false-cognate: pretend→intend' },
  { pattern: /\bin the\s+actually\b/gi, replacement: 'currently', label: 'calque: in the actually→currently' },

  // Preposition errors (Portuguese interference)
  { pattern: /\bdepends\s+of\b/gi, replacement: 'depends on', label: 'preposition: depends of→depends on' },
  { pattern: /\bconsist\s+in\b/gi, replacement: 'consist of', label: 'preposition: consist in→consist of' },
  { pattern: /\binterested\s+in\s+to\b/gi, replacement: 'interested in', label: 'preposition: interested in to→interested in' },
  { pattern: /\bmarried\s+with\b/gi, replacement: 'married to', label: 'preposition: married with→married to' },
  { pattern: /\bgo\s+to\s+home\b/gi, replacement: 'go home', label: 'preposition: go to home→go home' },
  { pattern: /\bin\s+the\s+last\s+time\b/gi, replacement: 'last time', label: 'calque: in the last time→last time' },
  { pattern: /\bfor\s+to\b/gi, replacement: 'to', label: 'preposition: for to→to' },
  { pattern: /\bexplain\s+me\b/gi, replacement: 'explain to me', label: 'preposition: explain me→explain to me' },
  { pattern: /\bsay\s+me\b/gi, replacement: 'tell me', label: 'verb: say me→tell me' },

  // Article errors
  { pattern: /\bthe\s+people\s+is\b/gi, replacement: 'people are', label: 'article+agreement: the people is→people are' },
  { pattern: /\bthe\s+life\s+is\b/gi, replacement: 'life is', label: 'article: the life is→life is' },

  // Verb form errors
  { pattern: /\bI\s+have\s+(\d+)\s+years\b/gi, replacement: 'I am $1 years old', label: 'calque: I have X years→I am X years old' },
  { pattern: /\bmake\s+a\s+question\b/gi, replacement: 'ask a question', label: 'calque: make a question→ask a question' },
  { pattern: /\bdo\s+a\s+question\b/gi, replacement: 'ask a question', label: 'calque: do a question→ask a question' },
  { pattern: /\bhave\s+a\s+doubt\b/gi, replacement: 'have a question', label: 'calque: have a doubt→have a question' },
  { pattern: /\bI\s+stay\s+in\b/gi, replacement: 'I am in', label: 'calque: I stay in→I am in' },
  { pattern: /\bis\s+it\s+possible\s+to\s+you\b/gi, replacement: 'can you', label: 'calque: is it possible to you→can you' },

  // Word order (Portuguese SVO with adjective after noun)
  { pattern: /\bthe\s+car\s+red\b/gi, replacement: 'the red car', label: 'word-order: car red→red car' },

  // Common spelling/word confusion
  { pattern: /\buntil\s+now\b/gi, replacement: 'so far', label: 'calque: until now→so far' },
  { pattern: /\bsince\s+ever\b/gi, replacement: 'since always', label: 'calque: since ever→since always' },
  { pattern: /\bfor\s+while\b/gi, replacement: 'for a while', label: 'article-omission: for while→for a while' },
  { pattern: /\bin\s+the\s+begin\b/gi, replacement: 'in the beginning', label: 'calque: in the begin→in the beginning' },
  { pattern: /\bmore\s+easy\b/gi, replacement: 'easier', label: 'comparative: more easy→easier' },
  { pattern: /\bmore\s+big\b/gi, replacement: 'bigger', label: 'comparative: more big→bigger' },
  { pattern: /\bmore\s+good\b/gi, replacement: 'better', label: 'comparative: more good→better' },
];

/**
 * Detect Brazilian English patterns in text.
 * Returns a confidence score based on pattern density.
 */
function detectBrazilianPatterns(text: string): { patterns: string[]; confidence: number } {
  const patterns: string[] = [];

  for (const rule of BRAZILIAN_ENGLISH_PATTERNS) {
    if (rule.pattern.test(text)) {
      patterns.push(rule.label);
      // Reset regex lastIndex since we use /g flag
      rule.pattern.lastIndex = 0;
    }
  }

  // Confidence based on pattern density relative to text length
  const wordCount = text.split(/\s+/).length;
  const confidence = wordCount > 0
    ? Math.min(patterns.length / Math.max(wordCount / 20, 1), 1)
    : 0;

  return { patterns, confidence };
}

export class EnglishNormalizer {
  private minConfidence: number;

  constructor(minConfidence: number = 0.1) {
    this.minConfidence = minConfidence;
  }

  /**
   * Normalize non-native English patterns in text.
   * Only applies normalization if confidence exceeds the threshold.
   */
  normalize(text: string): NormalizationResult {
    const { patterns, confidence } = detectBrazilianPatterns(text);

    if (patterns.length === 0 || confidence < this.minConfidence) {
      return {
        normalized: text,
        wasNormalized: false,
        patternsFound: [],
        confidence: 0,
      };
    }

    let normalized = text;
    const appliedPatterns: string[] = [];

    for (const rule of BRAZILIAN_ENGLISH_PATTERNS) {
      const before = normalized;
      normalized = normalized.replace(rule.pattern, rule.replacement);
      rule.pattern.lastIndex = 0; // reset /g flag
      if (normalized !== before) {
        appliedPatterns.push(rule.label);
      }
    }

    return {
      normalized,
      wasNormalized: appliedPatterns.length > 0,
      patternsFound: appliedPatterns,
      confidence,
    };
  }

  /**
   * Normalize all messages in a conversation.
   */
  normalizeMessages(
    messages: Array<{ role: string; content: string }>,
  ): {
    messages: Array<{ role: string; content: string }>;
    totalPatternsFound: string[];
    anyNormalized: boolean;
  } {
    const totalPatternsFound: string[] = [];
    let anyNormalized = false;

    const normalized = messages.map(msg => {
      // Only normalize user messages — don't touch system or assistant messages
      if (msg.role !== 'user') return msg;

      const result = this.normalize(msg.content);
      if (result.wasNormalized) {
        anyNormalized = true;
        totalPatternsFound.push(...result.patternsFound);
        return { ...msg, content: result.normalized };
      }
      return msg;
    });

    return { messages: normalized, totalPatternsFound, anyNormalized };
  }
}
