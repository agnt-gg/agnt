import express from 'express';
import db from '../models/database/index.js';
import LlmCallModel from '../models/LlmCallModel.js';
import { getLedgerStats } from '../services/execution/LedgerRecorder.js';
import { authenticateToken } from './Middleware.js';

/**
 * LedgerRoutes — read API over the execution ledger (PRD-122).
 *
 * Every monetary response carries the same triple: charged cost, the count of
 * calls that could not be priced, and notional (subscription) cost. A total
 * that silently omits unpriced calls would reintroduce the defect this ledger
 * was built to fix, one layer up — so the shape makes omission impossible.
 */

const LedgerRoutes = express.Router();

const dbAll = (q, p) => new Promise((res, rej) => db.all(q, p, (e, r) => (e ? rej(e) : res(r || []))));

/** Local-midnight boundary as a UTC string, matching the `ts` column. */
function startOfLocalDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().replace('T', ' ').slice(0, 19);
}

function windowFrom(query) {
  const { since, until, window } = query || {};
  if (since || until) return { since: since || null, until: until || null };
  if (window === 'today' || !window) return { since: startOfLocalDay(), until: null };
  const days = Number(String(window).replace(/\D/g, '')) || 7;
  const d = new Date(Date.now() - days * 86400000);
  return { since: d.toISOString().replace('T', ' ').slice(0, 19), until: null };
}

// GET /api/ledger/summary?window=today|7d|30d  |  ?since=&until=
LedgerRoutes.get('/summary', authenticateToken, async (req, res) => {
  try {
    const totals = await LlmCallModel.summary(req.user.userId, windowFrom(req.query));

    // Health must span EVERY process. AGNT runs the workflow engine out of
    // process, so `getLedgerStats()` alone describes only the process that
    // happened to answer this request — it would report a serene zero while
    // the workflow process dropped every write. `byProcess` is the real
    // tripwire; `thisProcess` is labelled with its own scope so it cannot be
    // mistaken for a global figure.
    const byProcess = await LlmCallModel.writeFailures();
    res.json({
      success: true,
      ...totals,
      ledgerHealth: {
        totalFailures: byProcess.reduce((s, r) => s + r.failures, 0),
        byProcess,
        thisProcess: getLedgerStats(),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ledger/breakdown?groupBy=origin|provider|model|day|origin_id|conversation
LedgerRoutes.get('/breakdown', authenticateToken, async (req, res) => {
  try {
    const rows = await LlmCallModel.breakdown(req.user.userId, {
      groupBy: req.query.groupBy || 'origin',
      ...windowFrom(req.query),
    });
    res.json({ success: true, groupBy: req.query.groupBy || 'origin', rows });
  } catch (err) {
    // An unsupported groupBy is a client error, not a server fault.
    const status = /Unsupported groupBy/.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * GET /api/ledger/tree/:executionId
 *
 * The run tree rooted at the given execution, with per-node and subtree cost.
 * Includes ledger rows that have no execution row of their own (goal tasks and
 * evaluations) — omitting them would make the subtree total quietly low.
 */
LedgerRoutes.get('/tree/:executionId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { executionId } = req.params;

    const seed = await dbAll(
      `SELECT id, root_execution_id FROM agent_executions WHERE id = ? AND user_id = ?`,
      [executionId, userId]
    );
    if (!seed.length) return res.status(404).json({ error: 'Execution not found' });
    const rootId = seed[0].root_execution_id || seed[0].id;

    const rows = await dbAll(
      `SELECT id, parent_execution_id, root_execution_id, agent_id, agent_name, origin,
              status, start_time, end_time, provider, model, tool_calls_count
       FROM agent_executions
       WHERE user_id = ? AND (root_execution_id = ? OR id = ?)
       ORDER BY start_time`,
      [userId, rootId, rootId]
    );

    const costs = await LlmCallModel.byExecutionIds(rows.map((r) => r.id));
    const unattached = await LlmCallModel.unattachedForRoot(userId, rootId);

    const nodes = rows.map((r) => ({
      id: r.id,
      parentExecutionId: r.parent_execution_id,
      agentId: r.agent_id,
      agentName: r.agent_name,
      origin: r.origin || 'chat',
      status: r.status,
      startTime: r.start_time,
      endTime: r.end_time,
      provider: r.provider,
      model: r.model,
      toolCallsCount: r.tool_calls_count,
      ledger: costs.get(r.id) || null,
    }));

    const sum = (acc, t) => {
      acc.costUsd += t.costUsd;
      acc.notionalUsd += t.notionalUsd;
      acc.unpricedCalls += t.unpricedCalls;
      acc.calls += t.calls;
      return acc;
    };
    const subtree = [...costs.values()]
      .concat(unattached)
      .reduce(sum, { costUsd: 0, notionalUsd: 0, unpricedCalls: 0, calls: 0 });

    res.json({ success: true, rootExecutionId: rootId, nodes, unattached, subtree });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default LedgerRoutes;
