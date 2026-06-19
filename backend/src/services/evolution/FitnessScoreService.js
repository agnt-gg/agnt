import db from '../../models/database/index.js';
import MutationHistoryModel from '../../models/MutationHistoryModel.js';
import ContractModel from '../../models/ContractModel.js';

/**
 * FitnessScoreService — unified RL reward signal (PRD-091 Layer 7).
 *
 * Combines four observable signals into one scalar in [0, 1]:
 *   - success rate (SES / completion ratio)
 *   - token efficiency (lower is better, normalized)
 *   - latency efficiency (lower is better, normalized)
 *   - contract violations (more is worse)
 *
 * Callable for a single asset (tool/workflow/skill/agent) so the router can
 * snapshot fitness before+after a mutation and detect regressions.
 */

const WEIGHTS = {
  successRate: 0.5,
  tokenEfficiency: 0.2,
  latencyEfficiency: 0.2,
  contractCleanliness: 0.1,
};

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

async function getAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}

class FitnessScoreService {
  /**
   * Compute fitness for a tool across the last `lookbackDays` days for `userId`.
   * Returns { score, components, sampleSize }.
   */
  static async forTool({ toolName, userId, lookbackDays = 7 }) {
    const rows = await getAll(`
      SELECT ate.status, ate.input_tokens, ate.output_tokens, ate.start_time, ate.end_time
        FROM agent_tool_executions ate
        JOIN agent_executions ae ON ate.execution_id = ae.id
       WHERE ate.tool_name = ?
         AND ae.user_id = ?
         AND ate.start_time > datetime('now', '-${Number(lookbackDays) || 7} days')
       LIMIT 1000
    `, [toolName, userId]);

    return this._scoreFromToolRows({ rows, targetType: 'tool', targetId: toolName, userId });
  }

  static async forWorkflow({ workflowId, userId, lookbackDays = 7 }) {
    const rows = await getAll(`
      SELECT status, input_tokens, output_tokens, start_time, end_time
        FROM workflow_executions
       WHERE workflow_id = ?
         AND user_id = ?
         AND start_time > datetime('now', '-${Number(lookbackDays) || 7} days')
       LIMIT 1000
    `, [workflowId, userId]).catch(() => []);

    return this._scoreFromToolRows({ rows, targetType: 'workflow', targetId: workflowId, userId });
  }

  /**
   * Generic scoring over a rows array: rows must have `status`, `input_tokens`,
   * `output_tokens`, `start_time`, `end_time`. Falls back gracefully when fields
   * are missing.
   */
  static async _scoreFromToolRows({ rows, targetType, targetId, userId }) {
    const sampleSize = rows.length;
    if (sampleSize === 0) {
      return { score: 0, components: { successRate: 0, tokenEfficiency: 0, latencyEfficiency: 0, contractCleanliness: 1 }, sampleSize: 0 };
    }

    const successes = rows.filter((r) => r.status === 'completed').length;
    const successRate = successes / sampleSize;

    const totalTokens = rows.reduce((acc, r) => acc + (Number(r.input_tokens) || 0) + (Number(r.output_tokens) || 0), 0);
    const avgTokens = totalTokens / sampleSize;
    // Normalize: 0 tokens = 1.0; 20k tokens = 0.5; 50k tokens ≈ 0.2; >100k ≈ 0
    const tokenEfficiency = clamp01(1 - avgTokens / 100000);

    const latencies = rows
      .map((r) => (r.start_time && r.end_time) ? new Date(r.end_time).getTime() - new Date(r.start_time).getTime() : null)
      .filter((d) => Number.isFinite(d) && d > 0);
    const avgLatencyMs = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;
    // Normalize: 0ms = 1.0; 30s = 0.5; 60s ≈ 0; >2min → 0
    const latencyEfficiency = avgLatencyMs == null ? 0.5 : clamp01(1 - avgLatencyMs / 60000);

    // Contract cleanliness — based on recent violations against active contracts.
    let contractCleanliness = 1;
    try {
      const contracts = await ContractModel.findActiveByTarget(targetType, targetId);
      if (contracts.length > 0) {
        const totalViolations = contracts.reduce((acc, c) => acc + (c.violation_count || 0), 0);
        const totalEvidence = contracts.reduce((acc, c) => acc + (c.evidence_count || 0), 0);
        const denom = totalEvidence + totalViolations;
        contractCleanliness = denom > 0 ? clamp01(1 - totalViolations / denom) : 1;
      }
    } catch { /* contracts table optional */ }

    const components = { successRate, tokenEfficiency, latencyEfficiency, contractCleanliness };
    const score = clamp01(
      WEIGHTS.successRate * successRate +
      WEIGHTS.tokenEfficiency * tokenEfficiency +
      WEIGHTS.latencyEfficiency * latencyEfficiency +
      WEIGHTS.contractCleanliness * contractCleanliness
    );

    return { score: Math.round(score * 1000) / 1000, components, sampleSize, avgTokens, avgLatencyMs };
  }

  /**
   * Convenience: score whatever the mutation history row targeted.
   */
  static async forMutation(mutationId) {
    const mh = await MutationHistoryModel.findOne(mutationId);
    if (!mh) return null;
    if (mh.target_type === 'tool' && mh.target_id) return this.forTool({ toolName: mh.target_id, userId: mh.user_id });
    if (mh.target_type === 'workflow' && mh.target_id) return this.forWorkflow({ workflowId: mh.target_id, userId: mh.user_id });
    return null;
  }

  /**
   * Canary check: compare current fitness vs. fitness_before stored at apply time.
   * If current is materially worse, return { regression: true, delta } so the
   * caller (autonomy router or a periodic watchdog) can decide to revert.
   */
  static async canaryCheck(mutationId, { minDelta = -0.05 } = {}) {
    const mh = await MutationHistoryModel.findOne(mutationId);
    if (!mh || mh.status !== 'applied') return { regression: false, reason: 'not_applicable' };
    if (typeof mh.fitness_before !== 'number') return { regression: false, reason: 'no_baseline' };

    const after = await this.forMutation(mutationId);
    if (!after) return { regression: false, reason: 'no_after_score' };

    const delta = after.score - mh.fitness_before;
    await MutationHistoryModel.updateFitnessAfter(mutationId, after.score, delta).catch(() => {});

    if (delta < minDelta) {
      return { regression: true, delta, fitnessAfter: after.score };
    }
    return { regression: false, delta, fitnessAfter: after.score };
  }
}

export default FitnessScoreService;
