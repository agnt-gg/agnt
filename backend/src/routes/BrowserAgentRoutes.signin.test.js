/**
 * CONTRACT for the sign-in card's routes: GET /signin, POST /signin/done|cancel|window.
 *
 * A real sign-in wait (services/browserSignIn.js) runs with scripted page ops,
 * and the card's answers arrive over real HTTP — so these prove the whole
 * path from a button press to the agent's tool call returning.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'http';

vi.mock('./Middleware.js', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = { id: req.headers['x-test-user'] || 'u1', isAuthenticated: true };
    next();
  },
}));
vi.mock('../tools/library/browserEngines/browserFallbackSurface.js', () => ({
  ensureFallbackSurface: vi.fn(),
  START_PAGE: 'data:text/html,ready',
}));
vi.mock('../utils/realtimeSync.js', () => ({ broadcastToUser: vi.fn() }));

const { default: BrowserAgentRoutes } = await import('./BrowserAgentRoutes.js');
const { runSignIn, _resetSignIns } = await import('../services/browserSignIn.js');

const CONVERSATION = 'conv-123';
const WALL = { kind: 'sign-in', provider: 'app.example.com', host: 'app.example.com' };

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

afterAll(async () => {
  await new Promise((resolve) => { server.close(resolve); });
});

afterEach(() => _resetSignIns());

const get = (query, user = 'u1') => fetch(`${base}/signin?${new URLSearchParams(query)}`, { headers: { 'x-test-user': user } }).then((r) => r.json());
const post = (route, body, user = 'u1') => fetch(`${base}/signin/${route}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': user }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

/** A sign-in on a page that stays a login wall until somebody answers. */
function waitingSignIn(extraOps = {}) {
  let windowOpen = false;
  const ops = {
    canUseWindow: true,
    inspect: async () => ({ url: 'https://app.example.com/login', login: WALL }),
    finish: async () => ({ url: 'https://app.example.com/home' }),
    openWindow: async () => { windowOpen = true; },
    windowOpen: () => windowOpen,
    windowClosed: () => new Promise(() => {}),
    closeWindow: async () => { windowOpen = false; },
    restore: async (url) => ({ url }),
    ...extraOps,
  };
  const run = runSignIn({
    userId: 'u1', scope: `conv:${CONVERSATION}`, url: 'https://app.example.com/login', initialLogin: WALL, pollMs: 5, ops,
  });
  return { run, isWindowOpen: () => windowOpen };
}

const until = async (check) => {
  for (let i = 0; i < 100; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const value = await check();
    if (value) return value;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 10); });
  }
  throw new Error('condition never held');
};

describe('sign-in card routes', () => {
  it('GET reports nothing when nothing is waiting', async () => {
    expect(await get({ conversationId: CONVERSATION })).toEqual({ success: true, signIn: null });
  });

  it('GET shows the waiting sign-in to its own user only', async () => {
    const { run } = waitingSignIn();
    const mine = await until(async () => (await get({ conversationId: CONVERSATION })).signIn);
    expect(mine).toMatchObject({ status: 'waiting', mode: 'here', host: 'app.example.com' });
    expect((await get({ conversationId: CONVERSATION }, 'u2')).signIn).toBeNull();
    expect((await get({ conversationId: 'some-other-conversation' })).signIn).toBeNull();
    await post('cancel', { conversationId: CONVERSATION, id: mine.id });
    await run;
  });

  it('Done ends the wait and the tool call returns signed in', async () => {
    // The page stays a login wall until Done: a page that cleared by itself would end the wait on
    // its own (outcome 'auto') and make Done a race. finish() reports the signed-in page.
    const { run } = waitingSignIn();
    const { id } = await until(async () => (await get({ conversationId: CONVERSATION })).signIn);
    const answer = await post('done', { conversationId: CONVERSATION, id });
    expect(answer.status).toBe(200);
    expect(await run).toMatchObject({ outcome: 'signed-in', signedIn: true });
  });

  it('Cancel ends the wait as cancelled', async () => {
    const { run } = waitingSignIn();
    const { id } = await until(async () => (await get({ conversationId: CONVERSATION })).signIn);
    expect((await post('cancel', { conversationId: CONVERSATION, id })).status).toBe(200);
    expect(await run).toMatchObject({ outcome: 'cancelled' });
  });

  it('Use a window switches the sign-in to the plain window', async () => {
    const { run, isWindowOpen } = waitingSignIn();
    const { id } = await until(async () => (await get({ conversationId: CONVERSATION })).signIn);
    expect((await post('window', { conversationId: CONVERSATION, id })).status).toBe(200);
    const switched = await until(async () => {
      const state = (await get({ conversationId: CONVERSATION })).signIn;
      return state?.mode === 'window' ? state : null;
    });
    expect(switched.status).toBe('window');
    expect(isWindowOpen()).toBe(true);
    await post('cancel', { conversationId: CONVERSATION, id });
    await run;
    expect(isWindowOpen()).toBe(false);
  });

  it('refuses an answer without an id, with a stale id, or from another user', async () => {
    const { run } = waitingSignIn();
    const { id } = await until(async () => (await get({ conversationId: CONVERSATION })).signIn);
    expect((await post('done', { conversationId: CONVERSATION })).status).toBe(400);
    expect((await post('done', { conversationId: CONVERSATION, id: 'stale' })).status).toBe(409);
    expect((await post('done', { conversationId: CONVERSATION, id }, 'u2')).status).toBe(409);
    expect((await get({ conversationId: CONVERSATION })).signIn).toMatchObject({ id, status: 'waiting' });
    await post('cancel', { conversationId: CONVERSATION, id });
    await run;
  });
});
