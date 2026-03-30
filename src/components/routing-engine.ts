import type { ModelProfile, RoutingPolicy, RoutingPolicyRule } from '../models/config.ts';
import type {
  ClassificationResult,
  LanguageDetectionResult,
  RoutingDecision,
} from '../models/types.ts';

/**
 * RoutingEngine evaluates routing policies against language detection,
 * task classification, and model profile to decide whether and how
 * to translate a prompt.
 *
 * Decision order:
 * 1. Undetermined language → skip
 * 2. Same language as optimal → skip
 * 3. Culturally-specific with confidence > 0.8 → skip
 * 4. Evaluate policy rules in priority order (lowest first), apply first match
 * 5. No match → skip
 */
export class RoutingEngine {
  private rules: RoutingPolicyRule[] = [];

  constructor(policy?: RoutingPolicy) {
    if (policy) {
      this.rules = sortByPriority(policy.rules);
    }
  }

  evaluate(
    detection: LanguageDetectionResult,
    classification: ClassificationResult,
    modelProfile: ModelProfile
  ): RoutingDecision {
    // Undetermined language → skip
    if (detection.isUndetermined) {
      return skip('Language is undetermined; skipping translation');
    }

    const originalLang = detection.primary.tag;
    const optimalLang = modelProfile.defaultOptimalLanguage;

    // Same-language skip (Req 4.1)
    if (originalLang === optimalLang) {
      return skip(`Original language "${originalLang}" matches optimal language`);
    }

    // Culturally-specific override (Req 3.3)
    const culturalEntry = classification.categories.find(
      (c) => c.category === 'culturally-specific'
    );
    if (culturalEntry && culturalEntry.confidence > 0.8) {
      return skip(
        `Culturally-specific content (confidence ${culturalEntry.confidence}); keeping original language`
      );
    }

    // Evaluate policy rules in priority order (Req 4.3)
    for (const rule of this.rules) {
      if (ruleMatches(rule, detection, classification, modelProfile)) {
        const targetLang = rule.targetLanguage ?? optimalLang;
        return {
          action: rule.action,
          optimalLanguage: rule.action === 'skip' ? null : targetLang,
          matchedRule: rule,
          reason: `Matched rule priority ${rule.priority} → ${rule.action}`,
        };
      }
    }

    // No match → skip (Req 4.4)
    return skip('No routing rule matched; defaulting to skip');
  }

  reloadPolicies(policy: RoutingPolicy): void {
    this.rules = sortByPriority(policy.rules);
  }
}


// ── helpers ──────────────────────────────────────────────────────────

function skip(reason: string): RoutingDecision {
  return { action: 'skip', optimalLanguage: null, matchedRule: null, reason };
}

function sortByPriority(rules: RoutingPolicyRule[]): RoutingPolicyRule[] {
  return [...rules].sort((a, b) => a.priority - b.priority);
}

/**
 * Returns true when a rule's match conditions are all satisfied.
 * Omitted conditions are treated as "match any".
 */
function ruleMatches(
  rule: RoutingPolicyRule,
  detection: LanguageDetectionResult,
  classification: ClassificationResult,
  modelProfile: ModelProfile
): boolean {
  const { matchConditions } = rule;

  // Task-type filter
  if (matchConditions.taskTypes && matchConditions.taskTypes.length > 0) {
    const classifiedTypes = classification.categories.map((c) => c.category);
    const hasMatch = matchConditions.taskTypes.some((t) => classifiedTypes.includes(t));
    if (!hasMatch) return false;
  }

  // Source-language pattern (regex)
  if (matchConditions.sourceLanguagePattern) {
    const re = new RegExp(matchConditions.sourceLanguagePattern);
    if (!re.test(detection.primary.tag)) return false;
  }

  // Model-ID pattern (regex)
  if (matchConditions.modelIdPattern) {
    const re = new RegExp(matchConditions.modelIdPattern);
    if (!re.test(modelProfile.modelId)) return false;
  }

  return true;
}
