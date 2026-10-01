/**
 * CONTRACT for POST /api/browser-agent/view with a conversation id.
 *
 * A conversation's live card used to be handed "the account's newest browser",
 * so it streamed whatever any other conversation's agent was doing. With a
 * conversation id the card watches what THAT conversation drove and nothing
 * else — never a fallthrough to someone else's surface.
 *
 * Real HTTP, a real WebSocket speaking CDP, a browser that really opens tabs.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';

vi.mock('./Middleware.js', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = { id: req.headers['x-test-user'] || 'u1', isAuthenticated: true };
    next();
  },
}));

const ensureFallbackSurface = vi.fn();
vi.mock('../tools/library/browserEngines/browserFallbackSurface.js', () => ({
  ensureFallbackSurface: (...a) => ensureFallbackSurface(...a),
  START_PAGE: 'data:text/html,ready',
}));
vi.mock('../utils/realtimeSync.js', () => ({ broadcastToUser: vi.fn() }));

const { default: BrowserAgentRoutes } = await import('./BrowserAgentRoutes.js');
const { registerSurface, getActiveSurface, _resetSurfaces } = await import('../services/browserSurfaces.js');
const { _stopAll } = await import('../services/BrowserScreencastService.js');
const { _resetLanes, bindConversation, ensureLane } = await import('../services/browserLanes.js');
const { _resetActiveTargets } = await import('../services/browserActiveTarget.js');

async function fakeBrowser() {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => wss.once('listening', resolve));
  const pages = [{ type: 'page', targetId: 'START', url: 'about:blank' }];
  const attached = [];
  let next = 1;
  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      const reply = (result) => socket.send(JSON.stringify({ id: m.id, result }));
      if (m.method === 'Target.getTargets') reply({ targetInfos: pages.map((p) => ({ ...p })) });
      else if (m.method === 'Target.createTarget') {
        const targetId = `T${next++}`;
        pages.push({ type: 'page', targetId, url: m.params.url });
        reply({ targetId });
      } else if (m.method === 'Target.attachToTarget') {
        attached.push(m.params.targetId);
        reply({ sessionId: `S-${m.params.targetId}` });
      } else if (m.id !== undefined) reply({});
    });
  });
  return {
    url: `ws://127.0.0.1:${wss.address().port}/devtools/browser/live`,
    attached,
    pages,
    close: async () => {
      for (const c of wss.clients) { try { c.terminate(); } catch { /* gone */ } }
      await new Promise((resolve) => wss.close(resolve));
    },
  };
}

let server;
let base;
let browser;

const view = (body = {}, user = 'u1') => fetch(`${base}/api/browser-agent/view`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-test-user': user },
  body: JSON.stringify({ protocolVersion: 2, ...body }),
});

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/browser-agent', BrowserAgentRoutes);
  await new Promise((resolve) => { server = http.createServer(app).listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(async () => {
  browser = await fakeBrowser();
  ensureFallbackSurface.mockReset().mockResolvedValue(browser.url);
});
afterEach(async () => {
  _stopAll();
  _resetLanes();
  _resetSurfaces();
  _resetActiveTargets();
  await browser.close();
});

describe('a conversation\'s card watches only that conversation', () => {
  it('opens and streams the conversation\'s OWN tab', async () => {
    const response = await view({ conversationId: 'c1' });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.instanceId).toBe('host:u1:conv:c1');
    expect(browser.attached.at(-1)).toBe('T1');
  });

  it('THE REGRESSION: never falls through to another browser that happens to be newest', async () => {
    // The shared default browser exists and is live; a different conversation
    // was using it. This conversation's card must not show it.
    registerSurface('u1', 'host:u1', { cdpUrl: browser.url, transport: 'host-cdp' });
    const response = await view({ conversationId: 'c2', launch: false });
    expect(response.status).toBe(404);
  });

  it('two conversations stream two different tabs', async () => {
    const one = await (await view({ conversationId: 'c1' })).json();
    const two = await (await view({ conversationId: 'c2' })).json();
    expect(one.instanceId).not.toBe(two.instanceId);
    expect(browser.attached.slice(-2)).toEqual(['T1', 'T2']);
  });

  it('follows the browser the conversation actually used (a script or run on the shared one)', async () => {
    registerSurface('u1', 'host:u1', { cdpUrl: browser.url, transport: 'host-cdp' });
    bindConversation('u1', 'conv:c1', 'host:u1');
    const body = await (await view({ conversationId: 'c1' })).json();
    expect(body.instanceId).toBe('host:u1');
  });

  it('joins the tab the agent already opened rather than opening another', async () => {
    await ensureLane('u1', 'conv:c1', { cdpUrl: browser.url });
    const body = await (await view({ conversationId: 'c1' })).json();
    expect(body.instanceId).toBe('host:u1:conv:c1');
    expect(browser.pages.filter((p) => p.targetId.startsWith('T'))).toHaveLength(1);
  });

  it('another user\'s conversation with the same id is a different lane', async () => {
    await view({ conversationId: 'c1' }, 'u1');
    const theirs = await (await view({ conversationId: 'c1' }, 'u2')).json();
    expect(theirs.instanceId).toBe('host:u2:conv:c1');
  });

  it('a temp- id or no id keeps the old behaviour', async () => {
    const body = await (await view({ conversationId: 'temp-99' })).json();
    expect(body.instanceId).toBe('host:u1');
  });
});

describe('reserved ids', () => {
  it('a widget cannot announce itself as a backend browser', async () => {
    const response = await fetch(`${base}/api/browser-agent/surface`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: 'host:u1:conv:c1', cdpUrl: 'ws://127.0.0.1:5555/tok' }),
    });
    expect(response.status).toBe(400);
    expect(getActiveSurface('u1', { instanceId: 'host:u1:conv:c1' })).toBeNull();
  });
});
