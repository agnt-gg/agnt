import express from 'express';
import { requireResourceAccess } from '../services/authorization/ApplicationAuthorization.js';
import AgentService from '../services/AgentService.js';
import AgentModel from '../models/AgentModel.js';
import { authenticateToken } from './Middleware.js';
import AgentTaskMatcher from '../services/goal/AgentTaskMatcher.js';
import { buildAgentEnvelope, parseAgentEnvelope, importAgent } from '../services/AgentImportService.js';

const AgentRoutes = express.Router();

AgentRoutes.get('/health', AgentService.healthCheck);
AgentRoutes.get('/', authenticateToken, AgentService.getAllAgents);
AgentRoutes.get('/summary', authenticateToken, AgentService.getAllAgentsSummary);
AgentRoutes.post('/save', authenticateToken, AgentService.saveOrUpdateAgent);
AgentRoutes.get('/:id', authenticateToken, requireResourceAccess('agents','view'), AgentService.getAgent);
AgentRoutes.put('/:id', authenticateToken, requireResourceAccess('agents','edit'), AgentService.saveOrUpdateAgent);
AgentRoutes.delete('/:id', authenticateToken, requireResourceAccess('agents','delete'), AgentService.deleteAgent);

// Agent-specific chat routes
AgentRoutes.post('/:id/chat', authenticateToken, requireResourceAccess('agents','run'), AgentService.chatWithAgent);
AgentRoutes.post('/:id/chat-stream', authenticateToken, requireResourceAccess('agents','run'), AgentService.streamChatWithAgent);
AgentRoutes.post('/:id/suggestions', authenticateToken, requireResourceAccess('agents','run'), AgentService.getAgentSuggestions);

// PRD-057: Agent import/export
AgentRoutes.get('/:id/export', authenticateToken, requireResourceAccess('agents','view'), async (req, res) => {
  try {
    const agent = await AgentModel.findOne(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (agent.created_by !== req.user.userId) {
      return res.status(403).json({ error: 'You do not have permission to export this agent' });
    }
    const envelope = buildAgentEnvelope(agent);
    res.json(envelope);
  } catch (error) {
    console.error('[AgentRoutes] export error:', error);
    res.status(500).json({ error: 'Failed to export agent', details: error.message });
  }
});

AgentRoutes.post('/import', authenticateToken, async (req, res) => {
  try {
    const envelope = req.body?.envelope || req.body;
    const payload = parseAgentEnvelope(envelope);
    const result = await importAgent(payload, req.user.userId);
    res.status(201).json({ success: true, agentId: result.id, missingRefs: result.missingRefs });
  } catch (error) {
    console.error('[AgentRoutes] import error:', error);
    res.status(400).json({ error: error.message });
  }
});

console.log(`Agent Routes Started...`);

export default AgentRoutes;
