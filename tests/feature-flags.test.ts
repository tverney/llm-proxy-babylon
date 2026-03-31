import { describe, it, expect, beforeEach } from 'vitest';
import { FeatureFlags } from '../src/components/feature-flags.ts';

describe('FeatureFlags', () => {
  let flags: FeatureFlags;

  beforeEach(() => {
    flags = new FeatureFlags();
  });

  it('returns false when no rules exist', () => {
    expect(flags.isEnabled('shadow-evaluation')).toBe(false);
  });

  it('returns true when a matching rule is enabled', () => {
    flags.addRule({ id: 'r1', feature: 'shadow-evaluation', enabled: true });
    expect(flags.isEnabled('shadow-evaluation')).toBe(true);
  });

  it('returns false when a matching rule is disabled', () => {
    flags.addRule({ id: 'r1', feature: 'shadow-evaluation', enabled: false });
    expect(flags.isEnabled('shadow-evaluation')).toBe(false);
  });

  it('last rule wins when multiple match', () => {
    flags.addRule({ id: 'r1', feature: 'shadow-evaluation', enabled: true });
    flags.addRule({ id: 'r2', feature: 'shadow-evaluation', enabled: false });
    expect(flags.isEnabled('shadow-evaluation')).toBe(false);
  });

  it('filters by language', () => {
    flags.addRule({
      id: 'r1', feature: 'shadow-evaluation', enabled: true,
      conditions: { languages: ['th', 'ko'] },
    });
    expect(flags.isEnabled('shadow-evaluation', { language: 'th' })).toBe(true);
    expect(flags.isEnabled('shadow-evaluation', { language: 'ko' })).toBe(true);
    expect(flags.isEnabled('shadow-evaluation', { language: 'pt' })).toBe(false);
    expect(flags.isEnabled('shadow-evaluation')).toBe(false); // no language in context
  });

  it('filters by tenant', () => {
    flags.addRule({
      id: 'r1', feature: 'shadow-evaluation', enabled: true,
      conditions: { tenants: ['acme-corp'] },
    });
    expect(flags.isEnabled('shadow-evaluation', { tenant: 'acme-corp' })).toBe(true);
    expect(flags.isEnabled('shadow-evaluation', { tenant: 'other' })).toBe(false);
  });

  it('filters by task type', () => {
    flags.addRule({
      id: 'r1', feature: 'shadow-evaluation', enabled: true,
      conditions: { taskTypes: ['reasoning', 'math'] },
    });
    expect(flags.isEnabled('shadow-evaluation', { taskType: 'reasoning' })).toBe(true);
    expect(flags.isEnabled('shadow-evaluation', { taskType: 'general' })).toBe(false);
  });

  it('combines multiple conditions (AND logic)', () => {
    flags.addRule({
      id: 'r1', feature: 'shadow-evaluation', enabled: true,
      conditions: { languages: ['th'], taskTypes: ['reasoning'] },
    });
    expect(flags.isEnabled('shadow-evaluation', { language: 'th', taskType: 'reasoning' })).toBe(true);
    expect(flags.isEnabled('shadow-evaluation', { language: 'th', taskType: 'general' })).toBe(false);
    expect(flags.isEnabled('shadow-evaluation', { language: 'ko', taskType: 'reasoning' })).toBe(false);
  });

  it('expired rules are skipped', () => {
    flags.addRule({
      id: 'r1', feature: 'shadow-evaluation', enabled: true,
      expiresAt: Date.now() - 1000, // expired 1 second ago
    });
    expect(flags.isEnabled('shadow-evaluation')).toBe(false);
  });

  it('non-expired rules work', () => {
    flags.addRule({
      id: 'r1', feature: 'shadow-evaluation', enabled: true,
      expiresAt: Date.now() + 60_000, // expires in 1 minute
    });
    expect(flags.isEnabled('shadow-evaluation')).toBe(true);
  });

  it('removeRule removes by ID', () => {
    flags.addRule({ id: 'r1', feature: 'shadow-evaluation', enabled: true });
    expect(flags.isEnabled('shadow-evaluation')).toBe(true);

    const removed = flags.removeRule('r1');
    expect(removed).toBe(true);
    expect(flags.isEnabled('shadow-evaluation')).toBe(false);
  });

  it('removeRule returns false for unknown ID', () => {
    expect(flags.removeRule('nonexistent')).toBe(false);
  });

  it('getRules returns active rules', () => {
    flags.addRule({ id: 'r1', feature: 'shadow-evaluation', enabled: true });
    flags.addRule({ id: 'r2', feature: 'other-feature', enabled: false });

    expect(flags.getRules().length).toBe(2);
    expect(flags.getRules('shadow-evaluation').length).toBe(1);
  });

  it('getRules excludes expired rules', () => {
    flags.addRule({
      id: 'r1', feature: 'shadow-evaluation', enabled: true,
      expiresAt: Date.now() - 1000,
    });
    expect(flags.getRules().length).toBe(0);
  });

  it('purgeExpired removes expired rules', () => {
    flags.addRule({ id: 'r1', feature: 'f1', enabled: true, expiresAt: Date.now() - 1000 });
    flags.addRule({ id: 'r2', feature: 'f2', enabled: true });

    const purged = flags.purgeExpired();
    expect(purged).toBe(1);
    expect(flags.getRules().length).toBe(1);
  });

  it('clear removes all rules', () => {
    flags.addRule({ id: 'r1', feature: 'f1', enabled: true });
    flags.addRule({ id: 'r2', feature: 'f2', enabled: true });
    flags.clear();
    expect(flags.getRules().length).toBe(0);
  });

  it('different features are independent', () => {
    flags.addRule({ id: 'r1', feature: 'shadow-evaluation', enabled: true });
    flags.addRule({ id: 'r2', feature: 'cost-tracking', enabled: false });

    expect(flags.isEnabled('shadow-evaluation')).toBe(true);
    expect(flags.isEnabled('cost-tracking')).toBe(false);
    expect(flags.isEnabled('unknown-feature')).toBe(false);
  });
});
