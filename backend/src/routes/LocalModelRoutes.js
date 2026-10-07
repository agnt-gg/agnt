import express from 'express';
import { authenticateToken } from './Middleware.js';
import { createLocalModelRuntime } from '../services/localModelRuntime.js';
import { hostedInstanceSlug } from '../services/agntServices.js';

/**
 * The "Run a model on this machine" link: is LM Studio running, installed,
 * startable. A hosted instance has no user machine, so it never runs a CLI.
 */
const runtime = createLocalModelRuntime({ hosted: () => !!hostedInstanceSlug() });
const LocalModelRoutes = express.Router();

LocalModelRoutes.get('/status', authenticateToken, async (_req, res) => {
  res.set('Cache-Control', 'no-store').json(await runtime.status());
});

LocalModelRoutes.post('/start', authenticateToken, async (_req, res) => {
  res.set('Cache-Control', 'no-store').json(await runtime.start());
});

export default LocalModelRoutes;
