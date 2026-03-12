import InsightModel from '../../../models/InsightModel.js';

/**
 * WorkflowApplicator — Applies insights to workflows via the WorkflowVersionService.
 */
class WorkflowApplicator {
  /**
   * Apply a workflow-targeted insight.
   */
  static async apply(insightId, userId) {
    const insight = await InsightModel.findOne(insightId);
    if (!insight || insight.user_id !== userId) {
      throw new Error('Insight not found or access denied');
    }
    if (insight.target_type !== 'workflow') {
      throw new Error('Insight does not target a workflow');
    }

    // Workflow insights are advisory — they're reviewed and applied through the
    // workflow chat or manually. We mark them with context for the user.
    switch (insight.category) {
      case 'bottleneck':
        return await this._applyBottleneck(insight, userId);
      case 'parameter_tune':
        return await this._applyParameterTune(insight, userId);
      default:
        await InsightModel.updateStatus(insightId, 'applied', {
          type: 'workflow_insight_recorded',
          note: 'Insight recorded for manual review',
        });
        return { applied: true, type: 'recorded_for_review' };
    }
  }

  /**
   * Mark bottleneck insight as applied with diagnostic info.
   */
  static async _applyBottleneck(insight, userId) {
    await InsightModel.updateStatus(insight.id, 'applied', {
      type: 'bottleneck_identified',
      workflowId: insight.target_id,
      recommendation: insight.description,
    });
    return { applied: true, type: 'bottleneck_identified', workflowId: insight.target_id };
  }

  /**
   * Mark parameter tune insight as applied.
   */
  static async _applyParameterTune(insight, userId) {
    await InsightModel.updateStatus(insight.id, 'applied', {
      type: 'parameter_tune_suggested',
      workflowId: insight.target_id,
      suggestion: insight.description,
    });
    return { applied: true, type: 'parameter_tune_suggested', workflowId: insight.target_id };
  }
}

export default WorkflowApplicator;
