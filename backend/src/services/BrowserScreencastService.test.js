/**
 * CONTRACT for streaming a browser to a client that cannot embed one.
 *
 * Tested against a REAL WebSocket server speaking CDP, not a mocked client.
 * The properties that matter here are all protocol-shaped — does it attach to a
 * page, does it ack the frame it was sent, does it refuse a method that is not
 * an input — and a hand-written mock of the transport would let every one of
 * them pass while the wire format was wrong.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketServer } from 'ws';

const broadcastToUser = vi.fn();
vi.mock('../utils/realtimeSync.js', () => ({
  broadcastToUser: (...a) => broadcastToUser(...a),
}));

const {
  startViewing, stopViewing, dispatchInput, acknowledgeFrame, isStreaming, streamsForUser,
  getBrowserState, controlBrowser, _stopAll,
} = await import('./BrowserScreencastService.js');

/**
 * A fake browser: answers the two target methods, records everything else.
 *
 * ASYNC because `server.address()` is null until the 'listening' event — a
 * port-0 server has not been ASSIGNED a port before then, and reading it early
 * fails every test with a TypeError that says nothing about the real code.
 */
async function fakeBrowser({
  pages = [{ targetId: 'T1', type: 'page' }],
  history = {
    currentIndex: 1,
    entries: [
      { id: 10, url: 'https://agnt.gg/', title: 'AGNT' },
      { id: 11, url: 'https://x.com/', title: 'X' },
      { id: 12, url: 'https://github.com/', title: 'GitHub' },
    ],
  },
} = {}) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => server.once('listening', resolve));
  const received = [];
  let live = null;

  server.on('connection', (socket) => {
    live = socket;
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      received.push(message);

      if (message.method === 'Target.getTargets') {
        socket.send(JSON.stringify({ id: message.id, result: { targetInfos: pages } }));
      } else if (message.method === 'Target.attachToTarget') {
        socket.send(JSON.stringify({ id: message.id, result: { sessionId: 'S1' } }));
      } else if (message.method === 'Page.getNavigationHistory') {
        socket.send(JSON.stringify({ id: message.id, result: history }));
      } else if (message.id !== undefined) {
        socket.send(JSON.stringify({ id: message.id, result: {} }));
      }
    });
  });

  return {
    url: () => `ws://127.0.0.1:${server.address().port}/devtools/browser/abc`,
    received,
    /** Push an event as a real browser would. */
    emit: (payload) => live?.send(JSON.stringify(payload)),
    methods: () => received.map((m) => m.method),
    /**
     * Kill the connection, the way a browser exiting does.
     *
     * `server.close()` alone only stops it ACCEPTING — established sockets stay
     * open, so the service never sees a close and the test waits for something
     * that cannot happen. Terminating the live socket is what actually models
     * a browser going away.
     */
    close: async () => {
      try { live?.terminate(); } catch { /* never connected */ }
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

const settle = () => new Promise((r) => { setTimeout(r, 60); });

let browser;

beforeEach(async () => {
  broadcastToUser.mockClear();
  browser = await fakeBrowser();
});

afterEach(async () => {
  _stopAll();
  await browser.close();
});

describe('starting a stream', () => {
  it('attaches to the page and turns the screencast on', async () => {
    const result = await startViewing({ userId: 'u1', instanceId: 'host:u1', cdpUrl: browser.url() });

    expect(result.ok).toBe(true);
    expect(result.joined).toBe(false);
    expect(isStreaming('host:u1')).toBe(true);
    expect(browser.methods()).toEqual([
      'Target.getTargets', 'Target.attachToTarget', 'Page.enable', 'Page.startScreencast',
    ]);

    // Every page-scoped command must carry the session id, or it is sent to the
    // BROWSER and silently does nothing to the page.
    const enable = browser.received.find((m) => m.method === 'Page.enable');
    expect(enable.sessionId).toBe('S1');
  });

  it('refuses a browser with no page rather than streaming nothing', async () => {
    const empty = await fakeBrowser({ pages: [{ targetId: 'B', type: 'browser' }] });
    await expect(startViewing({ userId: 'u1', instanceId: 'x', cdpUrl: empty.url() }))
      .rejects.toThrow(/no page/i);
    expect(isStreaming('x')).toBe(false);
    await empty.close();
  });

  it('leaves no half-built session behind when attaching fails', async () => {
    await expect(startViewing({ userId: 'u1', instanceId: 'y', cdpUrl: 'ws://127.0.0.1:1/nope' }))
      .rejects.toThrow();
    expect(isStreaming('y')).toBe(false);
  });
});

describe('two viewers, one screencast', () => {
  it('joins an existing stream instead of starting a second', async () => {
    await startViewing({ userId: 'u1', instanceId: 'host:u1', cdpUrl: browser.url() });
    const second = await startViewing({ userId: 'u1', instanceId: 'host:u1', cdpUrl: browser.url() });

    expect(second.joined).toBe(true);
    expect(second.viewers).toBe(2);
    // A second startScreencast silently replaces the first's frame settings,
    // so the first viewer's stream would change size underneath them.
    expect(browser.methods().filter((m) => m === 'Page.startScreencast')).toHaveLength(1);
  });

  it('keeps streaming until the LAST viewer leaves', async () => {
    await startViewing({ userId: 'u1', instanceId: 'host:u1', cdpUrl: browser.url() });
    await startViewing({ userId: 'u1', instanceId: 'host:u1', cdpUrl: browser.url() });

    expect(stopViewing('host:u1').viewers).toBe(1);
    expect(isStreaming('host:u1')).toBe(true);

    expect(stopViewing('host:u1').viewers).toBe(0);
    expect(isStreaming('host:u1')).toBe(false);
  });

  it('will not let one user watch another user\'s browser', async () => {
    await startViewing({ userId: 'u1', instanceId: 'host:u1', cdpUrl: browser.url() });
    await expect(startViewing({ userId: 'u2', instanceId: 'host:u1', cdpUrl: browser.url() }))
      .rejects.toThrow(/belongs to someone else/i);
  });
});

describe('frames go to the right room, and are acked on render', () => {
  it('broadcasts a frame to its owner only', async () => {
    await startViewing({ userId: 'u1', instanceId: 'host:u1', cdpUrl: browser.url() });
    browser.emit({ method: 'Page.screencastFrame', params: { data: 'AAA', sessionId: 7, metadata: { deviceWidth: 800 } } });
    await settle();

    expect(broadcastToUser).toHaveBeenCalledWith('u1', 'browser:frame', expect.objectContaining({
      instanceId: 'host:u1', data: 'AAA', frameId: 7,
    }));
  });

  it('does NOT ack on arrival — the client acks after it paints', async () => {
    await startViewing({ userId: 'u1', instanceId: 'host:u1', cdpUrl: browser.url() });
    browser.emit({ method: 'Page.screencastFrame', params: { data: 'AAA', sessionId: 7 } });
    await settle();

    // Acking here would stream as fast as the encoder can go and bury a slow
    // client. The ack is the flow control, so it belongs to whoever paints.
    expect(browser.methods()).not.toContain('Page.screencastFrameAck');
  });

  it('acks when the client says it painted', async () => {
    await startViewing({ userId: 'u1', instanceId: 'host:u1', cdpUrl: browser.url() });
    browser.emit({ method: 'Page.screencastFrame', params: { data: 'AAA', sessionId: 7 } });
    await settle();

    expect(acknowledgeFrame('host:u1', 7)).toBe(true);
    await settle();

    const ack = browser.received.find((m) => m.method === 'Page.screencastFrameAck');
    expect(ack.params.sessionId).toBe(7);
    expect(ack.sessionId).toBe('S1');
  });

  it('announces a top-level navigation, and ignores subframes', async () => {
    await startViewing({ userId: 'u1', instanceId: 'host:u1', cdpUrl: browser.url() });

    browser.emit({ method: 'Page.frameNavigated', params: { frame: { url: 'https://example.com' } } });
    browser.emit({ method: 'Page.frameNavigated', params: { frame: { url: 'https://ads.example', parentId: 'F1' } } });
    await settle();

    const navigations = broadcastToUser.mock.calls.filter(([, event]) => event === 'browser:navigated');
    expect(navigations).toHaveLength(1);
    expect(navigations[0][2].url).toBe('https://example.com');
  });
});

describe('what a viewer is allowed to send back', () => {
  beforeEach(async () => {
    await startViewing({ userId: 'u1', instanceId: 'host:u1', cdpUrl: browser.url() });
  });

  it('forwards a click, with the page session attached', async () => {
    const result = dispatchInput({
      userId: 'u1',
      instanceId: 'host:u1',
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mousePressed', x: 10, y: 20 },
    });
    await settle();

    expect(result.ok).toBe(true);
    const click = browser.received.find((m) => m.method === 'Input.dispatchMouseEvent');
    expect(click.params.x).toBe(10);
    expect(click.sessionId).toBe('S1');
  });

  it('REFUSES anything that is not an allowlisted input', async () => {
    // `Input.` looks like a safe namespace and is not — dispatchDragEvent can
    // start a file drag. The allowlist is by exact method for that reason.
    for (const method of [
      'Input.dispatchDragEvent',
      'Page.navigate',
      'Runtime.evaluate',
      'Browser.close',
      'Target.createTarget',
    ]) {
      const result = dispatchInput({ userId: 'u1', instanceId: 'host:u1', method, params: {} });
      expect(result.ok, `${method} must be refused`).toBe(false);
    }
    await settle();
    expect(browser.methods()).not.toContain('Runtime.evaluate');
    expect(browser.methods()).not.toContain('Page.navigate');
  });

  it('refuses input from a user who does not own the browser', () => {
    const result = dispatchInput({
      userId: 'u2', instanceId: 'host:u1', method: 'Input.dispatchKeyEvent', params: {},
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/belongs to someone else/i);
  });

  it('refuses input to a surface that is not streaming', () => {
    const result = dispatchInput({
      userId: 'u1', instanceId: 'nope', method: 'Input.dispatchKeyEvent', params: {},
    });
    expect(result.ok).toBe(false);
  });
});

describe('ordinary browser chrome', () => {
  beforeEach(async () => {
    await startViewing({ userId: 'u1', instanceId: 'host:u1', cdpUrl: browser.url() });
  });

  it('reports the current address and honest back/forward availability', async () => {
    const state = await getBrowserState({ userId: 'u1', instanceId: 'host:u1' });

    expect(state).toEqual({
      ok: true,
      url: 'https://x.com/',
      title: 'X',
      canGoBack: true,
      canGoForward: true,
    });
  });

  it.each([
    ['back', 'Page.navigateToHistoryEntry', { entryId: 10 }],
    ['forward', 'Page.navigateToHistoryEntry', { entryId: 12 }],
    ['reload', 'Page.reload', { ignoreCache: false }],
    ['navigate', 'Page.navigate', { url: 'https://example.com/path' }],
  ])('executes %s against the page session', async (action, method, params) => {
    const result = await controlBrowser({
      userId: 'u1', instanceId: 'host:u1', action,
      ...(action === 'navigate' ? { url: params.url } : {}),
    });
    await settle();

    expect(result.ok).toBe(true);
    const command = browser.received.find((message) => message.method === method);
    expect(command.params).toEqual(params);
    expect(command.sessionId).toBe('S1');
  });

  it('refuses non-web schemes rather than navigating the browser to them', async () => {
    const result = await controlBrowser({
      userId: 'u1', instanceId: 'host:u1', action: 'navigate', url: 'file:///C:/Windows/win.ini',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HTTP and HTTPS/);
    expect(browser.methods()).not.toContain('Page.navigate');
  });

  it('refuses controls from someone who does not own the browser', async () => {
    const result = await controlBrowser({
      userId: 'u2', instanceId: 'host:u1', action: 'reload',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/belongs to someone else/i);
    expect(browser.methods()).not.toContain('Page.reload');
  });
});

describe('a browser that goes away', () => {
  it('drops the session when the connection closes', async () => {
    await startViewing({ userId: 'u1', instanceId: 'host:u1', cdpUrl: browser.url() });
    expect(streamsForUser('u1')).toHaveLength(1);

    await browser.close();
    await settle();

    // A session left behind would report itself as streaming forever, and the
    // widget would sit on a frozen last frame with no way to recover.
    expect(isStreaming('host:u1')).toBe(false);
    expect(streamsForUser('u1')).toHaveLength(0);
  });

  it('TELLS its viewers, so they recover instead of freezing on the last frame', async () => {
    await startViewing({ userId: 'u1', instanceId: 'host:u1', cdpUrl: browser.url() });
    await browser.close();
    await settle();

    // A canvas still showing the last frame is indistinguishable from a page
    // that stopped changing — everything LOOKS fine, which is the most
    // confusing way for this to fail.
    const stopped = broadcastToUser.mock.calls.filter(([, event]) => event === 'browser:stopped');
    expect(stopped).toHaveLength(1);
    expect(stopped[0][0]).toBe('u1');
    expect(stopped[0][2].instanceId).toBe('host:u1');
  });

  it('does NOT announce a stop the viewer asked for', async () => {
    await startViewing({ userId: 'u1', instanceId: 'host:u1', cdpUrl: browser.url() });
    stopViewing('host:u1');
    await settle();

    // Telling a viewer that leaving worked would send it straight back to
    // polling for the browser it just chose to stop watching.
    expect(broadcastToUser.mock.calls.filter(([, e]) => e === 'browser:stopped')).toHaveLength(0);
  });

  it('stopping something that was never started is not an error', () => {
    expect(stopViewing('never').ok).toBe(true);
  });
});
