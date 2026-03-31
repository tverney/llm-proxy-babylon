/**
 * Runtime Feature Flags
 *
 * Enables per-language, per-tenant, and time-bounded feature gating
 * without restarting the service. Primary use case: controlling shadow
 * evaluation to limit cost while gathering quality data.
 *
 * Example: "Enable shadow evaluation for Thai only for 2 weeks"
 */

export interface FeatureRule {
  id: string;
  feature: string;           // e.g. 'shadow-evaluation'
  enabled: boolean;
  conditions?: {
    languages?: string[];    // BCP-47 tags, e.g. ['th', 'ko']
    tenants?: string[];      // tenant IDs
    taskTypes?: string[];    // e.g. ['reasoning', 'math']
  };
  expiresAt?: number;        // Unix timestamp — auto-disables after this time
  createdAt: number;
}

export class FeatureFlags {
  private rules: FeatureRule[] = [];

  /**
   * Add a feature rule. Later rules take precedence over earlier ones.
   */
  addRule(rule: Omit<FeatureRule, 'createdAt'>): void {
    this.rules.push({ ...rule, createdAt: Date.now() });
  }

  /**
   * Remove a rule by ID.
   */
  removeRule(id: string): boolean {
    const before = this.rules.length;
    this.rules = this.rules.filter(r => r.id !== id);
    return this.rules.length < before;
  }

  /**
   * Check if a feature is enabled for the given context.
   * Evaluates rules in reverse order (last added wins).
   * Expired rules are skipped.
   */
  isEnabled(
    feature: string,
    context?: { language?: string; tenant?: string; taskType?: string },
  ): boolean {
    const now = Date.now();

    // Evaluate in reverse — last matching rule wins
    for (let i = this.rules.length - 1; i >= 0; i--) {
      const rule = this.rules[i];
      if (rule.feature !== feature) continue;
      if (rule.expiresAt && now > rule.expiresAt) continue; // expired

      if (this.ruleMatchesContext(rule, context)) {
        return rule.enabled;
      }
    }

    return false; // default: disabled
  }

  /**
   * Get all active (non-expired) rules for a feature.
   */
  getRules(feature?: string): FeatureRule[] {
    const now = Date.now();
    return this.rules.filter(r => {
      if (feature && r.feature !== feature) return false;
      if (r.expiresAt && now > r.expiresAt) return false;
      return true;
    });
  }

  /**
   * Purge expired rules.
   */
  purgeExpired(): number {
    const now = Date.now();
    const before = this.rules.length;
    this.rules = this.rules.filter(r => !r.expiresAt || now <= r.expiresAt);
    return before - this.rules.length;
  }

  /**
   * Clear all rules.
   */
  clear(): void {
    this.rules = [];
  }

  private ruleMatchesContext(
    rule: FeatureRule,
    context?: { language?: string; tenant?: string; taskType?: string },
  ): boolean {
    if (!rule.conditions) return true; // no conditions = matches everything

    const { languages, tenants, taskTypes } = rule.conditions;

    if (languages && languages.length > 0) {
      if (!context?.language || !languages.includes(context.language)) return false;
    }

    if (tenants && tenants.length > 0) {
      if (!context?.tenant || !tenants.includes(context.tenant)) return false;
    }

    if (taskTypes && taskTypes.length > 0) {
      if (!context?.taskType || !taskTypes.includes(context.taskType)) return false;
    }

    return true;
  }
}
