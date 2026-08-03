import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

/**
 * LlmCallModel — the execution ledger (PRD-122).
 *
 * One row per LLM request/response round-trip, written by exactly one caller:
 * services/execution/LedgerRecorder.js. Nothing else in the backend may INSERT
 * here — see LedgerRecorder.spec.js for the guard that enforces it.
 *
 * Grain is deliberately per-call, not per-execution: a single run can switch
 * model mid-flight, and per-execution rows would average that away. Per-call is
 * also the grain the provider bills at, so the ledger and the invoice line up.
 *
 * NULL COST IS NOT ZERO. getModelCost() returns null for a model with no
 * pricing metadata. Storing 0 in that case is exactly the defect this PRD was
 * filed against (ExecutionModel's `0 as estimated_cost`), so cost_usd stays
 * nullable and every aggregate reports the unpriced count alongside the sum.
 */

const dbGet = (q, p) => new Promise((res, rej) => db.get(q, p, (e, r) => (e ? rej(e) : res(r))));
const dbAll = (q, p) => new Promise((res, rej) => db.all(q, p, (e, r) => (e ? rej(e) : res(r || []))));
const dbRun = (q, p) =>
  new Promise((res, rej) =>
    db.run(q, p, function (e) {
      if (e) rej(e);
      else res(this);
    })
  );

/**
 * Recognised origins. A row must name where it came from.
 *
 * The first block mirrors `detectChatType()` one-for-one: these ARE the user-
 * facing chat surfaces (Orchestrator, Agent Forge, Workflow Forge, Tool Forge,
 * Widget Forge, Goals, Artifacts). They are listed individually and not folded
 * into a single 'chat' because folding them is exactly what made feature usage
 * unmeasurable for the first eight months of this table's life — the surface
 * was known at the call site and thrown away one line before the INSERT.
 *
 * `chatSurfaceOrigins.spec.js` fails the build if detectChatType() ever grows a
 * surface that is not listed here, so a new forge cannot silently vanish from
 * analytics again.
 *
 * 'chat' is retained for historical rows written before surfaces were split.
 */
export const CHAT_SURFACE_ORIGINS = Object.freeze([
  'orchestrator',
  'agent',
  'workflow',
  'tool',
  'widget',
  'goal',
  'artifact',
]);

export const ORIGINS = Object.freeze([
  ...CHAT_SURFACE_ORIGINS,
  'chat', // legacy: pre-split rows, and any surface we failed to classify
  'goal_task',
  'goal_eval',
  'workflow_node',
  'insight',
  'system',
]);

class LlmCallModel {
  /**
   * Insert one ledger row. Returns the new row id.
   *
   * `costUsd` / `uncachedCostUsd` are passed through verbatim — including null.
   * Callers must not coerce a missing price to 0.
   */
  static async create({
    userId,
    executionId = null,
    parentExecutionId = null,
    rootExecutionId = null,
    origin,
    originId = null,
    conversationId = null,
    provider,
    model,
    inputTokens = 0,
    outputTokens = 0,
    cacheReadTokens = 0,
    cacheCreation5mTokens = 0,
    cacheCreation1hTokens = 0,
    costUsd = null,
    uncachedCostUsd = null,
    isNotional = 0,
    durationMs = null,
    status = 'ok',
    error = null,
    // Explicit timestamp, used ONLY by the one-time backfill so a run from
    // March lands in March. Live recording always omits it and gets the
    // database clock — COALESCE, because passing NULL to a column with a
    // DEFAULT stores the NULL rather than the default.
    ts = null,
  }) {
    const id = generateUUID();
    await dbRun(
      `INSERT INTO llm_calls (
         id, user_id, execution_id, parent_execution_id, root_execution_id,
         origin, origin_id, conversation_id, provider, model,
         input_tokens, output_tokens, cache_read_tokens,
         cache_write_5m_tokens, cache_write_1h_tokens,
         cost_usd, uncached_cost_usd, is_notional,
         duration_ms, status, error, ts
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?, CURRENT_TIMESTAMP))`,
      [
        id, userId, executionId, parentExecutionId, rootExecutionId,
        origin, originId, conversationId, provider, model,
        inputTokens | 0, outputTokens | 0, cacheReadTokens | 0,
        cacheCreation5mTokens | 0, cacheCreation1hTokens | 0,
        costUsd, uncachedCostUsd, isNotional ? 1 : 0,
        durationMs, status, error, ts,
      ]
    );
    return id;
  }

  /** SELECT list shared by every aggregate, so the triple can never drift. */
  static get AGG_SELECT() {
    return `
      COALESCE(SUM(CASE WHEN is_notional = 0 THEN cost_usd ELSE 0 END), 0) AS cost_usd,
      COALESCE(SUM(CASE WHEN is_notional = 1 THEN cost_usd ELSE 0 END), 0) AS notional_usd,
      COALESCE(SUM(CASE WHEN is_notional = 0 THEN uncached_cost_usd ELSE 0 END), 0) AS uncached_cost_usd,
      -- Charged and notional are kept on separate axes all the way through.
      -- Pairing a notional actual against a charged baseline (or vice versa)
      -- would produce a savings figure that is arithmetic nonsense, and
      -- omitting the notional baseline entirely — as this first did — makes
      -- savedUsd a structural zero for every subscription user, which is
      -- exactly the audience for whom the savings number is the ONLY
      -- meaningful money on the page.
      COALESCE(SUM(CASE WHEN is_notional = 1 THEN uncached_cost_usd ELSE 0 END), 0) AS notional_uncached_cost_usd,
      SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced_calls,
      COUNT(*) AS calls,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(cache_write_5m_tokens + cache_write_1h_tokens), 0) AS cache_write_tokens`;
  }

  static _shape(row) {
    const r = row || {};
    return {
      costUsd: Number(r.cost_usd) || 0,
      notionalUsd: Number(r.notional_usd) || 0,
      uncachedCostUsd: Number(r.uncached_cost_usd) || 0,
      // Negative on a turn that writes a cache prefix (Anthropic cache writes
      // bill at 1.25x/2.0x). Reported honestly rather than clamped at zero —
      // a cache write is an investment, and hiding its cost would make the
      // savings figure a marketing number instead of a measurement.
      savedUsd: (Number(r.uncached_cost_usd) || 0) - (Number(r.cost_usd) || 0),
      notionalUncachedUsd: Number(r.notional_uncached_cost_usd) || 0,
      notionalSavedUsd: (Number(r.notional_uncached_cost_usd) || 0) - (Number(r.notional_usd) || 0),
      unpricedCalls: Number(r.unpriced_calls) || 0,
      calls: Number(r.calls) || 0,
      inputTokens: Number(r.input_tokens) || 0,
      outputTokens: Number(r.output_tokens) || 0,
      cacheReadTokens: Number(r.cache_read_tokens) || 0,
      cacheWriteTokens: Number(r.cache_write_tokens) || 0,
    };
  }

  /**
   * Totals for a user over a window.
   * `since` / `until` are ISO-ish strings compared against the UTC `ts` column.
   */
  static async summary(userId, { since = null, until = null } = {}) {
    const where = ['user_id = ?'];
    const params = [userId];
    if (since) { where.push('ts >= ?'); params.push(since); }
    if (until) { where.push('ts < ?'); params.push(until); }
    const row = await dbGet(
      `SELECT ${LlmCallModel.AGG_SELECT} FROM llm_calls WHERE ${where.join(' AND ')}`,
      params
    );
    return LlmCallModel._shape(row);
  }

  /**
   * Same totals, bucketed. `groupBy` is validated against a whitelist because
   * it is interpolated into SQL.
   */
  static async breakdown(userId, { groupBy = 'origin', since = null, until = null } = {}) {
    const COLUMNS = {
      origin: 'origin',
      provider: 'provider',
      model: 'model',
      origin_id: 'origin_id',
      conversation: 'conversation_id',
      day: `DATE(ts, 'localtime')`,
    };
    const col = COLUMNS[groupBy];
    if (!col) throw new Error(`Unsupported groupBy: ${groupBy}`);

    const where = ['user_id = ?'];
    const params = [userId];
    if (since) { where.push('ts >= ?'); params.push(since); }
    if (until) { where.push('ts < ?'); params.push(until); }

    const rows = await dbAll(
      `SELECT ${col} AS bucket, ${LlmCallModel.AGG_SELECT}
       FROM llm_calls WHERE ${where.join(' AND ')}
       GROUP BY bucket ORDER BY cost_usd DESC`,
      params
    );
    return rows.map((r) => ({ bucket: r.bucket, ...LlmCallModel._shape(r) }));
  }

  /** Per-execution rollup, used by the run tree. */
  static async byExecutionIds(executionIds = []) {
    if (!executionIds.length) return new Map();
    const marks = executionIds.map(() => '?').join(',');
    const rows = await dbAll(
      `SELECT execution_id, ${LlmCallModel.AGG_SELECT}
       FROM llm_calls WHERE execution_id IN (${marks}) GROUP BY execution_id`,
      executionIds
    );
    return new Map(rows.map((r) => [r.execution_id, LlmCallModel._shape(r)]));
  }

  /**
   * Ledger rows belonging to a run tree but with no agent_executions row of
   * their own — goal tasks and goal evaluations, which are real spend with no
   * execution record. Omitting them would make a subtree total quietly low.
   */
  static async unattachedForRoot(userId, rootExecutionId) {
    const rows = await dbAll(
      `SELECT origin, origin_id, ${LlmCallModel.AGG_SELECT}
       FROM llm_calls
       WHERE user_id = ? AND execution_id IS NULL AND root_execution_id = ?
       GROUP BY origin, origin_id`,
      [userId, rootExecutionId]
    );
    return rows.map((r) => ({ origin: r.origin, originId: r.origin_id, ...LlmCallModel._shape(r) }));
  }

  /**
   * Totals for a single origin row — e.g. one workflow execution's LLM spend.
   * Hits idx_llm_calls_origin directly rather than aggregating every bucket for
   * the user and discarding all but one.
   */
  static async summaryForOrigin(origin, originId) {
    const row = await dbGet(
      `SELECT ${LlmCallModel.AGG_SELECT} FROM llm_calls WHERE origin = ? AND origin_id = ?`,
      [origin, originId]
    );
    return LlmCallModel._shape(row);
  }

  /** Totals for one goal (tasks + evaluations), sourced from the ledger. */
  static async summaryForGoal(goalId) {
    const row = await dbGet(
      `SELECT ${LlmCallModel.AGG_SELECT}
       FROM llm_calls
       WHERE origin IN ('goal_task','goal_eval') AND origin_id = ?`,
      [goalId]
    );
    return LlmCallModel._shape(row);
  }

  /** Rows whose cost is currently unknown — the repricer's work queue. */
  static async findUnpriced(limit = 10000) {
    return dbAll(
      `SELECT id, provider, model, input_tokens, output_tokens,
              cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens
       FROM llm_calls WHERE cost_usd IS NULL LIMIT ?`,
      [limit]
    );
  }

  /**
   * Resolve a previously-unknown cost (PRD-122 repricer).
   *
   * Guarded by `cost_usd IS NULL` so it can only ever turn UNKNOWN into KNOWN
   * — a priced row is immutable no matter what the caller passes.
   */
  static async setPrice(id, { costUsd, uncachedCostUsd = null }) {
    const r = await dbRun(
      `UPDATE llm_calls SET cost_usd = ?, uncached_cost_usd = ?
       WHERE id = ? AND cost_usd IS NULL`,
      [costUsd, uncachedCostUsd, id]
    );
    return r.changes > 0;
  }

  /**
   * Record that a ledger write was dropped, keyed by process role (PRD-122).
   *
   * Best-effort by design: this is bookkeeping ABOUT bookkeeping, so a failure
   * here is swallowed rather than escalated. Callers must not await this for
   * correctness.
   */
  static async noteWriteFailure(source, message) {
    try {
      await dbRun(
        `INSERT INTO ledger_write_failures (source, failures, last_error, last_at)
         VALUES (?, 1, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(source) DO UPDATE SET
           failures = failures + 1,
           last_error = excluded.last_error,
           last_at = excluded.last_at`,
        [source, String(message || '').slice(0, 500)]
      );
    } catch {
      /* the console error in LedgerRecorder is the remaining signal */
    }
  }

  /** Dropped-write counts across EVERY process, not just the one answering. */
  static async writeFailures() {
    try {
      const rows = await dbAll(
        `SELECT source, failures, last_error, last_at FROM ledger_write_failures ORDER BY failures DESC`,
        []
      );
      return rows.map((r) => ({
        source: r.source,
        failures: Number(r.failures) || 0,
        lastError: r.last_error,
        lastAt: r.last_at,
      }));
    } catch {
      return [];
    }
  }

  static async countForUser(userId) {
    const row = await dbGet(`SELECT COUNT(*) AS n FROM llm_calls WHERE user_id = ?`, [userId]);
    return Number(row?.n) || 0;
  }
}

export default LlmCallModel;
