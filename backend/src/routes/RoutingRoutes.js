import express from 'express';
import { authenticateToken } from './Middleware.js';
import RoutingDecisionModel from '../models/RoutingDecisionModel.js';

/**
 * RoutingRoutes — read API over the router's own decision log.
 *
 * Read-only on purpose. The routing MODE is a user setting and is written
 * through /api/user/settings with the rest of them; this router only answers
 * "what has it been doing and what did that save", which is the question the
 * Settings panel actually asks.
 */
const RoutingRoutes = express.Router();

/**
 * GET /api/routing/summary?hours=24[&shadow=1]
 *
 * `savedUsd` counts only decisions where BOTH the chosen and baseline costs
 * were known, and reports `unpricedDecisions` alongside so a caller can tell a
 * small saving from an unmeasurable one. A savings number that silently treats
 * unknown as zero is the reason most routing claims cannot be reproduced.
 */
RoutingRoutes.get('/summary', authenticateToken, async (req, res) => {
  try {
    const hours = Number.parseInt(req.query.hours, 10);
    const shadow = req.query.shadow === undefined ? null : req.query.shadow === '1';
    const summary = await RoutingDecisionModel.summary(req.user.id, {
      sinceHours: Number.isFinite(hours) && hours > 0 ? Math.min(hours, 24 * 90) : 24,
      shadow,
    });
    res.json(summary);
  } catch (error) {
    console.error('[Routing] summary failed:', error);
    res.status(500).json({ error: 'Failed to load routing summary' });
  }
});

/** GET /api/routing/recent?limit=20 — the "why did it pick that" view. */
RoutingRoutes.get('/recent', authenticateToken, async (req, res) => {
  try {
    const limit = Number.parseInt(req.query.limit, 10);
    const rows = await RoutingDecisionModel.recent(
      req.user.id,
      Number.isFinite(limit) ? limit : 20
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        conversationId: r.conversation_id,
        origin: r.origin,
        mode: r.mode,
        policy: r.policy,
        stake: r.stake,
        verifiability: r.verifiability,
        chosen: { provider: r.chosen_provider, model: r.chosen_model, reason: r.chosen_reason },
        baseline: { provider: r.baseline_provider, model: r.baseline_model },
        predictedCostUsd: r.predicted_cost_usd,
        baselineCostUsd: r.baseline_cost_usd,
        candidatesConsidered: r.candidates_considered,
        shadow: !!r.shadow,
        ts: r.ts,
      }))
    );
  } catch (error) {
    console.error('[Routing] recent failed:', error);
    res.status(500).json({ error: 'Failed to load routing decisions' });
  }
});

export default RoutingRoutes;
