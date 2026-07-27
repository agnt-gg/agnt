/**
 * Desktop connection config for hybrid / external-backend mode.
 *
 * Resolution order (highest wins):
 *   1. process.env.USE_EXTERNAL_BACKEND / process.env.BACKEND_URL (session override)
 *   2. userData/desktop-connection.json (Settings UI, survives restarts)
 *   3. Defaults: local backend on PORT||3333
 *
 * When useExternalBackend is true, Electron skips forking the local Express
 * server, serves this package's frontend on loopback (default :19333), and
 * reverse-proxies /api + /socket.io to BACKEND_URL. The remote host only needs
 * the AGNT API (and /api/health) — it does not need to serve the UI.
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';

const CONFIG_FILENAME = 'desktop-connection.json';

/**
 * @param {string} userDataPath - Electron app.getPath('userData')
 * @returns {string}
 */
export function connectionConfigPath(userDataPath) {
  return path.join(userDataPath, CONFIG_FILENAME);
}

/**
 * @param {string} userDataPath
 * @returns {{ useExternalBackend: boolean, backendUrl: string }}
 */
export function readStoredConnectionConfig(userDataPath) {
  const filePath = connectionConfigPath(userDataPath);
  try {
    if (!fs.existsSync(filePath)) {
      return { useExternalBackend: false, backendUrl: '' };
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      useExternalBackend: Boolean(raw.useExternalBackend),
      backendUrl: typeof raw.backendUrl === 'string' ? raw.backendUrl.trim() : '',
    };
  } catch (err) {
    console.warn('[connection] Failed to read desktop-connection.json:', err.message);
    return { useExternalBackend: false, backendUrl: '' };
  }
}

/**
 * Persist connection settings (does not apply env overrides).
 * @param {string} userDataPath
 * @param {{ useExternalBackend: boolean, backendUrl: string }} config
 */
export function writeStoredConnectionConfig(userDataPath, config) {
  const filePath = connectionConfigPath(userDataPath);
  const payload = {
    useExternalBackend: Boolean(config.useExternalBackend),
    backendUrl: typeof config.backendUrl === 'string' ? config.backendUrl.trim().replace(/\/+$/, '') : '',
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

/**
 * Normalize a backend base URL (no trailing slash, no /api suffix).
 * @param {string} url
 * @returns {string}
 */
export function normalizeBackendUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let cleaned = url.trim().replace(/\/+$/, '');
  if (cleaned.endsWith('/api')) {
    cleaned = cleaned.slice(0, -4).replace(/\/+$/, '');
  }
  return cleaned;
}

/**
 * Validate that a string is an absolute http(s) URL.
 * @param {string} url
 * @returns {{ ok: boolean, error?: string, parsed?: URL }}
 */
export function validateBackendUrl(url) {
  const cleaned = normalizeBackendUrl(url);
  if (!cleaned) {
    return { ok: false, error: 'Backend URL is required when using an external backend.' };
  }
  let parsed;
  try {
    parsed = new URL(cleaned);
  } catch {
    return { ok: false, error: 'Backend URL is not a valid URL.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Backend URL must use http:// or https://' };
  }
  return { ok: true, parsed, cleaned };
}

/**
 * Resolve effective connection mode for this app session.
 * @param {object} opts
 * @param {string} opts.userDataPath
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {{
 *   useExternalBackend: boolean,
 *   backendUrl: string,
 *   loadUrl: string,
 *   healthUrl: string,
 *   source: 'env' | 'file' | 'default',
 *   envOverrides: boolean,
 *   stored: { useExternalBackend: boolean, backendUrl: string },
 * }}
 */
export function resolveConnectionConfig({ userDataPath, env = process.env }) {
  const stored = readStoredConnectionConfig(userDataPath);
  const defaultPort = env.PORT || '3333';
  const defaultLocal = `http://127.0.0.1:${defaultPort}`;

  const envHasExternal = env.USE_EXTERNAL_BACKEND !== undefined && env.USE_EXTERNAL_BACKEND !== '';
  const envExternal =
    env.USE_EXTERNAL_BACKEND === 'true' ||
    env.USE_EXTERNAL_BACKEND === '1' ||
    env.USE_EXTERNAL_BACKEND === 'yes';
  const envUrl = typeof env.BACKEND_URL === 'string' ? env.BACKEND_URL.trim() : '';

  let useExternalBackend;
  let backendUrl;
  let source;

  if (envHasExternal || envUrl) {
    // Env wins for this process so docs / launch scripts keep working.
    useExternalBackend = envHasExternal ? envExternal : Boolean(stored.useExternalBackend) || Boolean(envUrl);
    backendUrl = normalizeBackendUrl(envUrl || stored.backendUrl || defaultLocal);
    source = 'env';
  } else if (stored.useExternalBackend || stored.backendUrl) {
    useExternalBackend = Boolean(stored.useExternalBackend);
    backendUrl = normalizeBackendUrl(stored.backendUrl || defaultLocal);
    source = 'file';
  } else {
    useExternalBackend = false;
    backendUrl = defaultLocal;
    source = 'default';
  }

  if (useExternalBackend) {
    const check = validateBackendUrl(backendUrl);
    if (!check.ok) {
      console.warn('[connection] Invalid external BACKEND_URL, falling back to local:', check.error);
      useExternalBackend = false;
      backendUrl = defaultLocal;
      source = 'default';
    } else {
      backendUrl = check.cleaned;
    }
  } else {
    backendUrl = defaultLocal;
  }

  return {
    useExternalBackend,
    backendUrl,
    loadUrl: backendUrl,
    healthUrl: `${backendUrl}/api/health`,
    source,
    envOverrides: source === 'env',
    stored,
  };
}

/**
 * One-shot health check against a backend base URL.
 * @param {string} backendUrl
 * @param {number} [timeoutMs]
 * @returns {Promise<{ ok: boolean, status?: number, error?: string, latencyMs?: number }>}
 */
export function probeBackendHealth(backendUrl, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const check = validateBackendUrl(backendUrl);
    if (!check.ok) {
      resolve({ ok: false, error: check.error });
      return;
    }

    const target = new URL('/api/health', check.cleaned);
    const lib = target.protocol === 'https:' ? https : http;
    const started = Date.now();

    const req = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname + target.search,
        method: 'GET',
        timeout: timeoutMs,
        // Self-hosted LAN certs are common; health probe is not security-critical.
        rejectUnauthorized: false,
      },
      (res) => {
        res.resume();
        const latencyMs = Date.now() - started;
        if (res.statusCode === 200) {
          resolve({ ok: true, status: res.statusCode, latencyMs });
        } else {
          resolve({ ok: false, status: res.statusCode, error: `Health returned HTTP ${res.statusCode}`, latencyMs });
        }
      }
    );

    req.on('error', (err) => {
      resolve({ ok: false, error: err.message, latencyMs: Date.now() - started });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Connection timed out', latencyMs: Date.now() - started });
    });
    req.end();
  });
}

/**
 * Poll probeBackendHealth until success or maxAttempts.
 * Single health primitive used by boot, activate, and tests.
 *
 * @param {string} backendUrl base URL (not .../api/health)
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts] default Infinity
 * @param {number} [opts.intervalMs] delay between attempts
 * @param {number} [opts.requestTimeoutMs] per-probe timeout
 * @param {(attempt: number, backendUrl: string, last: object) => void} [opts.onAttempt]
 * @returns {Promise<{ ok: boolean, attempts: number, status?: number, error?: string, latencyMs?: number }>}
 */
export async function waitUntilHealthy(backendUrl, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? Infinity;
  const intervalMs = opts.intervalMs ?? 250;
  const requestTimeoutMs = opts.requestTimeoutMs ?? 30000;
  let attempt = 0;
  let last = { ok: false, error: 'not started' };

  while (attempt < maxAttempts) {
    attempt += 1;
    last = await probeBackendHealth(backendUrl, requestTimeoutMs);
    if (typeof opts.onAttempt === 'function') {
      opts.onAttempt(attempt, backendUrl, last);
    }
    if (last.ok) {
      return { ...last, attempts: attempt };
    }
    if (attempt >= maxAttempts) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return {
    ok: false,
    attempts: attempt,
    status: last.status,
    error: last.error,
    latencyMs: last.latencyMs,
  };
}
