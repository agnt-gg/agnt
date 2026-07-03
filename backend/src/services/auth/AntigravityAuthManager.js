import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import url from 'url';
import crypto from 'crypto';
import axios from 'axios';
import { OAuth2Client } from 'google-auth-library';
import { getClientVersion } from '../ai/clientVersions.js';

const API_CHECK_TTL_MS = 2 * 60 * 1000; // 2 minutes
const OAUTH_SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
// PRD-109 ban-avoidance: the only documented Antigravity ban cause is behavioral
// (quota exhaustion + retry-storms). A single account-global cooldown flag stops
// us hitting Google after a 403/429 or when quota crosses the soft floor.
const SOFT_QUOTA_FLOOR = parseFloat(process.env.ANTIGRAVITY_SOFT_QUOTA_FLOOR || '0.10');
const COOLDOWN_MS = 5 * 60 * 1000; // after a 403/429, stop hitting Google for 5 min
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before expiry

// ══════════════════════════════════════════════════════════════
// Antigravity gateway configuration
// ══════════════════════════════════════════════════════════════
// Google folded Gemini CLI into Antigravity CLI (I/O 2026). The gateway
// endpoint is the SAME cloudcode-pa.googleapis.com/v1internal host, but
// Antigravity uses two additional OAuth scopes (cclog + experimentsandconfigs),
// ANTIGRAVITY client metadata, and an antigravity User-Agent. It unlocks a
// multi-vendor model set (Gemini 3.x + Claude 4.6 + GPT-OSS) through one login.
//
// The real Antigravity CLI stores its credentials in the OS keychain, which we
// cannot read. So we run our own loopback OAuth flow using Antigravity's own
// installed-app OAuth client and persist tokens to ~/.antigravity/oauth_creds.json.
//
// Client ID/secret: Antigravity ships its OWN dedicated OAuth client — distinct
// from Gemini CLI's. The Gemini CLI client is NOT authorized for the cclog /
// experimentsandconfigs scopes, so using it returns HTTP 400 invalid_scope.
// Set ANTIGRAVITY_CLIENT_ID / ANTIGRAVITY_CLIENT_SECRET in .env (never
// hardcoded here — same convention as GEMINI_CLI_CLIENT_ID).

// The Antigravity OAuth client is registered ONLY for this exact redirect URI.
// Google validates redirect_uri against the client's registered list, so we must
// use it verbatim (a random loopback port would 400 redirect_uri_mismatch).
const ANTIGRAVITY_REDIRECT_URI = 'http://localhost:51121/oauth-callback';
const ANTIGRAVITY_CALLBACK_PORT = 51121;
const ANTIGRAVITY_CALLBACK_PATH = '/oauth-callback';

const OAUTH_CONFIG = {
  CLIENT_ID: process.env.ANTIGRAVITY_CLIENT_ID || '',
  CLIENT_SECRET: process.env.ANTIGRAVITY_CLIENT_SECRET || '',
  AUTHORIZE_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
  TOKEN_URL: 'https://oauth2.googleapis.com/token',
  REDIRECT_URI: ANTIGRAVITY_REDIRECT_URI,
  // Antigravity requires 5 scopes (Gemini CLI uses only the first 3).
  SCOPES: [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs',
  ].join(' '),
  SUCCESS_URL: 'https://developers.google.com/gemini-code-assist/auth/auth_success_gemini',
  FAILURE_URL: 'https://developers.google.com/gemini-code-assist/auth/auth_failure_gemini',
};

// Antigravity gateway host + client identity headers
const ANTIGRAVITY_BASE = 'https://cloudcode-pa.googleapis.com/v1internal';
// TWO different platform encodings (Google validates them differently):
//  • HEADER Client-Metadata JSON  → short form: WINDOWS / MACOS
//  • BODY  metadata.platform enum → full form:  WINDOWS_AMD64 / DARWIN_ARM64 ...
// Sending the short form in the BODY returns 400 INVALID_ARGUMENT
// ("Invalid value at 'metadata.platform', WINDOWS"). Verified against the live
// gateway: PLATFORM_UNSPECIFIED and the *_AMD64 forms all return 200.
const ANTIGRAVITY_HEADER_PLATFORM = process.platform === 'win32' ? 'WINDOWS' : 'MACOS';
const ANTIGRAVITY_BODY_PLATFORM = process.platform === 'win32'
  ? 'WINDOWS_AMD64'
  : (process.platform === 'darwin'
    ? (process.arch === 'arm64' ? 'DARWIN_ARM64' : 'DARWIN_AMD64')
    : 'LINUX_AMD64');
// Header Client-Metadata (short-form platform).
const CLIENT_METADATA = { ideType: 'ANTIGRAVITY', platform: ANTIGRAVITY_HEADER_PLATFORM, pluginType: 'GEMINI' };
// Request-body metadata (full-form platform enum).
const BODY_METADATA = { ideType: 'ANTIGRAVITY', platform: ANTIGRAVITY_BODY_PLATFORM, pluginType: 'GEMINI' };

// ⚠️ CRITICAL (the "out of date" bug): loadCodeAssist / onboardUser are called
// with the plain google-api-nodejs-client User-Agent — NOT antigravity/<version>.
// Google's version gate only inspects the `antigravity/<version>` UA, so sending
// it on these calls triggers "Your version of Antigravity is out of date." The
// reference client uses the nodejs-client UA here (no version to gate) and only
// carries the ANTIGRAVITY Client-Metadata JSON. No X-Goog-Api-Client on these.
const ANTIGRAVITY_HEADERS = {
  'User-Agent': 'google-api-nodejs-client/9.15.1',
  'Client-Metadata': JSON.stringify(CLIENT_METADATA),
};

// fetchAvailableModels is gated the OPPOSITE way from loadCodeAssist: it returns
// 403 for the nodejs-client UA and requires the full Antigravity browser UA
// (verified against the live gateway). Version resolved LIVE via clientVersions.js.
async function getAntigravityBrowserHeaders() {
  const ver = await getClientVersion('antigravity');
  return {
    'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/${ver} Chrome/138.0.7204.235 Electron/37.3.1 Safari/537.36`,
    'Client-Metadata': JSON.stringify(CLIENT_METADATA),
  };
}

// ── Credential paths ─────────────────────────────────────────
// We store OAuth tokens at ~/.antigravity/oauth_creds.json (our own file —
// the real CLI uses the OS keychain which we can't read).
// Format: { access_token, refresh_token, scope, token_type, id_token, expiry_date }

function resolveAntigravityDir() {
  return path.join(os.homedir(), '.antigravity');
}

function resolveCredentialsPath() {
  return path.join(resolveAntigravityDir(), 'oauth_creds.json');
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
  const credDir = resolveAntigravityDir();
  const credPath = resolveCredentialsPath();

  if (!fs.existsSync(credDir)) {
    fs.mkdirSync(credDir, { recursive: true });
  }

  fs.writeFileSync(credPath, JSON.stringify(credData, null, 2), { mode: 0o600 });
}

// ── PKCE helpers ─────────────────────────────────────────────

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ══════════════════════════════════════════════════════════════
// AntigravityAuthManager
// Loopback-server OAuth flow for Google's Antigravity gateway.
// OAuth-only (no API key path — Antigravity is subscription/OAuth gated).
// ══════════════════════════════════════════════════════════════

class AntigravityAuthManager {
  constructor() {
    this._oauthSessions = new Map();
    this._lastApiCheck = null;
    this._lastApiStatus = null;
    this._refreshInFlight = null;
    this._codeAssistProject = null;
    this._currentTier = null;
    this._paidTier = null;
  }

  // ── OAuth Flow (loopback server on the registered fixed port) ────────────

  async startOAuth() {
    if (!OAUTH_CONFIG.CLIENT_ID || !OAUTH_CONFIG.CLIENT_SECRET) {
      throw new Error('Antigravity OAuth client is not configured. Set ANTIGRAVITY_CLIENT_ID and ANTIGRAVITY_CLIENT_SECRET in your .env.');
    }

    const sessionId = crypto.randomUUID();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString('hex');

    // The Antigravity OAuth client is registered for a FIXED redirect URI on
    // localhost:51121 — we must bind that exact port/path (Google validates it).
    const port = ANTIGRAVITY_CALLBACK_PORT;
    const redirectUri = OAUTH_CONFIG.REDIRECT_URI;

    const server = http.createServer(async (req, res) => {
      const parsed = new url.URL(req.url, `http://localhost:${port}`);

      if (parsed.pathname !== ANTIGRAVITY_CALLBACK_PATH) {
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

    const timeout = setTimeout(() => {
      const session = this._oauthSessions.get(sessionId);
      if (session && session.status === 'pending') {
        session.status = 'error';
        session.error = 'OAuth timed out';
      }
      server.close();
    }, OAUTH_SESSION_TTL_MS);

    server.on('close', () => clearTimeout(timeout));

    // Bind the fixed callback port. If it's already in use, surface a clear
    // error rather than a cryptic Google redirect_uri_mismatch later.
    server.on('error', (e) => {
      const session = this._oauthSessions.get(sessionId);
      if (session) {
        session.status = 'error';
        session.error = e.code === 'EADDRINUSE'
          ? `Port ${port} is in use — close the other Antigravity/Gemini login attempt (or app) and retry.`
          : `Callback server error: ${e.message}`;
      }
    });

    server.listen(port, '127.0.0.1', () => {
      console.log(`[AntigravityAuth] Loopback server on http://localhost:${port}${ANTIGRAVITY_CALLBACK_PATH}`);
    });

    this._oauthSessions.set(sessionId, {
      status: 'pending',
      error: null,
      createdAt: Date.now(),
    });

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

  getSessionStatus(sessionId) {
    const session = this._oauthSessions.get(sessionId);
    if (!session) {
      return { status: 'expired', error: 'Session not found or expired' };
    }
    return { status: session.status, error: session.error };
  }

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

    console.log('[AntigravityAuth] OAuth tokens saved to ~/.antigravity/oauth_creds.json');
  }

  // ── Google Cloud Project ──────────────────────────────────
  // Workspace/organization accounts require a GCP project for the gateway.
  // Read from ANTIGRAVITY_PROJECT / GOOGLE_CLOUD_PROJECT env or ~/.antigravity/.env.

  _readGcpProject() {
    if (process.env.ANTIGRAVITY_PROJECT) return process.env.ANTIGRAVITY_PROJECT;
    if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;
    if (process.env.GOOGLE_CLOUD_PROJECT_ID) return process.env.GOOGLE_CLOUD_PROJECT_ID;

    const envPath = path.join(resolveAntigravityDir(), '.env');
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

    const credDir = resolveAntigravityDir();
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

    if (envContent.match(/^GOOGLE_CLOUD_PROJECT=/m)) {
      envContent = envContent.replace(/^GOOGLE_CLOUD_PROJECT=.*/m, `GOOGLE_CLOUD_PROJECT=${projectId}`);
    } else {
      envContent = envContent.trim() + (envContent.trim() ? '\n' : '') + `GOOGLE_CLOUD_PROJECT=${projectId}\n`;
    }
    fs.writeFileSync(envPath, envContent, 'utf8');

    this._codeAssistProject = null;
    this._lastApiCheck = null;

    console.log('[AntigravityAuth] GCP project saved:', projectId);
    return { success: true };
  }

  // ── Token Access ───────────────────────────────────────────

  async getAccessToken({ autoRefresh = true } = {}) {
    const { data } = readCredentialsFile();
    if (!data) return null;

    if (data.access_token && data.expiry_date && Date.now() < data.expiry_date - REFRESH_BUFFER_MS) {
      return data.access_token;
    }

    if (autoRefresh && data.refresh_token) {
      const result = await this.refreshAccessToken();
      if (result.success) {
        const { data: refreshed } = readCredentialsFile();
        return refreshed?.access_token || null;
      }
    }

    return data.access_token || null;
  }

  // Antigravity is OAuth-only — there is no API key path.
  isUsingApiKey() {
    return false;
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

      console.log('[AntigravityAuth] Token refreshed');
      return { success: true };
    } catch (error) {
      const status = error.response?.status;
      const errorCode = error.response?.data?.error;
      const revoked = status === 400 && errorCode === 'invalid_grant';

      console.error('[AntigravityAuth] Token refresh failed:', errorCode || error.message);
      return { success: false, error: `Refresh failed: ${errorCode || error.message}`, revoked };
    }
  }

  // ── Status Checks ──────────────────────────────────────────  // ── Ban-avoidance cooldown (PRD-109) ───────────────────────
  // Tripped by any 403/429 from the gateway or a quota-floor breach. While open,
  // callers must not hit Google — this prevents the retry-storm / exhaustion
  // pattern that shadow-bans accounts.
  isCoolingDown() { return Date.now() < this._cooldownUntil; }
  cooldownMsLeft() { return Math.max(0, this._cooldownUntil - Date.now()); }
  tripCooldown(reason) {
    this._cooldownUntil = Date.now() + COOLDOWN_MS;
    this._lastApiCheck = null; // force a fresh status read once cooldown ends
    console.warn(`[AntigravityAuth] cooldown ${COOLDOWN_MS / 1000}s — ${reason}`);
  }

  async checkApiUsable({ forceRefresh = false } = {}) {
    if (this.isCoolingDown()) {
      return {
        available: true, apiUsable: false, coolingDown: true,
        retryAfterMs: this.cooldownMsLeft(),
        hint: 'Antigravity is cooling down to protect your Google account. Use an API-key provider meanwhile.',
      };
    }
    if (!forceRefresh && this._lastApiCheck && Date.now() - this._lastApiCheck < API_CHECK_TTL_MS) {
      return this._lastApiStatus;
    }

    const { data } = readCredentialsFile();
    if (!data?.refresh_token && !data?.access_token) {
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

      // OAuth → use loadCodeAssist as health check (gateway has no /models endpoint)
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...ANTIGRAVITY_HEADERS };
      const loadData = { metadata: BODY_METADATA };
      const gcpProject = this._readGcpProject();
      if (gcpProject) loadData.project = gcpProject;
      const response = await axios.post(
        `${ANTIGRAVITY_BASE}:loadCodeAssist`,
        loadData,
        { headers, timeout: 10000 },
      );

      if (response.data) {
        this._currentTier = response.data.currentTier?.id || this._currentTier;
        this._paidTier = response.data.paidTier?.id || this._paidTier;
      }

      const result = {
        available: true,
        apiUsable: response.status === 200,
        apiStatus: response.status,
        source: 'oauth',
        tier: this._currentTier || 'antigravity',
        paidTier: this._paidTier || null,
        gcpProject: gcpProject || null,
      };
      this._lastApiStatus = result;
      this._lastApiCheck = Date.now();
      return result;
    } catch (error) {
      const status = error.response?.status;
      const result = {
        available: true,
        apiUsable: false,
        apiStatus: status || null,
        hint: status === 401 ? 'Token expired or revoked'
          : status === 403 ? 'Access denied — your Google account may not have Antigravity access, or the account was restricted.'
          : `API error: ${error.message}`,
      };
      this._lastApiStatus = result;
      this._lastApiCheck = Date.now();
      return result;
    }
  }

  // ── OAuth2Client ────────────────────────────────────────

  /**
   * Returns a google-auth-library OAuth2Client configured with the stored
   * OAuth credentials. Used by AntigravityOAuthProxy for authenticated
   * requests to the gateway (cloud-platform + cclog + experimentsandconfigs).
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

    client.on('tokens', (tokens) => {
      const updated = { ...data, ...tokens };
      if (tokens.expiry_date) updated.expiry_date = tokens.expiry_date;
      writeCredentials(updated);
      this._lastApiCheck = null;
      console.log('[AntigravityAuth] OAuth2Client refreshed token automatically');
    });

    return client;
  }

  // ── Onboarding ─────────────────────────────────────────────
  // The gateway requires users to be onboarded before generateContent works.

  async ensureOnboarded(oauth2Client) {
    if (this._codeAssistProject) return this._codeAssistProject;

    const authClient = oauth2Client || this.getOAuth2Client();
    if (!authClient) return undefined;

    const META = BODY_METADATA;
    const gcpProject = this._readGcpProject();

    try {
      const loadData = { metadata: META };
      if (gcpProject) loadData.project = gcpProject;
      const loadRes = await authClient.request({
        url: `${ANTIGRAVITY_BASE}:loadCodeAssist`,
        method: 'POST',
        data: loadData,
        headers: ANTIGRAVITY_HEADERS,
      });
      const data = loadRes.data;

      this._currentTier = data.currentTier?.id || null;
      this._paidTier = data.paidTier?.id || null;
      const allowedTiers = data.allowedTiers || [];

      console.log('[AntigravityAuth] Tier info — current:', this._currentTier,
        '| paid:', this._paidTier,
        '| allowed:', JSON.stringify(allowedTiers.map(t => t.id)),
        '| project:', data.cloudaicompanionProject || 'none',
        '| gcpProject:', gcpProject || 'none');

      if (data.currentTier && data.cloudaicompanionProject) {
        this._codeAssistProject = data.cloudaicompanionProject;
        console.log('[AntigravityAuth] Onboarded, project:', this._codeAssistProject, 'tier:', this._currentTier);
        return this._codeAssistProject;
      }

      // Need to onboard — pick the best available tier (prefer paid)
      const selectedTier = allowedTiers.find(t => t.id && t.id !== 'free-tier') || allowedTiers.find(t => t.id === 'free-tier');
      if (!selectedTier) {
        console.warn('[AntigravityAuth] No tiers available for onboarding');
        return undefined;
      }

      const tierId = selectedTier.id;
      console.log(`[AntigravityAuth] Onboarding user to ${tierId}...`);
      await this._onboardToTier(authClient, ANTIGRAVITY_BASE, META, tierId);

      return this._codeAssistProject;
    } catch (error) {
      console.error('[AntigravityAuth] Onboarding failed:', error.message);
      return undefined;
    }
  }

  async _onboardToTier(authClient, base, meta, tierId) {
    const onboardData = { tier_id: tierId, metadata: meta };
    const gcpProject = this._readGcpProject();
    if (gcpProject) onboardData.project = gcpProject;
    const onboardRes = await authClient.request({
      url: `${base}:onboardUser`,
      method: 'POST',
      data: onboardData,
      headers: ANTIGRAVITY_HEADERS,
    });

    const opName = onboardRes.data?.name;
    if (opName) {
      for (let i = 0; i < 10; i++) {
        const opRes = await authClient.request({ url: `${base}/${opName}`, method: 'GET', headers: ANTIGRAVITY_HEADERS });
        if (opRes.data?.done) {
          const proj = opRes.data.response?.cloudaicompanionProject;
          this._codeAssistProject = proj?.id || proj?.name;
          console.log(`[AntigravityAuth] Onboarded to ${tierId}, project:`, this._codeAssistProject);
          return;
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  // ── Dynamic Model Listing ──────────────────────────────────
  // Antigravity exposes a real models endpoint (fetchAvailableModels) that
  // returns the live catalog plus per-model quota state. Falls back to the
  // static curated list in providerConfigs when unavailable.

  async fetchAvailableModels(oauth2Client) {
    const authClient = oauth2Client || this.getOAuth2Client();
    if (!authClient) return [];

    const projectId = await this.ensureOnboarded(authClient);

    try {
      const body = {};
      if (projectId) body.project = projectId;
      const browserHeaders = await getAntigravityBrowserHeaders();
      const res = await authClient.request({
        url: `${ANTIGRAVITY_BASE}:fetchAvailableModels`,
        method: 'POST',
        data: body,
        headers: browserHeaders,
      });

      const models = res.data?.models || {};
      const deprecated = new Set(Object.keys(res.data?.deprecatedModelIds || {}));

      // The gateway's own "Recommended" agent sort is the authoritative list of
      // chat-usable models (the raw map also contains internal tab/autocomplete
      // models like chat_20706 / tab_* that reject generateContent).
      const sortedIds = [];
      for (const sort of res.data?.agentModelSorts || []) {
        for (const group of sort.groups || []) {
          for (const id of group.modelIds || []) {
            if (!sortedIds.includes(id)) sortedIds.push(id);
          }
        }
      }

      const ids = sortedIds.length > 0
        ? sortedIds
        : Object.keys(models).filter((id) => models[id]?.displayName);

      // PRD-109: this is the live quota read point. If every usable model is at/under
      // the soft floor, trip the cooldown so we stop routing before exhaustion.
      const fractions = ids
        .map((id) => models[id]?.quotaInfo?.remainingFraction)
        .filter((f) => f != null);
      if (fractions.length > 0 && Math.max(...fractions) <= SOFT_QUOTA_FLOOR) {
        this.tripCooldown('quota floor');
      }

      return ids
        .filter((id) => models[id] && !deprecated.has(id))
        .filter((id) => !models[id]?.quotaInfo?.isExhausted)
        .map((id) => ({
          id,
          name: models[id]?.displayName || id,
          maxTokens: models[id]?.maxTokens ?? null,
          maxOutputTokens: models[id]?.maxOutputTokens ?? null,
          supportsImages: models[id]?.supportsImages ?? false,
          supportsThinking: models[id]?.supportsThinking ?? false,
          quotaRemaining: models[id]?.quotaInfo?.remainingFraction ?? null,
          quotaResetTime: models[id]?.quotaInfo?.resetTime ?? null,
        }));
    } catch (error) {
      const status = error.response?.status;
      if (status === 403 || status === 429) this.tripCooldown(`fetchAvailableModels HTTP ${status}`);
      console.warn('[AntigravityAuth] fetchAvailableModels failed:', error.message);
      return [];
    }
  }

  // ── Disconnect ─────────────────────────────────────────────

  logout() {
    try {
      const credPath = resolveCredentialsPath();
      if (fs.existsSync(credPath)) {
        fs.unlinkSync(credPath);
      }

      this._lastApiCheck = null;
      this._lastApiStatus = null;
      this._codeAssistProject = null;
      this._currentTier = null;
      this._paidTier = null;
      console.log('[AntigravityAuth] Logged out, credentials removed');
      return { success: true };
    } catch (error) {
      console.error('[AntigravityAuth] Logout failed:', error.message);
      return { success: false, error: error.message };
    }
  }
}

export default new AntigravityAuthManager();
