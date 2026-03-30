import type { LLMRequest, LLMResponse, QualityScore, QualityComparison } from '../models/types.ts';
import type { RoutingPolicyRule } from '../models/config.ts';
import type { LLMForwarder } from './llm-forwarder.ts';

export interface ShadowEvaluatorConfig {
  /** Global enable/disable for shadow evaluation. Default: false */
  enabled: boolean;
  /** Threshold above which a quality degradation warning is logged. Default: 0.1 */
  degradationThreshold: number;
  /** Weights for computing the overall quality score */
  weights: {
    coherence: number;
    completeness: number;
    factualConsistency: number;
    instructionAdherence: number;
  };
}

const DEFAULT_CONFIG: ShadowEvaluatorConfig = {
  enabled: false,
  degradationThreshold: 0.1,
  weights: {
    coherence: 0.25,
    completeness: 0.25,
    factualConsistency: 0.25,
    instructionAdherence: 0.25,
  },
};

export class ShadowEvaluator {
  private config: ShadowEvaluatorConfig;

  constructor(config?: Partial<ShadowEvaluatorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (config?.weights) {
      this.config.weights = { ...DEFAULT_CONFIG.weights, ...config.weights };
    }
  }

  /**
   * Check whether shadow evaluation is enabled for a given routing rule.
   * Per-rule `shadowEvaluation` overrides the global setting.
   */
  isEnabled(routingRule: RoutingPolicyRule | null): boolean {
    if (routingRule?.shadowEvaluation !== undefined) {
      return routingRule.shadowEvaluation;
    }
    return this.config.enabled;
  }

  /**
   * Perform a shadow evaluation by sending the original (untranslated) prompt
   * to the LLM and comparing the baseline response quality against the
   * translated-path response.
   */
  async evaluate(
    originalPrompt: LLMRequest,
    translatedResponse: LLMResponse,
    forwarder: LLMForwarder,
    endpoint: string,
  ): Promise<QualityComparison> {
    // Send the original untranslated prompt as a baseline request
    const baselineResponse = await forwarder.forward(originalPrompt, endpoint);

    const translatedScore = this.computeQualityScore(translatedResponse);
    const baselineScore = this.computeQualityScore(baselineResponse);
    const delta = translatedScore.overall - baselineScore.overall;
    const translationImproved = delta > 0;

    // Log warning when baseline outperforms translated by more than threshold
    if (baselineScore.overall - translatedScore.overall > this.config.degradationThreshold) {
      console.warn(
        `[ShadowEvaluator] Quality degradation detected: baseline overall=${baselineScore.overall.toFixed(3)}, ` +
        `translated overall=${translatedScore.overall.toFixed(3)}, ` +
        `delta=${delta.toFixed(3)} (threshold: ${this.config.degradationThreshold})`,
      );
    }

    return {
      translatedScore,
      baselineScore,
      delta,
      translationImproved,
    };
  }

  /**
   * Compute a quality score for an LLM response.
   * Uses heuristic signals derived from the response content.
   */
  computeQualityScore(response: LLMResponse): QualityScore {
    const content = response.content ?? '';

    const coherence = this.measureCoherence(content);
    const completeness = this.measureCompleteness(content);
    const factualConsistency = this.measureFactualConsistency(content);
    const instructionAdherence = this.measureInstructionAdherence(content);

    const w = this.config.weights;
    const overall = clamp(
      w.coherence * coherence +
      w.completeness * completeness +
      w.factualConsistency * factualConsistency +
      w.instructionAdherence * instructionAdherence,
      0,
      1,
    );

    return { coherence, completeness, factualConsistency, instructionAdherence, overall };
  }

  // --- Heuristic scoring helpers ---

  /**
   * Coherence: measures structural quality via sentence count, average sentence
   * length, and presence of logical connectors.
   */
  private measureCoherence(content: string): number {
    if (!content.trim()) return 0;
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const sentenceCount = Math.min(sentences.length / 10, 1);
    const avgLen = sentences.reduce((sum, s) => sum + s.trim().length, 0) / Math.max(sentences.length, 1);
    const lengthScore = clamp(avgLen / 100, 0, 1);
    const connectors = /\b(however|therefore|furthermore|additionally|moreover|consequently|thus|hence)\b/gi;
    const connectorScore = clamp((content.match(connectors)?.length ?? 0) / 5, 0, 1);
    return clamp((sentenceCount + lengthScore + connectorScore) / 3, 0, 1);
  }

  /**
   * Completeness: measures response length relative to a reasonable baseline.
   */
  private measureCompleteness(content: string): number {
    if (!content.trim()) return 0;
    const words = content.split(/\s+/).length;
    return clamp(words / 200, 0, 1);
  }

  /**
   * Factual consistency: proxy via presence of specific/concrete details
   * (numbers, proper nouns, technical terms).
   */
  private measureFactualConsistency(content: string): number {
    if (!content.trim()) return 0;
    const numbers = (content.match(/\d+/g) ?? []).length;
    const quotes = (content.match(/[""].+?[""]|".+?"/g) ?? []).length;
    const technicalTerms = (content.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g) ?? []).length; // CamelCase
    const score = (numbers + quotes + technicalTerms) / 15;
    return clamp(score, 0, 1);
  }

  /**
   * Instruction adherence: measures whether the response appears to follow
   * instructions (structured output, lists, headings, code blocks).
   */
  private measureInstructionAdherence(content: string): number {
    if (!content.trim()) return 0;
    let score = 0.3; // base score for non-empty response
    if (/^\s*[-*]\s/m.test(content)) score += 0.2;       // bullet lists
    if (/^\s*\d+\.\s/m.test(content)) score += 0.2;      // numbered lists
    if (/^#{1,6}\s/m.test(content)) score += 0.15;        // headings
    if (/```[\s\S]*?```/.test(content)) score += 0.15;    // code blocks
    return clamp(score, 0, 1);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
