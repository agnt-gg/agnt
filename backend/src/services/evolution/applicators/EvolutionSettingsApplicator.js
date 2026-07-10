import InsightModel from '../../../models/InsightModel.js';
import EvolutionSettingsModel from '../../../models/EvolutionSettingsModel.js';

/**
 * EvolutionSettingsApplicator — applies a parameter_tune insight by updating
 * EvolutionSettingsModel.autonomy.
 *
 * This is used to route CoreEvolutionSystem recommendations through the
 * existing InsightAutonomyRouter (direct/gated/escalate) instead of having
 * CoreEvolutionSystem write settings directly.
 */
class EvolutionSettingsApplicator {
  static async apply(insightId, userId) {
    const insight = await InsightModel.findOne(insightId);
    if (!insight || insight.user_id !== userId) {
      throw new Error('Insight not found or access denied');
    }

    if (insight.target_type !== 'evolution_settings') {
      return { applied: false, reason: `wrong_target_type:${insight.target_type}` };
    }

    const evidence = insight.evidence || {};
    const patch = evidence.autonomyPatch || evidence.autonomy || evidence.nextAutonomy;

    if (!patch || typeof patch !== 'object') {
      return { applied: false, reason: 'missing_autonomy_patch' };
    }

    const current = await EvolutionSettingsModel.get(userId);

    // Safety invariant: never flip autonomy on.
    const nextAutonomy = {
      ...(current.autonomy || {}),
      ...patch,
      enabled: !!current.autonomy?.enabled,
    };

    const updated = await EvolutionSettingsModel.update(userId, { autonomy: nextAutonomy });

    await InsightModel.updateStatus(insightId, 'applied', {
      type: 'evolution_settings_updated',
      patch,
      appliedAutonomy: updated.autonomy,
    });

    return { applied: true, type: 'evolution_settings_updated', autonomy: updated.autonomy };
  }
}

export default EvolutionSettingsApplicator;
