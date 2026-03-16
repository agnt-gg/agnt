import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';
import { spawn } from 'child_process';
import generateUUID from '../../utils/generateUUID.js';

const CODEX_AUTH_FILENAME = 'auth.json';
const API_CHECK_TTL_MS = 2 * 60 * 1000; // 2 minutes
const DEVICE_SESSION_TTL_MS = 20 * 60 * 1000; // 20 minutes
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

// OpenAI Codex OAuth public client ID (same as official Codex CLI)
const CODEX_OAUTH_CLIENT_ID = process.env.CODEX_OAUTH_CLIENT_ID || 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';

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

function resolveCodexBin() {
  const envBin = typeof process.env.CODEX_BIN === 'string' ? process.env.CODEX_BIN.trim() : '';
  if (envBin) return envBin;

  const isWindows = process.platform === 'win32';
  const home = os.homedir();

  // Helper to check multiple candidates and return first existing one
  const findFirst = (candidates) => {
    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  };

  // Helper to find latest version in a node versions directory
  const findInNodeVersions = (baseDir, binSubpath) => {
    try {
      if (!fs.existsSync(baseDir)) return null;
      const versions = fs
        .readdirSync(baseDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      for (let i = versions.length - 1; i >= 0; i -= 1) {
        const candidate = path.join(baseDir, versions[i], binSubpath);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    } catch {
      // Ignore errors
    }
    return null;
  };

  if (isWindows) {
    const appData = process.env.APPDATA;
    const localAppData = process.env.LOCALAPPDATA;

    // Windows npm global install
    if (appData) {
      const npmGlobal = findFirst([
        path.join(appData, 'npm', 'codex.cmd'),
        path.join(appData, 'npm', 'codex'),
      ]);
      if (npmGlobal) return npmGlobal;
    }

    // Windows nvm (nvm-windows)
    const nvmHome = process.env.NVM_HOME;
    if (nvmHome) {
      const nvmBin = findInNodeVersions(nvmHome, 'codex.cmd') || findInNodeVersions(nvmHome, 'codex');
      if (nvmBin) return nvmBin;
    }

    // Windows fnm
    if (localAppData) {
      const fnmDir = path.join(localAppData, 'fnm_multishells');
      if (fs.existsSync(fnmDir)) {
        const fnmBin = findInNodeVersions(fnmDir, 'codex.cmd') || findInNodeVersions(fnmDir, 'codex');
        if (fnmBin) return fnmBin;
      }
    }
  } else {
    // macOS / Linux

    // Common global npm locations
    const globalPaths = findFirst([
      '/usr/local/bin/codex',
      path.join(home, '.npm-global', 'bin', 'codex'),
      path.join(home, '.local', 'bin', 'codex'),
    ]);
    if (globalPaths) return globalPaths;

    // Homebrew (macOS)
    if (process.platform === 'darwin') {
      const brewPaths = findFirst([
        '/opt/homebrew/bin/codex', // Apple Silicon
        '/usr/local/bin/codex',    // Intel
      ]);
      if (brewPaths) return brewPaths;
    }

    // nvm (Linux/macOS)
    const nvmNodeDir = path.join(home, '.nvm', 'versions', 'node');
    const nvmBin = findInNodeVersions(nvmNodeDir, path.join('bin', 'codex'));
    if (nvmBin) return nvmBin;

    // fnm (Linux/macOS)
    const fnmNodeDir = path.join(home, '.fnm', 'node-versions');
    const fnmBin = findInNodeVersions(fnmNodeDir, path.join('installation', 'bin', 'codex'));
    if (fnmBin) return fnmBin;

    // volta
    const voltaBin = path.join(home, '.volta', 'bin', 'codex');
    if (fs.existsSync(voltaBin)) return voltaBin;

    // asdf
    const asdfNodeDir = path.join(home, '.asdf', 'installs', 'nodejs');
    const asdfBin = findInNodeVersions(asdfNodeDir, path.join('bin', 'codex'));
    if (asdfBin) return asdfBin;
  }

  // Fallback to PATH lookup
  return 'codex';
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

function stripAnsi(input) {
  if (!input) return '';
  // Basic ANSI escape stripping for CLI output parsing.
  return String(input).replace(/\u001b\[[0-9;]*m/g, '');
}

function sanitizeUrl(url) {
  if (!url) return null;
  // Remove obvious HTML/tag noise and trailing punctuation.
  let cleaned = String(url).trim();
  cleaned = cleaned.replace(/[<>"'`]/g, '');
  cleaned = cleaned.replace(/[)\],.;:!?]+$/g, '');
  return cleaned;
}

class CodexAuthManager {
  constructor() {
    this.apiCheckCache = null;
    this.deviceSessions = new Map();
    this.codexBin = resolveCodexBin();
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
        codexBin: this.codexBin,
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
      codexBin: this.codexBin,
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

  _cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.deviceSessions.entries()) {
      if (now - session.startedAtMs > DEVICE_SESSION_TTL_MS) {
        try {
          session.process?.kill('SIGTERM');
        } catch {
          // Best-effort cleanup.
        }
        this.deviceSessions.delete(sessionId);
      }
    }
  }

  _getActiveSession() {
    const now = Date.now();
    let latest = null;
    for (const session of this.deviceSessions.values()) {
      const isExpired = now - session.startedAtMs > DEVICE_SESSION_TTL_MS;
      const isActive = session.exitCode === null && (session.state === 'starting' || session.state === 'pending');
      if (!isExpired && isActive) {
        if (!latest || session.startedAtMs > latest.startedAtMs) {
          latest = session;
        }
      }
    }
    return latest;
  }

  async startDeviceAuth() {
    this._cleanupExpiredSessions();

    // Reuse an existing active session to avoid repeated device-code requests (which can hit 429s).
    const existingSession = this._getActiveSession();
    if (existingSession) {
      const deviceInfo = await this._waitForDeviceInfo(existingSession.id, 2000);
      return {
        sessionId: existingSession.id,
        ...deviceInfo,
        startedAt: new Date(existingSession.startedAtMs).toISOString(),
        expiresAt: new Date(existingSession.startedAtMs + DEVICE_SESSION_TTL_MS).toISOString(),
      };
    }

    const sessionId = generateUUID();
    const startedAtMs = Date.now();

    const child = spawn(this.codexBin, ['login', '--device-auth'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      shell: true,
    });

    const session = {
      id: sessionId,
      process: child,
      startedAtMs,
      deviceUrl: null,
      deviceCode: null,
      output: '',
      errorOutput: '',
      state: 'starting',
      exitCode: null,
      exitSignal: null,
      lastError: null,
    };

    this.deviceSessions.set(sessionId, session);

    const parseChunk = (chunk) => {
      const text = stripAnsi(chunk.toString());
      session.output += text;

      if (!session.lastError && /status\s+429|too many requests/i.test(text)) {
        session.lastError = 'Codex device login is rate-limited (429 Too Many Requests). Please wait a minute and try again.';
        session.state = 'error';
      }

      // Extract the device URL (first https URL in the output).
      if (!session.deviceUrl) {
        // Stop at whitespace OR common HTML/tag delimiters.
        const urlMatch = text.match(/https?:\/\/[^\s<>"')\]]+/i);
        if (urlMatch) {
          session.deviceUrl = sanitizeUrl(urlMatch[0]);
        }
      }

      // Extract the device code (e.g., ABCD-1234).
      if (!session.deviceCode) {
        // Be generous with the device code length; Codex codes can vary.
        const codeMatch = text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,8}\b/i);
        if (codeMatch) {
          session.deviceCode = String(codeMatch[0]).toUpperCase();
        }
      }

      if (session.deviceUrl && session.deviceCode && session.state === 'starting') {
        session.state = 'pending';
      }
    };

    child.stdout.on('data', parseChunk);
    child.stderr.on('data', (chunk) => {
      const text = stripAnsi(chunk.toString());
      session.errorOutput += text;
    });
    child.on('error', (error) => {
      session.lastError = error.message || String(error);
      session.state = 'error';
      console.warn('[CodexAuth] Failed to spawn codex CLI:', session.lastError);
    });

    child.on('exit', (code, signal) => {
      session.exitCode = code;
      session.exitSignal = signal;
      if (session.state !== 'success') {
        session.state = code === 0 ? 'completed' : 'error';
      }
    });

    // Wait briefly for the CLI to print the device instructions.
    const deviceInfo = await this._waitForDeviceInfo(sessionId, 8000);

    return {
      sessionId,
      ...deviceInfo,
      startedAt: new Date(startedAtMs).toISOString(),
      expiresAt: new Date(startedAtMs + DEVICE_SESSION_TTL_MS).toISOString(),
    };
  }

  _waitForDeviceInfo(sessionId, timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();

      const check = () => {
        const session = this.deviceSessions.get(sessionId);
        if (!session) {
          console.warn(`[CodexAuth] Device session missing during wait: ${sessionId} (sessions=${this.deviceSessions.size})`);
          return resolve({
            deviceUrl: null,
            deviceCode: null,
            state: 'error',
            message: 'Device auth session not found',
          });
        }

        if (session.lastError && session.state === 'error' && !session.deviceUrl && !session.deviceCode) {
          return resolve({
            deviceUrl: null,
            deviceCode: null,
            state: 'error',
            message: session.lastError,
          });
        }

        if (session.deviceUrl && session.deviceCode) {
          return resolve({
            deviceUrl: session.deviceUrl,
            deviceCode: session.deviceCode,
            state: session.state,
            message: 'Open the URL and enter the code to continue device login.',
          });
        }

        if (Date.now() - start > timeoutMs) {
          return resolve({
            deviceUrl: session.deviceUrl,
            deviceCode: session.deviceCode,
            state: session.state,
            message: 'Device login started. Waiting for device code from Codex CLI...',
          });
        }

        setTimeout(check, 200);
      };

      check();
    });
  }

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

    // If the process has exited, treat successful login as usable for Codex CLI even if the API is blocked.
    if (session.exitCode !== null) {
      const apiStatus = await this.checkApiUsable({ forceRefresh: true });
      const hasAuth = apiStatus.available === true || Boolean(this.getAccessToken());

      if (hasAuth) {
        session.state = 'success';
        const apiUsable = apiStatus.apiUsable === true;
        const message = apiUsable
          ? 'Device login complete and OpenAI API access is available.'
          : 'Device login complete. OpenAI API access is not available, but Codex CLI should be usable.';
        return {
          success: true,
          state: 'success',
          message,
          apiStatus,
        };
      }

      session.state = 'error';
      const statusDetail = apiStatus.apiStatus ? ` (API status: ${apiStatus.apiStatus})` : '';
      return {
        success: false,
        state: 'error',
        message: `Device login completed but the OpenAI API is not usable${statusDetail}.`,
        apiStatus,
      };
    }

    return {
      success: true,
      state: session.state,
      deviceUrl: session.deviceUrl,
      deviceCode: session.deviceCode,
      message: 'Waiting for you to complete device login in the browser...',
    };
  }

  async logout() {
    try {
      await new Promise((resolve, reject) => {
        const spawnOptions = {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        };
        // On Windows, .cmd files need shell: true to execute properly
        if (process.platform === 'win32') {
          spawnOptions.shell = true;
        }
        const child = spawn(this.codexBin, ['logout'], spawnOptions);
        let stderr = '';
        child.stderr.on('data', (chunk) => {
          stderr += stripAnsi(chunk.toString());
        });
        child.on('exit', (code) => {
          if (code === 0) resolve();
          else reject(new Error(stderr || `codex logout exited with code ${code}`));
        });
      });

      // Clear cached status after logout.
      this.apiCheckCache = null;
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Failed to log out of Codex CLI',
      };
    }
  }
}

export default new CodexAuthManager();
