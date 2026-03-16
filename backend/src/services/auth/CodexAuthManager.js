import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';
import generateUUID from '../../utils/generateUUID.js';

const CODEX_AUTH_FILENAME = 'auth.json';
const API_CHECK_TTL_MS = 2 * 60 * 1000; // 2 minutes
const DEVICE_SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes (OpenAI device auth timeout)
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

// OpenAI Codex OAuth public client ID (same as official Codex CLI)
const CODEX_OAUTH_CLIENT_ID = process.env.CODEX_OAUTH_CLIENT_ID || 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_DEVICE_USERCODE_URL = 'https://auth.openai.com/api/accounts/deviceauth/usercode';
const CODEX_DEVICE_TOKEN_URL = 'https://auth.openai.com/api/accounts/deviceauth/token';
const CODEX_DEVICE_VERIFY_URL = 'https://auth.openai.com/codex/device';
const CODEX_DEVICE_REDIRECT_URI = 'https://auth.openai.com/deviceauth/callback';

function expandUserPath(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function resolveCodexHome() {
  const configured = process.env.CODEX_HOME;
  const codexHome = configured ? expandUserPath(configured) : path.join(os.homedir(), '.codex');
  try {
    return fs.realpathSync.native(codexHome);
  } catch {
    return codexHome;
  }
}

function resolveCodexAuthPath() {
  return path.join(resolveCodexHome(), CODEX_AUTH_FILENAME);
}

function readCodexAuthFile() {
  const authPath = resolveCodexAuthPath();
  try {
    const raw = fs.readFileSync(authPath, 'utf8');
    const parsed = JSON.parse(raw);
    return { authPath, data: parsed };
  } catch {
    return { authPath, data: null };
  }
}

function writeCodexAuthFile(data) {
  const authPath = resolveCodexAuthPath();
  const codexHome = resolveCodexHome();
  try {
    if (!fs.existsSync(codexHome)) {
      fs.mkdirSync(codexHome, { recursive: true });
    }
    fs.writeFileSync(authPath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('[CodexAuth] Failed to write auth file:', error.message);
    return false;
  }
}

/**
 * Decode a JWT payload without verification (for reading exp/claims).
 */
function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch {
    return null;
  }
}

class CodexAuthManager {
  constructor() {
    this.apiCheckCache = null;
    this.deviceSessions = new Map();
  }

  getAuthPath() {
    return resolveCodexAuthPath();
  }

  getAccessToken() {
    // Allow an explicit API key from the environment to override Codex CLI auth.
    const envApiKey = typeof process.env.OPENAI_API_KEY === 'string' ? process.env.OPENAI_API_KEY.trim() : '';
    if (envApiKey) return envApiKey;

    const { data } = readCodexAuthFile();
    if (!data || typeof data !== 'object') return null;

    // Prefer an explicit API key if present, otherwise fall back to the OAuth access token.
    const openaiApiKey = typeof data.OPENAI_API_KEY === 'string' ? data.OPENAI_API_KEY.trim() : '';
    if (openaiApiKey) return openaiApiKey;

    const accessToken = typeof data.tokens?.access_token === 'string' ? data.tokens.access_token.trim() : '';
    return accessToken || null;
  }

  /**
   * Returns the OAuth access token from the Codex auth file (ignoring API keys).
   * The OAuth token is required for the ChatGPT backend Codex Responses API.
   */
  getOAuthToken() {
    const { data } = readCodexAuthFile();
    if (!data || typeof data !== 'object') return null;
    const accessToken = typeof data.tokens?.access_token === 'string' ? data.tokens.access_token.trim() : '';
    return accessToken || null;
  }

  /**
   * Extracts the chatgpt-account-id from the OAuth JWT access token.
   * Required as a header for the ChatGPT backend Codex Responses API.
   */
  getChatGptAccountId() {
    const token = this.getOAuthToken();
    if (!token) return null;
    try {
      const parts = token.split('.');
      if (parts.length < 2) return null;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      return payload?.['https://api.openai.com/auth']?.chatgpt_account_id || null;
    } catch {
      return null;
    }
  }

  getRefreshToken() {
    const { data } = readCodexAuthFile();
    if (!data || typeof data !== 'object') return null;
    const refreshToken = typeof data.tokens?.refresh_token === 'string' ? data.tokens.refresh_token.trim() : '';
    return refreshToken || null;
  }

  /**
   * Check if the current OAuth access token is expired or expiring soon.
   * Returns true if token needs refresh, false if still valid.
   * API keys (sk-*) never expire and always return false.
   */
  isTokenExpiringSoon() {
    const token = this.getOAuthToken();
    if (!token) return false;

    // API keys don't expire
    if (token.startsWith('sk-')) return false;

    const payload = decodeJwtPayload(token);
    if (!payload?.exp) return false;

    const expiresAtMs = payload.exp * 1000;
    return Date.now() + TOKEN_REFRESH_MARGIN_MS >= expiresAtMs;
  }

  /**
   * Get the expiry time of the current OAuth token.
   * Returns { expiresAt, expiresInMs, expired } or null if not a JWT.
   */
  getTokenExpiry() {
    const token = this.getOAuthToken();
    if (!token) return null;
    if (token.startsWith('sk-')) return null;

    const payload = decodeJwtPayload(token);
    if (!payload?.exp) return null;

    const expiresAtMs = payload.exp * 1000;
    return {
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresInMs: expiresAtMs - Date.now(),
      expired: Date.now() >= expiresAtMs,
    };
  }

  /**
   * Refresh the OAuth access token using the refresh token.
   * OpenAI uses refresh token rotation — each refresh returns a new refresh_token.
   * The new tokens are saved back to ~/.codex/auth.json.
   *
   * Endpoint: POST https://auth.openai.com/oauth/token
   * Content-Type: application/x-www-form-urlencoded
   * Body: grant_type=refresh_token&refresh_token=...&client_id=...
   */
  async refreshAccessToken() {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      return { success: false, error: 'No refresh token available. Please reconnect with device login.' };
    }

    try {
      console.log('[CodexAuth] Refreshing OAuth access token...');

      const response = await axios.post(
        CODEX_OAUTH_TOKEN_URL,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: CODEX_OAUTH_CLIENT_ID,
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 15000,
        },
      );

      const { access_token, refresh_token: newRefreshToken, id_token } = response.data;

      if (!access_token) {
        return { success: false, error: 'Token refresh response missing access_token.' };
      }

      // Read current auth file and update tokens
      const { data: authData } = readCodexAuthFile();
      const updated = authData && typeof authData === 'object' ? { ...authData } : {};
      updated.tokens = {
        ...(updated.tokens || {}),
        access_token,
        // OpenAI uses refresh token rotation — always save the new one
        ...(newRefreshToken ? { refresh_token: newRefreshToken } : {}),
        ...(id_token ? { id_token } : {}),
      };

      const saved = writeCodexAuthFile(updated);
      if (!saved) {
        return { success: false, error: 'Tokens refreshed but failed to save to auth file.' };
      }

      // Clear cached API check so next status check uses the new token
      this.apiCheckCache = null;

      const expiry = this.getTokenExpiry();
      console.log('[CodexAuth] Token refreshed successfully, expires:', expiry?.expiresAt || 'unknown');

      return {
        success: true,
        accessToken: access_token,
        expiresAt: expiry?.expiresAt || null,
        rotatedRefreshToken: Boolean(newRefreshToken),
      };
    } catch (error) {
      const status = error?.response?.status;
      const errorData = error?.response?.data;
      const errorDesc = errorData?.error_description || errorData?.error || error.message;

      console.error('[CodexAuth] Token refresh failed:', { status, error: errorDesc });

      // Refresh token already used (rotation) or revoked — user must re-authenticate
      if (status === 400 || status === 401) {
        return {
          success: false,
          revoked: true,
          error: `Token refresh failed (${status}): ${errorDesc}. Please reconnect with device login.`,
        };
      }

      return {
        success: false,
        error: `Token refresh failed: ${errorDesc}`,
      };
    }
  }

  /**
   * Ensure the OAuth token is valid. If expiring soon, attempt auto-refresh.
   * Returns the current (possibly refreshed) access token, or null.
   */
  async ensureValidToken() {
    const token = this.getAccessToken();
    if (!token) return null;

    // API keys don't expire
    if (token.startsWith('sk-')) return token;

    // Check if OAuth token needs refresh
    if (this.isTokenExpiringSoon()) {
      console.log('[CodexAuth] Access token expiring soon, attempting refresh...');
      const result = await this.refreshAccessToken();
      if (result.success) {
        return this.getAccessToken();
      }
      console.warn('[CodexAuth] Auto-refresh failed:', result.error);
      // Return the existing token anyway — it might still work for a few more minutes
    }

    return token;
  }

  async checkApiUsable({ forceRefresh = false } = {}) {
    // Auto-refresh expired OAuth tokens before checking
    const token = await this.ensureValidToken();
    const authPath = this.getAuthPath();

    if (!token) {
      return {
        available: false,
        cliUsable: false,
        apiUsable: false,
        apiStatus: null,
        source: null,
        authPath,
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
      const response = await axios.get('https://api.openai.com/v1/models', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        timeout: 5000,
      });
      apiStatus = response.status;
      apiUsable = response.status >= 200 && response.status < 300;
    } catch (error) {
      apiStatus = error?.response?.status || null;
      apiUsable = false;
    }

    const expiry = this.getTokenExpiry();
    const value = {
      available: true,
      cliUsable: true,
      apiUsable,
      apiStatus,
      source: this._inferSource(),
      authPath,
      checkedAt: new Date().toISOString(),
      tokenExpiry: expiry?.expiresAt || null,
    };

    this.apiCheckCache = {
      checkedAtMs: now,
      value,
    };

    return value;
  }

  _inferSource() {
    const { data } = readCodexAuthFile();
    if (!data || typeof data !== 'object') return null;
    if (typeof data.OPENAI_API_KEY === 'string' && data.OPENAI_API_KEY.trim()) {
      return 'codex-auth-openai-api-key';
    }
    if (typeof data.tokens?.access_token === 'string' && data.tokens.access_token.trim()) {
      return 'codex-auth-access-token';
    }
    return null;
  }

  // ─────────────────────────── NATIVE DEVICE AUTH ───────────────────────────
  // Uses OpenAI's custom device auth endpoints directly via HTTP.
  // No Codex CLI binary required.

  _cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.deviceSessions.entries()) {
      if (now - session.startedAtMs > DEVICE_SESSION_TTL_MS) {
        this.deviceSessions.delete(sessionId);
      }
    }
  }

  _getActiveSession() {
    const now = Date.now();
    let latest = null;
    for (const session of this.deviceSessions.values()) {
      const isExpired = now - session.startedAtMs > DEVICE_SESSION_TTL_MS;
      if (!isExpired && session.state === 'pending') {
        if (!latest || session.startedAtMs > latest.startedAtMs) {
          latest = session;
        }
      }
    }
    return latest;
  }

  /**
   * Start a native device auth session via OpenAI's HTTP API.
   * No Codex CLI required — requests a device code directly from auth.openai.com.
   *
   * POST https://auth.openai.com/api/accounts/deviceauth/usercode
   * Body: { client_id }
   * Returns: { device_auth_id, user_code, interval }
   */
  async startDeviceAuth() {
    this._cleanupExpiredSessions();

    // Reuse an existing active session to avoid repeated device-code requests (which can hit 429s).
    const existing = this._getActiveSession();
    if (existing) {
      return {
        success: true,
        sessionId: existing.id,
        deviceUrl: existing.deviceUrl,
        deviceCode: existing.userCode,
        state: existing.state,
        message: 'Open the URL and enter the code to continue device login.',
        startedAt: new Date(existing.startedAtMs).toISOString(),
        expiresAt: new Date(existing.startedAtMs + DEVICE_SESSION_TTL_MS).toISOString(),
      };
    }

    try {
      console.log('[CodexAuth] Requesting device code from OpenAI...');

      const response = await axios.post(
        CODEX_DEVICE_USERCODE_URL,
        { client_id: CODEX_OAUTH_CLIENT_ID },
        { headers: { 'Content-Type': 'application/json' }, timeout: 15000 },
      );

      const { device_auth_id, user_code, usercode } = response.data;
      const code = user_code || usercode;

      if (!device_auth_id || !code) {
        return {
          success: false,
          state: 'error',
          message: 'OpenAI did not return a device code. Please try again.',
        };
      }

      const sessionId = generateUUID();
      const startedAtMs = Date.now();

      const session = {
        id: sessionId,
        startedAtMs,
        deviceAuthId: device_auth_id,
        userCode: code,
        deviceUrl: CODEX_DEVICE_VERIFY_URL,
        state: 'pending',
        lastError: null,
      };

      this.deviceSessions.set(sessionId, session);

      console.log(`[CodexAuth] Device code issued: ${code} (session ${sessionId})`);

      return {
        success: true,
        sessionId,
        deviceUrl: CODEX_DEVICE_VERIFY_URL,
        deviceCode: code,
        state: 'pending',
        message: 'Open the URL and enter the code to continue device login.',
        startedAt: new Date(startedAtMs).toISOString(),
        expiresAt: new Date(startedAtMs + DEVICE_SESSION_TTL_MS).toISOString(),
      };
    } catch (error) {
      const status = error?.response?.status;
      const errorDesc = error?.response?.data?.error_description || error?.response?.data?.error || error.message;

      console.error('[CodexAuth] Failed to request device code:', { status, error: errorDesc });

      if (status === 429) {
        return {
          success: false,
          state: 'error',
          message: 'Device login is rate-limited (429 Too Many Requests). Please wait a minute and try again.',
        };
      }

      return {
        success: false,
        state: 'error',
        message: `Failed to start device login: ${errorDesc}`,
      };
    }
  }

  /**
   * Poll the device auth session status.
   * If the user has authorized, exchanges the authorization code for tokens.
   *
   * Poll: POST https://auth.openai.com/api/accounts/deviceauth/token
   * Body: { device_auth_id, user_code }
   * 403/404 = pending, 200 = authorized, 401 = denied
   *
   * Exchange: POST https://auth.openai.com/oauth/token
   * Body: grant_type=authorization_code&code=...&code_verifier=...&client_id=...&redirect_uri=...
   */
  async getDeviceSessionStatus(sessionId) {
    this._cleanupExpiredSessions();

    const session = this.deviceSessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        state: 'error',
        message: 'Session not found or expired. Start device login again.',
      };
    }

    // Already completed
    if (session.state === 'success') {
      return { success: true, state: 'success', message: 'Device login complete.' };
    }
    if (session.state === 'error') {
      return { success: false, state: 'error', message: session.lastError || 'Device login failed.' };
    }

    // Poll OpenAI's device token endpoint
    try {
      const pollResponse = await axios.post(
        CODEX_DEVICE_TOKEN_URL,
        { device_auth_id: session.deviceAuthId, user_code: session.userCode },
        { headers: { 'Content-Type': 'application/json' }, timeout: 10000 },
      );

      // 200 = user authorized, response contains authorization_code + PKCE params
      const { authorization_code, code_verifier } = pollResponse.data;

      if (!authorization_code) {
        return {
          success: true,
          state: 'pending',
          message: 'Waiting for you to complete device login in the browser...',
        };
      }

      console.log('[CodexAuth] Device authorized, exchanging code for tokens...');

      // Exchange authorization code for OAuth tokens
      const tokenResponse = await axios.post(
        CODEX_OAUTH_TOKEN_URL,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: authorization_code,
          redirect_uri: CODEX_DEVICE_REDIRECT_URI,
          client_id: CODEX_OAUTH_CLIENT_ID,
          code_verifier: code_verifier,
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 15000,
        },
      );

      const { access_token, refresh_token, id_token } = tokenResponse.data;

      if (!access_token) {
        session.state = 'error';
        session.lastError = 'Token exchange did not return an access token.';
        return { success: false, state: 'error', message: session.lastError };
      }

      // Save tokens to ~/.codex/auth.json (compatible with Codex CLI)
      const { data: authData } = readCodexAuthFile();
      const updated = authData && typeof authData === 'object' ? { ...authData } : {};
      updated.tokens = {
        access_token,
        ...(refresh_token ? { refresh_token } : {}),
        ...(id_token ? { id_token } : {}),
      };
      writeCodexAuthFile(updated);

      session.state = 'success';
      this.apiCheckCache = null;

      console.log('[CodexAuth] Device login complete, tokens saved.');

      const apiStatus = await this.checkApiUsable({ forceRefresh: true });

      return {
        success: true,
        state: 'success',
        message: 'Device login complete and OpenAI Codex connected successfully.',
        apiStatus,
      };
    } catch (error) {
      const status = error?.response?.status;

      // 403/404 = authorization pending — user hasn't completed the flow yet
      if (status === 403 || status === 404) {
        return {
          success: true,
          state: 'pending',
          deviceUrl: session.deviceUrl,
          deviceCode: session.userCode,
          message: 'Waiting for you to complete device login in the browser...',
        };
      }

      // 401 = authorization denied
      if (status === 401) {
        const errorData = error?.response?.data;
        const errorDesc = errorData?.error_description || errorData?.error || 'Authorization was denied.';
        session.state = 'error';
        session.lastError = errorDesc;
        return { success: false, state: 'error', message: errorDesc };
      }

      // 429 = rate limited — treat as pending, will retry
      if (status === 429) {
        return {
          success: true,
          state: 'pending',
          message: 'Rate limited by OpenAI. Will retry shortly...',
        };
      }

      // Other errors
      const errorDesc = error?.response?.data?.error || error.message;
      console.error('[CodexAuth] Device poll error:', { status, error: errorDesc });

      session.state = 'error';
      session.lastError = `Failed to check device login status: ${errorDesc}`;
      return { success: false, state: 'error', message: session.lastError };
    }
  }

  /**
   * Logout — clear tokens from ~/.codex/auth.json.
   * No CLI binary required.
   */
  async logout() {
    try {
      const { data: authData } = readCodexAuthFile();
      if (authData && typeof authData === 'object') {
        delete authData.tokens;
        delete authData.OPENAI_API_KEY;
        writeCodexAuthFile(authData);
      }
      this.apiCheckCache = null;
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Failed to log out',
      };
    }
  }
}

export default new CodexAuthManager();
