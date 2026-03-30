import { readFile } from 'node:fs/promises';
import type { RoutingPolicy, RoutingPolicyRule } from '../models/config.ts';
import type { RoutingAction } from '../models/types.ts';

const VALID_ACTIONS: RoutingAction[] = ['translate', 'skip', 'hybrid'];

export class RoutingPolicyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutingPolicyValidationError';
  }
}

/**
 * Validates a single RoutingPolicyRule. Throws RoutingPolicyValidationError if invalid.
 */
export function validateRoutingPolicyRule(rule: unknown): RoutingPolicyRule {
  if (rule === null || typeof rule !== 'object') {
    throw new RoutingPolicyValidationError('RoutingPolicyRule must be a non-null object');
  }

  const r = rule as Record<string, unknown>;

  if (typeof r.priority !== 'number' || !Number.isFinite(r.priority)) {
    throw new RoutingPolicyValidationError('RoutingPolicyRule.priority must be a finite number');
  }

  if (r.matchConditions === null || typeof r.matchConditions !== 'object') {
    throw new RoutingPolicyValidationError(
      `Rule priority ${r.priority}: matchConditions must be a non-null object`
    );
  }

  if (typeof r.action !== 'string' || !VALID_ACTIONS.includes(r.action as RoutingAction)) {
    throw new RoutingPolicyValidationError(
      `Rule priority ${r.priority}: action must be one of: ${VALID_ACTIONS.join(', ')}`
    );
  }

  return r as unknown as RoutingPolicyRule;
}

/**
 * Validates a full RoutingPolicy (array of rules). Checks for duplicate priorities.
 */
export function validateRoutingPolicy(policy: unknown): RoutingPolicy {
  if (policy === null || typeof policy !== 'object') {
    throw new RoutingPolicyValidationError('RoutingPolicy must be a non-null object');
  }

  const p = policy as Record<string, unknown>;

  if (!Array.isArray(p.rules)) {
    throw new RoutingPolicyValidationError('RoutingPolicy.rules must be an array');
  }

  const validatedRules: RoutingPolicyRule[] = [];
  const seenPriorities = new Map<number, number>(); // priority -> index

  for (let i = 0; i < p.rules.length; i++) {
    const rule = validateRoutingPolicyRule(p.rules[i]);

    const existing = seenPriorities.get(rule.priority);
    if (existing !== undefined) {
      throw new RoutingPolicyValidationError(
        `Duplicate priority ${rule.priority} found in rules at index ${existing} and ${i}`
      );
    }
    seenPriorities.set(rule.priority, i);
    validatedRules.push(rule);
  }

  return { rules: validatedRules };
}

/**
 * Loads and validates a RoutingPolicy from a JSON file.
 */
export async function loadRoutingPolicy(filePath: string): Promise<RoutingPolicy> {
  const content = await readFile(filePath, 'utf-8');
  const parsed: unknown = JSON.parse(content);
  return validateRoutingPolicy(parsed);
}

/**
 * Manages a RoutingPolicy with support for runtime reload.
 */
export class RoutingPolicyManager {
  private policy: RoutingPolicy = { rules: [] };

  constructor(policy?: RoutingPolicy) {
    if (policy) {
      this.policy = policy;
    }
  }

  /** Get the current policy. */
  getPolicy(): RoutingPolicy {
    return this.policy;
  }

  /** Get rules sorted by priority (lowest number first). */
  getSortedRules(): RoutingPolicyRule[] {
    return [...this.policy.rules].sort((a, b) => a.priority - b.priority);
  }

  /** Reload policy from a validated RoutingPolicy object (runtime reload without restart). */
  reload(policy: RoutingPolicy): void {
    this.policy = policy;
  }

  /** Reload policy from a JSON file (runtime reload without restart). */
  async reloadFromFile(filePath: string): Promise<void> {
    const loaded = await loadRoutingPolicy(filePath);
    this.policy = loaded;
  }
}
