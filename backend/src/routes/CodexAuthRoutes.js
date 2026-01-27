import express from 'express';
import CodexAuthManager from '../services/auth/CodexAuthManager.js';
import CodexCliService from '../services/ai/CodexCliService.js';

const router = express.Router();

/**
 * GET /api/codex/status
 * Checks whether Codex CLI auth exists locally and whether it can call the OpenAI API.
 */
router.get('/status', async (req, res) => {
  try {
    const status = await CodexAuthManager.checkApiUsable();

    const hint = status.available
      ? status.apiUsable
        ? 'Codex auth is available and the OpenAI API is usable.'
        : `Codex auth found but the OpenAI API is not usable${status.apiStatus ? ` (status ${status.apiStatus})` : ''}.`
      : 'Codex auth not found. Use device login to connect.';

    res.json({
      success: true,
      ...status,
      codexWorkdir: CodexCliService.getDefaultWorkdir(),
      toolRunner: CodexCliService.getToolRunnerPath(),
      hint,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to check Codex status',
    });
  }
});

/**
 * POST /api/codex/device/start
 * Starts Codex CLI device login and returns the device URL + code.
 */
router.post('/device/start', async (req, res) => {
  try {
    const session = await CodexAuthManager.startDeviceAuth();

    res.json({
      success: true,
      sessionId: session.sessionId,
      deviceUrl: session.deviceUrl,
      deviceCode: session.deviceCode,
      state: session.state,
      message: session.message || null,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      hint: 'Open the URL, enter the code, then return here. We will poll for completion.',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start device login',
    });
  }
});

/**
 * GET /api/codex/device/status?sessionId=...
 * Polls the current device login session state.
 */
router.get('/device/status', async (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'sessionId is required',
    });
  }

  try {
    const status = await CodexAuthManager.getDeviceSessionStatus(sessionId);
    res.json(status);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to check device login status',
    });
  }
});

/**
 * POST /api/codex/logout
 * Logs out of the Codex CLI.
 */
router.post('/logout', async (req, res) => {
  const result = await CodexAuthManager.logout();
  if (!result.success) {
    return res.status(500).json(result);
  }
  res.json(result);
});

export default router;
