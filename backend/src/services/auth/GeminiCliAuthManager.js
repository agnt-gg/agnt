import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import http from 'http';
import url from 'url';
import crypto from 'crypto';
import axios from 'axios';
import { OAuth2Client } from 'google-auth-library';

const API_CHECK_TTL_MS = 2 * 60 * 1000; // 2 minutes
const OAUTH_SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before expiry

// Google OAuth configuration — matches the real Gemini CLI exactly
// Source: https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/oauth2.ts
const OAUTH_CONFIG = {
  CLIENT_ID: process.env.GEMINI_CLI_CLIENT_ID || '',
  CLIENT_SECRET: process.env.GEMINI_CLI_CLIENT_SECRET || '',
  AUTHORIZE_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
  TOKEN_URL: 'https://oauth2.googleapis.com/token',
  SCOPES: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
  SUCCESS_URL: 'https://developers.google.com/gemini-code-assist/auth/auth_success_gemini',
  FAILURE_URL: 'https://developers.google.com/gemini-code-assist/auth/auth_failure_gemini',
};

// ── Credential paths ─────────────────────────────────────────
// Real Gemini CLI stores OAuth tokens at ~/.gemini/oauth_creds.json
// Format: { access_token, refresh_token, scope, token_type, id_token, expiry_date }

function resolveGeminiDir() {
  return path.join(os.homedir(), '.gemini');
}

function resolveCredentialsPath() {
  return path.join(resolveGeminiDir(), 'oauth_creds.json');
}

function readCredentialsFile() {
  const credPath = resolveCredentialsPath();
  try {
    const raw = fs.readFileSync(credPath, 'utf8');
    const parsed = JSON.parse(raw);
    return { credPath, data: parsed };
  } catch {
    return { credPath, data: null };
  }
}

function writeCredentials(credData) {
  const credDir = resolveGeminiDir();
  const credPath = resolveCredentialsPath();

  if (!fs.existsSync(credDir)) {
    fs.mkdirSync(credDir, { recursive: true });
  }

  fs.writeFileSync(credPath, JSON.stringify(credData, null, 2), { mode: 0o600 });
}

// ── Port helper ──────────────────────────────────────────────

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Could not determine port')));
      }
    });
    server.on('error', reject);
  });
}

// ── PKCE helpers ─────────────────────────────────────────────

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ══════════════════════════════════════════════════════════════
// GeminiCliAuthManager
// Reads credentials from the real Gemini CLI (~/.gemini/oauth_creds.json)
// and provides a loopback-server OAuth flow for in-app authentication,
// using the same client ID/secret as the Gemini CLI itself.
// ══════════════════════════════════════════════════════════════

class GeminiCliAuthManager {
  constructor() {
    this._oauthSessions = new Map();
    this._lastApiCheck = null;
    this._lastApiStatus = null;
    this._refreshInFlight = null;
  }

  // ── OAuth Flow (loopback server, same as Gemini CLI) ────────

  async startOAuth() {
    const sessionId = crypto.randomUUID();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString('hex');

    const port = await getAvailablePort();
    const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

    // Spin up a temporary loopback HTTP server to catch Google's redirect
    const server = http.createServer(async (req, res) => {
      const parsed = new url.URL(req.url, `http://127.0.0.1:${port}`);

      if (parsed.pathname !== '/oauth2callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const session = this._oauthSessions.get(sessionId);
      const error = parsed.searchParams.get('error');

      if (error) {
        res.writeHead(302, { Location: OAUTH_CONFIG.FAILURE_URL });
        res.end();
        if (session) { session.status = 'error'; session.error = `Google OAuth error: ${error}`; }
        server.close();
        return;
      }

      if (parsed.searchParams.get('state') !== state) {
        res.writeHead(302, { Location: OAUTH_CONFIG.FAILURE_URL });
        res.end();
        if (session) { session.status = 'error'; session.error = 'OAuth state mismatch'; }
        server.close();
        return;
      }

      const code = parsed.searchParams.get('code');
      if (!code) {
        res.writeHead(400);
        res.end('Missing code');
        return;
      }

      // Exchange code for tokens
      try {
        await this._exchangeCodeForTokens(code, codeVerifier, redirectUri);
        res.writeHead(302, { Location: OAUTH_CONFIG.SUCCESS_URL });
        res.end();
        if (session) { session.status = 'success'; }
      } catch (err) {
        res.writeHead(302, { Location: OAUTH_CONFIG.FAILURE_URL });
        res.end();
        if (session) { session.status = 'error'; session.error = err.message; }
      }
      server.close();
    });

    // Auto-close server after timeout
    const timeout = setTimeout(() => {
      const session = this._oauthSessions.get(sessionId);
      if (session && session.status === 'pending') {
        session.status = 'error';
        session.error = 'OAuth timed out';
      }
      server.close();
    }, OAUTH_SESSION_TTL_MS);

    server.on('close', () => clearTimeout(timeout));
    server.listen(port, '127.0.0.1', () => {
      console.log(`[GeminiCliAuth] Loopback server on port ${port}`);
    });

    this._oauthSessions.set(sessionId, {
      status: 'pending',
      error: null,
      createdAt: Date.now(),
    });

    // Clean up old sessions
    for (const [id, sess] of this._oauthSessions) {
      if (Date.now() - sess.createdAt > OAUTH_SESSION_TTL_MS) {
        this._oauthSessions.delete(id);
      }
    }

    const params = new URLSearchParams({
      client_id: OAUTH_CONFIG.CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: OAUTH_CONFIG.SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    });

    const authUrl = `${OAUTH_CONFIG.AUTHORIZE_URL}?${params.toString()}`;
    return { sessionId, authUrl };
  }

  // Poll session status from frontend
  getSessionStatus(sessionId) {
    const session = this._oauthSessions.get(sessionId);
    if (!session) {
      return { status: 'expired', error: 'Session not found or expired' };
    }
    return { status: session.status, error: session.error };
  }

  // Exchange code → tokens, write to ~/.gemini/oauth_creds.json (Gemini CLI format)
  async _exchangeCodeForTokens(code, codeVerifier, redirectUri) {
    const response = await axios.post(OAUTH_CONFIG.TOKEN_URL, new URLSearchParams({
      code,
      client_id: OAUTH_CONFIG.CLIENT_ID,
      client_secret: OAUTH_CONFIG.CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const t = response.data;

    // Write in exact Gemini CLI format
    const credData = {
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      scope: t.scope || OAUTH_CONFIG.SCOPES,
      token_type: t.token_type || 'Bearer',
      id_token: t.id_token || undefined,
      expiry_date: Date.now() + (t.expires_in || 3600) * 1000,
    };
    writeCredentials(credData);
    this._lastApiCheck = null;

    console.log('[GeminiCliAuth] OAuth tokens saved to ~/.gemini/oauth_creds.json');
  }

  // ── Manual API Key ─────────────────────────────────────────
  // Stored in ~/.gemini/.env as GEMINI_API_KEY (Gemini CLI convention)

  saveManualApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
      return { success: false, error: 'Invalid API key' };
    }

    const credDir = resolveGeminiDir();
    if (!fs.existsSync(credDir)) {
      fs.mkdirSync(credDir, { recursive: true });
    }

    // Write to ~/.gemini/.env (Gemini CLI reads this)
    const envPath = path.join(credDir, '.env');
    let envContent = '';
    try {
      envContent = fs.readFileSync(envPath, 'utf8');
    } catch {
      // doesn't exist yet
    }

    // Replace or append GEMINI_API_KEY
    if (envContent.match(/^GEMINI_API_KEY=/m)) {
      envContent = envContent.replace(/^GEMINI_API_KEY=.*/m, `GEMINI_API_KEY=${apiKey}`);
    } else {
      envContent = envContent.trim() + (envContent.trim() ? '\n' : '') + `GEMINI_API_KEY=${apiKey}\n`;
    }
    fs.writeFileSync(envPath, envContent, 'utf8');
    this._lastApiCheck = null;

    console.log('[GeminiCliAuth] API key saved to ~/.gemini/.env');
    return { success: true };
  }

  _readApiKey() {
    // Check env var first (same as Gemini CLI)
    if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;

    // Read from ~/.gemini/.env
    const envPath = path.join(resolveGeminiDir(), '.env');
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/^GEMINI_API_KEY=(.+)$/m);
      return match ? match[1].trim() : null;
    } catch {
      return null;
    }
  }

  // ── Google Cloud Project ──────────────────────────────────
  // Workspace/organization accounts require a GCP project for Code Assist.
  // Gemini CLI reads GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID.

  _readGcpProject() {
    // Check env vars first (same precedence as Gemini CLI)
    if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;
    if (process.env.GOOGLE_CLOUD_PROJECT_ID) return process.env.GOOGLE_CLOUD_PROJECT_ID;

    // Read from ~/.gemini/.env
    const envPath = path.join(resolveGeminiDir(), '.env');
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/^GOOGLE_CLOUD_PROJECT(?:_ID)?=(.+)$/m);
      return match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
    } catch {
      return null;
    }
  }

  saveGcpProject(projectId) {
    if (!projectId || typeof projectId !== 'string') {
      return { success: false, error: 'Invalid project ID' };
    }

    const credDir = resolveGeminiDir();
    if (!fs.existsSync(credDir)) {
      fs.mkdirSync(credDir, { recursive: true });
    }

    const envPath = path.join(credDir, '.env');
    let envContent = '';
    try {
      envContent = fs.readFileSync(envPath, 'utf8');
    } catch {
      // doesn't exist yet
    }

    // Replace or append GOOGLE_CLOUD_PROJECT
    if (envContent.match(/^GOOGLE_CLOUD_PROJECT=/m)) {
      envContent = envContent.replace(/^GOOGLE_CLOUD_PROJECT=.*/m, `GOOGLE_CLOUD_PROJECT=${projectId}`);
    } else {
      envContent = envContent.trim() + (envContent.trim() ? '\n' : '') + `GOOGLE_CLOUD_PROJECT=${projectId}\n`;
    }
    fs.writeFileSync(envPath, envContent, 'utf8');

    // Clear onboarding cache so it re-checks with the new project
    this._codeAssistProject = null;
    this._lastApiCheck = null;

    console.log('[GeminiCliAuth] GCP project saved:', projectId);
    return { success: true };
  }

  // ── Token Access ───────────────────────────────────────────

  async getAccessToken({ autoRefresh = true } = {}) {
    // 1. Prefer explicit API key (simplest, no refresh needed)
    const apiKey = this._readApiKey();
    if (apiKey) return apiKey;

    // 2. Read OAuth credentials from ~/.gemini/oauth_creds.json
    const { data } = readCredentialsFile();
    if (!data) return null;

    // If token is still fresh, return it
    if (data.access_token && data.expiry_date && Date.now() < data.expiry_date - REFRESH_BUFFER_MS) {
      return data.access_token;
    }

    // 3. Auto-refresh if we have a refresh token
    if (autoRefresh && data.refresh_token) {
      const result = await this.refreshAccessToken();
      if (result.success) {
        const { data: refreshed } = readCredentialsFile();
        return refreshed?.access_token || null;
      }
    }

    // Return possibly-expired token as last resort
    return data.access_token || null;
  }

  isUsingApiKey() {
    return !!this._readApiKey();
  }

  // ── Token Refresh ──────────────────────────────────────────

  async refreshAccessToken() {
    if (this._refreshInFlight) return this._refreshInFlight;
    this._refreshInFlight = this._doRefresh();
    try {
      return await this._refreshInFlight;
    } finally {
      this._refreshInFlight = null;
    }
  }

  async _doRefresh() {
    const { data } = readCredentialsFile();
    if (!data?.refresh_token) {
      return { success: false, error: 'No refresh token available', revoked: false };
    }

    // Use client_id/secret from the credential file if present, otherwise defaults
    const clientId = data.client_id || OAUTH_CONFIG.CLIENT_ID;
    const clientSecret = data.client_secret || OAUTH_CONFIG.CLIENT_SECRET;

    try {
      const response = await axios.post(OAUTH_CONFIG.TOKEN_URL, new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: data.refresh_token,
      }).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const t = response.data;

      // Update the credentials file in place (preserving existing fields)
      const updated = {
        ...data,
        access_token: t.access_token,
        expiry_date: Date.now() + (t.expires_in || 3600) * 1000,
        token_type: t.token_type || data.token_type || 'Bearer',
        scope: t.scope || data.scope,
      };
      if (t.refresh_token) updated.refresh_token = t.refresh_token;
      if (t.id_token) updated.id_token = t.id_token;
      writeCredentials(updated);
      this._lastApiCheck = null;

      console.log('[GeminiCliAuth] Token refreshed');
      return { success: true };
    } catch (error) {
      const status = error.response?.status;
      const errorCode = error.response?.data?.error;
      const revoked = status === 400 && errorCode === 'invalid_grant';

      console.error('[GeminiCliAuth] Token refresh failed:', errorCode || error.message);
      return { success: false, error: `Refresh failed: ${errorCode || error.message}`, revoked };
    }
  }

  // ── Status Checks ──────────────────────────────────────────

  async checkApiUsable({ forceRefresh = false } = {}) {
    if (!forceRefresh && this._lastApiCheck && Date.now() - this._lastApiCheck < API_CHECK_TTL_MS) {
      return this._lastApiStatus;
    }

    const apiKey = this._readApiKey();
    const { data } = readCredentialsFile();
    if (!apiKey && !data?.refresh_token && !data?.access_token) {
      const result = { available: false, apiUsable: false, hint: 'Not connected' };
      this._lastApiStatus = result;
      this._lastApiCheck = Date.now();
      return result;
    }

    try {
      const token = await this.getAccessToken({ autoRefresh: true });
      if (!token) {
        const result = { available: false, apiUsable: false, hint: 'No valid token' };
        this._lastApiStatus = result;
        this._lastApiCheck = Date.now();
        return result;
      }

      // Test with a lightweight models list call
      const isApiKey = this.isUsingApiKey();
      let testUrl, headers = {};

      if (isApiKey) {
        testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${token}&pageSize=1`;
        const response = await axios.get(testUrl, { headers, timeout: 10000 });
        const result = {
          available: true,
          apiUsable: response.status === 200,
          apiStatus: response.status,
          source: 'api-key',
          tier: 'api-key',
          gcpProject: this._readGcpProject() || null,
        };
        this._lastApiStatus = result;
        this._lastApiCheck = Date.now();
        return result;
      } else {
        // OAuth → use loadCodeAssist as health check (Code Assist has no /models endpoint)
        headers.Authorization = `Bearer ${token}`;
        const loadData = { metadata: { ide_type: 'GEMINI_CLI', platform: 'WINDOWS_AMD64', plugin_type: 'CLOUD_CODE' }, mode: 'HEALTH_CHECK' };
        const gcpProject = this._readGcpProject();
        if (gcpProject) loadData.project = gcpProject;
        const response = await axios.post(
          'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
          loadData,
          { headers: { ...headers, 'Content-Type': 'application/json' }, timeout: 10000 },
        );

        // Cache tier info from the health check response
        if (response.data) {
          this._currentTier = response.data.currentTier?.id || this._currentTier;
          this._paidTier = response.data.paidTier?.id || this._paidTier;
        }

        const result = {
          available: true,
          apiUsable: response.status === 200,
          apiStatus: response.status,
          source: 'oauth',
          tier: this._currentTier || 'unknown',
          paidTier: this._paidTier || null,
          gcpProject: gcpProject || null,
        };
        this._lastApiStatus = result;
        this._lastApiCheck = Date.now();
        return result;
      }
    } catch (error) {
      const status = error.response?.status;
      const result = {
        available: true,
        apiUsable: false,
        apiStatus: status || null,
        hint: status === 401 ? 'Token expired or revoked' : `API error: ${error.message}`,
      };
      this._lastApiStatus = result;
      this._lastApiCheck = Date.now();
      return result;
    }
  }

  // ── OAuth2Client ────────────────────────────────────────

  /**
   * Returns a google-auth-library OAuth2Client configured with the stored
   * OAuth credentials. Used by the GoogleGenAI SDK for authenticated requests
   * to the Code Assist endpoint (cloud-platform scope).
   */
  getOAuth2Client() {
    const { data } = readCredentialsFile();
    if (!data) return null;

    const client = new OAuth2Client({
      clientId: OAUTH_CONFIG.CLIENT_ID,
      clientSecret: OAUTH_CONFIG.CLIENT_SECRET,
    });
    client.setCredentials({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry_date: data.expiry_date,
      token_type: data.token_type || 'Bearer',
      scope: data.scope,
    });

    // Persist refreshed tokens back to disk
    client.on('tokens', (tokens) => {
      const updated = { ...data, ...tokens };
      if (tokens.expiry_date) updated.expiry_date = tokens.expiry_date;
      writeCredentials(updated);
      this._lastApiCheck = null;
      console.log('[GeminiCliAuth] OAuth2Client refreshed token automatically');
    });

    return client;
  }

  // ── Code Assist Onboarding ─────────────────────────────────
  // The Code Assist endpoint requires users to be onboarded before
  // generateContent works. This replicates the Gemini CLI's setup flow.

  async ensureOnboarded(oauth2Client) {
    // Return cached project if we already onboarded
    if (this._codeAssistProject) return this._codeAssistProject;

    const authClient = oauth2Client || this.getOAuth2Client();
    if (!authClient) return undefined;

    const BASE = 'https://cloudcode-pa.googleapis.com/v1internal';
    const META = { ide_type: 'GEMINI_CLI', platform: 'WINDOWS_AMD64', plugin_type: 'CLOUD_CODE' };
    const gcpProject = this._readGcpProject();

    try {
      // Check if already onboarded
      const loadData = { metadata: META, mode: 'HEALTH_CHECK' };
      if (gcpProject) loadData.project = gcpProject;
      const loadRes = await authClient.request({
        url: `${BASE}:loadCodeAssist`,
        method: 'POST',
        data: loadData,
      });
      const data = loadRes.data;

      // Cache tier info for model availability checks (zero-cost, no extra API call)
      this._currentTier = data.currentTier?.id || null;
      this._paidTier = data.paidTier?.id || null;
      const allowedTiers = data.allowedTiers || [];

      // Log full tier diagnostics on first check
      console.log('[GeminiCliAuth] Tier info — current:', this._currentTier,
        '| paid:', this._paidTier,
        '| allowed:', JSON.stringify(allowedTiers.map(t => t.id)),
        '| project:', data.cloudaicompanionProject || 'none',
        '| gcpProject:', gcpProject || 'none');

      if (data.currentTier && data.cloudaicompanionProject) {
        // Already onboarded — check if we should upgrade to a paid tier
        const bestPaidTier = allowedTiers.find(t => t.id && t.id !== 'free-tier');
        const shouldUpgrade = this._currentTier === 'free-tier' && (this._paidTier || bestPaidTier);
        const upgradeTierId = this._paidTier || bestPaidTier?.id;

        if (shouldUpgrade && upgradeTierId) {
          console.log(`[GeminiCliAuth] Currently on free-tier but paid tier '${upgradeTierId}' available, upgrading...`);
          try {
            await this._onboardToTier(authClient, BASE, META, upgradeTierId);
            // Re-check to get updated project after upgrade
            const reloadRes = await authClient.request({
              url: `${BASE}:loadCodeAssist`,
              method: 'POST',
              data: { metadata: META, mode: 'HEALTH_CHECK' },
            });
            const reloaded = reloadRes.data;
            this._currentTier = reloaded.currentTier?.id || this._currentTier;
            this._paidTier = reloaded.paidTier?.id || this._paidTier;
            if (reloaded.cloudaicompanionProject) {
              this._codeAssistProject = reloaded.cloudaicompanionProject;
            }
            console.log('[GeminiCliAuth] Upgraded — tier:', this._currentTier, '| project:', this._codeAssistProject);
          } catch (upgradeErr) {
            console.warn('[GeminiCliAuth] Tier upgrade failed (continuing with free-tier):', upgradeErr.message);
          }
        }

        if (!this._codeAssistProject) {
          this._codeAssistProject = data.cloudaicompanionProject;
        }
        console.log('[GeminiCliAuth] Onboarded, project:', this._codeAssistProject, 'tier:', this._currentTier);
        return this._codeAssistProject;
      }

      // Need to onboard — pick the best available tier (prefer paid)
      const selectedTier = allowedTiers.find(t => t.id && t.id !== 'free-tier') || allowedTiers.find(t => t.id === 'free-tier');
      if (!selectedTier) {
        console.warn('[GeminiCliAuth] No tiers available for onboarding');
        return undefined;
      }

      const tierId = selectedTier.id;
      console.log(`[GeminiCliAuth] Onboarding user to ${tierId}...`);
      await this._onboardToTier(authClient, BASE, META, tierId);

      return this._codeAssistProject;
    } catch (error) {
      console.error('[GeminiCliAuth] Onboarding failed:', error.message);
      return undefined;
    }
  }

  /**
   * Onboard user to a specific tier via the Code Assist API.
   * Polls the long-running operation until complete.
   */
  async _onboardToTier(authClient, base, meta, tierId) {
    const onboardData = { tier_id: tierId, metadata: meta };
    const gcpProject = this._readGcpProject();
    if (gcpProject) onboardData.project = gcpProject;
    const onboardRes = await authClient.request({
      url: `${base}:onboardUser`,
      method: 'POST',
      data: onboardData,
    });

    // Poll the long-running operation
    const opName = onboardRes.data?.name;
    if (opName) {
      for (let i = 0; i < 10; i++) {
        const opRes = await authClient.request({ url: `${base}/${opName}`, method: 'GET' });
        if (opRes.data?.done) {
          const proj = opRes.data.response?.cloudaicompanionProject;
          this._codeAssistProject = proj?.id || proj?.name;
          console.log(`[GeminiCliAuth] Onboarded to ${tierId}, project:`, this._codeAssistProject);
          return;
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  // ── Tier Info ────────────────────────────────────────────────
  // Returns cached tier info from the loadCodeAssist response.
  // Used to determine model availability without burning API quota.

  hasPaidTier() {
    // paidTier is set explicitly for paid users, OR currentTier may be 'standard'/'legacy' (not 'free-tier')
    if (this._paidTier) return true;
    if (this._currentTier && this._currentTier !== 'free-tier') return true;
    return false;
  }

  // ── Disconnect ─────────────────────────────────────────────

  logout() {
    try {
      const credPath = resolveCredentialsPath();
      if (fs.existsSync(credPath)) {
        fs.unlinkSync(credPath);
      }
      // Also remove the API key from .env if present
      const envPath = path.join(resolveGeminiDir(), '.env');
      try {
        let envContent = fs.readFileSync(envPath, 'utf8');
        envContent = envContent.replace(/^GEMINI_API_KEY=.*\n?/m, '');
        fs.writeFileSync(envPath, envContent, 'utf8');
      } catch {
        // .env doesn't exist, that's fine
      }

      this._lastApiCheck = null;
      this._lastApiStatus = null;
      this._codeAssistProject = null;
      this._currentTier = null;
      this._paidTier = null;
      console.log('[GeminiCliAuth] Logged out, credentials removed');
      return { success: true };
    } catch (error) {
      console.error('[GeminiCliAuth] Logout failed:', error.message);
      return { success: false, error: error.message };
    }
  }
}

export default new GeminiCliAuthManager();
