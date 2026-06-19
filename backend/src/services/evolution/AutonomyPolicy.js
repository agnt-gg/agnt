/**
 * AutonomyPolicy — per-domain rules for how aggressively the router auto-applies
 * insights (PRD-091 Layer 4).
 *
 * Ships conservative by default; users opt in via EvolutionSettingsModel.autonomy.
 */

// Fixed blast-radius lookup. Keyed first by target_type, then by category for
// fine-grained cases (e.g., memory vs. prompt_refinement under target=agent).
const BLAST_BY_CATEGORY = {
  memory: 0.1,
  contract_proposal: 0.2,
  prompt_refinement: 0.3,
  tool_preference: 0.3,
  skill_recommendation: 0.5,
  pattern: 0.4,
  antipattern: 0.4,
  bottleneck: 0.6,
  parameter_tune: 0.7,
};
const BLAST_BY_TARGET = {
  agent: 0.3,
  skill: 0.5,
  workflow: 0.7,
  tool: 0.9,
  memory: 0.1,
};

export const DEFAULTS = {
  enabled: false,
  minConfidence: 0.7,
  minDelta: 0.05,
  maxBlastRadius: 0.5,
  dailyBudget: 20,
  allowedCategories: ['memory', 'prompt_refinement', 'tool_preference', 'contract_proposal', 'skill_recommendation', 'pattern', 'antipattern'],
  // Categories that require gated (sandbox) verification before applying.
  requireGateAbove: 0.45,
};

class AutonomyPolicy {
  static blastRadiusOf(insight) {
    if (typeof insight.blast_radius === 'number') return insight.blast_radius;
    const byCat = BLAST_BY_CATEGORY[insight.category];
    const byTarget = BLAST_BY_TARGET[insight.target_type];
    if (typeof byCat === 'number') return byCat;
    if (typeof byTarget === 'number') return byTarget;
    return 0.5; // default to mid
  }

  static merged(settings) {
    const fromUser = settings && settings.autonomy ? settings.autonomy : {};
    return {
      ...DEFAULTS,
      ...fromUser,
      allowedCategories: fromUser.allowedCategories || DEFAULTS.allowedCategories,
    };
  }

  /**
   * Decide what the router should do with this insight.
   * @returns {{ decision: 'direct'|'gated'|'escalate'|'skip', reason, blastRadius }}
   */
  static evaluate(insight, settings = {}, ctx = {}) {
    const cfg = this.merged(settings);
    const blastRadius = this.blastRadiusOf(insight);

    if (!cfg.enabled) {
      return { decision: 'skip', reason: 'autonomy_disabled', blastRadius };
    }

    if (!cfg.allowedCategories.includes(insight.category)) {
      return { decision: 'escalate', reason: `category_not_allowed:${insight.category}`, blastRadius };
    }

    if ((insight.confidence || 0) < cfg.minConfidence) {
      return { decision: 'escalate', reason: `low_confidence:${(insight.confidence || 0).toFixed(2)}<${cfg.minConfidence}`, blastRadius };
    }

    if (blastRadius > cfg.maxBlastRadius) {
      return { decision: 'escalate', reason: `over_blast_radius:${blastRadius.toFixed(2)}>${cfg.maxBlastRadius}`, blastRadius };
    }

    if (ctx.budgetExhausted) {
      return { decision: 'escalate', reason: 'daily_budget_exhausted', blastRadius };
    }

    if (blastRadius >= cfg.requireGateAbove) {
      return { decision: 'gated', reason: `blast_radius>=${cfg.requireGateAbove}`, blastRadius };
    }

    return { decision: 'direct', reason: 'low_blast_high_confidence', blastRadius };
  }
}

export default AutonomyPolicy;
