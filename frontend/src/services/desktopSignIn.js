/**
 * SIGN IN USING THE BROWSER THE USER IS ALREADY SIGNED INTO.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS CLOSES
 * ---------------------------------------------------------------------------
 * `window.open(..., 'width=600,height=700')` is satisfied by Electron with a
 * BrowserWindow of its own — a fresh Chromium profile with no cookies. So a
 * user who has been signed into Google in Chrome for years is shown an empty
 * login form and asked for a password, inside a window that does not look like
 * a browser and has no address bar to verify.
 *
 * The answer is the one RFC 8252 gives for native apps: open the system
 * browser, where the session already exists, and take the result back on a
 * loopback address. The account picker appears, one click finishes it.
 *
 * ---------------------------------------------------------------------------
 * WHY POLLING, AND NOT A SOCKET
 * ---------------------------------------------------------------------------
 * The window waiting for this answer has no session yet, so it is not on the
 * authenticated realtime channel. Standing one up for a sign-in would mean a
 * second, unauthenticated push path — more surface than the problem deserves.
 * A poll every 1.2s for at most three minutes costs nothing and cannot leave a
 * listener behind.
 */

import axios from 'axios';
import { API_CONFIG } from '@/tt.config.js';

/** How often to ask whether the browser has answered. */
const POLL_INTERVAL_MS = 1200;

/**
 * How long to keep asking. Long enough for someone who has to find their
 * password manager, short enough that an abandoned sign-in does not poll for
 * the life of the window.
 */
const POLL_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Can this build hand a URL to the system browser?
 *
 * `openExternalUrl` is the existing preload bridge to `shell.openExternal`; in
 * a plain browser it is simply absent, which is the correct signal that this
 * whole strategy does not apply there.
 */
export function canUseDesktopSignIn(win = globalThis.window) {
  return typeof win?.electron?.openExternalUrl === 'function';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a desktop sign-in.
 *
 * @returns {{ promise: Promise<string>, cancel: () => void }} the session
 *   token, and a way to stop waiting for it
 */
export function startDesktopSignIn({
  win = globalThis.window,
  http = axios,
  baseUrl = API_CONFIG?.BASE_URL,
  remoteUrl = API_CONFIG?.REMOTE_URL,
  pollIntervalMs = POLL_INTERVAL_MS,
  timeoutMs = POLL_TIMEOUT_MS,
} = {}) {
  let cancelled = false;

  const promise = (async () => {
    // 1. Claim a nonce. This is what ties the browser's answer to this app,
    //    and it is created by the backend so the client cannot pick a weak one.
    const { data } = await http.post(`${baseUrl}/auth/desktop/begin`);
    const nonce = data?.nonce;
    if (!nonce) throw new Error('Could not start a sign-in on this machine.');

    // 2. Where the API should send the browser when it is done. This is THIS
    //    backend's own address — the app is the only thing that can be reached
    //    at it, which is the entire point of a loopback redirect.
    const redirectUrl = `${baseUrl}/auth/desktop/handoff/${nonce}`;

    const authUrl =
      `${remoteUrl}/users/auth/google` + `?redirectUrl=${encodeURIComponent(redirectUrl)}`;

    // 3. The user's real browser, not a window we built.
    win.electron.openExternalUrl(authUrl);

    // 4. Wait for the answer to come back through the loopback endpoint.
    const deadline = Date.now() + timeoutMs;

    while (!cancelled && Date.now() < deadline) {
      await sleep(pollIntervalMs);
      if (cancelled) break;

      // 204 = not yet, 200 = here it is, 404 = expired or already taken.
      // Anything else is a transport problem and is retried rather than
      // treated as a failed sign-in: a single dropped poll should not throw
      // away a sign-in the user has already completed in their browser.
      let response;
      try {
        response = await http.get(`${baseUrl}/auth/desktop/handoff/${nonce}/claim`, {
          validateStatus: (status) => status === 200 || status === 204 || status === 404,
        });
      } catch {
        continue;
      }

      if (response.status === 200 && response.data?.token) return response.data.token;

      if (response.status === 404) {
        throw new Error('This sign-in expired before it finished. Please try again.');
      }
    }

    if (cancelled) throw new Error('Sign-in cancelled.');
    throw new Error('Timed out waiting for the browser to finish signing in.');
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
    },
  };
}
