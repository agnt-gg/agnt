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
import {
  registerSurface, unregisterSurface, getActiveSurface,
  getLiveSurface, forgetSurfaceByUrl, announceHostSurface, hostInstanceId,
} from '../services/browserSurfaces.js';
import { startViewing, stopViewing, isStreaming } from '../services/BrowserScreencastService.js';
import { ensureFallbackSurface } from '../tools/library/actions/browserFallbackSurface.js';

const router = express.Router();

/**
 * POST /api/browser-agent/surface
 * Body: { instanceId, workspaceId?, cdpUrl, url?, title? }
 * Also used to refresh the current URL as the surface navigates.
 */
router.post('/surface', authenticateToken, (req, res) => {
  if (!req.user?.isAuthenticated) return res.status(401).json({ success: false, error: 'Authentication required' });

  const { instanceId, workspaceId, cdpUrl, url, title } = req.body || {};
  if (!instanceId) return res.status(400).json({ success: false, error: 'instanceId is required.' });

  // WHY THE CLIENT'S ADDRESS IS PART OF THE ANSWER.
  //
  // Refusing anything that is not a loopback bridge keeps this from becoming a
  // way to point the agent at an arbitrary CDP endpoint on the network. But
  // `127.0.0.1` names a DIFFERENT MACHINE when the announcement arrives from
  // one — which is the documented remote-backend topology, not an exotic case.
  // Accepting it produced the worst possible outcome: the registry believed in
  // a bridge, the probe could not reach it, and the agent silently drove a
  // browser on the server while the user watched an empty widget.
  const outcome = registerSurface(req.user.id, instanceId, {
    workspaceId, cdpUrl, url, title, transport: 'electron-bridge', clientAddress: req.ip,
  });

  if (!outcome.ok) {
    // Two different problems, two different fixes — so two different messages.
    // "Not a bridge" is a client bug; "unreachable" is a correct client on the
    // wrong side of a network, and it needs to know to stream instead.
    const error = outcome.reason === 'unreachable'
      ? 'This backend cannot reach a bridge on your machine. Use a streamed browser surface instead.'
      : 'That is not a local browser bridge endpoint.';
    return res.status(400).json({ success: false, error, reason: outcome.reason });
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
  const surface = getActiveSurface(req.user.id, {
    instanceId: req.query.instanceId || null,
    workspaceId: req.query.workspaceId || null,
  });
  // The bridge token is a credential for driving the user's browser; report
  // that a surface exists without handing its endpoint back out.
  return res.json({
    success: true,
    surface: surface ? {
      instanceId: surface.instanceId,
      workspaceId: surface.workspaceId,
      url: surface.url,
      title: surface.title,
      transport: surface.transport || 'electron-bridge',
    } : null,
  });
});

/**
 * POST /api/browser-agent/view
 * Body: { instanceId? , workspaceId? }
 *
 * Start watching a surface — or join a stream already running.
 *
 * WHY THE CLIENT DOES NOT SEND A cdpUrl. It does not have one and must not: the
 * endpoint is a credential for driving the user's browser, which is why GET
 * /surface deliberately withholds it. The client names WHICH surface it means
 * and the backend looks the endpoint up, so a viewer can only ever watch a
 * browser this backend already knows about and already owns.
 */
router.post('/view', authenticateToken, async (req, res) => {
  if (!req.user?.isAuthenticated) return res.status(401).json({ success: false, error: 'Authentication required' });

  const userId = req.user.id;
  const workspaceId = req.body?.workspaceId || null;
  const selector = { instanceId: req.body?.instanceId || null, workspaceId };

  // getLiveSurface, NEVER getActiveSurface.
  //
  // THE BUG THIS CLOSES. getActiveSurface reports what the registry BELIEVES;
  // it does not touch the network. browserSurfaces.js says why that is never
  // enough, in its own header: "A dead ws:// URL is indistinguishable from a
  // live one by inspection, so resolution does not inspect: it CONNECTS."
  //
  // Handing a viewer a remembered endpoint produced exactly the failure that
  // warning describes. A widget had announced a bridge, the widget went away
  // without a DELETE (a reload, a crash, a webContents rebuild), and the entry
  // outlived the socket. Every /view call then dialled a port with nothing
  // behind it and returned `ECONNREFUSED 127.0.0.1:<port>` — forever, because
  // nothing on this path ever pruned the corpse. The agent could not use that
  // surface either, but IT probes, so it quietly launched a browser and carried
  // on while the viewer stared at the error.
  //
  // getLiveSurface probes each candidate and DROPS the ones that do not answer,
  // so this path now self-heals instead of failing identically every time.
  let surface = await getLiveSurface(userId, selector);

  // Nothing live. Open one, the way the desktop widget always had one to show.
  //
  // Not a race with the tool: ensureFallbackSurface shares a single in-flight
  // launch and reuses a running browser, so a widget mounting at the same moment
  // a chat turn starts gets the SAME browser, not a second one.
  if (!surface && req.body?.launch !== false) {
    try {
      // hidden: the caller is about to WATCH this browser through the
      // screencast, so the stream is its window. Launching it visibly put a
      // second, redundant Chrome window on the host desktop — the first thing
      // reported when this endpoint shipped.
      const cdpUrl = await ensureFallbackSurface({ hidden: true, log: (m) => console.log(m) });
      announceHostSurface(userId, cdpUrl, { workspaceId });
      surface = {
        instanceId: hostInstanceId(userId), cdpUrl, transport: 'host-cdp', url: 'about:blank',
      };
    } catch (err) {
      // No browser installed, or it would not start. That is a real answer, and
      // the message names it rather than leaving the widget spinning.
      return res.status(503).json({ success: false, error: `Could not open a browser to watch: ${err.message}` });
    }
  }

  if (!surface) return res.status(404).json({ success: false, error: 'There is no browser to watch yet.' });

  try {
    const result = await startViewing({ userId, instanceId: surface.instanceId, cdpUrl: surface.cdpUrl });
    return res.json({
      success: true,
      instanceId: surface.instanceId,
      transport: surface.transport || 'electron-bridge',
      url: surface.url,
      ...result,
    });
  } catch (err) {
    // The narrow race the probe cannot close: the browser died between the probe
    // and the attach. Forget it so the next poll starts clean, and report "none
    // yet" — which is now the truth — rather than an error about a browser that
    // no longer exists.
    forgetSurfaceByUrl(userId, surface.cdpUrl);

    // A VIEWER NEVER DESTROYS THE BROWSER.
    //
    // This path used to end the launcher session here, to heal a zombie that
    // answers /json/version but cannot stream. That was right about a rare
    // case and catastrophic about a common one: attaching also fails
    // TRANSIENTLY — mid-navigation Target.getTargets briefly reports no page
    // target, so attachToPage throws "that browser has no page to show". The
    // response was to taskkill the browser tree the agent was working in,
    // ending the running task and the stream together. Reported from live use
    // as "the next browser step does not work and it kills both".
    //
    // Watching is read-only and has no standing to end a session it does not
    // own. The registry entry is still pruned above, so the next poll
    // re-probes rather than replaying a dead endpoint. Healing an unusable
    // browser belongs to the DRIVER path, which finds out by trying to use it.
    console.log(`[Screencast] ${surface.instanceId} could not be watched: ${err.message}`);
    return res.status(404).json({ success: false, error: 'There is no browser to watch yet.', reason: 'stale' });
  }
});

/** DELETE /api/browser-agent/view/:instanceId — one viewer leaves. */
router.delete('/view/:instanceId', authenticateToken, (req, res) => {
  if (!req.user?.isAuthenticated) return res.status(401).json({ success: false, error: 'Authentication required' });
  return res.json({ success: true, ...stopViewing(req.params.instanceId) });
});

/** GET /api/browser-agent/view/:instanceId — is anything streaming there? */
router.get('/view/:instanceId', authenticateToken, (req, res) => {
  if (!req.user?.isAuthenticated) return res.status(401).json({ success: false, error: 'Authentication required' });
  return res.json({ success: true, streaming: isStreaming(req.params.instanceId) });
});

export default router;
