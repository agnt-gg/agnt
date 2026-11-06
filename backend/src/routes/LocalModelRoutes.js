import express from 'express';
import { authenticateToken } from './Middleware.js';
import { lmStudio, localModelsStatus } from '../services/localModels/index.js';

/**
 * Local models: the model servers already running on this machine. AGNT uses
 * one that is running; it does not start, install or download one. A hosted
 * instance has no user machine; status reports nothing there.
 */
const LocalModelRoutes = express.Router();
const noStore = (res) => res.set('Cache-Control', 'no-store');

LocalModelRoutes.get('/status', authenticateToken, async (_req, res) => {
  noStore(res).json(await localModelsStatus());
});

/**
 * Make a local model ready for a chat turn before switching to it: an LM
 * Studio model loaded with too little context is reloaded with enough.
 * Body: { model? }. 200 { model, contextLength, reloaded } or 422 { error, detail }.
 */
LocalModelRoutes.post('/prepare', authenticateToken, async (req, res) => {
  const model = req.body?.model;
  if (model !== undefined && typeof model !== 'string') return noStore(res).status(400).json({ error: 'invalid_model' });
  const prepared = await lmStudio.prepare(model || undefined);
  noStore(res).status(prepared.error ? 422 : 200).json(prepared);
});

export default LocalModelRoutes;
