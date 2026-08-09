/**
 * Browser surface registration — how the backend learns which browser AGNT is
 * currently rendering.
 *
 * The Browser widget is a dumb surface: a real Chromium view and nothing else,
 * no task box and no provider picker. It is driven from the workspace chat, the
 * same way Workflow Forge is. So the widget's only job here is to say "there is
 * a browser at this endpoint" while it is open, and to take that back when it
 * closes. The Browser Agent action then finds it on its own — see
 * services/browserSurfaces.js.
 *
 * There is deliberately no `run` endpoint. A second way to start a browser task
 * would be a second place for provider resolution, model defaults and gateway
 * tokens to drift from the tool that already does all of it.
 */

import express from 'express';
import { authenticateToken } from './Middleware.js';
import { registerSurface, unregisterSurface, getActiveSurface } from '../services/browserSurfaces.js';

const router = express.Router();

/**
 * POST /api/browser-agent/surface
 * Body: { instanceId, cdpUrl, url?, title? }
 * Also used to refresh the current URL as the surface navigates.
 */
router.post('/surface', authenticateToken, (req, res) => {
  if (!req.user?.isAuthenticated) return res.status(401).json({ success: false, error: 'Authentication required' });

  const { instanceId, cdpUrl, url, title } = req.body || {};
  if (!instanceId) return res.status(400).json({ success: false, error: 'instanceId is required.' });

  // Refusing anything that is not a loopback bridge keeps this from becoming a
  // way to point the agent at an arbitrary CDP endpoint on the network.
  if (!registerSurface(req.user.id, instanceId, { cdpUrl, url, title })) {
    return res.status(400).json({ success: false, error: 'That is not a local browser bridge endpoint.' });
  }
  return res.json({ success: true });
});

/** DELETE /api/browser-agent/surface/:instanceId */
router.delete('/surface/:instanceId', authenticateToken, (req, res) => {
  if (!req.user?.isAuthenticated) return res.status(401).json({ success: false, error: 'Authentication required' });
  return res.json({ success: true, removed: unregisterSurface(req.user.id, req.params.instanceId) });
});

/**
 * GET /api/browser-agent/surface
 * Diagnostic: which browser would a chat turn drive right now?
 */
router.get('/surface', authenticateToken, (req, res) => {
  if (!req.user?.isAuthenticated) return res.status(401).json({ success: false, error: 'Authentication required' });
  const surface = getActiveSurface(req.user.id);
  // The bridge token is a credential for driving the user's browser; report
  // that a surface exists without handing its endpoint back out.
  return res.json({
    success: true,
    surface: surface ? { instanceId: surface.instanceId, url: surface.url, title: surface.title } : null,
  });
});

export default router;
