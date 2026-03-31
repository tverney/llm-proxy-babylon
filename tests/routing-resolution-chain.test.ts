import { describe, it, expect } from 'vitest';
import { RoutingEngine } from '../src/components/routing-engine.ts';
import type { LanguageDetectionResult, ClassificationResult } from '../src/models/types.ts';
import type { ModelProfile, RoutingPolicy } from '../src/models/config.ts';

const profile: ModelProfile = {
  modelId: 'test-model',
  supportedLanguages: ['en', 'th'],
  languagePerformance: [
    { languageTag: 'en', performanceRating: 1.0 },
    { languageTag: 'th', performanceRating: 0.5 },
  ],
  defaultOptimalLanguage: 'en',
  endpoint: 'http://localhost',
};

const policy: RoutingPolicy = {
  rules: [
    {
      priority: 1,
      matchConditions: { sourceLanguagePattern: '^(?!en).*$' },
      action: 'translate',
    },
  ],
};

function makeDetection(tag: string, undetermined = false): LanguageDetectionResult {
  return {
    primary: { tag, confidence: 1 },
    all: [{ tag, confidence: 1 }],
    isUndetermined: undetermined,
  };
}

function makeClassification(category: string, confidence = 0.9): ClassificationResult {
  return {
    categories: [{ category: category as any, confidence }],
    primaryCategory: category as any,
  };
}

describe('Routing Resolution Chain', () => {
  it('undetermined resolver decides first', () => {
    const engine = new RoutingEngine(policy);
    const result = engine.evaluate(makeDetection('und', true), makeClassification('general'), profile);
    expect(result.action).toBe('skip');
    expect(result.reason).toContain('undetermined');

    const trace = engine.getLastTrace();
    expect(trace[0].resolver).toBe('undetermined');
    expect(trace[0].result).toBe('decided');
  });

  it('same-language resolver decides when lang matches optimal', () => {
    const engine = new RoutingEngine(policy);
    const result = engine.evaluate(makeDetection('en'), makeClassification('general'), profile);
    expect(result.action).toBe('skip');
    expect(result.reason).toContain('matches optimal');

    const trace = engine.getLastTrace();
    expect(trace[0].result).toBe('deferred'); // undetermined deferred
    expect(trace[1].resolver).toBe('same-language');
    expect(trace[1].result).toBe('decided');
  });

  it('cultural override decides before static rules', () => {
    const engine = new RoutingEngine(policy);
    const result = engine.evaluate(
      makeDetection('th'),
      makeClassification('culturally-specific', 0.95),
      profile,
    );
    expect(result.action).toBe('skip');
    expect(result.reason).toContain('Culturally-specific');

    const trace = engine.getLastTrace();
    const cultural = trace.find(t => t.resolver === 'cultural-override');
    expect(cultural?.result).toBe('decided');
  });

  it('static rules decide when earlier resolvers defer', () => {
    const engine = new RoutingEngine(policy);
    const result = engine.evaluate(makeDetection('th'), makeClassification('general'), profile);
    expect(result.action).toBe('translate');
    expect(result.reason).toContain('Matched rule');

    const trace = engine.getLastTrace();
    expect(trace.filter(t => t.result === 'deferred').length).toBeGreaterThanOrEqual(3);
    const staticRule = trace.find(t => t.resolver === 'static-rules');
    expect(staticRule?.result).toBe('decided');
  });

  it('default resolver catches when no rules match', () => {
    const engine = new RoutingEngine({ rules: [] }); // no rules
    const result = engine.evaluate(makeDetection('th'), makeClassification('general'), profile);
    expect(result.action).toBe('skip');
    expect(result.reason).toContain('defaulting to skip');

    const trace = engine.getLastTrace();
    const defaultResolver = trace.find(t => t.resolver === 'default');
    expect(defaultResolver?.result).toBe('decided');
  });

  it('trace shows all resolvers consulted', () => {
    const engine = new RoutingEngine(policy);
    engine.evaluate(makeDetection('th'), makeClassification('general'), profile);

    const trace = engine.getLastTrace();
    const names = trace.map(t => t.resolver);
    expect(names).toContain('undetermined');
    expect(names).toContain('same-language');
    expect(names).toContain('cultural-override');
    expect(names).toContain('adaptive');
    expect(names).toContain('static-rules');
  });

  it('trace does not include resolvers after the deciding one', () => {
    const engine = new RoutingEngine(policy);
    engine.evaluate(makeDetection('en'), makeClassification('general'), profile);

    const trace = engine.getLastTrace();
    // same-language decides, so no further resolvers
    expect(trace.length).toBe(2); // undetermined (deferred) + same-language (decided)
    expect(trace[1].resolver).toBe('same-language');
    expect(trace[1].result).toBe('decided');
  });

  it('adaptive resolver defers when no adaptive router configured', () => {
    const engine = new RoutingEngine(policy); // no adaptive router
    engine.evaluate(makeDetection('th'), makeClassification('general'), profile);

    const trace = engine.getLastTrace();
    const adaptive = trace.find(t => t.resolver === 'adaptive');
    expect(adaptive?.result).toBe('deferred');
  });

  it('each trace entry for decided includes the decision', () => {
    const engine = new RoutingEngine(policy);
    engine.evaluate(makeDetection('th'), makeClassification('general'), profile);

    const trace = engine.getLastTrace();
    const decided = trace.find(t => t.result === 'decided');
    expect(decided?.decision).toBeDefined();
    expect(decided?.decision?.action).toBe('translate');
  });
});
