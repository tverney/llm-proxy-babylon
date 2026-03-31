import type { ModelProfile, RoutingPolicy, RoutingPolicyRule } from '../models/config.ts';
import type {
  ClassificationResult,
  LanguageDetectionResult,
  RoutingDecision,
} from '../models/types.ts';
import { AdaptiveRouter } from './adaptive-router.ts';

/**
 * A routing resolver is a single step in the resolution chain.
 * It either returns a RoutingDecision or null to defer to the next resolver.
 */
export type RoutingResolver = (ctx: RoutingContext) => RoutingDecision | null;

/**
 * Context passed through the resolution chain.
 */
export interface RoutingContext {
  detection: LanguageDetectionResult;
  classification: ClassificationResult;
  modelProfile: ModelProfile;
  originalLang: string;
  optimalLang: string;
}

/**
 * Trace entry for debugging — shows which resolvers were evaluated and what they decided.
 */
export interface RoutingTraceEntry {
  resolver: string;
  result: 'decided' | 'deferred';
  decision?: RoutingDecision;
}

/**
 * RoutingEngine evaluates a chain of resolvers to decide whether and how
 * to translate a prompt. Each resolver either returns a decision or defers
 * to the next one in the chain.
 *
 * Default resolution chain:
 * 1. Undetermined language → skip
 * 2. Same language as optimal → skip
 * 3. Culturally-specific override → skip
 * 4. Adaptive learned data → translate/skip based on quality history
 * 5. Static routing rules → first matching rule
 * 6. Default → skip
 */
export class RoutingEngine {
  private chain: Array<{ name: string; resolver: RoutingResolver }> = [];
  private rules: RoutingPolicyRule[] = [];
  private adaptiveRouter?: AdaptiveRouter;
  private lastTrace: RoutingTraceEntry[] = [];

  constructor(policy?: RoutingPolicy, adaptiveRouter?: AdaptiveRouter) {
    if (policy) {
      this.rules = sortByPriority(policy.rules);
    }
    this.adaptiveRouter = adaptiveRouter;
    this.buildDefaultChain();
  }

  /**
   * Build the default resolution chain.
   */
  private buildDefaultChain(): void {
    this.chain = [
      { name: 'undetermined', resolver: resolveUndetermined },
      { name: 'same-language', resolver: resolveSameLanguage },
      { name: 'cultural-override', resolver: resolveCulturalOverride },
      { name: 'adaptive', resolver: (ctx) => this.resolveAdaptive(ctx) },
      { name: 'static-rules', resolver: (ctx) => this.resolveStaticRules(ctx) },
      { name: 'default', resolver: resolveDefault },
    ];
  }

  /**
   * Evaluate the resolution chain. Returns the first non-null decision.
   * Builds a trace of which resolvers were consulted.
   */
  evaluate(
    detection: LanguageDetectionResult,
    classification: ClassificationResult,
    modelProfile: ModelProfile
  ): RoutingDecision {
    const ctx: RoutingContext = {
      detection,
      classification,
      modelProfile,
      originalLang: detection.primary.tag,
      optimalLang: modelProfile.defaultOptimalLanguage,
    };

    this.lastTrace = [];

    for (const { name, resolver } of this.chain) {
      const decision = resolver(ctx);
      if (decision) {
        this.lastTrace.push({ resolver: name, result: 'decided', decision });
        return decision;
      }
      this.lastTrace.push({ resolver: name, result: 'deferred' });
    }

    // Should never reach here — default resolver always returns
    return skip('Resolution chain exhausted; defaulting to skip');
  }

  /**
   * Get the trace from the last evaluate() call.
   * Shows which resolvers were consulted and which one made the decision.
   */
  getLastTrace(): RoutingTraceEntry[] {
    return [...this.lastTrace];
  }

  /**
   * Adaptive resolver — checks learned recommendations.
   */
  private resolveAdaptive(ctx: RoutingContext): RoutingDecision | null {
    if (!this.adaptiveRouter) return null;

    const recommendation = this.adaptiveRouter.getRecommendation(
      ctx.originalLang,
      ctx.classification.primaryCategory,
    );
    if (!recommendation) return null;

    return {
      action: recommendation,
      optimalLanguage: recommendation === 'skip' ? null : ctx.optimalLang,
      matchedRule: null,
      reason: `Adaptive routing: learned "${recommendation}" for ${ctx.originalLang}+${ctx.classification.primaryCategory}`,
    };
  }

  /**
   * Static rules resolver — evaluates policy rules in priority order.
   */
  private resolveStaticRules(ctx: RoutingContext): RoutingDecision | null {
    for (const rule of this.rules) {
      if (ruleMatches(rule, ctx.detection, ctx.classification, ctx.modelProfile)) {
        const targetLang = rule.targetLanguage ?? ctx.optimalLang;
        return {
          action: rule.action,
          optimalLanguage: rule.action === 'skip' ? null : targetLang,
          matchedRule: rule,
          reason: `Matched rule priority ${rule.priority} → ${rule.action}`,
        };
      }
    }
    return null;
  }

  reloadPolicies(policy: RoutingPolicy): void {
    this.rules = sortByPriority(policy.rules);
  }
}


// ── Built-in resolvers ──────────────────────────────────────────────

function resolveUndetermined(ctx: RoutingContext): RoutingDecision | null {
  if (ctx.detection.isUndetermined) {
    return skip('Language is undetermined; skipping translation');
  }
  return null;
}

function resolveSameLanguage(ctx: RoutingContext): RoutingDecision | null {
  if (ctx.originalLang === ctx.optimalLang) {
    return skip(`Original language "${ctx.originalLang}" matches optimal language`);
  }
  return null;
}

function resolveCulturalOverride(ctx: RoutingContext): RoutingDecision | null {
  const culturalEntry = ctx.classification.categories.find(
    (c) => c.category === 'culturally-specific'
  );
  if (culturalEntry && culturalEntry.confidence > 0.8) {
    return skip(
      `Culturally-specific content (confidence ${culturalEntry.confidence}); keeping original language`
    );
  }
  return null;
}

function resolveDefault(_ctx: RoutingContext): RoutingDecision | null {
  return skip('No routing rule matched; defaulting to skip');
}


// ── Helpers ──────────────────────────────────────────────────────────

function skip(reason: string): RoutingDecision {
  return { action: 'skip', optimalLanguage: null, matchedRule: null, reason };
}

function sortByPriority(rules: RoutingPolicyRule[]): RoutingPolicyRule[] {
  return [...rules].sort((a, b) => a.priority - b.priority);
}

function ruleMatches(
  rule: RoutingPolicyRule,
  detection: LanguageDetectionResult,
  classification: ClassificationResult,
  modelProfile: ModelProfile
): boolean {
  const { matchConditions } = rule;

  if (matchConditions.taskTypes && matchConditions.taskTypes.length > 0) {
    const classifiedTypes = classification.categories.map((c) => c.category);
    const hasMatch = matchConditions.taskTypes.some((t) => classifiedTypes.includes(t));
    if (!hasMatch) return false;
  }

  if (matchConditions.sourceLanguagePattern) {
    const re = new RegExp(matchConditions.sourceLanguagePattern);
    if (!re.test(detection.primary.tag)) return false;
  }

  if (matchConditions.modelIdPattern) {
    const re = new RegExp(matchConditions.modelIdPattern);
    if (!re.test(modelProfile.modelId)) return false;
  }

  return true;
}
