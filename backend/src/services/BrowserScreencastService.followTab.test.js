/**
 * The live view shows the tab the AGENT is in, and survives that tab closing.
 *
 * Before: the viewer attached to "the first page target" and never moved, so
 * an agent that opened or switched tabs worked in one tab while the user
 * watched another (often about:blank), and a closed tab froze the view with no
 * signal at all. Real WebSocket CDP server, as in BrowserScreencastService.test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketServer } from 'ws';

const broadcastToUser = vi.fn();
vi.mock('../utils/realtimeSync.js', () => ({ broadcastToUser: (...a) => broadcastToUser(...a) }));

const { startViewing, isStreaming, _stopAll } = await import('./BrowserScreencastService.js');
const { setActiveTarget, _resetActiveTargets } = await import('./browserActiveTarget.js');

/** A browser whose tab list can change; each tab gets its own session id. */
async function fakeBrowser(initialPages) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => server.once('listening', resolve));
  const state = { pages: initialPages, received: [], live: null };
  server.on('connection', (socket) => {
    state.live = socket;
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      state.received.push(message);
      let result = {};
      if (message.method === 'Target.getTargets') result = { targetInfos: state.pages };
      else if (message.method === 'Target.attachToTarget') result = { sessionId: `S-${message.params.targetId}` };
      else if (message.method === 'Target.getTargetInfo') {
        result = { targetInfo: state.pages.find((p) => p.targetId === message.params.targetId) || {} };
      }
      if (message.id !== undefined) socket.send(JSON.stringify({ id: message.id, result }));
    });
  });
  return {
    state,
    url: () => `ws://127.0.0.1:${server.address().port}/devtools/browser/x`,
    emit: (payload) => state.live?.send(JSON.stringify(payload)),
    sent: (method) => state.received.filter((m) => m.method === method),
    close: async () => { try { state.live?.terminate(); } catch { /* never connected */ } await new Promise((r) => server.close(r)); },
  };
}

const settle = () => new Promise((r) => { setTimeout(r, 80); });
const frameEvents = () => broadcastToUser.mock.calls.filter((c) => c[1] === 'browser:frame').map((c) => c[2]);

let browser;
beforeEach(async () => {
  broadcastToUser.mockClear();
  _resetActiveTargets();
  browser = await fakeBrowser([
    { targetId: 'T1', type: 'page', url: 'about:blank' },
    { targetId: 'T2', type: 'page', url: 'https://agnt.gg/' },
  ]);
});
afterEach(async () => { _stopAll(); await browser.close(); });

describe('which tab is streamed', () => {
  it('starts on the tab the agent is working in, not the first tab', async () => {
    setActiveTarget(browser.url(), 'T2');
    await startViewing({ userId: 'u1', instanceId: 'host:u1', cdpUrl: browser.url() });
    expect(browser.sent('Target.attachToTarget')[0].params.targetId).toBe('T2');
  });

  it('follows the agent to another tab, keeping the same stream', async () => {
    const { streamId } = await startViewing({ userId: 'u1', instanceId: 'host:u1', cdpUrl: browser.url() });
    expect(browser.sent('Target.attachToTarget')[0].params.targetId).toBe('T1');

    setActiveTarget(browser.url(), 'T2');
    await settle();

    expect(browser.sent('Target.attachToTarget').map((m) => m.params.targetId)).toEqual(['T1', 'T2']);
    expect(browser.sent('Page.startScreencast').map((m) => m.sessionId)).toEqual(['S-T1', 'S-T2']);
    expect(browser.sent('Page.stopScreencast').some((m) => m.sessionId === 'S-T1')).toBe(true);
    expect(browser.sent('Target.detachFromTarget')[0].params.sessionId).toBe('S-T1');
    const navigated = broadcastToUser.mock.calls.find((c) => c[1] === 'browser:navigated');
    expect(navigated[2]).toMatchObject({ instanceId: 'host:u1', streamId, url: 'https://agnt.gg/' });

    // Only the new tab's pixels reach the viewer.
    browser.emit({ method: 'Page.screencastFrame', sessionId: 'S-T1', params: { data: 'OLD', sessionId: 1 } });
    browser.emit({ method: 'Page.screencastFrame', sessionId: 'S-T2', params: { data: 'NEW', sessionId: 2 } });
    await settle();
    expect(frameEvents().map((f) => f.data)).toEqual(['NEW']);
    expect(frameEvents()[0].streamId).toBe(streamId);
  });
});

describe('the streamed tab goes away', () => {
  it('moves to a remaining tab instead of freezing', async () => {
    await startViewing({ userId: 'u1', instanceId: 'host:u1', cdpUrl: browser.url() });
    browser.state.pages = [{ targetId: 'T2', type: 'page', url: 'https://agnt.gg/' }];
    browser.emit({ method: 'Target.detachedFromTarget', params: { sessionId: 'S-T1', targetId: 'T1' } });
    await settle();

    expect(isStreaming('host:u1')).toBe(true);
    expect(browser.sent('Page.startScreencast').at(-1).sessionId).toBe('S-T2');
    expect(broadcastToUser.mock.calls.some((c) => c[1] === 'browser:stopped')).toBe(false);
  });

  it('tells the viewer the stream stopped when no tab is left', async () => {
    await startViewing({ userId: 'u1', instanceId: 'host:u1', cdpUrl: browser.url() });
    browser.state.pages = [];
    browser.emit({ method: 'Target.detachedFromTarget', params: { sessionId: 'S-T1', targetId: 'T1' } });
    await settle();

    expect(isStreaming('host:u1')).toBe(false);
    expect(broadcastToUser.mock.calls.some((c) => c[1] === 'browser:stopped' && c[2].instanceId === 'host:u1')).toBe(true);
  });
});
