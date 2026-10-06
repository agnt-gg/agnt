import express from 'express';
import InsightModel from '../models/InsightModel.js';
import AgentMemoryModel from '../models/AgentMemoryModel.js';
import AgentApplicator from '../services/evolution/applicators/AgentApplicator.js';
import SkillApplicator from '../services/evolution/applicators/SkillApplicator.js';
import WorkflowApplicator from '../services/evolution/applicators/WorkflowApplicator.js';
import ToolApplicator from '../services/evolution/applicators/ToolApplicator.js';
import InsightTriggers from '../services/evolution/InsightTriggers.js';
import EvolutionSettingsModel from '../models/EvolutionSettingsModel.js';
import { authenticateToken } from './Middleware.js';

const InsightRoutes = express.Router();

// ==================== INSIGHTS ====================

// GET /api/insights — List insights for the user
InsightRoutes.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { targetType, targetId, status, category, autonomyDecision, limit } = req.query;
    const insights = await InsightModel.findByUserId(userId, {
      targetType, targetId, status, category, autonomyDecision,
      limit: parseInt(limit) || 1000,
    });
    res.json({ success: true, insights });
  } catch (error) {
    console.error('[Insight Route] List error:', error);
    res.status(500).json({ error: 'Failed to fetch insights' });
  }
});

// POST /api/insights/route — Sweep all pending insights through the autonomy router
InsightRoutes.post('/route', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { provider, model } = req.body || {};
    const InsightAutonomyRouter = (await import('../services/evolution/InsightAutonomyRouter.js')).default;
    const summary = await InsightAutonomyRouter.routePendingForUser(userId, { provider, model });
    res.json({ success: true, summary });
  } catch (error) {
    console.error('[Insight Route] Route sweep error:', error);
    res.status(500).json({ error: 'Failed to route insights', details: error.message });
  }
});

// POST /api/insights/:id/route — Route one insight through the autonomy router
InsightRoutes.post('/:id/route', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { provider, model } = req.body || {};
    const InsightAutonomyRouter = (await import('../services/evolution/InsightAutonomyRouter.js')).default;
    const result = await InsightAutonomyRouter.route(req.params.id, userId, { provider, model });
    res.json({ success: true, result });
  } catch (error) {
    console.error('[Insight Route] Route one error:', error);
    res.status(500).json({ error: 'Failed to route insight', details: error.message });
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
    const insights = await InsightModel.findByTarget(targetType, targetId, { status,userId:req.user.userId });
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
    const insights = await InsightModel.findBySource(sourceType, sourceId, {userId:req.user.userId});
    res.json({ success: true, insights });
  } catch (error) {
    console.error('[Insight Route] Source insights error:', error);
    res.status(500).json({ error: 'Failed to fetch source insights' });
  }
});

// ==================== EVOLUTION SETTINGS ====================

// GET /api/insights/settings — Get evolution settings
InsightRoutes.get('/settings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const settings = await EvolutionSettingsModel.get(userId);
    res.json({ success: true, settings });
  } catch (error) {
    console.error('[Insight Route] Settings error:', error);
    res.status(500).json({ error: 'Failed to fetch evolution settings' });
  }
});

// POST /api/insights/settings — Update evolution settings
InsightRoutes.post('/settings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const settings = await EvolutionSettingsModel.update(userId, req.body);
    res.json({ success: true, settings });
  } catch (error) {
    console.error('[Insight Route] Settings update error:', error);
    res.status(500).json({ error: 'Failed to update evolution settings' });
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

// GET /api/insights/memory — Get all memories for the current user (across all agents)
InsightRoutes.get('/memory', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 5000, 50000));
    const sort = req.query.sort === 'relevance' ? 'relevance' : 'recent';
    const memories = await AgentMemoryModel.findByUserId(userId, { limit, sort });
    res.json({ success: true, memories, count: memories.length });
  } catch (error) {
    console.error('[Insight Route] All memories error:', error);
    res.status(500).json({ error: 'Failed to fetch all memories' });
  }
});

// GET /api/insights/memory/:agentId — Get all memories for an agent
InsightRoutes.get('/memory/:agentId', authenticateToken, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { memoryType } = req.query;
    const memories = await AgentMemoryModel.findByAgentId(agentId, { memoryType,userId:req.user.userId });
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
    // Scoped to the caller: `changes` is 0 for a row owned by somebody else,
    // which surfaces as { updated: false } rather than a silent cross-tenant write.
    const changes = await AgentMemoryModel.update(req.params.id, req.user.userId, {
      content,
      relevanceScore,
      memoryType,
    });
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

// DELETE /api/insights/memory/orphaned — Delete all memories whose agents no longer exist
InsightRoutes.delete('/memory/orphaned', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const AgentModel = (await import('../models/AgentModel.js')).default;
    const memories = await AgentMemoryModel.findByUserId(userId, { limit: 10000 });
    const agents = await AgentModel.findAllByUserId(userId);
    const agentIds = new Set(agents.map(a => a.id));
    const specialIds = new Set(['orchestrator', '__orchestrator__']);

    let deleted = 0;
    for (const mem of memories) {
      if (!agentIds.has(mem.agent_id) && !specialIds.has(mem.agent_id)) {
        await AgentMemoryModel.delete(mem.id, userId);
        deleted++;
      }
    }
    res.json({ success: true, deleted });
  } catch (error) {
    console.error('[Insight Route] Orphaned memory cleanup error:', error);
    res.status(500).json({ error: 'Failed to clean up orphaned memories' });
  }
});

// ==================== APPLYING ====================

class UnknownTargetError extends Error {}

/**
 * Apply one insight the caller owns, through the applicator for its target.
 * The single and bulk accept routes both go through here so they cannot drift.
 */
async function applyInsight(insight, userId, { provider, model } = {}) {
  // PRD-091 Layer 5: contract_proposal insights install via the contract
  // applicator regardless of target_type.
  if (insight.category === 'contract_proposal') {
    const ContractApplicator = (await import('../services/evolution/applicators/ContractApplicator.js')).default;
    return ContractApplicator.apply(insight.id, userId);
  }
  switch (insight.target_type) {
    case 'agent':
      return AgentApplicator.apply(insight.id, userId, provider, model);
    case 'skill':
      return SkillApplicator.apply(insight.id, userId);
    case 'workflow':
      return WorkflowApplicator.apply(insight.id, userId);
    case 'tool':
      return ToolApplicator.apply(insight.id, userId);
    case 'evolution_settings': {
      const EvolutionSettingsApplicator = (await import('../services/evolution/applicators/EvolutionSettingsApplicator.js')).default;
      return EvolutionSettingsApplicator.apply(insight.id, userId);
    }
    default:
      throw new UnknownTargetError(`Unknown target type: ${insight.target_type}`);
  }
}

// Applying can call a model per insight, so one request takes a bounded batch
// and the client walks the queue in batches (with progress and a stop).
export const MAX_APPLY_BATCH = 50;

const isIdList = (ids) => Array.isArray(ids) && ids.every((id) => typeof id === 'string' && id.length > 0);

// ==================== ESCALATION QUEUE (before /:id routes) ====================

// POST /api/insights/escalated/apply — Accept a batch of waiting insights.
// Body: { ids: string[] (1..MAX_APPLY_BATCH), provider?, model? }.
// Each id is applied in order; one failure never stops the rest. Ids that are
// not this user's, or no longer waiting, are reported as skipped.
InsightRoutes.post('/escalated/apply', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { ids, provider, model } = req.body || {};
  if (!isIdList(ids) || ids.length === 0 || ids.length > MAX_APPLY_BATCH) {
    return res.status(400).json({ error: `ids must be 1 to ${MAX_APPLY_BATCH} insight ids` });
  }
  const applied = [];
  const skipped = [];
  const failed = [];
  for (const id of new Set(ids)) {
    try {
      const insight = await InsightModel.findOwned(id, userId);
      if (!insight || insight.status !== 'pending' || insight.autonomy_decision !== 'escalate') {
        skipped.push(id);
        continue;
      }
      await applyInsight(insight, userId, { provider, model });
      applied.push(id);
    } catch (error) {
      console.error('[Insight Route] Bulk apply error:', id, error);
      failed.push({ id, error: error.message || 'Failed to apply' });
    }
  }
  res.json({ success: true, applied, skipped, failed });
});

// POST /api/insights/escalated/reject — Reject waiting insights in one statement.
// Body: { ids?: string[] }. Without ids, every waiting insight is rejected.
InsightRoutes.post('/escalated/reject', authenticateToken, async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (ids !== undefined && !isIdList(ids)) return res.status(400).json({ error: 'ids must be a list of insight ids' });
    const rejected = await InsightModel.rejectEscalated(req.user.userId, ids ?? null);
    res.json({ success: true, rejected });
  } catch (error) {
    console.error('[Insight Route] Bulk reject error:', error);
    res.status(500).json({ error: 'Failed to reject insights' });
  }
});

// ==================== SINGLE INSIGHT (must be after all named routes) ====================

// GET /api/insights/:id — Get a single insight
InsightRoutes.get('/:id', authenticateToken, async (req, res) => {
  try {
    const insight = await InsightModel.findOwned(req.params.id, req.user.userId);
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
    const insight = await InsightModel.findOwned(req.params.id, userId);
    if (!insight) return res.status(404).json({ error: 'Insight not found' });
    const result = await applyInsight(insight, userId, req.body || {});
    res.json({ success: true, result });
  } catch (error) {
    if (error instanceof UnknownTargetError) return res.status(400).json({ error: error.message });
    console.error('[Insight Route] Apply error:', error);
    res.status(500).json({ error: 'Failed to apply insight', details: error.message });
  }
});

// POST /api/insights/:id/reject — Reject an insight
InsightRoutes.post('/:id/reject', authenticateToken, async (req, res) => {
  try {
    const insight = await InsightModel.findOwned(req.params.id, req.user.userId);
    if (!insight) return res.status(404).json({ error: 'Insight not found' });
    await InsightModel.updateStatus(insight.id, 'rejected');
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

console.log('Insight Routes Started...');

export default InsightRoutes;
