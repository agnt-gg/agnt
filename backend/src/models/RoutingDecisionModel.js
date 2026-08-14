import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

/**
 * RoutingDecisionModel — what the router chose, and what it would have cost
 * to do the obvious thing instead.
 *
 * ── WHY THE COUNTERFACTUAL IS THE POINT ──────────────────────────────────
 * Recording only the chosen model produces a log that can never be graded: it
 * says the router picked Haiku, not whether picking Haiku was right. Every
 * row therefore carries the BASELINE — the provider/model the account default
 * would have used for the same turn — and both estimated costs. Savings are
 * then a subtraction over real traffic rather than a marketing multiplier.
 *
 * `shadow = 1` marks a decision that was computed and recorded but NOT
 * executed. That is what lets the router be evaluated against a user's actual
 * workload before it is permitted to change a single request.
 *
 * WRITES ARE BEST-EFFORT AND NEVER BLOCK A TURN. This is observability about
 * a request, not part of serving it; a failure here must degrade the audit
 * trail, never the answer. It is deliberately NOT part of the llm_calls
 * ledger, whose single-writer contract (LedgerRecorder) exists precisely so
 * money-bearing rows have exactly one author.
 * ─────────────────────────────────────────────────────────────────────────
 */
class RoutingDecisionModel {
  /**
   * @param {object} d
   * @param {string} d.userId
   * @param {boolean} [d.shadow]  computed but not executed
   * @returns {Promise<string|null>} row id, or null if the write was dropped
   */
  static async record({
    userId,
    conversationId = null,
    origin = null,
    mode = null,
    policy = null,
    stake = null,
    verifiability = null,
    chosenProvider = null,
    chosenModel = null,
    chosenReason = null,
    baselineProvider = null,
    baselineModel = null,
    predictedCostUsd = null,
    baselineCostUsd = null,
    candidatesConsidered = null,
    shadow = false,
    chain = null,
  }) {
    if (!userId) return null;
    const id = generateUUID();
    try {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO routing_decisions (
             id, user_id, conversation_id, origin, mode, policy, stake, verifiability,
             chosen_provider, chosen_model, chosen_reason,
             baseline_provider, baseline_model,
             predicted_cost_usd, baseline_cost_usd, candidates_considered, shadow, chain
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id, userId, conversationId, origin, mode, policy, stake, verifiability,
            chosenProvider, chosenModel, chosenReason,
            baselineProvider, baselineModel,
            // Costs pass through verbatim INCLUDING null. A missing estimate is
            // not a zero estimate — the same rule the llm_calls ledger follows,
            // for the same reason: a fabricated zero silently wins every
            // comparison it enters.
            predictedCostUsd, baselineCostUsd, candidatesConsidered,
            shadow ? 1 : 0,
            chain ? JSON.stringify(chain).slice(0, 4000) : null,
          ],
          (err) => (err ? reject(err) : resolve())
        );
      });
      return id;
    } catch (err) {
      console.warn('[RoutingDecision] write dropped (non-fatal):', err.message);
      return null;
    }
  }

  /**
   * Rollup for the Settings panel.
   *
   * `savedUsd` counts only rows where BOTH costs are known. A row with an
   * unpriced model contributes to `unpriced` instead, so the headline figure
   * is never inflated by treating "we don't know" as "we saved everything".
   */
  static async summary(userId, { sinceHours = 24, shadow = null } = {}) {
    const where = ['user_id = ?', `ts >= datetime('now', ?)`];
    const params = [userId, `-${Math.max(1, Math.floor(sinceHours))} hours`];
    if (shadow !== null) { where.push('shadow = ?'); params.push(shadow ? 1 : 0); }

    const row = await new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) AS decisions,
                SUM(CASE WHEN predicted_cost_usd IS NOT NULL AND baseline_cost_usd IS NOT NULL
                         THEN baseline_cost_usd - predicted_cost_usd ELSE 0 END) AS saved_usd,
                SUM(CASE WHEN predicted_cost_usd IS NOT NULL THEN predicted_cost_usd ELSE 0 END) AS predicted_usd,
                SUM(CASE WHEN predicted_cost_usd IS NULL OR baseline_cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced
         FROM routing_decisions WHERE ${where.join(' AND ')}`,
        params,
        (err, r) => (err ? reject(err) : resolve(r))
      );
    }).catch(() => null);

    const models = await new Promise((resolve) => {
      db.all(
        `SELECT chosen_provider AS provider, chosen_model AS model, COUNT(*) AS n
         FROM routing_decisions WHERE ${where.join(' AND ')}
         GROUP BY chosen_provider, chosen_model ORDER BY n DESC LIMIT 8`,
        params,
        (err, rows) => resolve(err ? [] : rows || [])
      );
    });

    const decisions = Number(row?.decisions) || 0;
    return {
      decisions,
      savedUsd: Number(row?.saved_usd) || 0,
      predictedUsd: Number(row?.predicted_usd) || 0,
      unpricedDecisions: Number(row?.unpriced) || 0,
      distribution: models.map((m) => ({
        provider: m.provider,
        model: m.model,
        calls: Number(m.n) || 0,
        share: decisions > 0 ? (Number(m.n) || 0) / decisions : 0,
      })),
    };
  }

  /** Most recent decisions, newest first — the "why did it pick that" view. */
  static async recent(userId, limit = 20) {
    return new Promise((resolve) => {
      db.all(
        `SELECT id, conversation_id, origin, mode, policy, stake, verifiability,
                chosen_provider, chosen_model, chosen_reason,
                baseline_provider, baseline_model,
                predicted_cost_usd, baseline_cost_usd, candidates_considered, shadow, ts
         FROM routing_decisions WHERE user_id = ?
         ORDER BY ts DESC LIMIT ?`,
        [userId, Math.min(Math.max(1, limit | 0), 200)],
        (err, rows) => resolve(err ? [] : rows || [])
      );
    });
  }
}

export default RoutingDecisionModel;
