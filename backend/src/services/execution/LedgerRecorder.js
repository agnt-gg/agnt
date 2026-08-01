import { getModelCost, isSubscriptionProvider } from '../ai/providerConfigs.js';
import LlmCallModel from '../../models/LlmCallModel.js';

/**
 * LedgerRecorder — the ONLY way an LLM call is recorded in AGNT (PRD-122).
 *
 * Before this existed, four subsystems called providers and each invented its
 * own bookkeeping: the orchestrator priced via computeCacheSavings, the goal
 * evaluator priced via a bare getModelCost, and the workflow node and goal task
 * paths did not price at all. Two of four were right, by coincidence rather
 * than by contract. This module is the contract.
 *
 * Two invariants make it trustworthy:
 *
 *   1. NULL, NEVER ZERO. getModelCost returns null for a model with no pricing
 *      metadata. A zero would be indistinguishable from "this was free", which
 *      is precisely the bug that made workflow spend invisible for months.
 *
 *   2. NEVER THROWS. A bookkeeping failure must not fail the user's actual
 *      work — discarding a provider response that already succeeded (and was
 *      already paid for) because an INSERT failed is strictly worse than
 *      losing the row. The failure is swallowed, logged, and counted. The
 *      counter is the part that matters: a silent swallow with no tripwire is
 *      how a meter dies without anyone noticing.
 */

/**
 * Which process this module instance is running in.
 *
 * AGNT runs the workflow engine as a SEPARATE OS process
 * (backend/src/workflow/WorkflowProcess.js) from the HTTP API (backend/server.js).
 * Both write LLM calls to the same SQLite file, but they do NOT share memory —
 * so an in-process counter exposed over HTTP can only ever see half the story.
 * Matches the existing convention in diagnostics/bootstrap.js.
 */
export const LEDGER_SOURCE = process.env.IS_WORKFLOW_PROCESS === 'true' ? 'workflow' : 'backend';

/**
 * Per-process counters.
 *
 * Kept because they always work — even when the database is the thing that is
 * broken, which is exactly when a DB-backed counter would also be lost. They
 * are reported with an explicit `scope`, never as a global guarantee; the
 * cross-process total comes from ledger_write_failures.
 */
const stats = { recorded: 0, failed: 0, lastError: null };

export function getLedgerStats() {
  return { ...stats, scope: LEDGER_SOURCE, pid: process.pid };
}

export function resetLedgerStats() {
  stats.recorded = 0;
  stats.failed = 0;
  stats.lastError = null;
}

/**
 * Normalise the many shapes providers report usage in.
 *
 * Anthropic says input_tokens/output_tokens, OpenAI-likes say
 * prompt_tokens/completion_tokens, and AGNT's own accumulators use
 * inputTokens/outputTokens. Accepting all three here means no call site has to
 * remember which dialect its provider speaks.
 *
 * IMPORTANT: `inputTokens` is the TRUE TOTAL input including cached tokens —
 * that is what getModelCost expects, and it is what lets the uncached baseline
 * be derived by simply omitting the cache breakdown.
 */
export function normalizeUsage(usage = {}) {
  const u = usage || {};
  const inputTokens =
    u.inputTokens ?? u.input_tokens ?? u.prompt_tokens ?? u.promptTokens ?? 0;
  const outputTokens =
    u.outputTokens ?? u.output_tokens ?? u.completion_tokens ?? u.completionTokens ?? 0;

  // Legacy single-bucket cache writes are treated as 5-minute, matching
  // getModelCost's own back-compat rule.
  const write5m =
    u.cacheCreation5mTokens ?? u.cache_creation_5m_tokens ?? u.cacheCreationTokens ?? u.cache_creation_input_tokens ?? 0;
  const write1h = u.cacheCreation1hTokens ?? u.cache_creation_1h_tokens ?? 0;

  return {
    inputTokens: Number(inputTokens) || 0,
    outputTokens: Number(outputTokens) || 0,
    cacheReadTokens: Number(u.cacheReadTokens ?? u.cache_read_tokens ?? u.cache_read_input_tokens ?? 0) || 0,
    cacheCreation5mTokens: Number(write5m) || 0,
    cacheCreation1hTokens: Number(write1h) || 0,
  };
}

/**
 * Record one LLM call.
 *
 * @param {object} p
 * @param {string} p.userId          required — the ledger is per-user
 * @param {string} [p.executionId]   agent_executions.id when one exists
 * @param {string} [p.parentExecutionId]
 * @param {string} [p.rootExecutionId]
 * @param {string} p.origin          one of LlmCallModel.ORIGINS
 * @param {string} [p.originId]      goal id, workflow execution id, node id…
 * @param {string} [p.conversationId]
 * @param {string} p.provider
 * @param {string} p.model
 * @param {object} p.usage           any provider usage shape (see normalizeUsage)
 * @param {number} [p.durationMs]
 * @param {string} [p.status]        'ok' | 'error' | 'aborted'
 * @param {string} [p.error]
 * @returns {Promise<string|null>}   row id, or null if nothing was recorded
 */
export async function recordLlmCall({
  userId,
  executionId = null,
  parentExecutionId = null,
  rootExecutionId = null,
  origin,
  originId = null,
  conversationId = null,
  provider,
  model,
  usage,
  durationMs = null,
  status = 'ok',
  error = null,
}) {
  try {
    if (!userId || !provider || !model || !origin) return null;

    const u = normalizeUsage(usage);
    // A call that reported no tokens and no error is not evidence of spend.
    // Recording it would inflate the call count without informing any total.
    if (u.inputTokens <= 0 && u.outputTokens <= 0 && status === 'ok') return null;

    const cache = {
      cacheReadTokens: u.cacheReadTokens,
      cacheCreation5mTokens: u.cacheCreation5mTokens,
      cacheCreation1hTokens: u.cacheCreation1hTokens,
    };

    const priced = getModelCost(provider, model, u.inputTokens, u.outputTokens, cache);
    // Same function, cache argument omitted: the "if nothing had been cached"
    // counterfactual. Deriving it here rather than re-implementing the
    // multiplier table means the two can never drift.
    const baseline = getModelCost(provider, model, u.inputTokens, u.outputTokens);

    const id = await LlmCallModel.create({
      userId,
      executionId,
      parentExecutionId,
      rootExecutionId: rootExecutionId || executionId || null,
      origin,
      originId,
      conversationId,
      provider,
      model,
      ...u,
      costUsd: priced ? priced.totalCost : null,
      uncachedCostUsd: baseline ? baseline.totalCost : null,
      isNotional: isSubscriptionProvider(provider) ? 1 : 0,
      durationMs,
      status,
      error,
    });

    stats.recorded += 1;
    return id;
  } catch (e) {
    stats.failed += 1;
    stats.lastError = e?.message || String(e);
    // eslint-disable-next-line no-console
    console.error('[Ledger] write failed — user work unaffected:', {
      origin, provider, model, source: LEDGER_SOURCE, error: stats.lastError,
    });
    // Persist so the failure is visible from whichever process is asked. Not
    // awaited: a slow or failing health write must not extend the user's turn.
    LlmCallModel.noteWriteFailure(LEDGER_SOURCE, stats.lastError);
    return null;
  }
}

/**
 * One-time backfill: inherit history the ledger was born without (PRD-122).
 *
 * The ledger started recording on 2026-08-01. Every run before that exists
 * only in agent_executions — which is why a spend panel over "last 30 days"
 * showed identical numbers to "last 1 day": there was nothing older to
 * include. The user's actual question, "what did I spend last month?", was
 * unanswerable from the table built to answer it.
 *
 * This is NOT the fabrication PRD-122 §N4 forbids. agent_executions rows carry
 * the cost that computeCacheSavings → getModelCost measured AT RUN TIME, plus
 * provider, model, token counts and the cache split. Copying a measurement is
 * inheritance; inventing one would be fabrication. Two consequences of that
 * stance:
 *
 *   - cost_usd is the STORED figure, not a recompute. Prices drift; the number
 *     measured when the run happened is the truthful one, and it is also what
 *     Traces has always displayed for that run — the two surfaces must agree.
 *   - uncached_cost_usd IS a recompute (the baseline was never persisted), so
 *     it is left NULL whenever getModelCost no longer knows the model. Savings
 *     for such rows read as unknown, not zero.
 *
 * Workflow history is backfilled separately by backfillFromNodeExecutions()
 * below, which recovers provider/model from the workflow definition.
 *
 * Idempotent two ways: a schema_markers row skips the scan on every later
 * boot, and a per-row NOT EXISTS makes a crash mid-backfill resumable — the
 * marker is only written after the scan completes.
 *
 * Lives in THIS file because ledgerContracts GUARD 2 pins LlmCallModel.create
 * to exactly one caller file, which is the property that makes the ledger
 * trustworthy at all.
 */
export async function backfillFromAgentExecutions() {
  const { default: db } = await import('../../models/database/index.js');
  const dbAll = (q, p = []) => new Promise((res, rej) => db.all(q, p, (e, r) => (e ? rej(e) : res(r || []))));
  const dbGet = (q, p = []) => new Promise((res, rej) => db.get(q, p, (e, r) => (e ? rej(e) : res(r))));
  const dbRunP = (q, p = []) => new Promise((res, rej) => db.run(q, p, function (e) { e ? rej(e) : res(this); }));

  const done = await dbGet(`SELECT marker FROM schema_markers WHERE marker = ?`, ['prd122_backfill_agent_executions']);
  if (done) return { backfilled: 0, skipped: true };

  // Runs with evidence of spend and no ledger row of their own. The NOT EXISTS
  // is what makes this safe to run alongside live recording: anything the
  // ledger already saw — including everything since it shipped — is untouched.
  const rows = await dbAll(
    `SELECT id, user_id, conversation_id, origin, root_execution_id, provider, model,
            input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
            estimated_cost, status, start_time, end_time
     FROM agent_executions ae
     WHERE (ae.estimated_cost > 0 OR ae.total_tokens > 0)
       AND ae.provider IS NOT NULL AND ae.model IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM llm_calls lc WHERE lc.execution_id = ae.id)`
  );

  let backfilled = 0;
  for (const ae of rows) {
    try {
      const provider = String(ae.provider).toLowerCase();
      const baseline = getModelCost(provider, ae.model, ae.input_tokens || 0, ae.output_tokens || 0);
      const durationMs = ae.start_time && ae.end_time ? new Date(ae.end_time) - new Date(ae.start_time) : null;

      await LlmCallModel.create({
        userId: ae.user_id,
        executionId: ae.id,
        rootExecutionId: ae.root_execution_id || ae.id,
        origin: ae.origin || 'chat',
        conversationId: ae.conversation_id,
        provider,
        model: ae.model,
        inputTokens: ae.input_tokens || 0,
        outputTokens: ae.output_tokens || 0,
        cacheReadTokens: ae.cache_read_tokens || 0,
        // Historical rows predate the 5m/1h split; the legacy single bucket was
        // 5-minute by definition, matching getModelCost's own back-compat rule.
        cacheCreation5mTokens: ae.cache_creation_tokens || 0,
        costUsd: ae.estimated_cost > 0 ? ae.estimated_cost : null,
        uncachedCostUsd: baseline ? baseline.totalCost : null,
        isNotional: isSubscriptionProvider(provider) ? 1 : 0,
        durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null,
        status: ae.status === 'failed' ? 'error' : 'ok',
        ts: new Date(ae.start_time).toISOString().replace('T', ' ').slice(0, 19),
      });
      backfilled += 1;
    } catch (e) {
      // One unreadable historical row must not abort the other 8,000. It stays
      // unbackfilled and the next boot retries it (marker not yet written).
      // eslint-disable-next-line no-console
      console.error('[Ledger] backfill skipped row', ae.id, e?.message);
    }
  }

  await dbRunP(`INSERT OR IGNORE INTO schema_markers (marker) VALUES (?)`, ['prd122_backfill_agent_executions']);
  // eslint-disable-next-line no-console
  console.log(`✓ Ledger backfill: inherited ${backfilled} historical run(s) from agent_executions (PRD-122)`);
  return { backfilled, skipped: false };
}

/**
 * One-time backfill of WORKFLOW LLM history (PRD-122).
 *
 * node_executions records input/output tokens for every LLM node run since
 * March, but no provider and no model — so 4,000+ real calls were invisible to
 * the ledger and "Workflows" read $0.73 across ninety days. The missing
 * columns are recoverable: a node's provider and model are declared in the
 * workflow definition, under `node.parameters`, which is exactly where the run
 * read them from at the time.
 *
 *   node_executions.node_id  →  workflows.workflow_data → nodes[].parameters
 *   node_executions.*_tokens →  the measured usage
 *
 * KNOWN LIMITATION, stated rather than hidden: the definition consulted is the
 * CURRENT one. If a node's model was changed after a run, that run is priced
 * with today's model. workflow_versions exists but covers a small minority of
 * these workflows, so using it would introduce a second, sparser code path for
 * marginal gain. The alternative — leaving four thousand calls invisible — is
 * far less accurate than a rate that is right for every unedited node.
 *
 * NO CACHE CLAIM. node_executions never stored the cache split, so these rows
 * price at standard rates and report zero savings. Assuming a hit rate to make
 * the savings figure look better would be inventing a measurement.
 *
 * Dedup is at the WORKFLOW EXECUTION level: any execution that already has a
 * workflow_node ledger row is skipped entirely. That is deliberately
 * conservative — a partially-recorded execution (only possible if a crash
 * interrupted it) is under-counted rather than double-counted, and it makes
 * the backfill idempotent even without its marker.
 */
export async function backfillFromNodeExecutions() {
  const { default: db } = await import('../../models/database/index.js');
  const dbAll = (q, p = []) => new Promise((res, rej) => db.all(q, p, (e, r) => (e ? rej(e) : res(r || []))));
  const dbGet = (q, p = []) => new Promise((res, rej) => db.get(q, p, (e, r) => (e ? rej(e) : res(r))));
  const dbRunP = (q, p = []) => new Promise((res, rej) => db.run(q, p, function (e) { e ? rej(e) : res(this); }));

  const done = await dbGet(`SELECT marker FROM schema_markers WHERE marker = ?`, ['prd122_backfill_node_executions']);
  if (done) return { backfilled: 0, skipped: true };

  const rows = await dbAll(
    `SELECT ne.node_id, ne.input_tokens, ne.output_tokens, ne.start_time, ne.end_time, ne.status,
            we.id AS wf_execution_id, we.workflow_id, we.user_id
     FROM node_executions ne
     JOIN workflow_executions we ON we.id = ne.execution_id
     WHERE (ne.input_tokens > 0 OR ne.output_tokens > 0)
       AND we.user_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM llm_calls lc
         WHERE lc.origin = 'workflow_node' AND lc.origin_id = we.id
       )`
  );
  if (rows.length === 0) {
    await dbRunP(`INSERT OR IGNORE INTO schema_markers (marker) VALUES (?)`, ['prd122_backfill_node_executions']);
    return { backfilled: 0, unresolved: 0, skipped: false };
  }

  // Node config, indexed per workflow. Parsed once — a definition is consulted
  // by every node execution that belongs to it.
  const nodeConfig = new Map();
  for (const w of await dbAll(`SELECT id, workflow_data FROM workflows`)) {
    try {
      const parsed = JSON.parse(w.workflow_data);
      const byId = new Map();
      for (const n of parsed?.nodes || []) byId.set(n.id, n.parameters || {});
      nodeConfig.set(w.id, byId);
    } catch {
      // A workflow whose definition will not parse simply resolves nothing;
      // its executions stay unpriced rather than guessed at.
    }
  }

  let backfilled = 0;
  let unresolved = 0;

  for (const ne of rows) {
    try {
      const params = nodeConfig.get(ne.workflow_id)?.get(ne.node_id);
      // A node deleted from its workflow since the run leaves no way to know
      // what model produced these tokens. Unknown, not guessed.
      if (!params?.provider || !params?.model) { unresolved += 1; continue; }

      const provider = String(params.provider).toLowerCase();
      const model = String(params.model);
      const inputTokens = ne.input_tokens || 0;
      const outputTokens = ne.output_tokens || 0;

      // No cache breakdown exists for these rows, so actual and baseline are
      // the same number and savings are correctly reported as zero.
      const cost = getModelCost(provider, model, inputTokens, outputTokens);
      const durationMs = ne.start_time && ne.end_time ? new Date(ne.end_time) - new Date(ne.start_time) : null;

      await LlmCallModel.create({
        userId: ne.user_id,
        origin: 'workflow_node',
        originId: ne.wf_execution_id,
        provider,
        model,
        inputTokens,
        outputTokens,
        costUsd: cost ? cost.totalCost : null,
        uncachedCostUsd: cost ? cost.totalCost : null,
        isNotional: isSubscriptionProvider(provider) ? 1 : 0,
        durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null,
        status: ne.status === 'failed' ? 'error' : 'ok',
        ts: new Date(ne.start_time).toISOString().replace('T', ' ').slice(0, 19),
      });
      backfilled += 1;
    } catch (e) {
      // One unreadable row must not abort the other four thousand.
      // eslint-disable-next-line no-console
      console.error('[Ledger] workflow backfill skipped node', ne.node_id, e?.message);
    }
  }

  await dbRunP(`INSERT OR IGNORE INTO schema_markers (marker) VALUES (?)`, ['prd122_backfill_node_executions']);
  // eslint-disable-next-line no-console
  console.log(`✓ Ledger backfill: inherited ${backfilled} historical workflow LLM call(s) from node_executions; ${unresolved} node(s) no longer exist in their workflow (PRD-122)`);
  return { backfilled, unresolved, skipped: false };
}

/**
 * A model that is genuinely free, as opposed to one whose price is unknown.
 *
 * `local/*` runs on the user's own hardware and OpenRouter's `:free` variants
 * are free by contract — for these, $0.00 is a TRUE cost, not a shrug. Keeping
 * this list tight is deliberate: everything else that cannot be priced stays
 * NULL, because "unknown" and "free" being distinguishable is the entire point
 * of the nullable column.
 */
function isGenuinelyFree(provider, model) {
  if (String(provider).toLowerCase() === 'local') return true;
  if (String(model).toLowerCase().endsWith(':free')) return true;
  return false;
}

/**
 * Reprice rows whose cost is unknown (PRD-122).
 *
 * Pricing comes from getModelCost ALONE — the same metadata system every
 * other cost in AGNT uses: static provider tables, plus the dynamic catalog
 * cache that provider APIs populate (persisted across restarts and hydrated
 * at boot by modelMetadataPersistence, with normalised-name matching for
 * vendor-prefixed and custom-provider spellings). There is deliberately no
 * second price table here: when a new model ships, it becomes priceable the
 * moment the metadata system learns it — from a catalog sync or a static
 * entry — and the next boot heals its history automatically.
 *
 * Three outcomes per row:
 *   1. getModelCost answers — priced at the known rate. An estimate, exactly
 *      as "estimated cost" is everywhere else in AGNT.
 *   2. Genuinely free models (local hardware, :free variants) — a true $0.00.
 *   3. Nothing prices it — STAYS NULL. Inventing a number here would be the
 *      fabrication the nullable column exists to prevent.
 *
 * Runs on every boot rather than behind a marker, and that is the feature: the
 * moment a model gains pricing metadata, history heals itself on the next
 * start. Idempotent by construction — setPrice only touches rows that are
 * still NULL, and a row it cannot price today costs one getModelCost call to
 * re-examine tomorrow.
 */
export async function repriceUnpricedCalls() {
  const rows = await LlmCallModel.findUnpriced();
  let priced = 0;
  let freed = 0;

  for (const row of rows) {
    try {
      if (isGenuinelyFree(row.provider, row.model)) {
        if (await LlmCallModel.setPrice(row.id, { costUsd: 0, uncachedCostUsd: 0 })) freed += 1;
        continue;
      }

      const cache = {
        cacheReadTokens: row.cache_read_tokens || 0,
        cacheCreation5mTokens: row.cache_write_5m_tokens || 0,
        cacheCreation1hTokens: row.cache_write_1h_tokens || 0,
      };
      const cost = getModelCost(row.provider, row.model, row.input_tokens || 0, row.output_tokens || 0, cache);
      if (!cost) continue; // honestly unknowable today; re-examined next boot

      const baseline = getModelCost(row.provider, row.model, row.input_tokens || 0, row.output_tokens || 0);
      if (await LlmCallModel.setPrice(row.id, {
        costUsd: cost.totalCost,
        uncachedCostUsd: baseline ? baseline.totalCost : null,
      })) priced += 1;
    } catch (e) {
      // One bad row must not abort the rest; it stays NULL and is re-examined
      // next boot.
      // eslint-disable-next-line no-console
      console.error('[Ledger] reprice skipped row', row.id, e?.message);
    }
  }

  const remaining = rows.length - priced - freed;
  if (priced || freed) {
    // eslint-disable-next-line no-console
    console.log(`✓ Ledger reprice: resolved ${priced} newly-priceable and ${freed} genuinely-free call(s); ${remaining} remain honestly unknown (PRD-122)`);
  }
  return { examined: rows.length, priced, freed, remaining };
}

export default {
  recordLlmCall,
  normalizeUsage,
  getLedgerStats,
  resetLedgerStats,
  backfillFromAgentExecutions,
  backfillFromNodeExecutions,
  repriceUnpricedCalls,
};
