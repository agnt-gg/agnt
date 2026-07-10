import express from 'express';
import { authenticateToken } from './Middleware.js';
import EvolutionPerformanceSnapshotModel from '../models/EvolutionPerformanceSnapshotModel.js';
import EvolutionCoreRunModel from '../models/EvolutionCoreRunModel.js';

const EvolutionCoreRoutes = express.Router();

// POST /api/evolution/core/run
// Runs the built-in evolution loop in recommendation-first mode.
EvolutionCoreRoutes.post('/core/run', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      lookbackDays,
      pendingInsightLimit,
      populationSize,
      generations,
      eliteCount,
      apply,
    } = req.body || {};

    // Defensive clamps: GA work is synchronous/CPU-bound.
    const lookback = Math.max(1, Math.min(Number(lookbackDays) || 7, 90));
    const pendingLimit = Math.max(1, Math.min(Number(pendingInsightLimit) || 250, 5000));
    const pop = Math.max(1, Math.min(Number(populationSize) || 24, 200));
    const gens = Math.max(1, Math.min(Number(generations) || 10, 50));
    const elite = Math.max(1, Math.min(Number(eliteCount) || 6, pop));

    const CoreEvolutionSystem = (await import('../services/evolution/CoreEvolutionSystem.js')).default;
    const recommendation = await CoreEvolutionSystem.runForUser(userId, {
      lookbackDays: lookback,
      pendingInsightLimit: pendingLimit,
      populationSize: pop,
      generations: gens,
      eliteCount: elite,
      apply: !!apply,
    });

    res.json({ success: true, recommendation });
  } catch (error) {
    console.error('[EvolutionCoreRoutes] run error:', error);
    res.status(500).json({ error: 'Failed to run core evolution', details: error.message });
  }
});

// GET /api/evolution/core/snapshots
// GET /api/evolution/core/runs
EvolutionCoreRoutes.get('/core/runs', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { limit } = req.query;
    const runs = await EvolutionCoreRunModel.findRecentByUser(userId, {
      limit: Math.max(1, Math.min(Number(limit) || 200, 2000)),
    });
    res.json({ success: true, runs });
  } catch (error) {
    console.error('[EvolutionCoreRoutes] runs error:', error);
    res.status(500).json({ error: 'Failed to fetch core evolution runs', details: error.message });
  }
});

EvolutionCoreRoutes.get('/core/snapshots', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { limit } = req.query;
    const snapshots = await EvolutionPerformanceSnapshotModel.findRecentByUser(userId, {
      scope: 'user',
      limit: Math.max(1, Math.min(Number(limit) || 200, 2000)),
    });
    res.json({ success: true, snapshots });
  } catch (error) {
    console.error('[EvolutionCoreRoutes] snapshots error:', error);
    res.status(500).json({ error: 'Failed to fetch snapshots', details: error.message });
  }
});

console.log('Evolution Core Routes Started...');
export default EvolutionCoreRoutes;
