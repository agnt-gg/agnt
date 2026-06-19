import express from 'express';
import MutationHistoryModel from '../models/MutationHistoryModel.js';
import FitnessScoreService from '../services/evolution/FitnessScoreService.js';
import { authenticateToken } from './Middleware.js';

const MutationHistoryRoutes = express.Router();

MutationHistoryRoutes.get('/', authenticateToken, async (req, res) => {
  try {
    const { status, targetType, limit } = req.query;
    const history = await MutationHistoryModel.findByUserId(req.user.userId, {
      status,
      targetType,
      limit: parseInt(limit) || 200,
    });
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

MutationHistoryRoutes.get('/:id', authenticateToken, async (req, res) => {
  try {
    const row = await MutationHistoryModel.findOne(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.user_id !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });
    res.json({ success: true, mutation: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

MutationHistoryRoutes.post('/:id/canary-check', authenticateToken, async (req, res) => {
  try {
    const row = await MutationHistoryModel.findOne(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.user_id !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });
    const verdict = await FitnessScoreService.canaryCheck(req.params.id);
    res.json({ success: true, verdict });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

MutationHistoryRoutes.post('/:id/revert', authenticateToken, async (req, res) => {
  try {
    const row = await MutationHistoryModel.findOne(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.user_id !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });
    await MutationHistoryModel.markReverted(req.params.id, req.body?.reason || 'manual');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

console.log('Mutation History Routes Started...');
export default MutationHistoryRoutes;
