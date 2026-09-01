/**
 * CONTRACT for POST /api/browser-agent/view.
 *
 * ONE PROPERTY DOMINATES THIS FILE: a viewer is handed a browser that ANSWERS,
 * never one the registry merely remembers.
 *
 * The registry is in memory and is updated by a widget that cannot promise to
 * run its own teardown — a reload, a crash, or a webContents rebuild all leave
 * an entry pointing at a socket nobody is listening on. browserSurfaces.js says
 * so in its header and gives the rule: "resolution does not inspect: it
 * CONNECTS."
 *
 * This route did inspect. It called getActiveSurface, got a corpse, dialled it,
 * and returned `ECONNREFUSED 127.0.0.1:<port>` to the user — every single time,
 * forever, because nothing on the path ever pruned the dead entry. The agent
 * hit the same corpse but probes, so it silently launched a browser and carried
 * on working while the viewer stared at an error.
 *
 * Tested against a REAL WebSocket server speaking CDP and a REAL dead port,
 * because that failure is entirely about what happens on the wire.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';

/** Authentication is not what this file is about. */
vi.mock('./Middleware.js', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = { id: 'u1', isAuthenticated: true };
    next();
  },
}));

/** The launcher is the one collaborator we do not want really running. */
const ensureFallbackSurface = vi.fn();
const closeFallbackSurface = vi.fn();
vi.mock('../tools/library/actions/browserFallbackSurface.js', () => ({
  ensureFallbackSurface: (...a) => ensureFallbackSurface(...a),
  closeFallbackSurface: (...a) => closeFallbackSurface(...a),
  default: (...a) => ensureFallbackSurface(...a),
}));

vi.mock('../utils/realtimeSync.js', () => ({ broadcastToUser: vi.fn() }));

const { default: BrowserAgentRoutes } = await import('./BrowserAgentRoutes.js');
const {
  registerSurface, getActiveSurface, _resetSurfaces,
} = await import('../services/browserSurfaces.js');
const { _stopAll } = await import('../services/BrowserScreencastService.js');

/** A port that refuses instantly — the shape of a bridge whose owner is gone. */
const DEAD_CDP = 'ws://127.0.0.1:1/devtools/browser/dead';

let server;
let base;

/** A browser that answers, so "live" means live on the wire. */
async function fakeBrowser() {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => wss.once('listening', resolve));
  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.method === 'Target.getTargets') {
        socket.send(JSON.stringify({ id: m.id, result: { targetInfos: [{ targetId: 'T1', type: 'page' }] } }));
      } else if (m.method === 'Target.attachToTarget') {
        socket.send(JSON.stringify({ id: m.id, result: { sessionId: 'S1' } }));
      } else if (m.id !== undefined) {
        socket.send(JSON.stringify({ id: m.id, result: {} }));
      }
    });
  });
  return {
    url: `ws://127.0.0.1:${wss.address().port}/devtools/browser/live`,
    /**
     * `wss.close(cb)` only stops the server ACCEPTING — it waits for existing
     * connections to end and never calls back while the screencast service is
     * still attached, which deadlocks the test rather than the code under test.
     * Terminating the clients first is also the honest model of a browser
     * exiting, which is the event this stands in for.
     */
    close: async () => {
      for (const client of wss.clients) {
        try { client.terminate(); } catch { /* already gone */ }
      }
      await new Promise((resolve) => wss.close(resolve));
    },
  };
}

const view = (body = {}) => fetch(`${base}/api/browser-agent/view`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/browser-agent', BrowserAgentRoutes);
  await new Promise((resolve) => { server = http.createServer(app).listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  _resetSurfaces();
  ensureFallbackSurface.mockReset();
  closeFallbackSurface.mockReset();
});

afterEach(() => _stopAll());

describe('a dead surface is never handed to a viewer', () => {
  it('THE REGRESSION: does not report ECONNREFUSED for a browser that is gone', async () => {
    registerSurface('u1', 'host:u1', { cdpUrl: DEAD_CDP, transport: 'host-cdp' });

    const response = await view({ launch: false });
    const body = await response.json();

    // What the user actually saw:
    //   "Could not start watching that browser: connect ECONNREFUSED 127.0.0.1:54831"
    // A port number is not something anyone can act on, and the browser it names
    // no longer exists.
    expect(body.error || '').not.toMatch(/ECONNREFUSED/);
    expect(response.status).toBe(404);
  });

  it('FORGETS it, so the next attempt is not the same failure again', async () => {
    registerSurface('u1', 'host:u1', { cdpUrl: DEAD_CDP, transport: 'host-cdp' });
    await view({ launch: false });

    // Without pruning, the corpse stays newest-updated and wins the "most
    // recent surface" contest for the life of the process — which is precisely
    // why the failure repeated identically instead of clearing.
    expect(getActiveSurface('u1')).toBeNull();
  });

  it('recovers on its own once a live browser appears', async () => {
    registerSurface('u1', 'host:u1', { cdpUrl: DEAD_CDP, transport: 'host-cdp' });
    expect((await view({ launch: false })).status).toBe(404);

    const browser = await fakeBrowser();
    registerSurface('u1', 'host:u1', { cdpUrl: browser.url, transport: 'host-cdp' });

    const response = await view({ launch: false });
    expect(response.status).toBe(200);
    expect((await response.json()).instanceId).toBe('host:u1');
    await browser.close();
  });

  it('walks past a dead surface to a live one in the same request', async () => {
    const browser = await fakeBrowser();
    registerSurface('u1', 'w_dead', { cdpUrl: DEAD_CDP, transport: 'host-cdp' });
    registerSurface('u1', 'w_live', { cdpUrl: browser.url, transport: 'host-cdp' });

    const response = await view({ launch: false });
    expect(response.status).toBe(200);
    expect((await response.json()).instanceId).toBe('w_live');
    await browser.close();
  });
});

describe('a host browser that cannot stream is discarded, not re-adopted', () => {
  it('drops the launcher session when attach fails against a zombie', async () => {
    // A browser can be alive enough to pass a liveness probe and still unable
    // to stream — measured: a crashed-profile headless launch whose renderer
    // hung; attach succeeded, every page command timed out. Without discarding
    // the session, the launcher re-adopts that zombie on the next poll and the
    // failure repeats identically forever.
    const zombie = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise((resolve) => { zombie.once('listening', resolve); });
    // Accepts connections, answers NOTHING — the shape of a hung renderer.
    const url = `ws://127.0.0.1:${zombie.address().port}/devtools/browser/zombie`;
    registerSurface('u1', 'host:u1', { cdpUrl: url, transport: 'host-cdp' });

    const response = await view({ launch: false });

    expect(response.status).toBe(404);
    expect((await response.json()).reason).toBe('stale');
    expect(closeFallbackSurface).toHaveBeenCalledTimes(1);

    for (const client of zombie.clients) { try { client.terminate(); } catch { /* gone */ } }
    await new Promise((resolve) => { zombie.close(resolve); });
  }, 15000);
});

describe('opening a browser when there is nothing to watch', () => {
  it('launches one, so the widget shows a browser instead of spinning', async () => {
    const browser = await fakeBrowser();
    ensureFallbackSurface.mockResolvedValue(browser.url);

    const response = await view({ workspaceId: 'ws_1' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.transport).toBe('host-cdp');
    expect(ensureFallbackSurface).toHaveBeenCalledTimes(1);

    // HIDDEN, because the caller is about to watch it through the screencast.
    // The stream is the window; a visible launch put a second, redundant Chrome
    // window on the host desktop — the first thing reported after shipping.
    expect(ensureFallbackSurface.mock.calls[0][0].hidden).toBe(true);
    await browser.close();
  });

  it('does NOT launch when a live surface already exists', async () => {
    const browser = await fakeBrowser();
    registerSurface('u1', 'w_live', { cdpUrl: browser.url, transport: 'host-cdp' });

    expect((await view()).status).toBe(200);
    // Launching here would open a second browser next to the one the user is
    // already looking at.
    expect(ensureFallbackSurface).not.toHaveBeenCalled();
    await browser.close();
  });

  it('honours launch:false, for a caller that only wants to know', async () => {
    const response = await view({ launch: false });
    expect(response.status).toBe(404);
    expect(ensureFallbackSurface).not.toHaveBeenCalled();
  });

  it('says so plainly when no browser can be opened at all', async () => {
    ensureFallbackSurface.mockRejectedValue(new Error('no Chrome, Chromium or Edge could be found'));

    const response = await view();
    const body = await response.json();

    // 503, not 404: "there is nothing to watch" and "this machine has no
    // browser" are different problems, and only one of them is worth waiting
    // out. A widget that polls forever on the second one never tells the user
    // what is wrong.
    expect(response.status).toBe(503);
    expect(body.error).toMatch(/no Chrome, Chromium or Edge/);
  });
});
