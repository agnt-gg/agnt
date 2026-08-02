/**
 * Which network is this machine actually on?
 *
 * WHY THIS EXISTS
 * The Phone Access panel used to say "Make sure your phone is on the same
 * Wi-Fi." That sentence is true, generic, and useless — the user cannot check
 * it without leaving the app, and it reads like boilerplate so it gets skipped.
 * Naming the network turns a platitude into an instruction:
 *
 *     "On your phone, connect to Wi-Fi:  Example Network 5G"
 *
 * Best-effort by design. Every failure path yields null and the UI falls back
 * to the generic wording. A settings panel must never hang or throw because an
 * OS command was slow, missing, or worded differently on some locale.
 *
 * WHY IT NEVER BLOCKS A REQUEST
 * This value is one line of garnish, and it used to hold the entire panel
 * hostage: /pairing/status awaited `netsh wlan show interfaces`, measured at
 * 133ms on the machine this was written on and capped at 1500ms, which made a
 * 8ms endpoint take 142ms — every 60 seconds, forever, plus once per poll
 * whenever the TTL happened to lapse mid-session. A decorative field must
 * never be on the critical path of a response.
 *
 * So reads are synchronous and always cheap: return what is known now, and if
 * that is stale, start a refresh for the NEXT caller. Never await the OS.
 */

import { execFile } from 'child_process';

const CACHE_TTL_MS = 60_000;
const COMMAND_TIMEOUT_MS = 1500;

let cache = { value: null, at: 0 };
/** The in-flight probe, so N concurrent polls cannot spawn N processes. */
let inflight = null;

/** Test seam. */
export function _resetNetworkNameCache() {
  cache = { value: null, at: 0 };
  inflight = null;
}

/**
 * @returns {Promise<string|null>} stdout, or null if the command could not be
 * run to completion (missing, timed out, non-zero exit).
 */
function run(cmd, args) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    try {
      const child = execFile(cmd, args, { timeout: COMMAND_TIMEOUT_MS, windowsHide: true }, (err, stdout) =>
        finish(err ? null : String(stdout || ''))
      );
      child.on('error', () => finish(null));
    } catch {
      finish(null);
    }
  });
}

/**
 * Parse the SSID out of `netsh wlan show interfaces`.
 * Anchored to the line START so it cannot match the `BSSID` line directly
 * below it — which is the MAC address, not a network name.
 */
export function parseWindowsSsid(text) {
  if (!text) return null;
  const line = String(text)
    .split(/\r?\n/)
    .find((l) => /^\s*SSID\s*:/.test(l));
  if (!line) return null;
  const value = line.split(':').slice(1).join(':').trim();
  return value || null;
}

export function parseMacSsid(text) {
  if (!text) return null;
  // "Current Wi-Fi Network: Example Network 5G"
  const m = /Current Wi-?Fi Network:\s*(.+)/i.exec(String(text));
  const value = m?.[1]?.trim();
  if (!value || /You are not associated/i.test(String(text))) return null;
  return value;
}

export function parseLinuxSsid(text) {
  const value = String(text || '').trim();
  return value || null;
}

/**
 * Ask the OS.
 *
 * Distinguishes two outcomes that both used to collapse to null, and must not:
 *   { ok: true,  value: null }  we asked and this machine is not on Wi-Fi
 *   { ok: false, value: null }  we could not ask (command missing/timed out)
 *
 * The first is evidence and should clear a previously-known name. The second
 * is the absence of evidence and must not — a momentarily busy `netsh` is no
 * reason to stop telling the user which network to join.
 *
 * @returns {Promise<{ok: boolean, value: string|null}>}
 */
async function detect() {
  if (process.platform === 'win32') {
    const out = await run('netsh', ['wlan', 'show', 'interfaces']);
    return out === null ? { ok: false, value: null } : { ok: true, value: parseWindowsSsid(out) };
  }

  if (process.platform === 'darwin') {
    const airport = await run(
      '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport',
      ['-I']
    );
    if (airport !== null) {
      const value = parseMacSsid(airport);
      if (value) return { ok: true, value };
    }
    // airport is removed on recent macOS; networksetup is the supported path.
    const ns = await run('networksetup', ['-getairportnetwork', 'en0']);
    if (ns === null) return { ok: airport !== null, value: null };
    return { ok: true, value: parseMacSsid(ns) };
  }

  const out = await run('iwgetid', ['-r']);
  return out === null ? { ok: false, value: null } : { ok: true, value: parseLinuxSsid(out) };
}

/**
 * Start a probe unless one is already running. Never rejects.
 * @returns {Promise<string|null>} the value after the probe settles.
 */
function refresh() {
  if (inflight) return inflight;
  inflight = detect()
    .then(({ ok, value }) => {
      cache = { value: ok ? value : cache.value, at: Date.now() };
      return cache.value;
    })
    .catch(() => {
      // Mark the attempt so a persistently throwing probe backs off to one
      // try per TTL instead of spawning a process per request.
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
 * The network name as currently known. Synchronous and always cheap.
 *
 * Returns null before the first probe settles; callers treat that exactly as
 * "unknown", which is the same fallback used on wired and unsupported setups.
 * Call primeNetworkName() at boot so that window closes before any user opens
 * the panel.
 *
 * @returns {string|null}
 */
export function getNetworkName() {
  if (!isFresh()) refresh(); // deliberately not awaited
  return cache.value;
}

/**
 * Warm the cache. Fire-and-forget at startup; awaited only by tests.
 * @returns {Promise<string|null>}
 */
export function primeNetworkName() {
  return isFresh() ? Promise.resolve(cache.value) : refresh();
}

export default {
  getNetworkName,
  primeNetworkName,
  parseWindowsSsid,
  parseMacSsid,
  parseLinuxSsid,
  _resetNetworkNameCache,
};
