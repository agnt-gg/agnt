import InsightModel from '../../../models/InsightModel.js';

/**
 * SkillApplicator — Wraps existing SkillEvolver for the unified evolution pipeline.
 * Insights targeting skills are routed through the existing SkillForge system.
 */
class SkillApplicator {
  /**
   * Apply a skill-targeted insight.
   * Delegates to existing SkillForge pipeline.
   */
  static async apply(insightId, userId) {
    const insight = await InsightModel.findOne(insightId);
    if (!insight || insight.user_id !== userId) {
      throw new Error('Insight not found or access denied');
    }
    if (insight.target_type !== 'skill') {
      throw new Error('Insight does not target a skill');
    }

    // For skill insights that came from goal analysis,
    // the SkillForge pipeline already handles evolution.
    // This applicator mainly handles marking status.
    if (insight.source_type === 'goal') {
      await InsightModel.updateStatus(insightId, 'applied', {
        type: 'skill_evolution',
        delegatedTo: 'SkillForge',
        note: 'Handled by SkillForge pipeline on goal completion',
      });
      return { applied: true, type: 'skill_evolution_delegated' };
    }

    // For other sources, we could potentially trigger manual skill refinement
    // For now, mark as applied with context
    await InsightModel.updateStatus(insightId, 'applied', {
      type: 'skill_insight_recorded',
      note: 'Insight recorded for future skill evolution',
    });

    return { applied: true, type: 'skill_insight_recorded' };
  }
}

export default SkillApplicator;
