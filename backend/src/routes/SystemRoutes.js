/**
 * System-level operations: restart, status.
 * Restart requires auth - this is a process-killing endpoint.
 */
import express from 'express';
import { authenticateToken } from './Middleware.js';
import RestartManager from '../services/RestartManager.js';

const router = express.Router();

// Unauthenticated on purpose: the frontend polls this while the backend
// drains/reboots, and the Electron supervisor may check it too. It exposes
// nothing sensitive (state/pid/uptime).
router.get('/status', (req, res) => {
  res.json(RestartManager.getStatus());
});

router.post('/restart', authenticateToken, (req, res) => {
  if (RestartManager.isDraining()) {
    return res.status(409).json({ success: false, error: 'Restart already in progress' });
  }

  const { reason = '' } = req.body || {};

  // Respond FIRST, then start the drain. The 2s grace period inside
  // requestRestart guarantees this response flushes before the socket dies.
  res.status(202).json({
    success: true,
    message: 'Restart initiated. Backend will be back in ~10-20 seconds.',
    gracePeriodMs: 2000,
  });

  RestartManager.requestRestart({
    userId: req.user?.id || req.user?.userId || null,
    reason,
  });
});

export default router;
