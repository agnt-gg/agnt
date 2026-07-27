/**
 * GrokBuildAuthManager — local auth for the Grok Build CLI.
 *
 * Credentials live in ~/.grok/auth.json (OIDC). Optional XAI_API_KEY env
 * override. Device login shells `grok login --device-auth` — we never
 * reimplement xAI OAuth ourselves.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import generateUUID from '../../utils/generateUUID.js';
import { grokBinCandidates } from '../../utils/cliInvocation.js';

const API_CHECK_TTL_MS = 2 * 60 * 1000;
const DEVICE_SESSION_TTL_MS = 15 * 60 * 1000;

function expandUserPath(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function resolveGrokHome() {
  const configured = process.env.GROK_HOME;
  const grokHome = configured ? expandUserPath(configured) : path.join(os.homedir(), '.grok');
  try {
    return fs.realpathSync.native(grokHome);
  } catch {
    return grokHome;
  }
}

function resolveAuthPath() {
  return path.join(resolveGrokHome(), 'auth.json');
}

function resolveGrokBin() {
  const envBin = typeof process.env.GROK_BIN === 'string' ? process.env.GROK_BIN.trim() : '';
  if (envBin) return envBin;

  // Platform-aware: on Windows the installer ships grok.exe, which the
  // extensionless POSIX candidates never matched.
  const candidates = grokBinCandidates();
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  return 'grok';
}

function readAuthFile() {
  const authPath = resolveAuthPath();
  try {
    const raw = fs.readFileSync(authPath, 'utf8');
    return { authPath, data: JSON.parse(raw) };
  } catch {
    return { authPath, data: null };
  }
}

/** Pick the first OIDC entry from auth.json (keys look like https://auth.x.ai::<clientId>). */
function getPrimaryEntry(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const keys = Object.keys(data);
  if (keys.length === 0) return null;
  return { key: keys[0], entry: data[keys[0]] };
}

class GrokBuildAuthManager {
  constructor() {
    this.apiCheckCache = null;
    this.deviceSessions = new Map();
    this.grokBin = resolveGrokBin();
  }

  get authPath() {
    return resolveAuthPath();
  }

  getAuthPath() {
    return resolveAuthPath();
  }

  getGrokBin() {
    // Re-resolve in case GROK_BIN / install path changed at runtime
    this.grokBin = resolveGrokBin();
    return this.grokBin;
  }

  getAccessToken() {
    const envKey = typeof process.env.XAI_API_KEY === 'string' ? process.env.XAI_API_KEY.trim() : '';
    if (envKey) return envKey;

    const { data } = readAuthFile();
    const primary = getPrimaryEntry(data);
    if (!primary?.entry) return null;
    const { entry } = primary;
    if (typeof entry.key === 'string' && entry.key.trim()) return entry.key.trim();
    if (typeof entry.access_token === 'string' && entry.access_token.trim()) {
      return entry.access_token.trim();
    }
    return null;
  }

  getTokenExpiry() {
    const { data } = readAuthFile();
    const primary = getPrimaryEntry(data);
    if (!primary?.entry?.expires_at) return null;
    const expiresAtMs = Date.parse(primary.entry.expires_at);
    if (Number.isNaN(expiresAtMs)) return null;
    return {
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresInMs: expiresAtMs - Date.now(),
      expired: Date.now() >= expiresAtMs,
      hasRefreshToken: Boolean(primary.entry.refresh_token),
      email: primary.entry.email || null,
      authMode: primary.entry.auth_mode || null,
    };
  }

  /**
   * Health check.
   * Prefer: spawn `grok models` (proves CLI + auth refresh path).
   * Fallback: env key presence if CLI probe fails.
   */
  async checkApiUsable({ forceRefresh = false } = {}) {
    const authPath = this.getAuthPath();
    const now = Date.now();
    if (
      !forceRefresh &&
      this.apiCheckCache &&
      now - this.apiCheckCache.checkedAtMs < API_CHECK_TTL_MS
    ) {
      return this.apiCheckCache.value;
    }

    const envKey = typeof process.env.XAI_API_KEY === 'string' ? process.env.XAI_API_KEY.trim() : '';
    const token = this.getAccessToken();
    const expiry = this.getTokenExpiry();
    const bin = this.getGrokBin();
    let cliPresent = bin === 'grok';
    try {
      cliPresent = cliPresent || fs.existsSync(bin);
    } catch {
      // ignore
    }

    if (!token && !envKey) {
      const value = {
        available: false,
        cliUsable: cliPresent,
        apiUsable: false,
        apiStatus: null,
        source: null,
        authPath,
        checkedAt: new Date().toISOString(),
        tokenExpiry: expiry?.expiresAt || null,
      };
      this.apiCheckCache = { checkedAtMs: now, value };
      return value;
    }

    let apiUsable = false;
    let apiStatus = null;
    let probeError = null;
    let models = [];

    try {
      const result = await this._runGrok(['models'], { timeoutMs: 20000 });
      const out = `${result.stdout}\n${result.stderr}`;
      if (/not authenticated/i.test(out)) {
        apiUsable = false;
        apiStatus = 401;
        probeError = 'Grok Build CLI is not authenticated. Run: grok login --oauth';
      } else if (result.exitCode === 0 || /available models/i.test(out) || /you are logged in/i.test(out)) {
        apiUsable = true;
        apiStatus = 200;
        // Parse model ids from lines like "  * grok-4.5 (default)"
        models = out
          .split('\n')
          .map((line) => {
            const m = line.match(/^\s*\*\s+([^\s(]+)/);
            return m ? m[1] : null;
          })
          .filter(Boolean);
      } else {
        apiUsable = false;
        apiStatus = result.exitCode;
        probeError = out.trim().slice(0, 300) || `grok models exited ${result.exitCode}`;
      }
    } catch (e) {
      if (envKey) {
        apiUsable = true;
        apiStatus = 200;
      } else {
        apiUsable = false;
        probeError = e.message;
      }
    }

    const value = {
      available: true,
      cliUsable: cliPresent,
      apiUsable,
      apiStatus,
      source: envKey ? 'env-xai-api-key' : 'grok-auth-oidc',
      authPath,
      checkedAt: new Date().toISOString(),
      tokenExpiry: expiry?.expiresAt || null,
      email: expiry?.email || null,
      models,
      error: probeError || undefined,
    };
    this.apiCheckCache = { checkedAtMs: now, value };
    return value;
  }

  async _runGrok(args, { timeoutMs = 30000 } = {}) {
    const bin = this.getGrokBin();
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, {
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
        reject(new Error(`grok ${args.join(' ')} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });
    });
  }

  _cleanupDeviceSessions() {
    const now = Date.now();
    for (const [id, session] of this.deviceSessions.entries()) {
      if (!session || now - session.startedAtMs > DEVICE_SESSION_TTL_MS) {
        try {
          session?.child?.kill?.('SIGTERM');
        } catch {
          // ignore
        }
        this.deviceSessions.delete(id);
      }
    }
  }

  /**
   * Device auth: spawn `grok login --device-auth` and capture device URL/code
   * from stdout/stderr. Grok CLI owns the OIDC client.
   */
  async startDeviceAuth() {
    this._cleanupDeviceSessions();
    const sessionId = generateUUID();
    const session = {
      id: sessionId,
      startedAtMs: Date.now(),
      state: 'pending',
      deviceUrl: null,
      deviceCode: null,
      lastError: null,
      child: null,
      buffer: '',
    };
    this.deviceSessions.set(sessionId, session);

    const bin = this.getGrokBin();
    const child = spawn(bin, ['login', '--device-auth'], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    session.child = child;

    const onData = (chunk) => {
      session.buffer += chunk.toString();
      const urlMatch = session.buffer.match(/https:\/\/[^\s]+/);
      if (urlMatch) session.deviceUrl = urlMatch[0].replace(/[.,;)]+$/, '');
      // Prefer codes that look like device codes (XXXX-XXXX or alphanumeric 6-10)
      const codeMatch =
        session.buffer.match(/\b([A-Z0-9]{4,5}-[A-Z0-9]{4,5})\b/) ||
        session.buffer.match(/(?:code|enter)[:\s]+([A-Z0-9]{6,10})\b/i);
      if (codeMatch) session.deviceCode = codeMatch[1];
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => {
      if (session.state === 'pending') {
        const token = this.getAccessToken();
        const expiry = this.getTokenExpiry();
        if (token && expiry && !expiry.expired) {
          session.state = 'success';
        } else if (token && expiry?.hasRefreshToken) {
          // Token may be briefly expired but refreshable — treat as success; probe later
          session.state = 'success';
        } else if (code !== 0) {
          session.state = 'error';
          session.lastError = `grok login exited ${code}`;
        }
      }
      this.apiCheckCache = null;
    });

    await new Promise((r) => setTimeout(r, 900));

    return {
      success: true,
      sessionId,
      deviceUrl: session.deviceUrl || 'https://accounts.x.ai',
      deviceCode: session.deviceCode || null,
      userCode: session.deviceCode || null,
      state: session.state,
      message: session.deviceCode
        ? 'Open the URL and enter the code to finish Grok Build login.'
        : 'Grok Build login started. Complete sign-in in the browser, or run: grok login --oauth',
    };
  }

  async getDeviceSessionStatus(sessionId) {
    this._cleanupDeviceSessions();
    const session = this.deviceSessions.get(sessionId);
    if (!session) {
      // Opportunistic: auth file may already be valid from a terminal login
      const status = await this.checkApiUsable({ forceRefresh: true });
      if (status.apiUsable) {
        return { success: true, state: 'success', message: 'Grok Build connected.', apiStatus: status };
      }
      return { success: false, state: 'error', message: 'Session not found or expired.' };
    }

    if (session.state === 'success') {
      const apiStatus = await this.checkApiUsable({ forceRefresh: true });
      return { success: true, state: 'success', message: 'Grok Build connected.', apiStatus };
    }
    if (session.state === 'error') {
      return { success: false, state: 'error', message: session.lastError || 'Login failed.' };
    }

    const expiry = this.getTokenExpiry();
    if (this.getAccessToken() && expiry && (!expiry.expired || expiry.hasRefreshToken)) {
      session.state = 'success';
      this.apiCheckCache = null;
      return this.getDeviceSessionStatus(sessionId);
    }

    return {
      success: true,
      state: 'pending',
      deviceUrl: session.deviceUrl,
      deviceCode: session.deviceCode,
      userCode: session.deviceCode,
      message: 'Waiting for Grok Build login to complete…',
    };
  }

  async refreshAccessToken() {
    this.apiCheckCache = null;
    const status = await this.checkApiUsable({ forceRefresh: true });
    if (status.apiUsable) return { success: true, ...status };
    return {
      success: false,
      error: 'Token refresh failed. Run: grok login --oauth',
      revoked: true,
    };
  }

  async logout() {
    try {
      await this._runGrok(['logout'], { timeoutMs: 15000 });
      this.apiCheckCache = null;
      return { success: true };
    } catch {
      try {
        const authPath = resolveAuthPath();
        if (fs.existsSync(authPath)) fs.unlinkSync(authPath);
        this.apiCheckCache = null;
        return { success: true, method: 'file-delete' };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
  }
}

export default new GrokBuildAuthManager();
