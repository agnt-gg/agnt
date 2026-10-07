import express from 'express';
import { authenticateToken } from './Middleware.js';
import { lmStudio, managedRuntime, localModelsStatus } from '../services/localModels/index.js';

/**
 * Local models: what is running, LM Studio's start, and AGNT's own one-click
 * runtime. A hosted instance has no user machine; the services refuse every
 * action there, and status reports nothing installed.
 */
const LocalModelRoutes = express.Router();
const noStore = (res) => res.set('Cache-Control', 'no-store');

LocalModelRoutes.get('/status', authenticateToken, async (_req, res) => {
  noStore(res).json(await localModelsStatus());
});

/** Start an installed-but-stopped LM Studio. */
LocalModelRoutes.post('/start', authenticateToken, async (_req, res) => {
  const started = await lmStudio.start();
  noStore(res).json({ ...(await localModelsStatus()), ...(started.error ? { error: started.error, detail: started.detail } : {}) });
});

/**
 * One-click setup: engine + model download, then start. Returns at once;
 * progress is status().managed.job. `modelId` is optional (default: the model
 * recommended for this machine) and must be a catalog id, so nothing outside
 * the pinned catalog can be downloaded or run.
 */
LocalModelRoutes.post('/managed/setup', authenticateToken, async (req, res) => {
  const modelId = req.body?.modelId;
  if (modelId !== undefined && typeof modelId !== 'string') return noStore(res).status(400).json({ error: 'invalid_model' });
  try {
    await managedRuntime.setup(modelId || undefined);
    noStore(res).json(await localModelsStatus());
  } catch (error) {
    noStore(res).status(error.code === 'busy' ? 409 : 400).json({ error: error.code || 'setup_failed', message: error.message });
  }
});

LocalModelRoutes.post('/managed/cancel', authenticateToken, async (_req, res) => {
  managedRuntime.cancel();
  noStore(res).json(await localModelsStatus());
});

export default LocalModelRoutes;
