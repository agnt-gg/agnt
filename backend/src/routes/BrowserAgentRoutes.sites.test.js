/**
 * CONTRACT for Settings › Browser: GET /sites, POST /sites/forget,
 * POST /signin/start and GET /signin?scope=settings.
 *
 * Real HTTP; the real sign-in wait and window flow (browserSignIn +
 * browserSignInWindow); the browser process and its cookies replaced.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'http';

vi.mock('./Middleware.js', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = { id: req.headers['x-test-user'] || 'u1', isAuthenticated: true };
    next();
  },
}));

const browser = vi.hoisted(() => ({ windowOpen: false, closeNow: () => {}, opened: [], launched: 0 }));
vi.mock('../tools/library/browserEngines/browserFallbackSurface.js', () => ({
  START_PAGE: 'data:text/html,ready',
  ensureFallbackSurface: vi.fn(async () => { browser.launched += 1; return 'ws://127.0.0.1:1/devtools/browser/x'; }),
  isSignInWindowOpen: () => browser.windowOpen,
  openSignInWindow: vi.fn(async ({ url }) => { browser.opened.push(url); browser.windowOpen = true; }),
  closeSignInWindow: vi.fn(async () => { browser.windowOpen = false; browser.closeNow(); }),
  signInWindowClosed: () => new Promise((resolve) => { browser.closeNow = resolve; }),
}));
vi.mock('../utils/realtimeSync.js', () => ({ broadcastToUser: vi.fn() }));

const SITES = [{ site: 'example.test', cookies: 2, session: false, expires: '2027-01-01T00:00:00.000Z' }];
const readSites = vi.fn(async () => SITES);
const forgetSite = vi.fn(async () => ({ removed: 2, remaining: 0 }));
vi.mock('../services/browserSites.js', () => ({
  readSites: (...a) => readSites(...a),
  forgetSite: (...a) => forgetSite(...a),
}));

const { default: BrowserAgentRoutes } = await import('./BrowserAgentRoutes.js');
const { _resetSignIns } = await import('../services/browserSignIn.js');
const { _resetSettingsSignIns } = await import('../services/browserSignInWindow.js');

let server;
let base;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/browser-agent', BrowserAgentRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/browser-agent`;
});
afterAll(async () => { await new Promise((resolve) => { server.close(resolve); }); });

beforeEach(() => {
  browser.windowOpen = false;
  browser.opened = [];
  browser.launched = 0;
  readSites.mockClear();
  forgetSite.mockClear();
});
afterEach(() => { _resetSignIns(); _resetSettingsSignIns(); });

const call = (method, route, body, user = 'u1') => fetch(`${base}${route}`, {
  method,
  headers: { 'content-type': 'application/json', 'x-test-user': user },
  ...(body ? { body: JSON.stringify(body) } : {}),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

const until = async (check) => {
  for (let i = 0; i < 200; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const value = await check();
    if (value) return value;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 10); });
  }
  throw new Error('condition never held');
};

describe('signed-in sites', () => {
  it('lists them from the AGNT browser', async () => {
    const { status, body } = await call('GET', '/sites');
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, signingIn: false, sites: SITES });
    expect(readSites).toHaveBeenCalledWith('ws://127.0.0.1:1/devtools/browser/x');
  });

  it('reads nothing while a sign-in window holds the profile', async () => {
    browser.windowOpen = true;
    expect((await call('GET', '/sites')).body).toEqual({ success: true, signingIn: true, sites: [] });
    expect(readSites).not.toHaveBeenCalled();
    expect(browser.launched).toBe(0);
  });

  it('signs out of one site and returns the fresh list', async () => {
    const { status, body } = await call('POST', '/sites/forget', { site: 'Example.test ' });
    expect(status).toBe(200);
    expect(forgetSite).toHaveBeenCalledWith('ws://127.0.0.1:1/devtools/browser/x', 'example.test');
    expect(body).toMatchObject({ success: true, removed: 2, remaining: 0, sites: SITES });
  });

  it('refuses a missing or malformed site, and refuses while a window is open', async () => {
    expect((await call('POST', '/sites/forget', {})).status).toBe(400);
    expect((await call('POST', '/sites/forget', { site: 'a b/../c' })).status).toBe(400);
    browser.windowOpen = true;
    expect((await call('POST', '/sites/forget', { site: 'example.test' })).status).toBe(409);
    expect(forgetSite).not.toHaveBeenCalled();
  });

  it('a sign-out that leaves cookies behind is not reported as success', async () => {
    forgetSite.mockResolvedValueOnce({ removed: 1, remaining: 1 });
    expect((await call('POST', '/sites/forget', { site: 'example.test' })).body).toMatchObject({ success: false, remaining: 1 });
  });
});

describe('"Sign in to a site…" from Settings', () => {
  it('opens the window at the site, reports it waiting, and finishes when the person closes it', async () => {
    const started = await call('POST', '/signin/start', { url: 'https://accounts.google.com/' });
    expect(started.status).toBe(200);
    await until(() => browser.windowOpen);
    expect(browser.opened).toEqual(['https://accounts.google.com/']);

    const waiting = await call('GET', '/signin?scope=settings');
    expect(waiting.body.signIn).toMatchObject({ mode: 'window', status: 'window', host: 'accounts.google.com' });
    // Nobody else sees it, and it is not any conversation's.
    expect((await call('GET', '/signin?scope=settings', null, 'u2')).body.signIn).toBeNull();
    expect((await call('GET', '/signin?conversationId=c1')).body.signIn).toBeNull();

    // The person closes the window.
    browser.windowOpen = false;
    browser.closeNow();
    const done = await until(async () => {
      const state = (await call('GET', '/signin?scope=settings')).body;
      return state.signIn === null && state.last ? state : null;
    });
    // Nothing to check but the site list itself: never claimed as "signed in".
    expect(done.last).toMatchObject({ outcome: 'finished', host: 'accounts.google.com' });
    expect(browser.launched).toBe(1); // the automation browser came back
  });

  it('Done from the page closes the window', async () => {
    await call('POST', '/signin/start', { url: 'https://github.com/login' });
    const { id } = await until(async () => (await call('GET', '/signin?scope=settings')).body.signIn?.status === 'window'
      && (await call('GET', '/signin?scope=settings')).body.signIn);
    expect((await call('POST', '/signin/done', { scope: 'settings', id })).status).toBe(200);
    await until(async () => (await call('GET', '/signin?scope=settings')).body.last);
    expect(browser.windowOpen).toBe(false);
  });

  it('refuses a non-web address, and a second window while one is open', async () => {
    expect((await call('POST', '/signin/start', { url: 'file:///C:/x' })).status).toBe(400);
    expect((await call('POST', '/signin/start', {})).status).toBe(400);
    await call('POST', '/signin/start', { url: 'https://example.com/login' });
    const second = await call('POST', '/signin/start', { url: 'https://example.org/login' });
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/already open/);
  });
});
