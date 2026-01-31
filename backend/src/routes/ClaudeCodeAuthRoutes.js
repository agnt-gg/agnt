import express from 'express';
import ClaudeCodeAuthManager from '../services/auth/ClaudeCodeAuthManager.js';

const router = express.Router();

/**
 * GET /api/claude-code/status
 * Checks whether Claude Code credentials exist locally and whether the Anthropic API is usable.
 */
router.get('/status', async (req, res) => {
  try {
    const status = await ClaudeCodeAuthManager.checkApiUsable();

    const hint = status.available
      ? status.apiUsable
        ? 'Claude Code is connected and the Anthropic API is usable.'
        : `Claude Code credentials found but the Anthropic API is not usable${status.apiStatus ? ` (status ${status.apiStatus})` : ''}.`
      : 'Claude Code not connected. Use setup-token or paste a token to connect.';

    res.json({
      success: true,
      ...status,
      hint,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to check Claude Code status',
    });
  }
});

/**
 * GET /api/claude-code/oauth/start
 * Initiates the Anthropic OAuth flow.
 * Returns an authUrl the frontend opens in the system browser, plus a sessionId.
 * The redirect_uri points to Anthropic's own code display page — no localhost callback needed.
 */
router.get('/oauth/start', (req, res) => {
  try {
    const { authUrl, sessionId } = ClaudeCodeAuthManager.startOAuth();
    res.json({ success: true, authUrl, sessionId });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start OAuth flow',
    });
  }
});

/**
 * POST /api/claude-code/oauth/exchange
 * Receives the code#state string the user copied from Anthropic's callback page.
 * Parses it, exchanges the code for tokens, and saves credentials.
 */
router.post('/oauth/exchange', async (req, res) => {
  const { sessionId, codeState } = req.body || {};

  if (!sessionId || !codeState) {
    return res.status(400).json({
      success: false,
      error: 'sessionId and codeState are required',
    });
  }

  const parsed = ClaudeCodeAuthManager.parseCodeState(codeState);
  if (!parsed) {
    return res.status(400).json({
      success: false,
      error: 'Could not parse the authorization code. Please copy the full code from the Anthropic page and try again.',
    });
  }

  try {
    const result = await ClaudeCodeAuthManager.exchangeCode(sessionId, parsed.code, parsed.state);
    res.json(result);
  } catch (error) {
    console.error('[ClaudeCodeAuth] Code exchange error:', error.message);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to exchange authorization code',
    });
  }
});

/**
 * POST /api/claude-code/connect
 * Saves a manually provided OAuth token.
 */
router.post('/connect', async (req, res) => {
  const { token } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'token is required in request body',
    });
  }

  try {
    const result = await ClaudeCodeAuthManager.saveManualToken(token);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to save token',
    });
  }
});

/**
 * POST /api/claude-code/disconnect
 * Removes Claude Code credentials.
 */
router.post('/disconnect', async (req, res) => {
  const result = await ClaudeCodeAuthManager.logout();
  if (!result.success) {
    return res.status(500).json(result);
  }
  res.json(result);
});

export default router;
