import db from '../../models/database/index.js';
import InsightModel from '../../models/InsightModel.js';
import FitnessScoreService from './FitnessScoreService.js';
import EvolutionPerformanceSnapshotModel from '../../models/EvolutionPerformanceSnapshotModel.js';

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

async function getAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}

/**
 * PerformanceMonitor
 *
 * Produces a lightweight, explainable telemetry snapshot for a user.
 * This is the "performance monitoring" primitive that other evolution layers
 * can build on.
 */
class PerformanceMonitor {
  static async snapshotUser(userId, { lookbackDays = 7, toolLimit = 15, persist = true } = {}) {
    // Insight backlog + throughput
    const statusCounts = await InsightModel.getStatusCounts(userId).catch(() => ({ pending: 0, applied: 0, rejected: 0, superseded: 0 }));

    // Tool usage rollup
    const toolRows = await getAll(`
      SELECT ate.tool_name as tool_name, COUNT(*) as call_count
        FROM agent_tool_executions ate
        JOIN agent_executions ae ON ate.execution_id = ae.id
       WHERE ae.user_id = ?
         AND ate.start_time > datetime('now', '-${Number(lookbackDays) || 7} days')
       GROUP BY ate.tool_name
       ORDER BY call_count DESC
       LIMIT ?
    `, [userId, toolLimit]).catch(() => []);

    // Fitness for top tools (advisory; never blocks)
    const toolFitness = [];
    for (const row of toolRows) {
      const toolName = row.tool_name;
      try {
        const fit = await FitnessScoreService.forTool({ toolName, userId, lookbackDays });
        toolFitness.push({ toolName, callCount: row.call_count, ...fit });
      } catch {
        toolFitness.push({ toolName, callCount: row.call_count, score: 0, components: null, sampleSize: 0 });
      }
    }

    // Aggregate tool success rate (simple; uses raw counts)
    const totals = await getAll(`
      SELECT
        COUNT(*) as call_count,
        SUM(CASE WHEN ate.status = 'completed' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN ate.status = 'failed' THEN 1 ELSE 0 END) as fail_count
      FROM agent_tool_executions ate
      JOIN agent_executions ae ON ate.execution_id = ae.id
      WHERE ae.user_id = ?
        AND ate.start_time > datetime('now', '-${Number(lookbackDays) || 7} days')
    `, [userId]).catch(() => [{ call_count: 0, success_count: 0, fail_count: 0 }]);

    const callCount = Number(totals?.[0]?.call_count) || 0;
    const successCount = Number(totals?.[0]?.success_count) || 0;
    const failCount = Number(totals?.[0]?.fail_count) || 0;
    const toolSuccessRate = callCount > 0 ? successCount / callCount : 0;

    const snapshot = {
      schema: 'AGNT_EVOLUTION_PERFORMANCE_SNAPSHOT.v0.1',
      userId,
      lookbackDays,
      generatedAt: new Date().toISOString(),
      insights: {
        pending: statusCounts.pending || 0,
        applied: statusCounts.applied || 0,
        rejected: statusCounts.rejected || 0,
        superseded: statusCounts.superseded || 0,
      },
      tools: {
        callCount,
        successCount,
        failCount,
        successRate: Math.round(toolSuccessRate * 1000) / 1000,
        topTools: toolFitness,
      },
    };

    // A simple scalar summary score — not used as authority, only monitoring.
    // Bias: prefer high tool success and low insight backlog.
    const backlogPenalty = clamp01(1 - (snapshot.insights.pending / 500));
    const score = clamp01(0.7 * snapshot.tools.successRate + 0.3 * backlogPenalty);
    snapshot.score = Math.round(score * 1000) / 1000;

    if (persist) {
      await EvolutionPerformanceSnapshotModel.create({
        userId,
        scope: 'user',
        targetType: null,
        targetId: null,
        metrics: snapshot,
        score: snapshot.score,
        notes: `lookbackDays=${lookbackDays}`,
      }).catch(() => {});
    }

    return snapshot;
  }
}

export default PerformanceMonitor;
