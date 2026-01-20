import express from 'express';
import AgentService from '../services/AgentService.js';
import { authenticateToken } from './Middleware.js';
import AgentTaskMatcher from '../services/goal/AgentTaskMatcher.js';

const AgentRoutes = express.Router();

AgentRoutes.get('/health', AgentService.healthCheck);
AgentRoutes.get('/', authenticateToken, AgentService.getAllAgents);
AgentRoutes.post('/save', authenticateToken, AgentService.saveOrUpdateAgent);
AgentRoutes.get('/:id', authenticateToken, AgentService.getAgent);
AgentRoutes.put('/:id', authenticateToken, AgentService.saveOrUpdateAgent);
AgentRoutes.delete('/:id', authenticateToken, AgentService.deleteAgent);

// Agent-specific chat routes
AgentRoutes.post('/:id/chat', authenticateToken, AgentService.chatWithAgent);
AgentRoutes.post('/:id/chat-stream', authenticateToken, AgentService.streamChatWithAgent);
AgentRoutes.post('/:id/suggestions', authenticateToken, AgentService.getAgentSuggestions);

console.log(`Agent Routes Started...`);

export default AgentRoutes;
