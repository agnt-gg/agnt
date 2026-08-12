import crypto from 'crypto';
import db from '../../models/database/index.js';

/**
 * Novelty gate in front of insight extraction.
 *
 * ── THE PRODUCER IS THE PROBLEM ───────────────────────────────────────────
 * InsightTriggers.onWorkflowExecutionCompleted fires one LLM extraction per
 * workflow execution. A workflow on a 5-minute timer is 288 extractions/day,
 * forever, each one an LLM call that produces the same finding in slightly
 * different words. Measured on the live store: May 2026 alone wrote 50,194
 * memory rows, and the largest single cluster is 4,859 copies of "Duplicate
 * timer trigger execution".
 *
 * Deduping that downstream (see AgentMemoryModel + memorySimilarity) fixes the
 * table but still pays for every LLM call, and still burns the extraction
 * latency on every execution. The cheapest correct fix is upstream: don't
 * extract when nothing new happened.
 *
 * ── NOVELTY AS AN OUTCOME SIGNATURE ───────────────────────────────────────
 * "Nothing new happened" is defined structurally rather than by tuned
 * thresholds: hash the SHAPE of the outcome — overall status, the per-node
 * type+status multiset, and whether anything errored. A timer workflow that
 * succeeds identically produces a byte-identical signature every run, so it
 * extracts once and then goes quiet. The moment a node fails, a new node type
 * appears, or the workflow changes shape, the signature changes and extraction
 * fires immediately.
 *
 * That is the property worth having: it degrades to silence on the repetitive
 * case WITHOUT ever suppressing the anomalous one, which is the only case
 * anybody wanted an insight about. There is no threshold to tune and no
 * heuristic to drift.
 *
 * Durations are deliberately NOT in the signature. They vary continuously, so
 * including them would make every run novel and defeat the gate entirely —
 * exactly the trap that makes "detect the outlier" schemes collapse back into
 * "extract everything".
 */

/**
 * Re-extract a known signature at most this often.
 *
 * Not zero, because a recurring finding SHOULD refresh occasionally: evidence
 * ages, and a workflow that has been failing the same way for a week is worth
 * one reminder a day. 24h takes a 5-minute timer from 288 extractions/day to
 * 1 — a 99.7% reduction — while keeping the memory alive.
 */
export const EXTRACTION_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);

/**
 * Deterministic outcome signature for a workflow execution.
 *
 * Keyed on `node_id` — the actual column on node_executions. There is no
 * `node_type`; an earlier draft read one and, because it fell back with `||`,
 * silently collapsed every node to the constant "node" and produced a
 * signature that could not tell two different workflows apart. A gate that
 * degrades quietly is worse than no gate, so the column names are pinned by
 * ExtractionGate.test.js against the live schema.
 *
 * Sorted, so execution ORDER does not perturb it: parallel branches finish
 * nondeterministically and would otherwise look novel on every run.
 *
 * Note that repeated node_ids are preserved rather than de-duplicated. The
 * single most common finding in the store is "Duplicate timer trigger
 * execution" — a node genuinely running twice — so the multiset IS the signal.
 *
 * @param {object} execution      row from workflow_executions
 * @param {Array}  nodeExecutions rows from node_executions
 */
export function workflowSignature(execution, nodeExecutions = []) {
  const parts = nodeExecutions
    .map((n) => `${n.node_id ?? 'unknown'}:${n.status || 'unknown'}`)
    .sort();
  const anyError = nodeExecutions.some(
    (n) => n.status === 'failed' || n.status === 'error' || Boolean(n.error)
  );
  return hash([
    `status=${execution?.status || 'unknown'}`,
    `nodes=${parts.join(',')}`,
    `error=${anyError ? 1 : 0}`,
  ].join('|'));
}

/**
 * Deterministic procedure signature for a chat turn.
 *
 * WHY A CHAT NEEDS ONE. Skill evolution has only ever been reachable from a
 * Goal, because SES needs a fitness number and a goal evaluation is the only
 * fitness number in the system. A chat turn has none. But "is this worth
 * turning into a skill?" does not actually need a score — it needs evidence of
 * REUSE, and reuse is a count. The third time a turn has the same shape it is a
 * procedure, not an occurrence; that is what this hash makes countable.
 *
 * The shape is the SORTED MULTISET OF TOOL NAMES plus the agent. Sorted for the
 * same reason workflowSignature sorts — the model may reorder independent calls
 * between runs and that is not a different procedure. The multiset is preserved
 * rather than de-duplicated because "read three files then edit one" is a
 * genuinely different procedure from "read one file then edit one".
 *
 * Tool ARGUMENTS are deliberately excluded. They carry the specifics — this
 * repo, that host, yesterday's date — and including them would make every turn
 * novel by construction, which is the exact trap that durations are for
 * workflowSignature. Excluding them is also what makes the gate generalise:
 * three homelab sessions against three different machines collapse to one
 * signature, which is precisely the procedure worth writing down.
 *
 * The cost of being coarse is a possible collision between two unrelated tasks
 * that happen to use the same tools. That produces an over-general skill, not a
 * wrong one, and the LLM judge downstream still has to agree the trace is
 * reusable before anything is written.
 *
 * @param {object} execution      execution details (AgentExecutionModel shape)
 * @param {Array}  toolExecutions tool calls belonging to that execution
 */
export function chatSignature(execution, toolExecutions = []) {
  const tools = toolExecutions
    .map((t) => t?.toolName || t?.tool_name || 'unknown')
    .sort();
  return hash([
    `agent=${execution?.agentId || execution?.agent_id || 'orchestrator'}`,
    `tools=${tools.join(',')}`,
  ].join('|'));
}

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
});
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { return err ? reject(err) : resolve(this); });
});

/**
 * Should extraction run for this (source, scope, signature)?
 *
 * Records the sighting either way, so `occurrence_count` becomes a free census
 * of how often each outcome shape actually occurs — which is the number the
 * consolidation pass needs and which nobody currently has.
 *
 * FAILS OPEN. If the gate table is unavailable the answer is "extract": losing
 * an insight is a worse failure than paying for a redundant one, and this
 * whole module is an optimisation sitting in front of a non-critical path.
 *
 * @returns {Promise<{extract: boolean, reason: string, occurrences: number}>}
 */
export async function shouldExtract({ userId, sourceType, scopeId, signature, now = Date.now() }) {
  if (!userId || !sourceType || !scopeId || !signature) {
    return { extract: true, reason: 'ungated', occurrences: 0 };
  }
  try {
    const row = await dbGet(
      `SELECT occurrence_count, last_extracted_at FROM extraction_gate
       WHERE user_id = ? AND source_type = ? AND scope_id = ? AND signature = ?`,
      [userId, sourceType, scopeId, signature]
    );
    const nowIso = new Date(now).toISOString();

    if (!row) {
      await dbRun(
        `INSERT INTO extraction_gate
           (user_id, source_type, scope_id, signature, occurrence_count, first_seen_at, last_seen_at, last_extracted_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        [userId, sourceType, scopeId, signature, nowIso, nowIso, nowIso]
      );
      return { extract: true, reason: 'novel', occurrences: 1 };
    }

    const occurrences = (row.occurrence_count || 0) + 1;
    const last = row.last_extracted_at ? Date.parse(row.last_extracted_at) : 0;
    const due = !Number.isFinite(last) || (now - last) >= EXTRACTION_COOLDOWN_MS;

    await dbRun(
      `UPDATE extraction_gate
         SET occurrence_count = ?, last_seen_at = ?${due ? ', last_extracted_at = ?' : ''}
       WHERE user_id = ? AND source_type = ? AND scope_id = ? AND signature = ?`,
      due
        ? [occurrences, nowIso, nowIso, userId, sourceType, scopeId, signature]
        : [occurrences, nowIso, userId, sourceType, scopeId, signature]
    );

    return {
      extract: due,
      reason: due ? 'cooldown-elapsed' : 'repeat-suppressed',
      occurrences,
    };
  } catch (err) {
    console.error('[ExtractionGate] probe failed, extracting anyway:', err.message);
    return { extract: true, reason: 'gate-error', occurrences: 0 };
  }
}

export default { shouldExtract, workflowSignature, chatSignature, EXTRACTION_COOLDOWN_MS };
