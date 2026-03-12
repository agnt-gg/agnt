import InsightModel from '../../../models/InsightModel.js';

/**
 * ToolApplicator — Applies insights to tools (parameter defaults, descriptions).
 */
class ToolApplicator {
  /**
   * Apply a tool-targeted insight.
   */
  static async apply(insightId, userId) {
    const insight = await InsightModel.findOne(insightId);
    if (!insight || insight.user_id !== userId) {
      throw new Error('Insight not found or access denied');
    }
    if (insight.target_type !== 'tool') {
      throw new Error('Insight does not target a tool');
    }

    // Tool insights are mostly diagnostic/informational.
    // They identify failure patterns and usage trends.
    await InsightModel.updateStatus(insightId, 'applied', {
      type: 'tool_insight_applied',
      toolName: insight.target_id,
      category: insight.category,
      recommendation: insight.description,
    });

    return { applied: true, type: 'tool_insight_applied', toolName: insight.target_id };
  }
}

export default ToolApplicator;
