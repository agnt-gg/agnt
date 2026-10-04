/**
 * The agnt.gg update notifier's one network call: "is there a newer version?"
 *
 * It lives here, with the fetch injected, because it broke silently once:
 * main.js stopped importing `https` while this call still used it, so every
 * check threw a ReferenceError that the IPC handler turned into a quiet
 * `{ error }`. Two months of checks never reached the network and nothing
 * said so. As a module it is unit-tested, and it can only fail loudly.
 */

export const UPDATE_CHECK_URL = 'https://agnt.gg/api/updates/check';
export const UPDATE_CHECK_TIMEOUT_MS = 10_000;

/** The platform id agnt.gg's update feed is keyed by. */
export function updatePlatformId(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-arm' : 'mac-intel';
  if (platform === 'linux') return 'linux-appimage';
  return 'win';
}

export function updateCheckUrl(version, platformId) {
  const url = new URL(UPDATE_CHECK_URL);
  url.searchParams.set('version', version);
  url.searchParams.set('platform', platformId);
  return url.toString();
}

/**
 * Ask agnt.gg whether `version` is current. Resolves with the feed's answer,
 * rejects with an Error naming what went wrong. Never hangs past `timeoutMs`.
 *
 * @param {object} opts
 * @param {(url: string, init: object) => Promise<Response>} opts.fetch  Electron's net.fetch in the app
 * @param {string} opts.version
 * @param {string} [opts.platformId]
 * @param {number} [opts.timeoutMs]
 */
export async function checkForUpdate({ fetch, version, platformId = updatePlatformId(), timeoutMs = UPDATE_CHECK_TIMEOUT_MS }) {
  const url = updateCheckUrl(version, platformId);
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const reason = err?.name === 'TimeoutError' ? `no answer within ${timeoutMs}ms` : err?.message || String(err);
    throw new Error(`update check failed: ${reason}`, { cause: err });
  }
  if (!response.ok) throw new Error(`update check failed: HTTP ${response.status}`);

  let body;
  try {
    body = await response.json();
  } catch (err) {
    throw new Error('update check failed: response was not JSON', { cause: err });
  }
  if (!body || typeof body.updateAvailable !== 'boolean') {
    throw new Error('update check failed: response has no updateAvailable flag');
  }
  return body;
}
