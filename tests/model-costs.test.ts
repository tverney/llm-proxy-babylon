import { describe, it, expect } from 'vitest';
import { getModelCostTier, calculateCost, COST_TIERS, formatCostUSD, formatModelPricing, formatCostBreakdown } from '../src/config/model-costs.ts';

describe('Model Cost Tracking', () => {
  describe('getModelCostTier', () => {
    it('matches Nova Lite', () => {
      const tier = getModelCostTier('us.amazon.nova-lite-v1:0');
      expect(tier).toBe(COST_TIERS.NOVA_LITE);
    });

    it('matches Nova Micro', () => {
      const tier = getModelCostTier('amazon.nova-micro-v1:0');
      expect(tier).toBe(COST_TIERS.NOVA_MICRO);
    });

    it('matches Claude Opus 4', () => {
      const tier = getModelCostTier('anthropic.claude-opus-4-20250514-v1:0');
      expect(tier).toBe(COST_TIERS.CLAUDE_OPUS_4);
    });

    it('matches Mistral 7B', () => {
      const tier = getModelCostTier('mistral.mistral-7b-instruct-v0:2');
      expect(tier).toBe(COST_TIERS.MISTRAL_7B);
    });

    it('matches GPT-4o', () => {
      const tier = getModelCostTier('gpt-4o');
      expect(tier).toBe(COST_TIERS.GPT4O);
    });

    it('matches GPT-4o-mini before GPT-4o', () => {
      const tier = getModelCostTier('gpt-4o-mini');
      expect(tier).toBe(COST_TIERS.GPT4O_MINI);
    });

    it('returns DEFAULT for unknown models', () => {
      const tier = getModelCostTier('some-unknown-model-v1');
      expect(tier).toBe(COST_TIERS.DEFAULT);
    });

    it('is case-insensitive', () => {
      const tier = getModelCostTier('US.AMAZON.NOVA-LITE-V1:0');
      expect(tier).toBe(COST_TIERS.NOVA_LITE);
    });
  });

  describe('calculateCost', () => {
    it('calculates cost for Nova Lite', () => {
      const cost = calculateCost('us.amazon.nova-lite-v1:0', 49, 850);
      expect(cost.inputCostUSD).toBeCloseTo(0.06 * 49 / 1_000_000, 10);
      expect(cost.outputCostUSD).toBeCloseTo(0.24 * 850 / 1_000_000, 10);
      expect(cost.totalCostUSD).toBeCloseTo(cost.inputCostUSD + cost.outputCostUSD, 10);
      expect(cost.savedInputCostUSD).toBe(0);
    });

    it('calculates saved cost when tokens are saved', () => {
      const cost = calculateCost('us.amazon.nova-lite-v1:0', 49, 850, 117);
      expect(cost.savedInputCostUSD).toBeCloseTo(0.06 * 117 / 1_000_000, 10);
    });

    it('calculates higher savings for expensive models', () => {
      const novaCost = calculateCost('us.amazon.nova-lite-v1:0', 49, 850, 117);
      const opusCost = calculateCost('anthropic.claude-opus-4-20250514-v1:0', 49, 850, 117);
      expect(opusCost.savedInputCostUSD).toBeGreaterThan(novaCost.savedInputCostUSD);
      // Opus is 250x more expensive per input token than Nova Lite
      expect(opusCost.savedInputCostUSD / novaCost.savedInputCostUSD).toBeCloseTo(15.00 / 0.06, 0);
    });

    it('returns the matched tier and model ID', () => {
      const cost = calculateCost('gpt-4o', 100, 200);
      expect(cost.tier).toBe(COST_TIERS.GPT4O);
      expect(cost.modelId).toBe('gpt-4o');
    });

    it('handles zero tokens', () => {
      const cost = calculateCost('gpt-4o', 0, 0);
      expect(cost.totalCostUSD).toBe(0);
      expect(cost.savedInputCostUSD).toBe(0);
    });
  });
});

  describe('formatCostUSD', () => {
    it('formats zero', () => {
      expect(formatCostUSD(0)).toBe('$0.00');
    });

    it('formats >= $1', () => {
      expect(formatCostUSD(1.234)).toBe('$1.23');
      expect(formatCostUSD(15.5)).toBe('$15.50');
    });

    it('formats >= $0.01', () => {
      expect(formatCostUSD(0.05)).toBe('$0.05');
      expect(formatCostUSD(0.0123)).toBe('$0.01');
    });

    it('formats >= $0.001', () => {
      expect(formatCostUSD(0.0034)).toBe('$0.0034');
    });

    it('formats >= $0.000001', () => {
      expect(formatCostUSD(0.000012)).toBe('$0.000012');
      expect(formatCostUSD(0.00000114)).toBe('$0.000001');
    });

    it('formats very small amounts', () => {
      expect(formatCostUSD(0.0000001)).toBe('< $0.000001');
    });
  });

  describe('formatModelPricing', () => {
    it('formats Nova Lite pricing', () => {
      expect(formatModelPricing(COST_TIERS.NOVA_LITE)).toBe('$0.06/$0.24 per Mtok');
    });

    it('formats Opus 4 pricing', () => {
      expect(formatModelPricing(COST_TIERS.CLAUDE_OPUS_4)).toBe('$15/$75 per Mtok');
    });
  });

  describe('formatCostBreakdown', () => {
    it('formats a full breakdown', () => {
      const cost = calculateCost('us.amazon.nova-lite-v1:0', 49, 850, 117);
      const formatted = formatCostBreakdown(cost);
      expect(formatted.input).toMatch(/^\$/);
      expect(formatted.output).toMatch(/^\$/);
      expect(formatted.total).toMatch(/^\$/);
      expect(formatted.saved).toMatch(/^\$/);
      expect(formatted.pricing).toContain('per Mtok');
    });
  });
