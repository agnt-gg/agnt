/**
 * System-level operations: restart, status, and the desktop update handoff.
 * Restart requires auth - this is a process-killing endpoint.
 */
import crypto from 'crypto';
import express from 'express';
import { authenticateToken } from './Middleware.js';
import RestartManager from '../services/RestartManager.js';

const router = express.Router();

/**
 * Only the Electron main process that spawned this backend may ask it to stop
 * for an update. It generates a random token per launch and passes it in the
 * environment; web pages on localhost never see it. Without the variable (a
 * browser/Docker deployment) the routes do not exist.
 */
export function requireControlToken(req, res, next) {
  const expected = process.env.AGNT_CONTROL_TOKEN;
  if (!expected) return res.status(404).json({ error: 'Not found' });
  const given = req.get('x-agnt-control-token') || '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
}

// Unauthenticated on purpose: the frontend polls this while the backend
// drains/reboots, and the Electron supervisor may check it too. It exposes
// nothing sensitive (state/pid/uptime).
// Storage health: database file size, free pages, auto_vacuum mode, and the
// last background maintenance pass (StorageMaintenance.js). Authenticated, and
// its modules are imported per request so this router stays free of the
// database at import time (see SystemRoutes.handoff.test.js for why).
router.get('/storage', authenticateToken, async (req, res) => {
  try {
    const [{ default: db }, { databaseSpaceStats }, { getLastStorageMaintenanceReport }, { getCompactionState }] = await Promise.all([
      import('../models/database/index.js'),
      import('../services/storage/freePages.js'),
      import('../services/storage/StorageMaintenance.js'),
      import('../services/storage/databaseCompaction.js'),
    ]);
    res.json({ database: await databaseSpaceStats(db), lastMaintenance: getLastStorageMaintenanceReport(), compaction: getCompactionState() });
  } catch (err) {
    console.warn('[System] storage statistics failed:', err.message);
    res.status(500).json({ error: 'Storage statistics are unavailable' });
  }
});

/**
 * Start the one-off database rebuild (services/storage/databaseCompaction.js).
 * Writers wait while it runs, so it is refused while anything is in progress
 * unless the caller passes { force: true }. Answers 202 at once; progress and
 * the result are on GET /storage under `compaction`.
 */
router.post('/storage/compact', authenticateToken, async (req, res) => {
  try {
    const [{ default: db }, { isDataDirOwner }, { compactDatabase, getCompactionState }] = await Promise.all([
      import('../models/database/index.js'),
      import('../models/database/dataDirOwnership.js'),
      import('../services/storage/databaseCompaction.js'),
    ]);
    if (!(await isDataDirOwner())) {
      return res.status(409).json({ success: false, error: 'Another process owns this data directory' });
    }
    if (getCompactionState().running) {
      return res.status(409).json({ success: false, error: 'A rebuild is already running' });
    }
    const busy = await RestartManager.busyReport();
    const inProgress = busy.goals + busy.chats + busy.workflows + busy.tools > 0 || busy.unknown.length > 0;
    if (inProgress && req.body?.force !== true) {
      return res.status(409).json({ success: false, error: 'Work is in progress', busy });
    }

    res.status(202).json({ success: true, status: 'started' });
    compactDatabase(db.filename).then((result) => {
      const freedMb = Math.round((result.bytesFreed || 0) / 1048576);
      console.log(`[System] database rebuild: ${result.status}${result.status === 'complete' ? `, ${freedMb} MB returned to the OS` : ''}${result.error ? ` (${result.error})` : ''}`);
    });
  } catch (err) {
    console.warn('[System] database rebuild could not start:', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: 'The rebuild could not be started' });
  }
});

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

/**
 * What an update restart would interrupt right now.
 * { goals, chats, workflows, tools, unknown: [source...] }
 */
router.get('/busy', requireControlToken, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await RestartManager.busyReport());
});

/**
 * Update handoff: re-check busy and start draining in one step, answer, then
 * run the process's own graceful shutdown (journal flush, workflow child,
 * server close, exit 0). 409 means nothing was stopped.
 */
router.post('/prepare-shutdown', requireControlToken, async (req, res) => {
  const force = req.body?.force === true;
  const result = await RestartManager.prepareShutdown({ force, reason: 'update' });
  if (!result.ok) return res.status(409).json(result);
  res.status(202).json(result);
  // After the response is on the wire.
  res.on('finish', () => setImmediate(() => RestartManager.beginShutdown('update')));
});

export default router;
