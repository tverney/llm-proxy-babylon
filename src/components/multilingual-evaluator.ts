import type {
  LLMRequest,
  LLMResponse,
  QualityScore,
  LanguageEvaluationResult,
  EvaluationReport,
  LanguageInstructionConfig,
} from '../models/types.ts';
import type { ModelProfile, LanguagePerformance } from '../models/config.ts';
import type { LLMForwarder } from './llm-forwarder.ts';
import { ShadowEvaluator } from './shadow-evaluator.ts';
import { Translator } from './translator.ts';
import type { TranslatorConfig } from '../models/config.ts';

const BASELINE_LANGUAGE = 'en';

const DEFAULT_LANGUAGE_INSTRUCTION_CONFIG: LanguageInstructionConfig = {
  template: 'Please respond in {{language}} since the original question was asked in {{language}}',
  injectionMode: 'append_to_last_user',
};

export interface MultilingualEvaluatorConfig {
  translatorConfig: TranslatorConfig;
  languageInstructionConfig?: LanguageInstructionConfig;
  autoUpdateProfile?: boolean;
}

export class MultilingualEvaluator {
  private translator: Translator;
  private shadowEvaluator: ShadowEvaluator;
  private languageInstructionConfig: LanguageInstructionConfig;
  private autoUpdateProfile: boolean;

  constructor(config: MultilingualEvaluatorConfig) {
    this.translator = new Translator(config.translatorConfig);
    this.shadowEvaluator = new ShadowEvaluator();
    this.languageInstructionConfig = config.languageInstructionConfig ?? DEFAULT_LANGUAGE_INSTRUCTION_CONFIG;
    this.autoUpdateProfile = config.autoUpdateProfile ?? false;
  }

  /**
   * Evaluate a single prompt across multiple target languages.
   * Translates the prompt into each target language, sends each to the LLM
   * with a language instruction, collects responses, and computes quality scores.
   * Also sends the original English prompt as a baseline.
   *
   * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
   */
  async evaluate(
    prompt: string,
    targetLanguages: string[],
    modelProfile: ModelProfile,
    forwarder: LLMForwarder,
  ): Promise<EvaluationReport> {
    // Send baseline English prompt (Req 12.3)
    const baselineRequest: LLMRequest = {
      model: modelProfile.modelId,
      messages: [{ role: 'user', content: prompt }],
    };
    const baselineResponse = await forwarder.forward(baselineRequest, modelProfile.endpoint, undefined, modelProfile.provider, modelProfile.awsRegion);
    const baselineScore = this.shadowEvaluator.computeQualityScore(baselineResponse);

    // Evaluate each target language (Req 12.2)
    const results: LanguageEvaluationResult[] = await Promise.all(
      targetLanguages.map(async (lang) => {
        return this.evaluateLanguage(prompt, lang, modelProfile, forwarder, baselineScore);
      }),
    );

    // Produce ranking sorted by overall quality descending (Req 12.5)
    const allEntries: Array<{ language: string; overall: number }> = [
      { language: BASELINE_LANGUAGE, overall: baselineScore.overall },
      ...results.map((r) => ({ language: r.language, overall: r.qualityScore.overall })),
    ];
    allEntries.sort((a, b) => b.overall - a.overall);
    const ranking = allEntries.map((e) => e.language);

    // Optionally auto-update ModelProfile performance ratings (Req 12.7)
    if (this.autoUpdateProfile) {
      this.updateModelProfile(modelProfile, baselineScore, results);
    }

    return {
      prompt,
      baselineLanguage: BASELINE_LANGUAGE,
      baselineScore,
      results,
      ranking,
    };
  }

  /**
   * Evaluate multiple prompts in batch (Req 12.6).
   * Returns per-prompt per-language results.
   */
  async evaluateBatch(
    prompts: string[],
    targetLanguages: string[],
    modelProfile: ModelProfile,
    forwarder: LLMForwarder,
  ): Promise<EvaluationReport[]> {
    return Promise.all(
      prompts.map((prompt) => this.evaluate(prompt, targetLanguages, modelProfile, forwarder)),
    );
  }

  /**
   * Evaluate a single language for a given prompt.
   * Translates the prompt, builds an LLM request with language instruction,
   * sends to LLM, and computes quality score.
   */
  private async evaluateLanguage(
    prompt: string,
    language: string,
    modelProfile: ModelProfile,
    forwarder: LLMForwarder,
    baselineScore: QualityScore,
  ): Promise<LanguageEvaluationResult> {
    // Translate prompt to target language
    const translationResult = await this.translator.translate(prompt, BASELINE_LANGUAGE, language);

    // Build language instruction
    const instruction = this.translator.buildLanguageInstruction(
      language,
      this.languageInstructionConfig,
    );

    // Build LLM request with translated prompt + language instruction
    const translatedContent = `${translationResult.translatedText}\n\n${instruction}`;
    const request: LLMRequest = {
      model: modelProfile.modelId,
      messages: [{ role: 'user', content: translatedContent }],
    };

    // Send to LLM
    const response = await forwarder.forward(request, modelProfile.endpoint, undefined, modelProfile.provider, modelProfile.awsRegion);

    // Compute quality score (Req 12.4)
    const qualityScore = this.shadowEvaluator.computeQualityScore(response);

    // deltaFromBaseline = language's overall score - baseline's overall score
    const deltaFromBaseline = qualityScore.overall - baselineScore.overall;

    return {
      language,
      response,
      qualityScore,
      deltaFromBaseline,
    };
  }

  /**
   * Auto-update ModelProfile performance ratings from evaluation results (Req 12.7).
   * Updates the languagePerformance array entries with new performanceRating values
   * derived from evaluation results. The baseline language gets a rating of 1.0,
   * and other languages get their overall score relative to the baseline.
   */
  private updateModelProfile(
    modelProfile: ModelProfile,
    baselineScore: QualityScore,
    results: LanguageEvaluationResult[],
  ): void {
    const baselineOverall = baselineScore.overall;

    for (const result of results) {
      const rating = baselineOverall > 0
        ? Math.min(result.qualityScore.overall / baselineOverall, 1.0)
        : result.qualityScore.overall;

      const existing = modelProfile.languagePerformance.find(
        (lp) => lp.languageTag === result.language,
      );

      if (existing) {
        existing.performanceRating = rating;
      } else {
        modelProfile.languagePerformance.push({
          languageTag: result.language,
          performanceRating: rating,
        });
      }
    }

    // Ensure baseline language has rating 1.0
    const baselineEntry = modelProfile.languagePerformance.find(
      (lp) => lp.languageTag === BASELINE_LANGUAGE,
    );
    if (baselineEntry) {
      baselineEntry.performanceRating = 1.0;
    } else {
      modelProfile.languagePerformance.push({
        languageTag: BASELINE_LANGUAGE,
        performanceRating: 1.0,
      });
    }
  }
}
