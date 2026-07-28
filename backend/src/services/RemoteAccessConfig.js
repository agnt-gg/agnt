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

/**
 * `publicOrigin` is the address the outside world uses to reach this server
 * when it differs from anything the machine can observe about itself — a
 * tunnel, a CNAME, split-horizon DNS. Nothing can infer it, so it is the one
 * value an operator must be able to state outright.
 * @returns {{ lanEnabled: boolean, publicOrigin: string }}
 */
export function readConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      lanEnabled: parsed?.lanEnabled === true,
      publicOrigin: typeof parsed?.publicOrigin === 'string' ? parsed.publicOrigin : '',
    };
  } catch {
    return { lanEnabled: false, publicOrigin: '' };
  }
}

/**
 * @param {{ lanEnabled: boolean, publicOrigin?: string }} next
 * @returns {{ lanEnabled: boolean, publicOrigin: string }}
 */
export function writeConfig(next) {
  // Preserve a field the caller did not mention. The LAN toggle and the public
  // URL are set from different places, and a partial write that silently
  // dropped the other one would look exactly like "my setting reverted".
  const current = readConfig();
  const publicOrigin =
    next?.publicOrigin === undefined ? current.publicOrigin : String(next.publicOrigin || '').trim();
  const value = {
    lanEnabled: next?.lanEnabled === true,
    publicOrigin,
    updatedAt: new Date().toISOString(),
  };
  // Atomic write: a torn config file would silently fall back to loopback on
  // next boot, which looks exactly like "the toggle didn't save".
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
  return { lanEnabled: value.lanEnabled, publicOrigin: value.publicOrigin };
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

// ---------------------------------------------------------------------------
// ACTUAL BIND — what the OS says we are listening on, not what we asked for.
// ---------------------------------------------------------------------------
// The bind decision is made once, at startup. Flipping the config afterwards
// changes what we WOULD bind, and nothing else — the socket is already open.
// Without recording the real address there is no way to answer "do I need to
// restart?", and an earlier version of this file tried to answer it by
// comparing the live config file against itself (always equal, always false).
let actualBind = null;

/**
 * Record the real listening address. Call once from the listen() callback with
 * `server.address()`.
 * @param {{address?: string, port?: number}|null} addr
 */
export function recordActualBind(addr) {
  if (!addr || typeof addr.address !== 'string') return;
  const host = addr.address;
  actualBind = {
    host,
    port: addr.port,
    // '0.0.0.0' / '::' mean every interface. Anything else that is not loopback
    // is a specific external interface, which is also LAN-reachable.
    lanEnabled: host !== LOOPBACK && host !== '::1' && host !== 'localhost',
  };
}

/** @returns {{host: string, port: number, lanEnabled: boolean}|null} */
export function getActualBind() {
  return actualBind;
}

/** Test seam. */
export function _resetActualBind() {
  actualBind = null;
}

/**
 * Does the running process need a restart for the current config to take effect?
 *
 * Compares DESIRED (config/env, read now) against ACTUAL (the open socket).
 * Returns false when the actual bind is unknown — an unrecorded bind means we
 * are not the server process (unit tests, imports), and inventing a restart
 * prompt there would be noise.
 */
export function isRestartRequired() {
  if (!actualBind) return false;
  return resolveBindHost().lanEnabled !== actualBind.lanEnabled;
}

// ---------------------------------------------------------------------------
// REACHABILITY WITNESS — has anything other than this machine connected?
// ---------------------------------------------------------------------------
// One boolean's worth of truth that turns an invisible failure into a visible
// one. Without it, "my phone can't connect" is indistinguishable from "the
// server is broken", and the user has no way to tell which half to fix.
//
// Deliberately keeps only the MOST RECENT hit: the question is "did my phone
// get here?", which needs no history. Storing a log of every client would be
// both useless for that and a privacy footgun.
let lastExternalRequest = null;

const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', 'localhost']);

/** Strip the IPv6-mapped-IPv4 prefix Node reports on dual-stack sockets. */
export function normalizeIp(ip) {
  if (typeof ip !== 'string') return '';
  return ip.replace(/^::ffff:/i, '').trim();
}

/**
 * Record a request if it came from somewhere other than this machine.
 * Runs on every request, so it stays trivial: one regex-free comparison.
 * @param {{ip?: string, path?: string, socket?: {remoteAddress?: string}}} req
 */
export function recordExternalRequest(req) {
  const ip = normalizeIp(req?.ip || req?.socket?.remoteAddress || '');
  if (!ip || LOOPBACK_ADDRS.has(ip) || ip.startsWith('127.')) return;
  lastExternalRequest = { ip, path: String(req?.path || '').slice(0, 120), at: Date.now() };
}

/** @returns {{ip: string, path: string, at: number}|null} */
export function getLastExternalRequest() {
  return lastExternalRequest;
}

/** Test seam. */
export function _resetExternalRequest() {
  lastExternalRequest = null;
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

export default {
  readConfig,
  writeConfig,
  resolveBindHost,
  lanAddresses,
  recordActualBind,
  getActualBind,
  isRestartRequired,
  recordExternalRequest,
  getLastExternalRequest,
  normalizeIp,
  _resetActualBind,
  _resetExternalRequest,
  LOOPBACK,
  ALL_INTERFACES,
  CONFIG_PATH,
};
