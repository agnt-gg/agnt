import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import GeminiCliAuthManager from '../services/auth/GeminiCliAuthManager.js';

const router = express.Router();

// Check connection status
router.get('/status', async (req, res) => {
  try {
    const status = await GeminiCliAuthManager.checkApiUsable();
    res.json(status);
  } catch (error) {
    console.error('[GeminiCLI] Status check error:', error.message);
    res.json({ available: false, apiUsable: false, hint: error.message });
  }
});

// Start Google OAuth flow (loopback server)
router.get('/oauth/start', async (req, res) => {
  try {
    const { sessionId, authUrl } = await GeminiCliAuthManager.startOAuth();
    res.json({ success: true, sessionId, authUrl });
  } catch (error) {
    console.error('[GeminiCLI] OAuth start error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Poll OAuth session status (loopback flow — no code exchange needed)
router.get('/oauth/status', (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Missing sessionId' });
    }
    const status = GeminiCliAuthManager.getSessionStatus(sessionId);
    res.json({ success: true, ...status });
  } catch (error) {
    console.error('[GeminiCLI] OAuth status error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Save API key manually (alternative to OAuth)
router.post('/connect', async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) {
      return res.status(400).json({ success: false, error: 'Missing apiKey' });
    }

    const result = GeminiCliAuthManager.saveManualApiKey(apiKey);
    if (result.success) {
      const status = await GeminiCliAuthManager.checkApiUsable({ forceRefresh: true });
      res.json({ success: true, message: 'Gemini CLI connected successfully', apiUsable: status.apiUsable });
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('[GeminiCLI] Connect error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Refresh access token
router.post('/refresh', async (req, res) => {
  try {
    const result = await GeminiCliAuthManager.refreshAccessToken();
    res.json(result);
  } catch (error) {
    console.error('[GeminiCLI] Refresh error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Set Google Cloud Project (required for workspace/organization accounts)
router.post('/gcp-project', (req, res) => {
  try {
    const { projectId } = req.body;
    if (!projectId) {
      return res.status(400).json({ success: false, error: 'Missing projectId' });
    }
    const result = GeminiCliAuthManager.saveGcpProject(projectId);
    res.json(result);
  } catch (error) {
    console.error('[GeminiCLI] GCP project error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Switch auth method: clear OAuth credentials to force API key usage, or vice versa
router.post('/set-auth-method', async (req, res) => {
  try {
    const { method } = req.body; // 'api-key' or 'oauth'
    if (method === 'api-key') {
      // Remove OAuth creds so API key takes precedence
      const credPath = path.join(os.homedir(), '.gemini', 'oauth_creds.json');
      if (fs.existsSync(credPath)) {
        fs.unlinkSync(credPath);
        console.log('[GeminiCLI] Removed OAuth creds to switch to API key mode');
      }
      // Clear cached state
      GeminiCliAuthManager._codeAssistProject = null;
      GeminiCliAuthManager._currentTier = null;
      GeminiCliAuthManager._paidTier = null;
      GeminiCliAuthManager._lastApiCheck = null;
      GeminiCliAuthManager._lastApiStatus = null;
    } else if (method === 'oauth') {
      // Remove API key from ~/.gemini/.env so OAuth takes precedence
      const envPath = path.join(os.homedir(), '.gemini', '.env');
      try {
        let envContent = fs.readFileSync(envPath, 'utf8');
        envContent = envContent.replace(/^GEMINI_API_KEY=.*\n?/m, '');
        fs.writeFileSync(envPath, envContent, 'utf8');
        console.log('[GeminiCLI] Removed API key from .env to switch to OAuth mode');
      } catch {
        // .env doesn't exist, that's fine
      }
      GeminiCliAuthManager._lastApiCheck = null;
      GeminiCliAuthManager._lastApiStatus = null;
    } else {
      return res.status(400).json({ success: false, error: 'method must be "api-key" or "oauth"' });
    }
    const status = await GeminiCliAuthManager.checkApiUsable({ forceRefresh: true });
    res.json({ success: true, ...status });
  } catch (error) {
    console.error('[GeminiCLI] Set auth method error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Disconnect
router.post('/disconnect', (req, res) => {
  try {
    const result = GeminiCliAuthManager.logout();
    res.json(result);
  } catch (error) {
    console.error('[GeminiCLI] Disconnect error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
