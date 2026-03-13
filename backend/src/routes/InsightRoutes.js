import express from 'express';
import InsightModel from '../models/InsightModel.js';
import AgentMemoryModel from '../models/AgentMemoryModel.js';
import AgentApplicator from '../services/evolution/applicators/AgentApplicator.js';
import SkillApplicator from '../services/evolution/applicators/SkillApplicator.js';
import WorkflowApplicator from '../services/evolution/applicators/WorkflowApplicator.js';
import ToolApplicator from '../services/evolution/applicators/ToolApplicator.js';
import InsightTriggers from '../services/evolution/InsightTriggers.js';
import { authenticateToken } from './Middleware.js';

const InsightRoutes = express.Router();

// ==================== INSIGHTS ====================

// GET /api/insights — List insights for the user
InsightRoutes.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { targetType, targetId, status, category, limit } = req.query;
    const insights = await InsightModel.findByUserId(userId, {
      targetType, targetId, status, category,
      limit: parseInt(limit) || 1000,
    });
    res.json({ success: true, insights });
  } catch (error) {
    console.error('[Insight Route] List error:', error);
    res.status(500).json({ error: 'Failed to fetch insights' });
  }
});

// GET /api/insights/stats — Get insight counts and stats
InsightRoutes.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const statusCounts = await InsightModel.getStatusCounts(userId);
    const targetCounts = await InsightModel.getTargetTypeCounts(userId);
    res.json({ success: true, statusCounts, targetCounts });
  } catch (error) {
    console.error('[Insight Route] Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch insight stats' });
  }
});

// GET /api/insights/target/:targetType/:targetId — Get insights for a specific asset
InsightRoutes.get('/target/:targetType/:targetId', authenticateToken, async (req, res) => {
  try {
    const { targetType, targetId } = req.params;
    const { status } = req.query;
    const insights = await InsightModel.findByTarget(targetType, targetId, { status });
    res.json({ success: true, insights });
  } catch (error) {
    console.error('[Insight Route] Target insights error:', error);
    res.status(500).json({ error: 'Failed to fetch target insights' });
  }
});

// GET /api/insights/source/:sourceType/:sourceId — Get insights generated from a specific execution
InsightRoutes.get('/source/:sourceType/:sourceId', authenticateToken, async (req, res) => {
  try {
    const { sourceType, sourceId } = req.params;
    const insights = await InsightModel.findBySource(sourceType, sourceId);
    res.json({ success: true, insights });
  } catch (error) {
    console.error('[Insight Route] Source insights error:', error);
    res.status(500).json({ error: 'Failed to fetch source insights' });
  }
});

// GET /api/insights/:id — Get a single insight
InsightRoutes.get('/:id', authenticateToken, async (req, res) => {
  try {
    const insight = await InsightModel.findOne(req.params.id);
    if (!insight) return res.status(404).json({ error: 'Insight not found' });
    res.json({ success: true, insight });
  } catch (error) {
    console.error('[Insight Route] Get error:', error);
    res.status(500).json({ error: 'Failed to fetch insight' });
  }
});

// POST /api/insights/:id/apply — Apply an insight to its target
InsightRoutes.post('/:id/apply', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { provider, model } = req.body || {};
    const insight = await InsightModel.findOne(req.params.id);
    if (!insight) return res.status(404).json({ error: 'Insight not found' });

    let result;
    switch (insight.target_type) {
      case 'agent':
        result = await AgentApplicator.apply(req.params.id, userId, provider, model);
        break;
      case 'skill':
        result = await SkillApplicator.apply(req.params.id, userId);
        break;
      case 'workflow':
        result = await WorkflowApplicator.apply(req.params.id, userId);
        break;
      case 'tool':
        result = await ToolApplicator.apply(req.params.id, userId);
        break;
      default:
        return res.status(400).json({ error: `Unknown target type: ${insight.target_type}` });
    }

    res.json({ success: true, result });
  } catch (error) {
    console.error('[Insight Route] Apply error:', error);
    res.status(500).json({ error: 'Failed to apply insight', details: error.message });
  }
});

// POST /api/insights/:id/reject — Reject an insight
InsightRoutes.post('/:id/reject', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    await InsightModel.updateStatus(req.params.id, 'rejected');
    res.json({ success: true, message: 'Insight rejected' });
  } catch (error) {
    console.error('[Insight Route] Reject error:', error);
    res.status(500).json({ error: 'Failed to reject insight' });
  }
});

// DELETE /api/insights/:id — Delete an insight
InsightRoutes.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const changes = await InsightModel.delete(req.params.id, userId);
    res.json({ success: true, deleted: changes > 0 });
  } catch (error) {
    console.error('[Insight Route] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete insight' });
  }
});

// POST /api/insights/rollup — Trigger periodic tool usage rollup
InsightRoutes.post('/rollup', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const insightIds = await InsightTriggers.onPeriodicRollup(userId);
    res.json({ success: true, count: insightIds.length, insightIds });
  } catch (error) {
    console.error('[Insight Route] Rollup error:', error);
    res.status(500).json({ error: 'Failed to run rollup' });
  }
});

// ==================== AGENT MEMORY ====================

// GET /api/insights/memory/:agentId — Get all memories for an agent
InsightRoutes.get('/memory/:agentId', authenticateToken, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { memoryType } = req.query;
    const memories = await AgentMemoryModel.findByAgentId(agentId, { memoryType });
    res.json({ success: true, memories });
  } catch (error) {
    console.error('[Insight Route] Memory list error:', error);
    res.status(500).json({ error: 'Failed to fetch agent memories' });
  }
});

// POST /api/insights/memory/:agentId — Add a memory to an agent
InsightRoutes.post('/memory/:agentId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { agentId } = req.params;
    const { memoryType, content } = req.body;

    if (!content) return res.status(400).json({ error: 'Content is required' });

    const id = await AgentMemoryModel.create({
      agentId,
      userId,
      memoryType: memoryType || 'fact',
      content,
    });
    res.json({ success: true, id });
  } catch (error) {
    console.error('[Insight Route] Memory create error:', error);
    res.status(500).json({ error: 'Failed to create memory' });
  }
});

// PUT /api/insights/memory/entry/:id — Update a memory entry
InsightRoutes.put('/memory/entry/:id', authenticateToken, async (req, res) => {
  try {
    const { content, relevanceScore, memoryType } = req.body;
    const changes = await AgentMemoryModel.update(req.params.id, { content, relevanceScore, memoryType });
    res.json({ success: true, updated: changes > 0 });
  } catch (error) {
    console.error('[Insight Route] Memory update error:', error);
    res.status(500).json({ error: 'Failed to update memory' });
  }
});

// DELETE /api/insights/memory/entry/:id — Delete a memory entry
InsightRoutes.delete('/memory/entry/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const changes = await AgentMemoryModel.delete(req.params.id, userId);
    res.json({ success: true, deleted: changes > 0 });
  } catch (error) {
    console.error('[Insight Route] Memory delete error:', error);
    res.status(500).json({ error: 'Failed to delete memory' });
  }
});

console.log('Insight Routes Started...');

export default InsightRoutes;
