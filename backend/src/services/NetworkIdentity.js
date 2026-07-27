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
 * Best-effort by design. Every failure path returns null and the UI falls back
 * to the generic wording. A settings panel must never hang or throw because an
 * OS command was slow, missing, or worded differently on some locale.
 */

import { execFile } from 'child_process';

const CACHE_TTL_MS = 60_000;
const COMMAND_TIMEOUT_MS = 1500;

let cache = { value: null, at: 0 };

/** Test seam. */
export function _resetNetworkNameCache() {
  cache = { value: null, at: 0 };
}

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
 * @returns {Promise<string|null>} the Wi-Fi network name, or null when it
 * cannot be determined (wired, unsupported OS, command unavailable).
 */
export async function getNetworkName() {
  const now = Date.now();
  if (cache.at && now - cache.at < CACHE_TTL_MS) return cache.value;

  let value = null;
  try {
    if (process.platform === 'win32') {
      value = parseWindowsSsid(await run('netsh', ['wlan', 'show', 'interfaces']));
    } else if (process.platform === 'darwin') {
      value = parseMacSsid(
        await run('/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport', ['-I'])
      );
      if (!value) value = parseMacSsid(await run('networksetup', ['-getairportnetwork', 'en0']));
    } else {
      value = parseLinuxSsid(await run('iwgetid', ['-r']));
    }
  } catch {
    value = null;
  }

  cache = { value, at: now };
  return value;
}

export default { getNetworkName, parseWindowsSsid, parseMacSsid, parseLinuxSsid, _resetNetworkNameCache };
