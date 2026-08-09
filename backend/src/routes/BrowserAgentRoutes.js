/**
 * Browser Agent routes — drive the browser AGNT is rendering.
 *
 * The Browser widget hosts a real Chromium surface (an Electron <webview>) and
 * asks the main process for a CDP endpoint onto it. This route takes that
 * endpoint plus a task and runs the SAME action the workflow node uses, so the
 * widget and the node cannot drift: identical provider routing, identical
 * gateway tokens for subscription providers, identical model defaults,
 * identical structured-output handling.
 *
 * The run is synchronous by design. There is no progress feed because there
 * does not need to be one — the user is watching the actual browser navigate,
 * click and type. The page IS the progress indicator, and it is a better one
 * than any step list.
 */

import express from 'express';
import { authenticateToken } from './Middleware.js';
import browserAgentAction from '../tools/library/actions/ai-browser-use.js';
import { browserUseProviderOptions } from '../tools/library/actions/browserUseProviders.js';

const router = express.Router();

/** Runs in flight, so a second Run on the same surface is refused rather than raced. */
const activeRuns = new Map();

/**
 * GET /api/browser-agent/providers
 * The provider list for the widget's dropdown, generated from the same routing
 * table the node uses — a hand-copied list here is how the node's dropdown got
 * stuck advertising three providers for a year.
 */
router.get('/providers', authenticateToken, (req, res) => {
  if (!req.user?.isAuthenticated) return res.status(401).json({ success: false, error: 'Authentication required' });
  return res.json({ success: true, providers: browserUseProviderOptions() });
});

/**
 * POST /api/browser-agent/run
 * Body: { task, cdpUrl, provider?, model?, maxSteps?, timeoutMinutes?, outputSchema? }
 */
router.post('/run', authenticateToken, async (req, res) => {
  if (!req.user?.isAuthenticated) return res.status(401).json({ success: false, error: 'Authentication required' });

  const { task, cdpUrl, provider, model, maxSteps, timeoutMinutes, outputSchema } = req.body || {};

  if (!task || !String(task).trim()) {
    return res.status(400).json({ success: false, error: 'A task is required.' });
  }
  if (!cdpUrl || !String(cdpUrl).trim()) {
    // Without this the action would silently LAUNCH a browser instead of
    // driving the one on screen — the user would watch an idle page while a
    // hidden Chromium did the work somewhere else.
    return res.status(400).json({ success: false, error: 'No browser surface was supplied for this run.' });
  }
  // The bridge is loopback-only and token-gated; refusing anything else here
  // stops this route being turned into a way to reach an arbitrary endpoint.
  if (!/^ws:\/\/127\.0\.0\.1:\d+\//.test(cdpUrl)) {
    return res.status(400).json({ success: false, error: 'That is not a local browser surface.' });
  }

  if (activeRuns.has(cdpUrl)) {
    return res.status(409).json({ success: false, error: 'This browser is already running a task.' });
  }
  activeRuns.set(cdpUrl, Date.now());

  try {
    const result = await browserAgentAction.execute(
      {
        instructions: String(task),
        provider: provider || 'Gemini',
        model: model || '',
        cdpUrl: String(cdpUrl),
        maxSteps: maxSteps || 25,
        timeoutMinutes: timeoutMinutes || 10,
        useVision: 'auto',
        outputSchema: outputSchema || '',
        generateGif: 'false',
      },
      {},
      { userId: req.user.id },
    );

    return res.json({ success: result.success, result });
  } catch (error) {
    console.error('[BrowserAgentRoutes] run failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    activeRuns.delete(cdpUrl);
  }
});

export default router;
