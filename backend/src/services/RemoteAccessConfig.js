/**
 * Remote-access configuration: which interface the HTTP server binds to.
 *
 * SECURE BY DEFAULT. Before this module the server bound 0.0.0.0
 * unconditionally, so every AGNT instance was reachable from every network the
 * machine ever joined — coffee shop, hotel, office — without the user ever
 * choosing that. Binding is now loopback-only unless LAN access is explicitly
 * turned on.
 *
 * Precedence (highest first):
 *   1. process.env.BIND_HOST   — explicit operator override, never persisted
 *   2. remote-access.json      — the in-app "Allow phone access" toggle
 *   3. '127.0.0.1'             — safe default
 *
 * The config file lives in process.cwd(), the same location and for the same
 * reason as RestartManager's manifest: it is `backend/` in dev and the
 * writable userData dir when packaged, and it is the cwd of the next instance
 * too, because the supervisor respawns with identical options.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'remote-access.json');

export const LOOPBACK = '127.0.0.1';
export const ALL_INTERFACES = '0.0.0.0';

/** @returns {{ lanEnabled: boolean }} */
export function readConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return { lanEnabled: parsed?.lanEnabled === true };
  } catch {
    return { lanEnabled: false };
  }
}

/**
 * @param {{ lanEnabled: boolean }} next
 * @returns {{ lanEnabled: boolean }}
 */
export function writeConfig(next) {
  const value = { lanEnabled: next?.lanEnabled === true, updatedAt: new Date().toISOString() };
  // Atomic write: a torn config file would silently fall back to loopback on
  // next boot, which looks exactly like "the toggle didn't save".
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
  return { lanEnabled: value.lanEnabled };
}

/**
 * Resolve the interface to bind. Env wins so an operator can pin behaviour
 * without the UI, and so containerised deployments (Dockerfile sets
 * BIND_HOST=0.0.0.0) are unaffected by the loopback default.
 * @returns {{ host: string, source: 'env'|'config'|'default', lanEnabled: boolean }}
 */
export function resolveBindHost() {
  const env = (process.env.BIND_HOST || '').trim();
  if (env) {
    return { host: env, source: 'env', lanEnabled: env !== LOOPBACK && env !== '::1' && env !== 'localhost' };
  }
  const { lanEnabled } = readConfig();
  if (lanEnabled) return { host: ALL_INTERFACES, source: 'config', lanEnabled: true };
  return { host: LOOPBACK, source: 'default', lanEnabled: false };
}

/**
 * Non-internal IPv4 addresses this host can be reached on.
 * @returns {Array<{ address: string, iface: string }>}
 */
export function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces || {})) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      out.push({ address: a.address, iface: name });
    }
  }
  // Prefer real LAN ranges over virtual adapters (WSL/Docker/Hyper-V sit on
  // 172.16-31.x and are almost never the address a phone can reach).
  const score = (ip) => {
    if (/^192\.168\./.test(ip)) return 0;
    if (/^10\./.test(ip)) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 3;
    return 2;
  };
  return out.sort((a, b) => score(a.address) - score(b.address));
}

export default { readConfig, writeConfig, resolveBindHost, lanAddresses, LOOPBACK, ALL_INTERFACES, CONFIG_PATH };
