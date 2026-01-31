import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';
import generateUUID from '../../utils/generateUUID.js';

const API_CHECK_TTL_MS = 2 * 60 * 1000; // 2 minutes
const OAUTH_SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Anthropic OAuth configuration (matching OpenClaw's working implementation)
const OAUTH_CONFIG = {
  CLIENT_ID: process.env.CLAUDE_CODE_OAUTH_CLIENT_ID || '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  AUTHORIZE_URL: 'https://claude.ai/oauth/authorize',
  TOKEN_URL: 'https://console.anthropic.com/v1/oauth/token',
  REDIRECT_URI: 'https://console.anthropic.com/oauth/code/callback',
  SCOPES: 'org:create_api_key user:profile user:inference',
};

function resolveClaudeCredentialsPath() {
  return path.join(os.homedir(), '.claude', '.credentials.json');
}

function readClaudeCredentialsFile() {
  const credPath = resolveClaudeCredentialsPath();
  try {
    const raw = fs.readFileSync(credPath, 'utf8');
    const parsed = JSON.parse(raw);
    return { credPath, data: parsed };
  } catch {
    return { credPath, data: null };
  }
}

function writeClaudeCredentials(oauthData) {
  const credDir = path.join(os.homedir(), '.claude');
  const credPath = resolveClaudeCredentialsPath();

  if (!fs.existsSync(credDir)) {
    fs.mkdirSync(credDir, { recursive: true });
  }

  // Preserve any existing fields in the credentials file
  let existing = {};
  try {
    const raw = fs.readFileSync(credPath, 'utf8');
    existing = JSON.parse(raw);
  } catch {
    // File doesn't exist yet
  }

  existing.claudeAiOauth = oauthData;
  fs.writeFileSync(credPath, JSON.stringify(existing, null, 2), 'utf8');
}

// PKCE helpers
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

class ClaudeCodeAuthManager {
  constructor() {
    this.apiCheckCache = null;
    this.oauthSessions = new Map();
  }

  getCredentialsPath() {
    return resolveClaudeCredentialsPath();
  }

  getAccessToken() {
    const { data } = readClaudeCredentialsFile();
    if (!data || typeof data !== 'object') return null;

    // Primary: claudeAiOauth.accessToken (current Claude CLI format)
    if (data.claudeAiOauth?.accessToken) {
      const value = String(data.claudeAiOauth.accessToken).trim();
      if (value) return value;
    }

    // Legacy fallback fields
    for (const key of ['oauth_token', 'token', 'access_token']) {
      const value = typeof data[key] === 'string' ? data[key].trim() : '';
      if (value) return value;
    }

    return null;
  }

  async checkApiUsable({ forceRefresh = false } = {}) {
    const token = this.getAccessToken();
    const credPath = this.getCredentialsPath();

    if (!token) {
      return {
        available: false,
        apiUsable: false,
        apiStatus: null,
        source: null,
        credPath,
        checkedAt: new Date().toISOString(),
      };
    }

    const now = Date.now();
    if (!forceRefresh && this.apiCheckCache && now - this.apiCheckCache.checkedAtMs < API_CHECK_TTL_MS) {
      return this.apiCheckCache.value;
    }

    let apiStatus = null;
    let apiUsable = false;

    try {
      const isOAuth = token.includes('sk-ant-oat');
      const headers = {
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      };

      if (isOAuth) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['anthropic-beta'] = 'claude-code-20250219,oauth-2025-04-20';
        headers['user-agent'] = 'claude-cli/2.1.2 (external, cli)';
        headers['x-app'] = 'cli';
      } else {
        headers['x-api-key'] = token;
      }

      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }],
        },
        {
          headers,
          timeout: 5000,
        }
      );
      apiStatus = response.status;
      apiUsable = response.status >= 200 && response.status < 300;
    } catch (error) {
      apiStatus = error?.response?.status || null;
      apiUsable = apiStatus !== null && apiStatus !== 401 && apiStatus !== 403;
    }

    const value = {
      available: true,
      apiUsable,
      apiStatus,
      source: 'claude-credentials',
      credPath,
      checkedAt: new Date().toISOString(),
    };

    this.apiCheckCache = { checkedAtMs: now, value };
    return value;
  }

  // ── OAuth PKCE flow ──────────────────────────────────────────────

  _cleanupExpiredOAuthSessions() {
    const now = Date.now();
    for (const [id, session] of this.oauthSessions.entries()) {
      if (now - session.createdAtMs > OAUTH_SESSION_TTL_MS) {
        this.oauthSessions.delete(id);
      }
    }
  }

  /**
   * Starts an OAuth authorization flow.
   * Returns the authUrl the frontend should open in the system browser.
   * Uses Anthropic's own callback page (no localhost redirect needed).
   * The user copies the code from Anthropic's page and pastes it back.
   */
  startOAuth() {
    this._cleanupExpiredOAuthSessions();

    const sessionId = generateUUID();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    const params = new URLSearchParams({
      code: 'true',
      client_id: OAUTH_CONFIG.CLIENT_ID,
      response_type: 'code',
      redirect_uri: OAUTH_CONFIG.REDIRECT_URI,
      scope: OAUTH_CONFIG.SCOPES,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: codeVerifier,
    });

    const authUrl = `${OAUTH_CONFIG.AUTHORIZE_URL}?${params.toString()}`;

    this.oauthSessions.set(sessionId, {
      codeVerifier,
      createdAtMs: Date.now(),
    });

    return { authUrl, sessionId };
  }

  /**
   * Parses the code#state string the user copies from Anthropic's callback page.
   * Accepts formats: "code#state", full callback URL with code= and state= params,
   * or text surrounded by backticks.
   */
  parseCodeState(raw) {
    if (!raw || typeof raw !== 'string') return null;

    // Strip backticks
    let text = raw.trim().replace(/^`+|`+$/g, '').trim();

    // Try URL format first
    try {
      const url = new URL(text);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (code && state) return { code, state };
    } catch {
      // Not a URL
    }

    // Try code#state format
    const hashIdx = text.indexOf('#');
    if (hashIdx > 0 && hashIdx < text.length - 1) {
      return { code: text.substring(0, hashIdx), state: text.substring(hashIdx + 1) };
    }

    return null;
  }

  /**
   * Exchanges the authorization code for tokens and saves credentials.
   * @param {string} sessionId - The session ID from startOAuth
   * @param {string} code - The authorization code
   * @param {string} state - The state parameter (should equal the PKCE verifier)
   */
  async exchangeCode(sessionId, code, state) {
    const session = this.oauthSessions.get(sessionId);
    if (!session) {
      throw new Error('OAuth session expired or not found. Please try again.');
    }

    // Verify state matches the PKCE verifier
    if (state !== session.codeVerifier) {
      throw new Error('OAuth state mismatch — possible CSRF. Please try again.');
    }

    // Exchange code for tokens
    console.log('[ClaudeCodeAuth] Exchanging code for tokens at:', OAUTH_CONFIG.TOKEN_URL);

    let tokenResponse;
    try {
      tokenResponse = await axios.post(
        OAUTH_CONFIG.TOKEN_URL,
        JSON.stringify({
          grant_type: 'authorization_code',
          client_id: OAUTH_CONFIG.CLIENT_ID,
          code,
          state,
          redirect_uri: OAUTH_CONFIG.REDIRECT_URI,
          code_verifier: session.codeVerifier,
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000,
        }
      );
    } catch (tokenError) {
      const status = tokenError?.response?.status;
      const data = tokenError?.response?.data;
      console.error('[ClaudeCodeAuth] Token exchange failed:', status, JSON.stringify(data));
      throw new Error(`Token exchange failed (${status || 'network error'}): ${data?.error_description || data?.error || tokenError.message}`);
    }

    const tokenData = tokenResponse.data;
    console.log('[ClaudeCodeAuth] Token exchange successful, saving credentials');

    // Save credentials in the same format the Claude CLI uses
    const expiresAt = tokenData.expires_in
      ? Date.now() + (tokenData.expires_in * 1000) - (5 * 60 * 1000)
      : null;

    const oauthCreds = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || null,
      expiresAt,
      scopes: tokenData.scope ? tokenData.scope.split(' ') : OAUTH_CONFIG.SCOPES.split(' '),
    };

    writeClaudeCredentials(oauthCreds);

    // Clear cached status so next check reads the new credentials
    this.apiCheckCache = null;

    // Clean up the session
    this.oauthSessions.delete(sessionId);

    return { success: true };
  }

  // ── Manual token (paste) ─────────────────────────────────────────

  async saveManualToken(token) {
    if (!token || typeof token !== 'string') {
      return { success: false, error: 'Token is required.' };
    }

    const trimmed = token.trim();

    if (!trimmed.startsWith('sk-ant-')) {
      return { success: false, error: 'Invalid token format. Expected a token starting with sk-ant-.' };
    }

    // Test the token against the API
    let apiUsable = false;
    try {
      const isOAuth = trimmed.includes('sk-ant-oat');
      const headers = {
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      };

      if (isOAuth) {
        headers['Authorization'] = `Bearer ${trimmed}`;
        headers['anthropic-beta'] = 'claude-code-20250219,oauth-2025-04-20';
        headers['user-agent'] = 'claude-cli/2.1.2 (external, cli)';
        headers['x-app'] = 'cli';
      } else {
        headers['x-api-key'] = trimmed;
      }

      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }],
        },
        {
          headers,
          timeout: 10000,
        }
      );
      apiUsable = response.status >= 200 && response.status < 300;
    } catch (error) {
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        return { success: false, error: `Token rejected by Anthropic API (status ${status}).` };
      }
      apiUsable = status !== null && status !== undefined;
    }

    // Save in the same format the Claude CLI uses
    try {
      writeClaudeCredentials({ accessToken: trimmed });
    } catch (error) {
      return { success: false, error: `Failed to write credentials: ${error.message}` };
    }

    this.apiCheckCache = null;

    return {
      success: true,
      apiUsable,
      message: apiUsable
        ? 'Token saved and verified. Claude Code is ready.'
        : 'Token saved. API verification returned a non-success status but token may still be valid.',
    };
  }

  // ── Disconnect ───────────────────────────────────────────────────

  async logout() {
    const credPath = resolveClaudeCredentialsPath();
    try {
      if (fs.existsSync(credPath)) {
        // Remove only the claudeAiOauth key, preserving other data
        const { data } = readClaudeCredentialsFile();
        if (data && typeof data === 'object') {
          delete data.claudeAiOauth;
          delete data.oauth_token;
          delete data.token;
          delete data.access_token;
          if (Object.keys(data).length === 0) {
            fs.unlinkSync(credPath);
          } else {
            fs.writeFileSync(credPath, JSON.stringify(data, null, 2), 'utf8');
          }
        } else {
          fs.unlinkSync(credPath);
        }
      }
      this.apiCheckCache = null;
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Failed to remove Claude credentials',
      };
    }
  }
}

export default new ClaudeCodeAuthManager();
