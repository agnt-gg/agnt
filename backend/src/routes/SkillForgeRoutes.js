import express from 'express';
import SkillForgeOrchestrator from '../services/goal/SkillForgeOrchestrator.js';
import SkillEvalModel from '../models/SkillEvalModel.js';
import SkillVersionModel from '../models/SkillVersionModel.js';
import { authenticateToken } from './Middleware.js';

const SkillForgeRoutes = express.Router();

// GET /api/skillforge/eligible-goals — List completed goals available for skill forging
SkillForgeRoutes.get('/eligible-goals', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const goals = await SkillForgeOrchestrator.getEligibleGoals(userId);
    res.json({ success: true, goals });
  } catch (error) {
    console.error('[SkillForge Route] Eligible goals error:', error);
    res.status(500).json({ error: 'Failed to fetch eligible goals' });
  }
});

// POST /api/skillforge/analyze/:goalId — Trigger trace analysis for a completed goal
SkillForgeRoutes.post('/analyze/:goalId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { goalId } = req.params;
    const analysis = await SkillForgeOrchestrator.analyzeGoal(goalId, userId);

    if (!analysis) {
      return res.json({ success: false, message: 'No analysis could be generated (insufficient data or low quality trace)' });
    }

    res.json({ success: true, analysis });
  } catch (error) {
    console.error('[SkillForge Route] Analyze error:', error);
    res.status(500).json({ error: 'Failed to analyze goal trace' });
  }
});

// POST /api/skillforge/evolve/:goalId — Trigger full analysis + evolution
SkillForgeRoutes.post('/evolve/:goalId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { goalId } = req.params;
    const result = await SkillForgeOrchestrator.analyzeAndEvolve(goalId, userId);
    res.json({ success: true, result });
  } catch (error) {
    console.error('[SkillForge Route] Evolve error:', error);
    res.status(500).json({ error: 'Failed to evolve skill from goal' });
  }
});

// GET /api/skillforge/evaluations — List all evaluations for the user
SkillForgeRoutes.get('/evaluations', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = parseInt(req.query.limit) || 50;
    const evaluations = await SkillEvalModel.findByUserId(userId, limit);
    res.json({ success: true, evaluations });
  } catch (error) {
    console.error('[SkillForge Route] Evaluations error:', error);
    res.status(500).json({ error: 'Failed to fetch evaluations' });
  }
});

// GET /api/skillforge/evaluations/:skillId — Get evaluations for a specific skill
SkillForgeRoutes.get('/evaluations/:skillId', authenticateToken, async (req, res) => {
  try {
    const evaluations = await SkillEvalModel.findBySkillId(req.params.skillId);
    res.json({ success: true, evaluations });
  } catch (error) {
    console.error('[SkillForge Route] Skill evaluations error:', error);
    res.status(500).json({ error: 'Failed to fetch skill evaluations' });
  }
});

// GET /api/skillforge/leaderboard — Top skills by average SES delta
SkillForgeRoutes.get('/leaderboard', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = parseInt(req.query.limit) || 20;
    const leaderboard = await SkillEvalModel.getLeaderboard(userId, limit);
    res.json({ success: true, leaderboard });
  } catch (error) {
    console.error('[SkillForge Route] Leaderboard error:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// GET /api/skillforge/skill/:skillId/versions — Version history for a skill
SkillForgeRoutes.get('/skill/:skillId/versions', authenticateToken, async (req, res) => {
  try {
    const versions = await SkillVersionModel.findBySkillId(req.params.skillId);
    res.json({ success: true, versions });
  } catch (error) {
    console.error('[SkillForge Route] Versions error:', error);
    res.status(500).json({ error: 'Failed to fetch skill versions' });
  }
});

// GET /api/skillforge/skill/:skillId/lineage — Full evolutionary lineage
SkillForgeRoutes.get('/skill/:skillId/lineage', authenticateToken, async (req, res) => {
  try {
    const lineage = await SkillVersionModel.getLineage(req.params.skillId);
    const stats = await SkillVersionModel.getEvolutionStats(req.params.skillId);
    res.json({ success: true, lineage, stats });
  } catch (error) {
    console.error('[SkillForge Route] Lineage error:', error);
    res.status(500).json({ error: 'Failed to fetch skill lineage' });
  }
});

// GET /api/skillforge/stats — Aggregate stats
SkillForgeRoutes.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const stats = await SkillForgeOrchestrator.getStats(userId);
    res.json({ success: true, stats });
  } catch (error) {
    console.error('[SkillForge Route] Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/skillforge/settings — Get SkillForge configuration
SkillForgeRoutes.get('/settings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const settings = await SkillForgeOrchestrator.getSettings(userId);
    res.json({ success: true, settings });
  } catch (error) {
    console.error('[SkillForge Route] Settings error:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// POST /api/skillforge/settings — Update SkillForge configuration
SkillForgeRoutes.post('/settings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const settings = await SkillForgeOrchestrator.updateSettings(userId, req.body);
    res.json({ success: true, settings });
  } catch (error) {
    console.error('[SkillForge Route] Settings update error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

console.log('SkillForge Routes Started...');

export default SkillForgeRoutes;
