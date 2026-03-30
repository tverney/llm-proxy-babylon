import type { TaskCategory, ClassificationResult } from '../models/types.ts';

/**
 * Keyword/heuristic patterns for each task category.
 * Each entry maps a category to an array of regex patterns and their weight.
 */
const CATEGORY_PATTERNS: Array<{
  category: TaskCategory;
  patterns: Array<{ regex: RegExp; weight: number }>;
}> = [
  {
    category: 'math',
    patterns: [
      { regex: /\b(calculate|compute|solve|equation|integral|derivative|sum|product|factorial|algebra|arithmetic|geometry|trigonometry|calculus|probability|statistics|matrix|vector)\b/i, weight: 0.6 },
      { regex: /[+\-*/^=<>]{2,}|\\frac|\\sqrt|\\sum|\\int|\d+\s*[+\-*/^]\s*\d+/, weight: 0.5 },
      { regex: /\b(proof|theorem|lemma|corollary|conjecture|hypothesis)\b/i, weight: 0.4 },
      { regex: /\b(how much|how many|what is \d|find the value)\b/i, weight: 0.3 },
    ],
  },
  {
    category: 'reasoning',
    patterns: [
      { regex: /\b(reason|reasoning|logic|logical|deduce|infer|conclude|analyze|analysis|evaluate|compare|contrast|explain why|think step by step|chain of thought)\b/i, weight: 0.5 },
      { regex: /\b(if .+ then|therefore|because|hence|thus|consequently|implies|assumption|premise)\b/i, weight: 0.4 },
      { regex: /\b(pros and cons|advantages|disadvantages|trade-?offs?|critical thinking)\b/i, weight: 0.3 },
      { regex: /\b(what would happen|why does|why is|how does .+ work)\b/i, weight: 0.3 },
    ],
  },
  {
    category: 'code-generation',
    patterns: [
      { regex: /\b(write|generate|create|implement|code|program|script|function|class|method|api|endpoint|algorithm)\b.*\b(in|using|with)\b.*\b(python|javascript|typescript|java|c\+\+|rust|go|ruby|php|swift|kotlin|sql|html|css)\b/i, weight: 0.7 },
      { regex: /\b(write|generate|create|implement)\b.*\b(code|function|class|method|script|program|module|component)\b/i, weight: 0.5 },
      { regex: /\b(refactor|debug|fix the code|optimize the code|unit test|test case)\b/i, weight: 0.4 },
      { regex: /```[\s\S]*```/, weight: 0.3 },
      { regex: /\b(import|export|require|def |class |function |const |let |var |public |private )\b/, weight: 0.3 },
    ],
  },
  {
    category: 'creative-writing',
    patterns: [
      { regex: /\b(write|compose|create|draft)\b.*\b(story|poem|essay|article|blog|novel|song|lyrics|script|dialogue|narrative|fiction)\b/i, weight: 0.6 },
      { regex: /\b(creative|imaginative|fictional|poetic|literary|metaphor|simile)\b/i, weight: 0.4 },
      { regex: /\b(once upon a time|in a world where|imagine|picture this)\b/i, weight: 0.4 },
      { regex: /\b(tone|voice|style|genre|character|plot|setting|theme)\b/i, weight: 0.2 },
    ],
  },
  {
    category: 'translation',
    patterns: [
      { regex: /\b(translate|translation|interpret|convert)\b.*\b(to|into|from)\b.*\b(english|spanish|french|german|chinese|japanese|korean|portuguese|arabic|russian|hindi|italian|dutch)\b/i, weight: 0.8 },
      { regex: /\b(translate|translation)\b/i, weight: 0.5 },
      { regex: /\b(how do you say|what is .+ in .+(language|tongue))\b/i, weight: 0.5 },
    ],
  },
  {
    category: 'summarization',
    patterns: [
      { regex: /\b(summarize|summary|summarise|tldr|tl;dr|brief|overview|recap|condense|shorten|abridge)\b/i, weight: 0.6 },
      { regex: /\b(key points|main ideas|highlights|takeaways|in a nutshell|in short)\b/i, weight: 0.4 },
      { regex: /\b(give me the gist|boil down|distill)\b/i, weight: 0.4 },
    ],
  },
  {
    category: 'culturally-specific',
    patterns: [
      { regex: /\b(culture|cultural|tradition|traditional|custom|customs|ritual|festival|holiday|celebration|heritage|folklore|mythology)\b/i, weight: 0.5 },
      { regex: /\b(local cuisine|regional dish|national dish|street food|traditional food|traditional medicine)\b/i, weight: 0.5 },
      { regex: /\b(idiom|proverb|saying|slang|colloquial|dialect|vernacular)\b/i, weight: 0.5 },
      { regex: /\b(etiquette|manners|social norm|taboo|superstition)\b/i, weight: 0.4 },
      { regex: /\b(religion|religious|spiritual|sacred|holy|worship|prayer)\b/i, weight: 0.3 },
    ],
  },
];

/**
 * Heuristic-based content classifier that identifies task categories
 * from prompt text using keyword pattern matching.
 *
 * Requirements: 3.1, 3.2, 3.3
 */
export class ContentClassifier {
  /**
   * Classify a prompt into one or more task categories with confidence scores.
   *
   * - Scans the text against keyword/regex patterns for each category.
   * - Aggregates weighted matches into a confidence score clamped to [0.0, 1.0].
   * - Always returns at least one category ('general' as fallback).
   * - The primaryCategory is the one with the highest confidence.
   */
  classify(text: string): ClassificationResult {
    const scores = new Map<TaskCategory, number>();

    for (const { category, patterns } of CATEGORY_PATTERNS) {
      let score = 0;
      for (const { regex, weight } of patterns) {
        if (regex.test(text)) {
          score += weight;
        }
      }
      if (score > 0) {
        // Clamp to [0.0, 1.0]
        scores.set(category, Math.min(score, 1.0));
      }
    }

    // Build sorted categories array (descending by confidence)
    const categories: ClassificationResult['categories'] = [];
    for (const [category, confidence] of scores) {
      categories.push({ category, confidence });
    }
    categories.sort((a, b) => b.confidence - a.confidence);

    // Fallback: if nothing matched, return 'general' with confidence 1.0
    if (categories.length === 0) {
      categories.push({ category: 'general', confidence: 1.0 });
    }

    return {
      categories,
      primaryCategory: categories[0].category,
    };
  }
}
