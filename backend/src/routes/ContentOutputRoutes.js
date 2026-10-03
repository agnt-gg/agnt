import express from 'express';
import RunService from '../services/RunService.js';
import { getMainChatState } from '../services/MainChatService.js';
import { authenticateToken } from './Middleware.js';

// Set up new route
const ContentOutputRoutes = express.Router();

// Define routes
ContentOutputRoutes.get('/health', RunService.healthCheck);
ContentOutputRoutes.get('/', authenticateToken, RunService.getAllContentOutputs);
ContentOutputRoutes.post('/save', authenticateToken, RunService.saveOrUpdateContentOutput);
// Bulk read-clear. Declared above the /:id routes so a literal path can never
// be swallowed by a parameter segment as this file grows.
ContentOutputRoutes.patch('/read-all', authenticateToken, RunService.markAllContentOutputsRead);
// Same rule as read-all: a literal segment MUST be declared before '/:id', or
// 'by-conversation' is matched as an output id.
ContentOutputRoutes.get('/by-conversation/:conversationId', authenticateToken, RunService.getContentOutputByConversation);
// The Main chat (created on first ask) and which chats it started. Literal
// paths, so they too sit above '/:id'.
ContentOutputRoutes.get('/main-chat', authenticateToken, async (req, res) => {
  try {
    res.json(await getMainChatState(req.user.userId || req.user.id));
  } catch (error) {
    console.error('Error loading the main chat:', error);
    res.status(500).json({ error: 'Error loading the main chat' });
  }
});
// The Main chat is retired (see MainChatService). Clearing one would mint it
// again, so the route refuses rather than recreate what was removed.
ContentOutputRoutes.post('/main-chat/clear', authenticateToken, (req, res) => {
  res.status(410).json({ error: 'main_chat_retired' });
});
ContentOutputRoutes.get('/:id', authenticateToken, RunService.getContentOutput);
ContentOutputRoutes.put('/:id', authenticateToken, RunService.saveOrUpdateContentOutput);
ContentOutputRoutes.patch('/:id/rename', authenticateToken, RunService.renameContentOutput);
ContentOutputRoutes.patch('/:id/read', authenticateToken, RunService.setContentOutputReadState);
ContentOutputRoutes.patch('/:id/archive', authenticateToken, RunService.setContentOutputArchived);
ContentOutputRoutes.patch('/:id/channel', authenticateToken, RunService.setContentOutputChannel);
ContentOutputRoutes.delete('/:id', authenticateToken, RunService.deleteContentOutput);

// Additional routes specific to content outputs
ContentOutputRoutes.get('/workflow/:workflowId', authenticateToken, RunService.getContentOutputsByWorkflow);
ContentOutputRoutes.get('/tool/:toolId', authenticateToken, RunService.getContentOutputsByTool);

console.log(`Content Output Routes Started...`);

export default ContentOutputRoutes;
