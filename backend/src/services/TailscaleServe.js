/**
 * Is there a Tailscale HTTPS front door pointing at this server?
 *
 * WHY THIS EXISTS
 * ---------------
 * Phone Access enumerates network interfaces, so a machine on a tailnet is
 * offered as `http://100.x.y.z:3333` — "This machine on Tailscale". That URL
 * works, and it is also the WRONG one to hand a phone, because `tailscale
 * serve` may already be terminating TLS for the same server at
 * `https://<machine>.<tailnet>.ts.net`.
 *
 * The difference is not cosmetic. A browser only exposes the microphone and
 * camera in a SECURE CONTEXT, so over plain http the phone silently loses
 * voice and the QR scanner — with nothing on screen to explain why, because
 * from the app's point of view nothing failed. The user is told to check their
 * Wi-Fi for a problem that is actually a URL scheme.
 *
 * The daemon already knows the answer. Ask it instead of guessing.
 *
 * WHAT COUNTS AS EVIDENCE
 * -----------------------
 * `tailscale serve status --json` reports the live proxy table:
 *
 *   { "TCP": { "443": { "HTTPS": true } },
 *     "Web": { "host.tailnet.ts.net:443":
 *              { "Handlers": { "/": { "Proxy": "http://127.0.0.1:3333" } } } } }
 *
 * An origin is only advertised when a handler proxies to THIS server's port on
 * loopback. A tailnet that serves some other app on 443 must not be offered as
 * a way to reach AGNT — that would trade a working http URL for a broken https
 * one, which is worse than the bug being fixed.
 *
 * WHY IT NEVER BLOCKS A REQUEST
 * -----------------------------
 * Same rule, and the same shape, as NetworkIdentity: spawning a process on the
 * response path is how /pairing/status once turned an 8ms endpoint into 142ms.
 * Reads are synchronous and return what is known now; a stale value schedules a
 * refresh for the NEXT caller and never delays this one.
 */

import { execFile } from 'child_process';
import fs from 'fs';

const CACHE_TTL_MS = 60_000;
const COMMAND_TIMEOUT_MS = 2000;

/** Where the CLI lives when it is not on PATH. */
const BINARY_CANDIDATES = {
  win32: ['C:\\Program Files\\Tailscale\\tailscale.exe', 'C:\\Program Files (x86)\\Tailscale\\tailscale.exe'],
  darwin: [
    '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
    '/usr/local/bin/tailscale',
    '/opt/homebrew/bin/tailscale',
  ],
  linux: ['/usr/bin/tailscale', '/usr/local/bin/tailscale'],
};

/**
 * Under a test runner this module reports NO front door, and never spawns
 * anything.
 *
 * PairingRoutes primes the probe at module scope, so merely importing the
 * route ran `tailscale` against whatever machine the suite happened to be on.
 * The author's desktop has a live serve config, so the origin tests asserted
 * against a real tailnet name and went red — while the same commit passed on a
 * machine without Tailscale. A suite whose result depends on the developer's
 * VPN is not testing the code.
 *
 * Enforced here rather than by mocking in each spec, because a convention only
 * holds until someone writes the next spec without knowing about it. Tests that
 * genuinely want a front door stub `getServeOrigin`, which is the seam they
 * should be using anyway.
 */
const UNDER_TEST = Boolean(process.env.VITEST) || process.env.NODE_ENV === 'test';

let cache = { value: null, at: 0 };
let inflight = null;
let scheduled = false;

/** Test seam. */
export function _resetTailscaleCache() {
  cache = { value: null, at: 0 };
  inflight = null;
  scheduled = false;
}

function binaryPath() {
  for (const p of BINARY_CANDIDATES[process.platform] || []) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* unreadable path is not a path */
    }
  }
  // PATH lookup. execFile resolves this itself; an ENOENT resolves to null.
  return 'tailscale';
}

/** @returns {Promise<string|null>} stdout, or null if the command did not complete. */
function run(args) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    try {
      const child = execFile(
        binaryPath(),
        args,
        { timeout: COMMAND_TIMEOUT_MS, windowsHide: true },
        (err, stdout) => finish(err ? null : String(stdout || ''))
      );
      child.on('error', () => finish(null));
    } catch {
      finish(null);
    }
  });
}

/**
 * Pull the HTTPS front door for `port` out of a `serve status --json` payload.
 *
 * Exported for tests: this is the whole decision, and it is pure, so it can be
 * exercised against real daemon output without a tailnet.
 *
 * @param {object|string} payload parsed or raw JSON from the CLI
 * @param {number} port the port THIS server is listening on
 * @returns {{ origin: string, hostname: string }|null}
 */
export function parseServeStatus(payload, port) {
  let data = payload;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;

  const web = data.Web;
  if (!web || typeof web !== 'object') return null;

  for (const [hostPort, entry] of Object.entries(web)) {
    const handlers = entry?.Handlers;
    if (!handlers || typeof handlers !== 'object') continue;

    // Only a handler mounted at the ROOT can serve the whole app. A serve
    // config scoped to /grafana proxying our port would still not let
    // /m/pair resolve, so advertising its origin would produce a dead link.
    const root = handlers['/'];
    const proxy = typeof root?.Proxy === 'string' ? root.Proxy : '';
    if (!proxy) continue;

    let target;
    try {
      target = new URL(proxy);
    } catch {
      continue;
    }
    const targetPort = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
    if (targetPort !== Number(port)) continue;

    // The proxy must point back at THIS machine. A serve config forwarding to
    // another host happens to use our port number by coincidence, not because
    // it reaches us.
    const targetHost = target.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const isLocal =
      targetHost === 'localhost' || targetHost === '::1' || targetHost.startsWith('127.');
    if (!isLocal) continue;

    // "host:443" — the port is the PUBLIC one and is almost always 443.
    const lastColon = hostPort.lastIndexOf(':');
    const hostname = lastColon > -1 ? hostPort.slice(0, lastColon) : hostPort;
    const publicPort = lastColon > -1 ? Number(hostPort.slice(lastColon + 1)) : 443;
    if (!hostname) continue;

    // TLS is what this whole module is for. `serve` terminates HTTPS on the
    // port named in the TCP table; without that flag the front door is plain
    // http and buys us nothing over the interface address we already offer.
    const tls = data.TCP?.[String(publicPort)]?.HTTPS === true;
    if (!tls) continue;

    const origin = publicPort === 443 ? `https://${hostname}` : `https://${hostname}:${publicPort}`;
    return { origin, hostname };
  }

  return null;
}

async function detect(port) {
  if (UNDER_TEST) return { ok: true, value: null };
  const out = await run(['serve', 'status', '--json']);
  if (out === null) return { ok: false, value: null };
  return { ok: true, value: parseServeStatus(out, port) };
}

function refresh(port) {
  if (inflight) return inflight;
  inflight = detect(port)
    .then(({ ok, value }) => {
      // Only a completed probe may clear a known front door. A CLI that timed
      // out is the absence of evidence, not evidence of absence, and dropping
      // the HTTPS origin on a blip would bounce the user back to an http URL.
      cache = { value: ok ? value : cache.value, at: Date.now() };
      return cache.value;
    })
    .catch(() => {
      cache = { value: cache.value, at: Date.now() };
      return cache.value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

const isFresh = () => cache.at !== 0 && Date.now() - cache.at < CACHE_TTL_MS;

/**
 * The HTTPS front door as currently known. Synchronous and always cheap.
 * @param {number|string} [port] this server's port
 * @returns {{ origin: string, hostname: string }|null}
 */
export function getServeOrigin(port = process.env.PORT || 3333) {
  if (!isFresh() && !inflight && !scheduled) {
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      if (!isFresh()) refresh(Number(port));
    });
  }
  return cache.value;
}

/** Warm the cache at boot. Fire-and-forget; awaited only by tests. */
export function primeServeOrigin(port = process.env.PORT || 3333) {
  return isFresh() ? Promise.resolve(cache.value) : refresh(Number(port));
}

export default {
  getServeOrigin,
  primeServeOrigin,
  parseServeStatus,
  _resetTailscaleCache,
};
