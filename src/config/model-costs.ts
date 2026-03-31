/**
 * Table-driven per-model cost tracking.
 *
 * Cost tiers define input/output price per 1M tokens.
 * Models map to tiers. The cost calculator computes USD cost from token usage.
 */

export interface CostTier {
  inputPer1M: number;   // USD per 1M input tokens
  outputPer1M: number;  // USD per 1M output tokens
}

// Named cost tiers for common pricing brackets
export const COST_TIERS: Record<string, CostTier> = {
  // Amazon Nova
  NOVA_MICRO:    { inputPer1M: 0.035,  outputPer1M: 0.14 },
  NOVA_LITE:     { inputPer1M: 0.06,   outputPer1M: 0.24 },
  NOVA_PRO:      { inputPer1M: 0.80,   outputPer1M: 3.20 },
  NOVA_PREMIER:  { inputPer1M: 2.00,   outputPer1M: 15.00 },

  // Anthropic Claude (Bedrock pricing)
  CLAUDE_HAIKU_3:     { inputPer1M: 0.25,  outputPer1M: 1.25 },
  CLAUDE_HAIKU_35:    { inputPer1M: 0.80,  outputPer1M: 4.00 },
  CLAUDE_SONNET_35:   { inputPer1M: 3.00,  outputPer1M: 15.00 },
  CLAUDE_SONNET_4:    { inputPer1M: 3.00,  outputPer1M: 15.00 },
  CLAUDE_OPUS_4:      { inputPer1M: 15.00, outputPer1M: 75.00 },

  // Meta Llama (Bedrock pricing)
  LLAMA_8B:      { inputPer1M: 0.22,  outputPer1M: 0.22 },
  LLAMA_70B:     { inputPer1M: 0.72,  outputPer1M: 0.72 },
  LLAMA_405B:    { inputPer1M: 2.13,  outputPer1M: 2.13 },
  LLAMA_SCOUT:   { inputPer1M: 0.17,  outputPer1M: 0.17 },
  LLAMA_MAVERICK:{ inputPer1M: 0.20,  outputPer1M: 0.80 },

  // Mistral (Bedrock pricing)
  MISTRAL_7B:    { inputPer1M: 0.15,  outputPer1M: 0.20 },
  MIXTRAL_8X7B:  { inputPer1M: 0.45,  outputPer1M: 0.70 },
  MISTRAL_LARGE: { inputPer1M: 2.00,  outputPer1M: 6.00 },

  // OpenAI
  GPT4O:         { inputPer1M: 2.50,  outputPer1M: 10.00 },
  GPT4O_MINI:    { inputPer1M: 0.15,  outputPer1M: 0.60 },

  // Fallback
  DEFAULT:       { inputPer1M: 1.00,  outputPer1M: 3.00 },
};

/**
 * Maps model ID patterns to cost tiers.
 * Patterns are matched in order — first match wins.
 * Use substring matching for flexibility across versions.
 */
const MODEL_COST_MAP: Array<{ pattern: string; tier: CostTier }> = [
  // Amazon Nova
  { pattern: 'nova-micro',    tier: COST_TIERS.NOVA_MICRO },
  { pattern: 'nova-lite',     tier: COST_TIERS.NOVA_LITE },
  { pattern: 'nova-pro',      tier: COST_TIERS.NOVA_PRO },
  { pattern: 'nova-premier',  tier: COST_TIERS.NOVA_PREMIER },

  // Anthropic Claude
  { pattern: 'claude-3-haiku',       tier: COST_TIERS.CLAUDE_HAIKU_3 },
  { pattern: 'claude-3.5-haiku',     tier: COST_TIERS.CLAUDE_HAIKU_35 },
  { pattern: 'claude-3-5-haiku',     tier: COST_TIERS.CLAUDE_HAIKU_35 },
  { pattern: 'claude-3.5-sonnet',    tier: COST_TIERS.CLAUDE_SONNET_35 },
  { pattern: 'claude-3-5-sonnet',    tier: COST_TIERS.CLAUDE_SONNET_35 },
  { pattern: 'claude-sonnet-4',      tier: COST_TIERS.CLAUDE_SONNET_4 },
  { pattern: 'claude-opus-4',        tier: COST_TIERS.CLAUDE_OPUS_4 },

  // Meta Llama
  { pattern: 'llama-4-scout',        tier: COST_TIERS.LLAMA_SCOUT },
  { pattern: 'llama-4-maverick',     tier: COST_TIERS.LLAMA_MAVERICK },
  { pattern: 'llama-3.3-70b',        tier: COST_TIERS.LLAMA_70B },
  { pattern: 'llama-3.1-405b',       tier: COST_TIERS.LLAMA_405B },
  { pattern: 'llama-3.1-70b',        tier: COST_TIERS.LLAMA_70B },
  { pattern: 'llama-3.1-8b',         tier: COST_TIERS.LLAMA_8B },

  // Mistral
  { pattern: 'mistral-7b',           tier: COST_TIERS.MISTRAL_7B },
  { pattern: 'mixtral-8x7b',         tier: COST_TIERS.MIXTRAL_8X7B },
  { pattern: 'mistral-large',        tier: COST_TIERS.MISTRAL_LARGE },

  // OpenAI
  { pattern: 'gpt-4o-mini',          tier: COST_TIERS.GPT4O_MINI },
  { pattern: 'gpt-4o',               tier: COST_TIERS.GPT4O },
];

/**
 * Look up the cost tier for a model ID.
 * Returns the DEFAULT tier if no pattern matches.
 */
export function getModelCostTier(modelId: string): CostTier {
  const lower = modelId.toLowerCase();
  for (const { pattern, tier } of MODEL_COST_MAP) {
    if (lower.includes(pattern)) return tier;
  }
  return COST_TIERS.DEFAULT;
}

export interface CostBreakdown {
  inputCostUSD: number;
  outputCostUSD: number;
  totalCostUSD: number;
  savedInputCostUSD: number;  // cost saved by token reduction
  tier: CostTier;
  modelId: string;
}

/**
 * Calculate USD cost from token usage and model ID.
 */
export function calculateCost(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
  savedTokens?: number,
): CostBreakdown {
  const tier = getModelCostTier(modelId);
  const inputCostUSD = (promptTokens / 1_000_000) * tier.inputPer1M;
  const outputCostUSD = (completionTokens / 1_000_000) * tier.outputPer1M;
  const savedInputCostUSD = savedTokens
    ? (savedTokens / 1_000_000) * tier.inputPer1M
    : 0;

  return {
    inputCostUSD,
    outputCostUSD,
    totalCostUSD: inputCostUSD + outputCostUSD,
    savedInputCostUSD,
    tier,
    modelId,
  };
}

// ── Formatting ──────────────────────────────────────────────────────

/**
 * Format a USD cost for human-readable display.
 * - >= $1.00     → "$1.23"
 * - >= $0.01     → "$0.05"
 * - >= $0.001    → "$0.0034"
 * - >= $0.000001 → "$0.000012"
 * - < $0.000001  → "< $0.000001"
 * - 0            → "$0.00"
 */
export function formatCostUSD(amount: number): string {
  if (amount === 0) return '$0.00';
  if (amount < 0.000001) return '< $0.000001';
  if (amount < 0.001) return `$${amount.toFixed(6)}`;
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

/**
 * Format a model's pricing tier for display.
 * e.g. "$0.06/$0.24 per Mtok"
 */
export function formatModelPricing(tier: CostTier): string {
  const fmtInput = tier.inputPer1M >= 1 ? `$${tier.inputPer1M}` : `$${tier.inputPer1M}`;
  const fmtOutput = tier.outputPer1M >= 1 ? `$${tier.outputPer1M}` : `$${tier.outputPer1M}`;
  return `${fmtInput}/${fmtOutput} per Mtok`;
}

/**
 * Format a full cost breakdown for display.
 */
export function formatCostBreakdown(cost: CostBreakdown): {
  input: string;
  output: string;
  total: string;
  saved: string;
  pricing: string;
} {
  return {
    input: formatCostUSD(cost.inputCostUSD),
    output: formatCostUSD(cost.outputCostUSD),
    total: formatCostUSD(cost.totalCostUSD),
    saved: formatCostUSD(cost.savedInputCostUSD),
    pricing: formatModelPricing(cost.tier),
  };
}
