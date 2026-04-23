/**
 * Admin routes for inspecting and force-refreshing the upstream CLI version
 * cache that drives Claude Code / OpenAI Codex / Kimi Code client spoofing.
 *
 * GET  /api/admin/client-versions          → current + cached state
 * POST /api/admin/client-versions/refresh  → force registry re-fetch
 *
 * Mounted publicly under /api/admin to keep it reachable from DevTools in the
 * Electron shell, where most debugging happens. Since AGNT is a local-first
 * single-user product, there's no tenancy to gate — the routes do require the
 * backend to be running, which already implies local trust.
 */

import express from 'express';
import {
  inspectClientVersions,
  refreshClientVersions,
} from '../services/ai/clientVersions.js';

const router = express.Router();

router.get('/client-versions', (req, res) => {
  try {
    res.json({ success: true, providers: inspectClientVersions() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/client-versions/refresh', async (req, res) => {
  try {
    const keys = Array.isArray(req.body?.keys) && req.body.keys.length ? req.body.keys : null;
    const results = await refreshClientVersions(keys);
    res.json({ success: true, refreshed: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
