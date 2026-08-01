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

export default { recordLlmCall, normalizeUsage, getLedgerStats, resetLedgerStats };
