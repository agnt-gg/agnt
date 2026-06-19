import ContractModel from '../../models/ContractModel.js';
import db from '../../models/database/index.js';

/**
 * ContractsService — runtime predicate check for refinement-type contracts
 * (PRD-091 Layer 5).
 *
 * Two public entry points:
 *   - check(target, runtimeState) — evaluate active predicates, record
 *     violations, return {pass, violations[]}
 *   - mineForTool(toolName, userId) — analyze recent tool executions and
 *     propose new contracts (numeric bounds) when invariants hold across
 *     many runs.
 */

function pickField(state, fieldPath) {
  if (!fieldPath) return undefined;
  return fieldPath.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), state);
}

function evalPredicate(predicate, state) {
  switch (predicate.type) {
    case 'numeric_bound': {
      const v = Number(pickField(state, predicate.field));
      if (!Number.isFinite(v)) return { pass: true, value: v }; // missing == not applicable
      if (typeof predicate.max === 'number' && v > predicate.max) return { pass: false, value: v };
      if (typeof predicate.min === 'number' && v < predicate.min) return { pass: false, value: v };
      return { pass: true, value: v };
    }
    case 'always_succeeds': {
      const v = pickField(state, predicate.field || 'status');
      const expect = predicate.equals || 'completed';
      return { pass: v === expect, value: v };
    }
    case 'never_value': {
      const v = pickField(state, predicate.field);
      const forbidden = Array.isArray(predicate.forbidden) ? predicate.forbidden : [];
      return { pass: !forbidden.includes(v), value: v };
    }
    default:
      // Unknown predicate types pass by default — forward-compat for new vocab.
      return { pass: true, value: null };
  }
}

class ContractsService {
  /**
   * Evaluate all active contracts for a target against runtimeState.
   * @returns {{pass: boolean, violations: Array<{contractId, name, value}>}}
   */
  static async check({ targetType, targetId, runtimeState, sourceExecutionId }) {
    if (!targetType) return { pass: true, violations: [] };
    const contracts = await ContractModel.findActiveByTarget(targetType, targetId);
    if (!contracts.length) return { pass: true, violations: [] };

    const violations = [];
    for (const c of contracts) {
      const res = evalPredicate(c.predicate || {}, runtimeState || {});
      if (res.pass) {
        await ContractModel.incrementEvidence(c.id).catch(() => {});
      } else {
        violations.push({ contractId: c.id, name: c.name, value: res.value, predicate: c.predicate });
        await ContractModel.recordViolation({
          contractId: c.id,
          targetType, targetId,
          runtimeValue: res.value,
          severity: c.predicate?.severity || 'warn',
          sourceExecutionId,
        }).catch((err) => console.warn('[Contracts] Failed to record violation:', err.message));
      }
    }
    return { pass: violations.length === 0, violations };
  }

  /**
   * Mine numeric invariants for one tool across recent successful executions.
   * Proposes a contract per numeric field when the spread is tight enough.
   */
  static async mineForTool({ toolName, userId, lookbackDays = 7, minSamples = 10 }) {
    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT ate.*, ae.user_id
           FROM agent_tool_executions ate
           JOIN agent_executions ae ON ate.execution_id = ae.id
          WHERE ate.tool_name = ?
            AND ae.user_id = ?
            AND ate.status = 'completed'
            AND ate.start_time > datetime('now', '-${Number(lookbackDays) || 7} days')
          ORDER BY ate.start_time DESC
          LIMIT 500`,
        [toolName, userId],
        (err, r) => (err ? reject(err) : resolve(r || []))
      );
    });

    if (rows.length < minSamples) return [];

    const fields = {
      input_tokens: [],
      output_tokens: [],
      duration_ms: [],
    };

    for (const row of rows) {
      if (Number.isFinite(row.input_tokens)) fields.input_tokens.push(row.input_tokens);
      if (Number.isFinite(row.output_tokens)) fields.output_tokens.push(row.output_tokens);
      if (row.start_time && row.end_time) {
        const d = new Date(row.end_time).getTime() - new Date(row.start_time).getTime();
        if (Number.isFinite(d) && d > 0) fields.duration_ms.push(d);
      }
    }

    const proposals = [];
    for (const [field, samples] of Object.entries(fields)) {
      if (samples.length < minSamples) continue;
      const max = Math.max(...samples);
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      // Propose a generous upper bound: 2x the max we've seen, rounded.
      const proposedMax = Math.ceil(max * 2 / 10) * 10;
      const confidence = Math.min(0.9, 0.5 + samples.length / 100);
      proposals.push({
        userId,
        targetType: 'tool',
        targetId: toolName,
        name: `${toolName}.${field}_upper_bound`,
        predicate: { type: 'numeric_bound', field, max: proposedMax, severity: 'warn' },
        confidence,
        evidence: { samples: samples.length, observedMax: max, observedMean: Math.round(mean) },
      });
    }
    return proposals;
  }

  /**
   * Persist a list of mined proposals as active contracts (used by the
   * autonomy router and by the periodic miner). Skips duplicates by
   * target+name.
   */
  static async persistProposals(proposals) {
    const stored = [];
    for (const p of proposals) {
      const existing = await ContractModel.findActiveByTarget(p.targetType, p.targetId);
      const dup = existing.find((c) => c.name === p.name);
      if (dup) {
        await ContractModel.incrementEvidence(dup.id).catch(() => {});
        continue;
      }
      const id = await ContractModel.create({
        userId: p.userId,
        targetType: p.targetType,
        targetId: p.targetId,
        name: p.name,
        predicate: p.predicate,
        source: p.source || 'mined',
        confidence: p.confidence,
      });
      stored.push(id);
    }
    return stored;
  }
}

export default ContractsService;
