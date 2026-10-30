import express from 'express';
import db from '../models/database/index.js';
import { databaseRepository } from '../services/authorization/ScopeRepository.js';
import { TaskCheckpoints, createBoardClient } from '../services/TaskCheckpoints.js';
import { broadcastToUser } from '../utils/realtimeSync.js';
import { authenticateToken } from './Middleware.js';

/**
 * Tasks in chat: the checkpoint cards Annie posts and waits on.
 *
 * Every route is the signed-in person's own: a checkpoint is private to the
 * person whose conversation it is (also inside a team: ScopeApiPolicy lists
 * this API as private-in-team, so a team header never pools it). Another
 * person's id is a 404, never a 403, so ids reveal nothing.
 *
 * After a change the person's other windows get `checkpoint:changed` (ids
 * only), so the Home badge and every open card stay in step.
 */
export function createCheckpointRouter({ getService = () => new TaskCheckpoints(databaseRepository(db), createBoardClient()), authenticate = authenticateToken, notify = broadcastToUser } = {}) {
  const router = express.Router();
  router.use(authenticate);
  const handle = (fn) => async (req, res) => {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Sign in required' });
    res.set('Cache-Control', 'no-store');
    try {
      res.json(await fn(getService(), req, userId));
    } catch (error) {
      if (!error.status) console.error('[Checkpoints]', error);
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Checkpoint request failed', ...(error.code ? { code: error.code } : {}) });
    }
  };
  const changed = (userId, checkpoint) => notify(userId, 'checkpoint:changed', { id: checkpoint.id, conversationId: checkpoint.conversationId, state: checkpoint.state });

  // What is waiting on me (Home, the rail badge).
  router.get('/', handle((service, req, userId) => (req.query.conversationId ? service.forConversation(userId, String(req.query.conversationId)) : service.pending(userId))));
  router.get('/:id', handle((service, req, userId) => service.get(userId, req.params.id)));
  router.post('/:id/locate', handle(async (service, req, userId) => service.locate(userId, req.params.id, req.body?.outputId)));
  router.post('/:id/decide', handle(async (service, req, userId) => {
    const result = await service.decide(userId, req.params.id, { decision: req.body?.decision, note: req.body?.note }, { authToken: req.headers.authorization });
    changed(userId, result.checkpoint);
    return result;
  }));
  return router;
}

export default createCheckpointRouter();
