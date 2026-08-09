/**
 * CONTRACT for the CDP bridge that lets browser-use drive AGNT's own browser.
 *
 * The method list under test is not invented. A logging proxy was placed between
 * a real browser-use agent and a real Chromium for a complete task (spike,
 * 2026-08-09); the agent used 21 distinct CDP methods, of which exactly seven
 * were browser-level and therefore cannot be served by Electron's page-scoped
 * `webContents.debugger`. Those seven are what this bridge emulates, and this
 * file asserts each of them behaves the way the measured client expects.
 *
 * Everything else must be forwarded VERBATIM. That is the property that keeps
 * this bridge honest: it is not allowed to develop opinions about page
 * semantics, because the moment it does, pages behave differently inside AGNT
 * than they do in a real browser and nobody can explain why.
 *
 * A real socket is used rather than calling the dispatcher directly — the bridge
 * exists to serve a network client, and token rejection in particular is
 * invisible if you never open a connection.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { CdpBridge } from './CdpBridge.js';

/** Minimal stand-in for an Electron WebContents + its debugger. */
function fakeWebContents() {
  const listeners = new Map();
  const pageEvents = new Map();
  return {
    sent: [],
    focused: 0,
    url: 'https://example.com/',
    title: 'Example Domain',
    getURL() { return this.url; },
    getTitle() { return this.title; },
    getUserAgent: () => 'AGNT-Test-UA',
    focus() { this.focused += 1; },
    on(event, handler) { pageEvents.set(event, handler); },
    /** Simulate the surface navigating, as Electron reports it. */
    navigateTo(url, title) {
      this.url = url;
      if (title) this.title = title;
      pageEvents.get('did-navigate')?.();
    },
    debugger: {
      attached: false,
      attach() { this.attached = true; },
      detach() { this.attached = false; },
      on(event, handler) { listeners.set(event, handler); },
      sendCommand: null, // assigned per test
      /** Simulate the page pushing a CDP event upward. */
      emitMessage(method, params, sessionId) {
        const handler = listeners.get('message');
        if (handler) handler({}, method, params, sessionId);
      },
    },
  };
}

let webContents;
let bridge;
let socket;

/** Send a CDP command and resolve with the reply carrying the matching id. */
function call(id, method, params, sessionId) {
  return new Promise((resolve) => {
    const onMessage = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id === id) {
        socket.off('message', onMessage);
        resolve(msg);
      }
    };
    socket.on('message', onMessage);
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

/** Resolve with the next pushed EVENT (a frame with no id) matching `method`. */
function nextEvent(method) {
  return new Promise((resolve) => {
    const onMessage = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id === undefined && msg.method === method) {
        socket.off('message', onMessage);
        resolve(msg);
      }
    };
    socket.on('message', onMessage);
  });
}

const connect = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  ws.once('open', () => resolve(ws));
  ws.once('error', reject);
  ws.once('close', (code) => reject(new Error(`closed ${code}`)));
});

beforeEach(async () => {
  webContents = fakeWebContents();
  webContents.debugger.sendCommand = async (method, params) => {
    webContents.sent.push({ method, params });
    return { echoed: method };
  };
  bridge = new CdpBridge(webContents);
  await bridge.start();
  socket = await connect(bridge.cdpUrl);
});

afterEach(() => {
  try { socket.close(); } catch { /* already closed */ }
  bridge.close();
});

describe('the bridge is a credential-gated door to ONE surface', () => {
  it('binds to loopback on an ephemeral port', () => {
    expect(bridge.cdpUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+$/);
    // Never a fixed port: two widgets would collide, and a predictable port is
    // a predictable thing for another local process to probe.
    expect(bridge.port).toBeGreaterThan(0);
  });

  it('refuses a connection without the token, before a WebSocket exists', async () => {
    // Rejected at the HTTP upgrade with a 401 — not opened-then-closed. A
    // caller with no credential must never hold a live socket, however briefly.
    await expect(connect(`ws://127.0.0.1:${bridge.port}/wrong-token`)).rejects.toThrow(/401/);
  });

  it('attaches the debugger exactly once', async () => {
    expect(webContents.debugger.attached).toBe(true);
    await bridge.start(); // idempotent
    expect(webContents.debugger.attached).toBe(true);
  });
});

describe('the seven measured browser-level methods', () => {
  it('Target.getTargets reports the one surface the user is looking at', async () => {
    const reply = await call(1, 'Target.getTargets');
    expect(reply.result.targetInfos).toHaveLength(1);
    expect(reply.result.targetInfos[0]).toMatchObject({
      targetId: bridge.targetId,
      type: 'page',
      url: 'https://example.com/',
      title: 'Example Domain',
      attached: true,
    });
  });

  it('Target.attachToTarget hands back a session id', async () => {
    const reply = await call(2, 'Target.attachToTarget', { targetId: bridge.targetId, flatten: true });
    expect(reply.result.sessionId).toBe(bridge.sessionId);
  });

  it('Target.attachToTarget rejects a target that is not ours', async () => {
    const reply = await call(3, 'Target.attachToTarget', { targetId: 'SOMEONE-ELSES-TARGET' });
    expect(reply.error.message).toMatch(/No such target/);
  });

  it('Target.setAutoAttach announces the target that already exists', async () => {
    // The measured client calls this six times and then waits. Our single target
    // predates the connection, so without an immediate announcement it waits
    // forever for a "creation" that will never happen.
    const announced = nextEvent('Target.attachedToTarget');
    const reply = await call(4, 'Target.setAutoAttach', { autoAttach: true, flatten: true, waitForDebuggerOnStart: false });
    expect(reply.result).toEqual({});

    const event = await announced;
    expect(event.params.sessionId).toBe(bridge.sessionId);
    expect(event.params.waitingForDebugger).toBe(false);
    expect(event.params.targetInfo.targetId).toBe(bridge.targetId);
  });

  it('Target.setDiscoverTargets emits targetCreated when discovery is on', async () => {
    const created = nextEvent('Target.targetCreated');
    await call(5, 'Target.setDiscoverTargets', { discover: true });
    expect((await created).params.targetInfo.targetId).toBe(bridge.targetId);
  });

  it('Browser.grantPermissions and setDownloadBehavior are accepted as no-ops', async () => {
    // Truthful: the Electron session already governs both for this surface, so
    // the caller's intent is satisfied — just not by the caller.
    expect((await call(6, 'Browser.grantPermissions', { permissions: ['geolocation'] })).result).toEqual({});
    expect((await call(7, 'Browser.setDownloadBehavior', { behavior: 'deny' })).result).toEqual({});
  });

  it('Page.enable at browser level reaches the page', async () => {
    const reply = await call(8, 'Page.enable', {});
    expect(reply.result).toEqual({});
    expect(webContents.sent.map((s) => s.method)).toContain('Page.enable');
  });
});

describe('the client is told when the page moves', () => {
  // REGRESSION. Real Chromium pushes Target.targetInfoChanged on every URL or
  // title change, and browser-use tracks the current page from those events
  // rather than by polling. The first build announced the target ONCE, at
  // attach time, while it was still about:blank — measured on a live Electron
  // run, the agent drove the real window to the correct article and then spent
  // eight steps reasoning about a blank page it was no longer on.
  it('emits targetInfoChanged when the surface navigates', async () => {
    await call(30, 'Target.attachToTarget', { targetId: bridge.targetId });

    const changed = nextEvent('Target.targetInfoChanged');
    webContents.navigateTo('https://en.wikipedia.org/wiki/Model_Context_Protocol', 'Model Context Protocol');

    const event = await changed;
    expect(event.params.targetInfo.url).toBe('https://en.wikipedia.org/wiki/Model_Context_Protocol');
    expect(event.params.targetInfo.title).toBe('Model Context Protocol');
  });

  it('answers Target.getTargetInfo with the CURRENT page, never a cached one', async () => {
    webContents.navigateTo('https://news.ycombinator.com/', 'Hacker News');
    const reply = await call(31, 'Target.getTargetInfo', {});
    expect(reply.result.targetInfo.url).toBe('https://news.ycombinator.com/');
  });
});

describe('everything else is forwarded verbatim', () => {
  it('passes session-scoped commands straight through, unaltered', async () => {
    const params = { nodeId: 42, depth: -1 };
    const reply = await call(10, 'DOM.describeNode', params, bridge.sessionId);

    // DOM.describeNode was 146 of the 207 measured calls. If the bridge ever
    // started interpreting these, pages would behave differently inside AGNT.
    expect(webContents.sent.at(-1)).toEqual({ method: 'DOM.describeNode', params });
    expect(reply.result).toEqual({ echoed: 'DOM.describeNode' });
    expect(reply.sessionId).toBe(bridge.sessionId);
  });

  it('surfaces a page error as a CDP error rather than swallowing it', async () => {
    webContents.debugger.sendCommand = async () => { throw new Error('Node with given id does not exist'); };
    const reply = await call(11, 'DOM.getDocument', {}, bridge.sessionId);
    expect(reply.error.message).toMatch(/Node with given id/);
  });

  it('rejects a session id it never issued', async () => {
    const reply = await call(12, 'Runtime.evaluate', {}, 'FORGED-SESSION');
    expect(reply.error.message).toMatch(/Unknown sessionId/);
  });

  it('relabels page events with the session the client attached to', async () => {
    const lifecycle = nextEvent('Page.lifecycleEvent');
    webContents.debugger.emitMessage('Page.lifecycleEvent', { name: 'load' }, null);
    expect((await lifecycle).sessionId).toBe(bridge.sessionId);
  });
});

describe('a guest may not damage its host', () => {
  it('refuses to create a second target', async () => {
    // A second target would be a page with nowhere to render. Refusing by name
    // beats handing back an id that maps to nothing the user can see.
    const reply = await call(20, 'Target.createTarget', { url: 'https://example.com' });
    expect(reply.error.message).toMatch(/single tab/);
  });

  it('acknowledges closeTarget without closing anything', async () => {
    const reply = await call(21, 'Target.closeTarget', { targetId: bridge.targetId });
    expect(reply.result.success).toBe(true);
    // The widget owns the surface lifecycle. If this actually closed the
    // webview, an agent finishing its run would delete the user's browser.
    expect(webContents.sent.find((s) => /close/i.test(s.method))).toBeUndefined();
  });

  it('names an unsupported method instead of silently acking it', async () => {
    const reply = await call(22, 'Emulation.setDeviceMetricsOverride', {});
    expect(reply.error.code).toBe(-32601);
    expect(reply.error.message).toMatch(/Emulation.setDeviceMetricsOverride/);
  });

  it('detaches the debugger on close but leaves the page alone', () => {
    bridge.close();
    expect(webContents.debugger.attached).toBe(false);
    expect(webContents.sent.find((s) => /close|navigate/i.test(s.method))).toBeUndefined();
  });

  it('tolerates being closed twice', () => {
    bridge.close();
    expect(() => bridge.close()).not.toThrow();
  });
});
