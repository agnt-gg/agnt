import express from 'express';
import LlmCallModel from '../models/LlmCallModel.js';
import AgentExecutionModel from '../models/AgentExecutionModel.js';
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

/**
 * Local midnight, `daysAgo` days back, as a UTC string matching the `ts` column.
 *
 * setHours AFTER setDate on purpose: it re-normalises to local midnight of the
 * target date, so a DST transition inside the window cannot shift the boundary
 * by an hour.
 */
function startOfLocalDay(daysAgo = 0) {
  const d = new Date();
  if (daysAgo) d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Resolve a query into a time window.
 *
 * `Nd` means N CALENDAR DAYS back to local midnight — not a rolling N×24 hours.
 * That distinction is load-bearing: the dashboard usage chart asks for calendar
 * dates and the rollup groups them with DATE(..., 'localtime'), so a rolling
 * window would start up to 24h later than the chart's and the two figures would
 * never reconcile. Anyone comparing them would reasonably conclude one was
 * wrong. Same boundary, same buckets.
 */
function windowFrom(query) {
  const { since, until, window } = query || {};
  if (since || until) return { since: since || null, until: until || null };
  if (window === 'today' || !window) return { since: startOfLocalDay(), until: null };
  const days = Number(String(window).replace(/\D/g, '')) || 7;
  return { since: startOfLocalDay(days), until: null };
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
    // Shared with the trace detail view (AgentExecutionModel.getRunTree) so the
    // two surfaces cannot disagree about what a run tree cost.
    const tree = await AgentExecutionModel.getRunTree(req.params.executionId, req.user.userId);
    if (!tree) return res.status(404).json({ error: 'Execution not found' });
    res.json({ success: true, ...tree });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default LedgerRoutes;
