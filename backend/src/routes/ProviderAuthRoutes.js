/**
 * Unified provider auth routes — /api/providers/:providerId/auth/*
 *
 * Local CLI providers are handled entirely on localhost (filesystem credentials).
 * Remote standard providers proxy to agnt.gg.
 */

import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getAuthEntry, getCapabilities, isLocalProvider } from '../services/auth/AuthDispatcher.js';
import CodexCliService from '../services/ai/CodexCliService.js';

const router = express.Router();

// ─────────────────────────── PARAM MIDDLEWARE ───────────────────────────

router.param('providerId', (req, res, next, providerId) => {
  const entry = getAuthEntry(providerId);
  if (!entry) {
    return res.status(404).json({ success: false, error: `Unknown provider: ${providerId}` });
  }
  req.providerEntry = entry;
  req.providerId = providerId;
  next();
});

// ─────────────────────────── STATUS ───────────────────────────

router.get('/:providerId/auth/status', async (req, res) => {
  const { providerEntry, providerId } = req;

  if (!providerEntry.local) {
    // Remote providers: return basic info (actual health check is via UserService)
    return res.json({
      success: true,
      available: false,
      providerId,
      local: false,
      hint: 'Use connection health endpoint for remote provider status.',
    });
  }

  try {
    const status = await providerEntry.manager.checkApiUsable();

    const extra = {};
    // Codex-specific extras
    if (providerEntry.config.authScheme === 'codex') {
      extra.codexWorkdir = CodexCliService.getDefaultWorkdir();
      extra.toolRunner = CodexCliService.getToolRunnerPath();
    }

    res.json({ success: true, ...status, ...extra });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to check status' });
  }
});

// ─────────────────────────── CAPABILITIES ───────────────────────────

router.get('/:providerId/auth/capabilities', (req, res) => {
  const caps = getCapabilities(req.providerId);
  if (!caps) {
    return res.status(404).json({ success: false, error: 'Provider not found' });
  }
  res.json({ success: true, ...caps });
});

// ─────────────────────────── CONNECT ───────────────────────────

router.post('/:providerId/auth/connect', async (req, res) => {
  const { providerEntry, providerId } = req;

  if (providerEntry.local) {
    // Claude Code: save manual token
    if (providerEntry.config.authScheme === 'claude-code') {
      const { token } = req.body || {};
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ success: false, error: 'token is required in request body' });
      }
      try {
        const result = await providerEntry.manager.saveManualToken(token);
        if (!result.success) return res.status(400).json(result);
        return res.json(result);
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message || 'Failed to save token' });
      }
    }

    // Gemini CLI: save API key
    if (providerEntry.config.authScheme === 'gemini-cli') {
      const { apiKey } = req.body || {};
      if (!apiKey) {
        return res.status(400).json({ success: false, error: 'Missing apiKey' });
      }
      try {
        const result = providerEntry.manager.saveManualApiKey(apiKey);
        if (result.success) {
          const status = await providerEntry.manager.checkApiUsable({ forceRefresh: true });
          return res.json({ success: true, message: 'Gemini CLI connected successfully', apiUsable: status.apiUsable });
        }
        return res.status(400).json(result);
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    }

    return res.status(400).json({ success: false, error: `Connect not supported for ${providerId}` });
  }

  // Remote providers: proxy API key save to REMOTE_URL
  try {
    const REMOTE_URL = process.env.REMOTE_URL || 'https://api.agnt.gg';
    const authHeader = req.headers.authorization || '';
    const response = await fetch(`${REMOTE_URL}/auth/apikeys/${providerId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to connect provider' });
  }
});

// ─────────────────────────── DISCONNECT ───────────────────────────

router.post('/:providerId/auth/disconnect', async (req, res) => {
  const { providerEntry, providerId } = req;

  if (providerEntry.local) {
    try {
      const result = await providerEntry.manager.logout();
      if (!result.success) return res.status(500).json(result);
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // Remote providers: proxy disconnect to REMOTE_URL
  try {
    const REMOTE_URL = process.env.REMOTE_URL || 'https://api.agnt.gg';
    const authHeader = req.headers.authorization || '';
    const response = await fetch(`${REMOTE_URL}/auth/disconnect/${providerId}`, {
      method: 'POST',
      headers: {
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to disconnect provider' });
  }
});

// ─────────────────────────── REFRESH ───────────────────────────

router.post('/:providerId/auth/refresh', async (req, res) => {
  const { providerEntry } = req;

  if (!providerEntry.local || !providerEntry.caps.includes('refresh')) {
    return res.status(400).json({ success: false, error: 'Refresh not supported for this provider' });
  }

  try {
    const result = await providerEntry.manager.refreshAccessToken();

    if (result.success) {
      const status = await providerEntry.manager.checkApiUsable({ forceRefresh: true });
      return res.json({ success: true, refreshed: true, ...status });
    }

    // Revoked/expired refresh token — user must re-authenticate
    if (result.revoked) {
      return res.status(401).json({ success: false, code: 'REAUTH_REQUIRED', error: result.error });
    }

    res.status(502).json({ success: false, code: 'REFRESH_FAILED', error: result.error });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to refresh token' });
  }
});

// ─────────────────────────── OAUTH START ───────────────────────────

router.get('/:providerId/auth/oauth/start', async (req, res) => {
  const { providerEntry } = req;

  if (!providerEntry.local) {
    return res.status(400).json({ success: false, error: 'OAuth start not supported for remote providers' });
  }

  try {
    // Both ClaudeCodeAuthManager and GeminiCliAuthManager have startOAuth()
    const result = await providerEntry.manager.startOAuth();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to start OAuth flow' });
  }
});

// ─────────────────────────── OAUTH EXCHANGE (claude-code PKCE) ───────────────────────────

router.post('/:providerId/auth/oauth/exchange', async (req, res) => {
  const { providerEntry } = req;

  if (!providerEntry.caps.includes('oauth-pkce')) {
    return res.status(400).json({ success: false, error: 'OAuth exchange not supported for this provider' });
  }

  const { sessionId, codeState } = req.body || {};
  if (!sessionId || !codeState) {
    return res.status(400).json({ success: false, error: 'sessionId and codeState are required' });
  }

  const parsed = providerEntry.manager.parseCodeState(codeState);
  if (!parsed) {
    return res.status(400).json({
      success: false,
      error: 'Could not parse the authorization code. Please copy the full code from the Anthropic page and try again.',
    });
  }

  try {
    const result = await providerEntry.manager.exchangeCode(sessionId, parsed.code, parsed.state);
    res.json(result);
  } catch (error) {
    console.error('[ProviderAuth] Code exchange error:', error.message);
    res.status(400).json({ success: false, error: error.message || 'Failed to exchange authorization code' });
  }
});

// ─────────────────────────── OAUTH STATUS (gemini-cli loopback) ───────────────────────────

router.get('/:providerId/auth/oauth/status', (req, res) => {
  const { providerEntry } = req;

  if (!providerEntry.caps.includes('oauth-loopback')) {
    return res.status(400).json({ success: false, error: 'OAuth status polling not supported for this provider' });
  }

  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Missing sessionId' });
    }
    const status = providerEntry.manager.getSessionStatus(sessionId);
    res.json({ success: true, ...status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────── DEVICE AUTH START ───────────────────────────

router.post('/:providerId/auth/device/start', async (req, res) => {
  const { providerEntry } = req;

  if (!providerEntry.caps.includes('device-auth')) {
    return res.status(400).json({ success: false, error: 'Device auth not supported for this provider' });
  }

  try {
    const session = await providerEntry.manager.startDeviceAuth();
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
    res.status(500).json({ success: false, error: error.message || 'Failed to start device login' });
  }
});

// ─────────────────────────── DEVICE AUTH STATUS ───────────────────────────

router.get('/:providerId/auth/device/status', async (req, res) => {
  const { providerEntry } = req;

  if (!providerEntry.caps.includes('device-auth')) {
    return res.status(400).json({ success: false, error: 'Device auth not supported for this provider' });
  }

  const { sessionId } = req.query;
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ success: false, error: 'sessionId is required' });
  }

  try {
    const status = await providerEntry.manager.getDeviceSessionStatus(sessionId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to check device login status' });
  }
});

// ─────────────────────────── SET AUTH METHOD (gemini-cli) ───────────────────────────

router.post('/:providerId/auth/set-auth-method', async (req, res) => {
  const { providerEntry } = req;

  if (!providerEntry.caps.includes('set-auth-method')) {
    return res.status(400).json({ success: false, error: 'set-auth-method not supported for this provider' });
  }

  try {
    const { method } = req.body; // 'api-key' or 'oauth'
    if (method === 'api-key') {
      const credPath = path.join(os.homedir(), '.gemini', 'oauth_creds.json');
      if (fs.existsSync(credPath)) {
        fs.unlinkSync(credPath);
        console.log('[ProviderAuth] Removed OAuth creds to switch to API key mode');
      }
      providerEntry.manager._codeAssistProject = null;
      providerEntry.manager._currentTier = null;
      providerEntry.manager._paidTier = null;
      providerEntry.manager._lastApiCheck = null;
      providerEntry.manager._lastApiStatus = null;
    } else if (method === 'oauth') {
      const envPath = path.join(os.homedir(), '.gemini', '.env');
      try {
        let envContent = fs.readFileSync(envPath, 'utf8');
        envContent = envContent.replace(/^GEMINI_API_KEY=.*\n?/m, '');
        fs.writeFileSync(envPath, envContent, 'utf8');
        console.log('[ProviderAuth] Removed API key from .env to switch to OAuth mode');
      } catch {
        // .env doesn't exist, that's fine
      }
      providerEntry.manager._lastApiCheck = null;
      providerEntry.manager._lastApiStatus = null;
    } else {
      return res.status(400).json({ success: false, error: 'method must be "api-key" or "oauth"' });
    }
    const status = await providerEntry.manager.checkApiUsable({ forceRefresh: true });
    res.json({ success: true, ...status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────── GCP PROJECT (gemini-cli) ───────────────────────────

router.post('/:providerId/auth/gcp-project', (req, res) => {
  const { providerEntry } = req;

  if (!providerEntry.caps.includes('gcp-project')) {
    return res.status(400).json({ success: false, error: 'GCP project not supported for this provider' });
  }

  try {
    const { projectId } = req.body;
    if (!projectId) {
      return res.status(400).json({ success: false, error: 'Missing projectId' });
    }
    const result = providerEntry.manager.saveGcpProject(projectId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
