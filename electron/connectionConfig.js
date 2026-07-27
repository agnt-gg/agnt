/**
 * Desktop connection config — "which backend does this app talk to?"
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM
 * ---------------------------------------------------------------------------
 * Every other AGNT client already has a way to choose its backend: a browser
 * has the URL bar, a paired phone gets the URL from the QR code. The desktop
 * app is the one client that cannot choose, because it plays both roles — it
 * forks its own backend and then hardcodes `loadURL('http://localhost:3333')`.
 *
 * So a user whose real AGNT lives on a homelab server opens the desktop app and
 * gets a SECOND, EMPTY instance: no agents, no history, none of their data,
 * because they are looking at a brand-new local database. The pretty client is
 * pointed at the wrong brain.
 *
 * This module is the missing URL bar.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS SHAPED THIS WAY
 * ---------------------------------------------------------------------------
 * The remote backend serves its own frontend (backend/server.js mounts the
 * built SPA), so "connect to a remote backend" is literally just pointing the
 * window at a different origin. That means:
 *   - no local proxy, no second origin, no CORS change, no re-login dance
 *   - no version skew: the UI always comes from the backend it talks to
 *   - AGNT Cloud works for free — https://x.agnt.cloud is just another URL
 *
 * Resolution order (first hit wins):
 *   1. AGNT_REMOTE_URL env  — power-user / CI override, never persisted
 *   2. <userData>/connection.json — the Settings → Connection card
 *   3. local (today's behaviour, byte-for-byte)
 *
 * BLAST RADIUS: when nothing is configured this resolves to { mode: 'local' }
 * and every call site takes exactly the branch it takes today. A user who never
 * touches the setting cannot enter any new code path.
 */

import fs from 'fs';
import path from 'path';

export const CONFIG_FILENAME = 'connection.json';

/** @typedef {{ mode: 'local'|'remote', url: string|null, source: 'env'|'file'|'default', invalid?: string }} Connection */

const LOCAL = Object.freeze({ mode: 'local', url: null, source: 'default' });

/**
 * Validate and normalise a remote backend URL.
 *
 * Deliberately strict: this value decides where the app sends the user's
 * credentials, so anything that is not an unambiguous http(s) origin is
 * rejected rather than coerced. Returns null for anything unusable.
 *
 * @param {unknown} raw
 * @returns {{ ok: true, url: string } | { ok: false, reason: string }}
 */
export function normalizeRemoteUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'empty' };
  const trimmed = raw.trim();

  // Decide up front whether the input carries an explicit scheme.
  //
  // A try/catch around `new URL` does NOT work here: `new URL('192.168.1.50:3333')`
  // does not throw — it happily parses `192.168.1.50:` as the protocol and
  // `3333` as the path. So the catch branch never ran, and the single most
  // likely thing a human types into this box was rejected as an "unsupported
  // protocol". Detect the scheme by pattern instead.
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);

  let parsed;
  try {
    parsed = new URL(hasScheme ? trimmed : `http://${trimmed}`);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `unsupported protocol ${parsed.protocol}` };
  }
  if (!parsed.hostname) return { ok: false, reason: 'no host' };

  // Origin only. A path would be appended to every route the SPA requests.
  return { ok: true, url: parsed.origin };
}

/**
 * True when the URL sends credentials in the clear over a non-loopback hop.
 * Not an error — a homelab LAN is a legitimate place to run http — but the UI
 * says so out loud rather than pretending it is fine.
 * @param {string} url
 */
export function isPlaintextRemote(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:') return false;
    const h = u.hostname;
    return !(h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]');
  } catch {
    return false;
  }
}

/** @param {string} userDataPath */
export function configPath(userDataPath) {
  return path.join(userDataPath, CONFIG_FILENAME);
}

/**
 * Read the persisted connection choice. Any unreadable/corrupt/invalid file
 * degrades to local rather than throwing — a bad config file must never stop
 * the app from booting.
 *
 * @param {string} userDataPath
 * @returns {Connection}
 */
export function readConfig(userDataPath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath(userDataPath), 'utf8'));
  } catch {
    return { ...LOCAL };
  }
  if (parsed?.mode !== 'remote') return { ...LOCAL };

  const check = normalizeRemoteUrl(parsed.url);
  if (!check.ok) {
    return { mode: 'local', url: null, source: 'default', invalid: `saved URL rejected: ${check.reason}` };
  }
  return { mode: 'remote', url: check.url, source: 'file' };
}

/**
 * Persist the connection choice. Atomic (tmp + rename) so a torn write cannot
 * leave a half-file that silently reverts the user to local on next boot.
 *
 * @param {string} userDataPath
 * @param {{ mode: 'local'|'remote', url?: string }} next
 * @returns {{ ok: true, config: Connection } | { ok: false, reason: string }}
 */
export function writeConfig(userDataPath, next) {
  if (next?.mode === 'local') {
    const payload = { mode: 'local', updatedAt: new Date().toISOString() };
    atomicWrite(configPath(userDataPath), payload);
    return { ok: true, config: { ...LOCAL } };
  }
  if (next?.mode !== 'remote') return { ok: false, reason: 'mode must be "local" or "remote"' };

  const check = normalizeRemoteUrl(next.url);
  if (!check.ok) return { ok: false, reason: check.reason };

  atomicWrite(configPath(userDataPath), { mode: 'remote', url: check.url, updatedAt: new Date().toISOString() });
  return { ok: true, config: { mode: 'remote', url: check.url, source: 'file' } };
}

function atomicWrite(target, payload) {
  const tmp = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, target);
}

/**
 * THE resolver. Single decision point for the whole app.
 *
 * @param {{ env?: NodeJS.ProcessEnv, userDataPath: string }} opts
 * @returns {Connection}
 */
export function resolveConnection({ env = process.env, userDataPath }) {
  const fromEnv = env.AGNT_REMOTE_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    const check = normalizeRemoteUrl(fromEnv);
    if (check.ok) return { mode: 'remote', url: check.url, source: 'env' };
    // An explicitly-set but broken env var is operator error worth surfacing.
    // Still boot — locally — rather than refusing to start.
    return { mode: 'local', url: null, source: 'default', invalid: `AGNT_REMOTE_URL rejected: ${check.reason}` };
  }
  return readConfig(userDataPath);
}

export default { resolveConnection, readConfig, writeConfig, normalizeRemoteUrl, isPlaintextRemote, configPath, CONFIG_FILENAME };
