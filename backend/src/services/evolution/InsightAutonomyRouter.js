import InsightModel from '../../models/InsightModel.js';
import EvolutionSettingsModel from '../../models/EvolutionSettingsModel.js';
import AutonomyPolicy from './AutonomyPolicy.js';
import { broadcastToUser } from '../../utils/realtimeSync.js';

/**
 * InsightAutonomyRouter — PRD-091 Layer 4.
 *
 * Replaces InsightTriggers._autoApplyMemoryInsights with a general router:
 *   - low blast + confident → snapshot → apply directly
 *   - high blast + confident → Arena/VerifierGate → apply on pass
 *   - ambiguous / over-budget → mark escalated (insight stays pending)
 */

const DAY_MS = 24 * 60 * 60 * 1000;

class InsightAutonomyRouter {
  /**
   * Lazy-load applicators so we never hard-require them at module-load time.
   * Returns the matching applicator class for the insight's target_type.
   */
  static async _getApplicator(insight) {
    switch (insight.target_type) {
      case 'agent': return (await import('./applicators/AgentApplicator.js')).default;
      case 'skill': return (await import('./applicators/SkillApplicator.js')).default;
      case 'workflow': return (await import('./applicators/WorkflowApplicator.js')).default;
      case 'tool': return (await import('./applicators/ToolApplicator.js')).default;
      case 'memory': return null; // memory category insights are recorded directly
      default: return null;
    }
  }

  static async _applyViaApplicator(insight, userId, { provider, model } = {}) {
    // PRD-091 Layer 5: contract proposals install via the ContractApplicator.
    if (insight.category === 'contract_proposal') {
      const ContractApplicator = (await import('./applicators/ContractApplicator.js')).default;
      return ContractApplicator.apply(insight.id, userId);
    }

    const Applicator = await this._getApplicator(insight);
    if (!Applicator) {
      // Memory insights are essentially "fact stored" — mark applied directly.
      await InsightModel.updateStatus(insight.id, 'applied', { autoApplied: true, type: 'memory_stored' });
      return { applied: true, type: 'memory_stored' };
    }
    if (insight.target_type === 'agent') {
      return Applicator.apply(insight.id, userId, provider, model);
    }
    return Applicator.apply(insight.id, userId);
  }

  static async _snapshotBeforeApply(insight, userId) {
    // Snapshot only what's cheap and well-known. Other types fall through.
    try {
      if (insight.target_type === 'workflow' && insight.target_id) {
        const WorkflowVersionService = (await import('../WorkflowVersionService.js')).default;
        const WorkflowModel = (await import('../../models/WorkflowModel.js')).default;
        const workflow = await WorkflowModel.findOne(insight.target_id).catch(() => null);
        if (workflow && workflow.workflow_data) {
          const state = typeof workflow.workflow_data === 'string' ? JSON.parse(workflow.workflow_data) : workflow.workflow_data;
          const snap = await WorkflowVersionService.createVersion({
            workflowId: insight.target_id,
            workflowState: state,
            createdBy: userId,
            changeType: 'router_snapshot',
            changeSummary: `Pre-apply snapshot for insight ${insight.id}`,
            isCheckpoint: false,
          });
          return { kind: 'workflow_version', ref: snap?.versionId || null };
        }
      }
    } catch (err) {
      console.warn('[InsightRouter] Snapshot failed (non-fatal):', err.message);
    }
    return { kind: null, ref: null };
  }

  /**
   * Route a single insight through the policy 2×2.
   * @returns {Promise<{decision, reason, applied?, result?, error?, mutationId?}>}
   */
  static async route(insightId, userId, { provider, model } = {}) {
    const insight = await InsightModel.findOne(insightId);
    if (!insight) return { decision: 'skip', reason: 'insight_not_found' };
    if (insight.status !== 'pending') return { decision: 'skip', reason: `status:${insight.status}` };

    const settings = await EvolutionSettingsModel.get(userId);
    const cfg = AutonomyPolicy.merged(settings);

    // Daily budget check.
    let budgetExhausted = false;
    if (cfg.dailyBudget > 0) {
      const since = new Date(Date.now() - DAY_MS).toISOString();
      const applied = await InsightModel.countAppliedSince(userId, since);
      if (applied >= cfg.dailyBudget) budgetExhausted = true;
    }

    const verdict = AutonomyPolicy.evaluate(insight, settings, { budgetExhausted });

    await InsightModel.updateAutonomyMeta(insightId, {
      decision: verdict.decision,
      reason: verdict.reason,
      blastRadius: verdict.blastRadius,
    });

    if (verdict.decision === 'skip') {
      return { decision: 'skip', reason: verdict.reason };
    }

    if (verdict.decision === 'escalate') {
      broadcastToUser(userId, 'evolution:insight_escalated', {
        insightId, reason: verdict.reason, blastRadius: verdict.blastRadius,
      });
      return { decision: 'escalate', reason: verdict.reason, blastRadius: verdict.blastRadius };
    }

    // ---- direct or gated ----
    // Take a snapshot for canary rollback. For 'gated', the Arena (Layer 6)
    // will be invoked if available; otherwise we proceed straight to apply
    // since the empirical gate is still the autonomy router itself + future
    // canary regression detection (Layer 7).
    const snapshot = await this._snapshotBeforeApply(insight, userId);

    let gateDelta = null;
    if (verdict.decision === 'gated') {
      try {
        const ArenaService = (await import('../arena/ArenaService.js')).default;
        if (ArenaService && typeof ArenaService.evaluate === 'function') {
          const arena = await ArenaService.evaluate({ insight, userId });
          gateDelta = (arena && typeof arena.delta === 'number') ? arena.delta : null;
          await InsightModel.updateAutonomyMeta(insightId, { gateDelta });
          if (arena && arena.pass === false) {
            await InsightModel.updateStatus(insightId, 'superseded', {
              autonomyDecision: 'gated', result: 'arena_failed', delta: gateDelta, reason: arena.reason || null,
            });
            return { decision: 'gated', applied: false, reason: 'arena_failed', delta: gateDelta };
          }
        }
      } catch (err) {
        // Arena not present yet or threw — proceed without sandbox check.
        console.warn('[InsightRouter] Arena evaluate skipped:', err.message);
      }
    }

    // PRD-091 Layer 7: snapshot fitness BEFORE applying (canary baseline).
    let fitnessBefore = null;
    try {
      const FitnessScoreService = (await import('./FitnessScoreService.js')).default;
      let baseline = null;
      if (insight.target_type === 'tool' && insight.target_id) {
        baseline = await FitnessScoreService.forTool({ toolName: insight.target_id, userId });
      } else if (insight.target_type === 'workflow' && insight.target_id) {
        baseline = await FitnessScoreService.forWorkflow({ workflowId: insight.target_id, userId });
      }
      if (baseline) fitnessBefore = baseline.score;
    } catch (err) {
      // FitnessScore is advisory — never block apply on it.
    }

    let result;
    let applyError = null;
    try {
      result = await this._applyViaApplicator(insight, userId, { provider, model });
    } catch (err) {
      applyError = err && err.message ? err.message : String(err);
      console.error(`[InsightRouter] Apply failed for ${insightId}:`, applyError);
    }

    // Record mutation history for canary/auto-revert (Layer 7).
    let mutationId = null;
    try {
      const MutationHistoryModel = (await import('../../models/MutationHistoryModel.js')).default;
      mutationId = await MutationHistoryModel.create({
        userId,
        insightId: insight.id,
        targetType: insight.target_type,
        targetId: insight.target_id,
        appliedVia: verdict.decision,
        snapshotKind: snapshot.kind,
        snapshotRef: snapshot.ref,
        fitnessBefore,
        fitnessAfter: null,
        delta: gateDelta,
        status: applyError ? 'apply_failed' : 'applied',
        notes: applyError || verdict.reason,
      });
    } catch (err) {
      console.warn('[InsightRouter] Mutation history record skipped:', err.message);
    }

    if (applyError) {
      return { decision: verdict.decision, applied: false, error: applyError, mutationId };
    }

    broadcastToUser(userId, 'evolution:insight_applied', {
      insightId, targetType: insight.target_type, decision: verdict.decision, mutationId,
    });

    return { decision: verdict.decision, applied: true, result, mutationId, snapshot };
  }

  /**
   * Sweep all pending insights for a user.
   * Stops short of the per-user daily budget; emits one broadcast at the end.
   */
  static async routePendingForUser(userId, { provider, model, limit = 100 } = {}) {
    const pending = await InsightModel.findByUserId(userId, { status: 'pending', limit });
    const summary = { processed: 0, direct: 0, gated: 0, escalated: 0, skipped: 0, errors: 0 };

    for (const insight of pending) {
      try {
        const result = await this.route(insight.id, userId, { provider, model });
        summary.processed++;
        if (result.decision === 'direct') summary.direct++;
        else if (result.decision === 'gated') summary.gated++;
        else if (result.decision === 'escalate') summary.escalated++;
        else summary.skipped++;
      } catch (err) {
        summary.errors++;
        console.error('[InsightRouter] route error:', err.message);
      }
    }
    return summary;
  }
}

export default InsightAutonomyRouter;
