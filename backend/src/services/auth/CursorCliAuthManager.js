/**
 * CursorCliAuthManager — local auth for the Cursor Agent CLI.
 *
 * The Cursor CLI (`cursor-agent`) owns its own login. Session lives in
 * ~/.cursor. We NEVER reimplement Cursor OAuth — we shell `cursor-agent login`
 * for device auth and `cursor-agent status` to read login state.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import generateUUID from '../../utils/generateUUID.js';
import { resolveCursorInvocation } from '../../utils/cliInvocation.js';

const API_CHECK_TTL_MS = 2 * 60 * 1000;
const DEVICE_SESSION_TTL_MS = 15 * 60 * 1000;

function expandUserPath(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/')) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

function resolveCursorBin() {
  const envBin = typeof process.env.AGNT_CURSOR_BIN === 'string' ? process.env.AGNT_CURSOR_BIN.trim() : '';
  if (envBin) return expandUserPath(envBin);
  const home = os.homedir();
  const candidates = [
    path.join(home, '.local', 'bin', 'cursor-agent'),
    '/opt/homebrew/bin/cursor-agent',
    '/usr/local/bin/cursor-agent',
    path.join(home, '.cursor', 'bin', 'cursor-agent'),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return 'cursor-agent';
}

function resolveCursorHome() {
  return path.join(os.homedir(), '.cursor');
}

class CursorCliAuthManager {
  constructor() {
    this.apiCheckCache = null;
    this.deviceSessions = new Map();
    this.cursorBin = resolveCursorBin();
  }

  get authPath() {
    return resolveCursorHome();
  }

  getAuthPath() {
    return resolveCursorHome();
  }

  /**
   * Sync provenance for sessionDiscovery.js and the status endpoint.
   *
   * Cursor is the one provider that genuinely cannot answer cheaply: the CLI
   * holds the credential internally and there is no file to stat. Note that
   * ~/.cursor EXISTS as soon as the CLI has ever run, so its presence proves
   * nothing — probing it would produce a confident false "connected".
   *
   * So we report the warm probe result if checkApiUsable() has run recently, and
   * otherwise say plainly that a probe is required. Saying "unknown" is the
   * correct answer here; guessing is not.
   */
  describeCredential() {
    const warm = this.apiCheckCache?.value?.apiUsable === true;
    return {
      connected: warm,
      source: warm ? 'cursor-cli-session' : null,
      tier: warm ? 'cli-probe' : null,
      ownedByAgnt: false,
      label: warm ? 'CLI reports signed in' : 'requires a CLI probe',
      credPath: resolveCursorHome(),
      keychainSupported: false,
      requiresProbe: !warm,
    };
  }

  getCursorBin() {
    this.cursorBin = resolveCursorBin();
    return this.cursorBin;
  }

  /**
   * The Cursor CLI holds the credential internally; there is no plaintext token
   * file to read. We surface a sentinel so callers that only gate on
   * "getAccessToken() truthy" behave correctly when the CLI is logged in.
   */
  getAccessToken() {
    // Cheap sync check: if `cursor-agent status` was recently confirmed usable, return sentinel.
    if (this.apiCheckCache?.value?.apiUsable) return 'cursor-cli-session';
    return null;
  }

  getTokenExpiry() {
    // Cursor CLI does not expose a plaintext expiry; sessions refresh internally.
    return null;
  }

  async _runCursor(args, { timeoutMs = 30000 } = {}) {
    // Invocation, not bare bin: on Windows the CLI is a .cmd shim Node cannot
    // spawn; resolveCursorInvocation returns the underlying node.exe + index.js.
    const invocation = resolveCursorInvocation();
    return new Promise((resolve, reject) => {
      const child = spawn(invocation.command, [...invocation.args, ...args], {
        env: { ...process.env, HOME: os.homedir() },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        reject(new Error(`cursor-agent ${args.join(' ')} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('error', (err) => { clearTimeout(timer); reject(err); });
      child.on('close', (code) => { clearTimeout(timer); resolve({ exitCode: code ?? 1, stdout, stderr }); });
    });
  }

  /**
   * List model ids known to the CLI via `cursor-agent models`.
   * Public API for routes — callers must not reach into _runCursor.
   * Returns [] on any failure; callers fall back to the static config list.
   */
  async listModels({ timeoutMs = 20000 } = {}) {
    try {
      const probe = await this._runCursor(['models'], { timeoutMs });
      return `${probe.stdout}`
        .split('\n')
        .map((line) => {
          const m = line.match(/^\s*([a-z0-9][a-z0-9._-]+)\s+-\s+/i);
          return m ? m[1] : null;
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Health check via `cursor-agent status`.
   */
  async checkApiUsable({ forceRefresh = false } = {}) {
    const now = Date.now();
    if (!forceRefresh && this.apiCheckCache && now - this.apiCheckCache.checkedAtMs < API_CHECK_TTL_MS) {
      return this.apiCheckCache.value;
    }

    const invocation = resolveCursorInvocation();
    // A resolved args prefix (Windows node.exe + index.js) proves a real
    // install; otherwise fall back to the historical checks.
    let cliPresent = invocation.args.length > 0 || invocation.command === 'cursor-agent';
    try { cliPresent = cliPresent || fs.existsSync(invocation.command); } catch { /* ignore */ }

    let loggedIn = false;
    let email = null;
    let apiStatus = null;
    let probeError = null;

    try {
      const result = await this._runCursor(['status'], { timeoutMs: 25000 });
      const out = `${result.stdout}\n${result.stderr}`;
      if (/not logged in/i.test(out)) {
        loggedIn = false;
        apiStatus = 401;
        probeError = 'Cursor CLI is not authenticated. Run: cursor-agent login';
      } else if (/logged in/i.test(out)) {
        loggedIn = true;
        apiStatus = 200;
        const m = out.match(/Logged in as\s+([^\s]+)/i);
        email = m ? m[1] : null;
      } else {
        loggedIn = false;
        apiStatus = result.exitCode;
        probeError = out.trim().slice(0, 300) || `cursor-agent status exited ${result.exitCode}`;
      }
    } catch (e) {
      loggedIn = false;
      probeError = e.message;
    }

    const value = {
      available: loggedIn,
      cliUsable: cliPresent,
      apiUsable: loggedIn,
      apiStatus,
      source: loggedIn ? 'cursor-cli-session' : null,
      authPath: resolveCursorHome(),
      checkedAt: new Date().toISOString(),
      tokenExpiry: null,
      email,
      error: probeError || undefined,
    };
    this.apiCheckCache = { checkedAtMs: now, value };
    return value;
  }

  _cleanupDeviceSessions() {
    const now = Date.now();
    for (const [id, session] of this.deviceSessions.entries()) {
      if (!session || now - session.startedAtMs > DEVICE_SESSION_TTL_MS) {
        try { session?.child?.kill?.('SIGKILL'); } catch { /* ignore */ }
        this.deviceSessions.delete(id);
      }
    }
  }

  /**
   * Device auth: spawn `cursor-agent login` and capture the URL from output.
   * The Cursor CLI opens a browser + prints an auth URL.
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

    const invocation = resolveCursorInvocation();
    const child = spawn(invocation.command, [...invocation.args, 'login'], {
      env: { ...process.env, HOME: os.homedir() },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    session.child = child;

    const onData = (chunk) => {
      session.buffer += chunk.toString();
      const urlMatch = session.buffer.match(/https:\/\/[^\s]+/);
      if (urlMatch) session.deviceUrl = urlMatch[0].replace(/[.,;)]+$/, '');
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', async () => {
      if (session.state === 'pending') {
        const status = await this.checkApiUsable({ forceRefresh: true });
        session.state = status.apiUsable ? 'success' : 'error';
        if (!status.apiUsable) session.lastError = 'cursor-agent login did not complete';
      }
      this.apiCheckCache = null;
    });

    await new Promise((r) => setTimeout(r, 1200));

    return {
      success: true,
      sessionId,
      deviceUrl: session.deviceUrl || 'https://cursor.com',
      deviceCode: null,
      userCode: null,
      state: session.state,
      message: session.deviceUrl
        ? 'Open the URL in your browser to finish Cursor login.'
        : 'Cursor login started. Complete sign-in in the browser, or run: cursor-agent login',
    };
  }

  async getDeviceSessionStatus(sessionId) {
    this._cleanupDeviceSessions();
    const session = this.deviceSessions.get(sessionId);
    if (!session) {
      const status = await this.checkApiUsable({ forceRefresh: true });
      if (status.apiUsable) {
        return { success: true, state: 'success', message: 'Cursor connected.', apiStatus: status };
      }
      return { success: false, state: 'error', message: 'Session not found or expired.' };
    }

    if (session.state === 'success') {
      const apiStatus = await this.checkApiUsable({ forceRefresh: true });
      return { success: true, state: 'success', message: 'Cursor connected.', apiStatus };
    }
    if (session.state === 'error') {
      return { success: false, state: 'error', message: session.lastError || 'Login failed.' };
    }

    const status = await this.checkApiUsable({ forceRefresh: true });
    if (status.apiUsable) {
      session.state = 'success';
      this.apiCheckCache = null;
      return { success: true, state: 'success', message: 'Cursor connected.', apiStatus: status };
    }

    return {
      success: true,
      state: 'pending',
      deviceUrl: session.deviceUrl,
      message: 'Waiting for Cursor login to complete…',
    };
  }

  async refreshAccessToken() {
    this.apiCheckCache = null;
    const status = await this.checkApiUsable({ forceRefresh: true });
    if (status.apiUsable) return { success: true, ...status };
    return { success: false, error: 'Not authenticated. Run: cursor-agent login', revoked: true };
  }

  async logout() {
    try {
      await this._runCursor(['logout'], { timeoutMs: 15000 });
      this.apiCheckCache = null;
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

export default new CursorCliAuthManager();
