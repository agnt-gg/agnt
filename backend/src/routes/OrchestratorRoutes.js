import express from 'express';
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticateToken } from './Middleware.js';
import multer from 'multer';

import universalChatHandler, { getAvailableTools } from '../services/OrchestratorService.js';
import { attachSubscriber, cancelRun, getRunStatus } from '../services/orchestrator/activeRuns.js';
import ConversationLogModel from '../models/ConversationLogModel.js';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB per file
    fieldSize: 50 * 1024 * 1024, // 50MB per text field (history JSON can hold base64 images from prior turns)
  },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

router.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));

// Available tools for frontend tool selector
router.get('/tools', authenticateToken, getAvailableTools);

// Universal chat handler - all routes stream by default with clean names
router.post('/chat', authenticateToken, upload.array('files'), universalChatHandler);
router.post('/agent-chat', authenticateToken, upload.array('files'), universalChatHandler);
router.post('/workflow-chat', authenticateToken, upload.array('files'), universalChatHandler);
router.post('/tool-chat', authenticateToken, upload.array('files'), universalChatHandler);
router.post('/widget-chat', authenticateToken, upload.array('files'), universalChatHandler);
router.post('/goal-chat', authenticateToken, upload.array('files'), universalChatHandler);
router.post('/suggestions', authenticateToken, universalChatHandler);
router.post('/artifact-chat', authenticateToken, upload.array('files'), universalChatHandler);

/*
 * ---------------------------------------------------------------------------
 * Run lifecycle
 *
 * A chat turn outlives the socket that started it (see activeRuns.js). These
 * three routes are what make that observable to a client: ask whether a turn is
 * still running, reattach to it, or explicitly cancel it.
 *
 * Cancellation used to be implicit — closing the connection killed the run — so
 * a refresh and a Stop click were indistinguishable to the server. They are
 * different intentions and now have different mechanisms.
 * ---------------------------------------------------------------------------
 */

// Is a turn still generating for this conversation?
router.get('/runs/:conversationId', authenticateToken, (req, res) => {
  res.json(getRunStatus(req.params.conversationId, req.user?.id));
});

// Reattach to an in-flight turn: replays everything already emitted, then
// streams the remainder live on the same SSE event shape as /chat.
router.get('/runs/:conversationId/stream', authenticateToken, (req, res) => {
  const { conversationId } = req.params;
  const status = getRunStatus(conversationId, req.user?.id);

  // 204 = "nothing in flight". Distinct from an error: it is the normal answer
  // for the overwhelming majority of page loads, and the client treats it as
  // "clear the stale streaming flag" rather than as a failure.
  if (!status.known) return res.status(204).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const result = attachSubscriber(conversationId, res, req.user?.id);
  if (result === 'forbidden' || result === 'not_found') {
    return res.end();
  }

  // 'attached' leaves the response open — activeRuns owns it from here and
  // closes it when the run ends. 'ended' already replayed and closed.
  return undefined;
});

// Explicit cancel. This is the ONLY way a client stops generation.
router.post('/runs/:conversationId/cancel', authenticateToken, (req, res) => {
  const result = cancelRun(req.params.conversationId, req.user?.id);
  if (result === 'forbidden') return res.status(403).json({ success: false, result });
  res.json({ success: result === 'cancelled', result });
});

// Authoritative persisted transcript. The backend has always written this; until
// now nothing could read it.
router.get('/conversations/:conversationId', authenticateToken, async (req, res) => {
  try {
    const log = await ConversationLogModel.getByConversationId(req.params.conversationId, req.user?.id);
    if (!log) return res.status(404).json({ success: false, error: 'Conversation not found' });
    res.json({ success: true, conversation: log });
  } catch (error) {
    console.error('[OrchestratorRoutes] Failed to read conversation log:', error);
    res.status(500).json({ success: false, error: 'Failed to read conversation' });
  }
});

export default router;
