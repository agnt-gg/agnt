/**
 * LIVE gate for the sign-in window, against a REAL Chromium and a real
 * (temporary) profile. Opt-in, because it opens a visible window on the
 * desktop for a few seconds: AGNT_LIVE_SIGNIN_WINDOW=1 npx vitest run <this file>
 *
 * It proves the claim the whole feature rests on, without Google: a cookie a
 * site sets in the PLAIN window (no debug port, no automation) is still there
 * when the HIDDEN automation browser is relaunched on the same profile — so a
 * person signing in once leaves the agent signed in.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import {
  ensureFallbackSurface, closeFallbackSurfaceGracefully, installedBrowsers,
  openSignInWindow, closeSignInWindow, isSignInWindowOpen,
} from './browserFallbackSurface.js';
import { performBrowserAction, _resetDrivers } from '../../../services/browserActDriver.js';

const enabled = process.env.AGNT_LIVE_SIGNIN_WINDOW === '1' && installedBrowsers().length > 0;
const quiet = { log: () => {} };

let server;
let base;
const seen = [];

beforeAll(async () => {
  if (!enabled) return;
  server = http.createServer((req, res) => {
    seen.push({ path: req.url, cookie: req.headers.cookie || '' });
    if (req.url === '/signin') {
      // A persistent session cookie, the way a site's login sets one.
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'agnt_session=signed-in-in-the-window; Max-Age=3600; Path=/; HttpOnly' });
      return res.end('<!doctype html><title>Signed in</title><h1>Signed in</h1>');
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!doctype html><title>Account</title><h1>Account</h1>');
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
}, 30000);

afterAll(async () => {
  if (!enabled) return;
  await closeSignInWindow(quiet);
  _resetDrivers();
  await closeFallbackSurfaceGracefully();
  await new Promise((r) => { server.close(r); });
}, 30000);

const until = async (check, ms) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 100); });
  }
  return false;
};

describe.skipIf(!enabled)('the sign-in window, in a real browser', () => {
  it('a cookie set in the plain window is read by the hidden browser relaunched on the same profile', async () => {
    // The automation browser is running, as it is when a sign-in starts.
    const before = await ensureFallbackSurface({ ...quiet, hidden: true });

    await openSignInWindow({ ...quiet, url: `${base}/signin` });
    expect(isSignInWindowOpen()).toBe(true);
    // While it is open, nothing may launch the automation browser on top of it.
    await expect(ensureFallbackSurface({ ...quiet, hidden: true })).rejects.toThrow(/sign-in window/);
    expect(await until(() => seen.some((r) => r.path === '/signin'), 20000)).toBe(true);

    // The person is done: the window closes politely and releases the profile.
    await closeSignInWindow(quiet);
    expect(isSignInWindowOpen()).toBe(false);

    const after = await ensureFallbackSurface({ ...quiet, hidden: true });
    expect(after).not.toBe(before);
    const page = await performBrowserAction('live-user', after, 'navigate', { url: `${base}/account` });
    expect(page.title).toBe('Account');
    const accountVisit = seen.filter((r) => r.path === '/account').at(-1);
    expect(accountVisit.cookie).toContain('agnt_session=signed-in-in-the-window');
  }, 90000);
});
