/**
 * CONTRACT for the live-browser-surface registry.
 *
 * This is the join between a browser the renderer is showing and an agent run
 * that happens in the backend. Two properties matter and neither is obvious:
 *
 *   - only a LOOPBACK bridge may be registered, or this becomes a way to point
 *     the agent at an arbitrary CDP endpoint somewhere on the network;
 *   - a surface must be findable within a second or two of appearing, because
 *     calling the tool ALSO opens the window it is looking for.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import {
  registerSurface,
  unregisterSurface,
  getActiveSurface,
  getLiveSurface,
  forgetSurfaceByUrl,
  probeBridge,
  waitForSurface,
  isLocalBridgeUrl,
  _resetSurfaces,
} from './browserSurfaces.js';

const CDP = 'ws://127.0.0.1:51234/tok3n-value';

/** Liveness is asserted separately; identity tests say so out loud. */
const alive = () => true;
const dead = () => false;

beforeEach(() => _resetSurfaces());

describe('only local bridges may be registered', () => {
  it('accepts the shape CdpBridge mints', () => {
    expect(isLocalBridgeUrl(CDP)).toBe(true);
    expect(registerSurface('u1', 'w_1', { cdpUrl: CDP })).toBe(true);
  });

  it('refuses anything that is not loopback', () => {
    for (const bad of [
      'ws://10.0.0.5:9222/token',
      'ws://evil.example.com/token',
      'wss://127.0.0.1:9222/token',
      'http://127.0.0.1:9222/token',
      '',
      null,
    ]) {
      expect(isLocalBridgeUrl(bad), `${bad} should be refused`).toBe(false);
      expect(registerSurface('u1', 'w_1', { cdpUrl: bad })).toBe(false);
    }
    expect(getActiveSurface('u1')).toBeNull();
  });

  it('requires both a user and an instance', () => {
    expect(registerSurface(null, 'w_1', { cdpUrl: CDP })).toBe(false);
    expect(registerSurface('u1', null, { cdpUrl: CDP })).toBe(false);
  });
});

describe('finding the browser a chat turn means', () => {
  it('returns nothing when no window is open', () => {
    expect(getActiveSurface('u1')).toBeNull();
  });

  it('keeps users apart', () => {
    registerSurface('u1', 'w_1', { cdpUrl: CDP });
    expect(getActiveSurface('u2')).toBeNull();
    expect(getActiveSurface('u1').instanceId).toBe('w_1');
  });

  it('resolves an exact instance inside its owning workspace', () => {
    registerSurface('u1', 'w_a', { workspaceId: 'ws_a', cdpUrl: 'ws://127.0.0.1:1111/aaa' });
    registerSurface('u1', 'w_b', { workspaceId: 'ws_b', cdpUrl: 'ws://127.0.0.1:2222/bbb' });

    expect(getActiveSurface('u1', { workspaceId: 'ws_a', instanceId: 'w_a' }).cdpUrl)
      .toContain(':1111/');
    // An instance id may not be smuggled across a workspace boundary.
    expect(getActiveSurface('u1', { workspaceId: 'ws_a', instanceId: 'w_b' })).toBeNull();
  });

  it('never falls through from a workspace to another workspace', () => {
    registerSurface('u1', 'w_b', { workspaceId: 'ws_b', cdpUrl: CDP });
    expect(getActiveSurface('u1', { workspaceId: 'ws_a' })).toBeNull();
    expect(getActiveSurface('u1', { workspaceId: 'ws_a', instanceId: 'missing' })).toBeNull();
  });

  it('picks the newest window only inside the selected workspace', async () => {
    registerSurface('u1', 'w_1', { workspaceId: 'ws_a', cdpUrl: 'ws://127.0.0.1:1111/aaa' });
    await new Promise((r) => setTimeout(r, 5));
    registerSurface('u1', 'w_2', { workspaceId: 'ws_a', cdpUrl: 'ws://127.0.0.1:2222/bbb' });
    registerSurface('u1', 'w_other', { workspaceId: 'ws_b', cdpUrl: 'ws://127.0.0.1:3333/ccc' });
    expect(getActiveSurface('u1', { workspaceId: 'ws_a' }).instanceId).toBe('w_2');

    // Navigating in the first window re-announces it, which is the honest
    // signal for "the one the user is actually working in".
    await new Promise((r) => setTimeout(r, 5));
    registerSurface('u1', 'w_1', { workspaceId: 'ws_a', cdpUrl: 'ws://127.0.0.1:1111/aaa', url: 'https://example.com' });
    expect(getActiveSurface('u1', { workspaceId: 'ws_a' }).instanceId).toBe('w_1');
    expect(getActiveSurface('u1', { workspaceId: 'ws_a' }).url).toBe('https://example.com');
  });

  it('forgets a window that closed', () => {
    registerSurface('u1', 'w_1', { cdpUrl: CDP });
    expect(unregisterSurface('u1', 'w_1')).toBe(true);
    expect(getActiveSurface('u1')).toBeNull();
    expect(unregisterSurface('u1', 'w_1')).toBe(false);
  });
});

describe('waiting for a window that is still opening', () => {
  it('returns immediately when one is already there', async () => {
    registerSurface('u1', 'w_1', { cdpUrl: CDP });
    expect((await waitForSurface('u1', {}, 500, 10, alive)).instanceId).toBe('w_1');
  });

  it('waits for a window that appears a moment later', async () => {
    // The real race: calling ai_browser_use auto-opens the Browser widget, so
    // the tool starts looking before the window has finished mounting.
    setTimeout(() => registerSurface('u1', 'w_late', { cdpUrl: CDP }), 60);
    const surface = await waitForSurface('u1', {}, 1000, 10, alive);
    expect(surface.instanceId).toBe('w_late');
  });

  it('gives up rather than hanging when no window ever appears', async () => {
    const started = Date.now();
    expect(await waitForSurface('u1', {}, 80, 10, alive)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

/**
 * THE BUG THIS SECTION EXISTS FOR.
 *
 * A registry entry and its bridge are two records of one fact, kept by two
 * processes. The bridge dies with its webContents — a reload, a crash, a quit —
 * and none of those run the widget's unmount hook, so the entry survives its
 * browser. The next chat turn was handed that endpoint and got
 * "[WinError 1225] The remote computer refused the network connection", eight
 * layers from the cause, with zero steps taken.
 *
 * A dead ws:// URL looks exactly like a live one, so the fix cannot be a
 * smarter inspection. It has to be a connection.
 */
describe('a surface is only offered if it answers', () => {
  let server = null;
  let liveUrl = '';

  beforeEach(async () => {
    const token = 'live-token';
    server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise((resolve) => server.once('listening', resolve));
    liveUrl = `ws://127.0.0.1:${server.address().port}/${token}`;
  });

  afterEach(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null;
  });

  it('probes a real socket: true while it listens, false once it stops', async () => {
    expect(await probeBridge(liveUrl, 1000)).toBe(true);

    await new Promise((resolve) => server.close(resolve));
    server = null;
    // This is the exact condition behind WinError 1225 / ECONNREFUSED.
    expect(await probeBridge(liveUrl, 1000)).toBe(false);
  });

  it('returns a surface whose bridge is really listening', async () => {
    registerSurface('u1', 'w_1', { workspaceId: 'ws_a', cdpUrl: liveUrl });
    const surface = await getLiveSurface('u1', { workspaceId: 'ws_a' });
    expect(surface?.cdpUrl).toBe(liveUrl);
  });

  it('refuses to hand out a browser that is gone, and forgets it', async () => {
    registerSurface('u1', 'w_1', { workspaceId: 'ws_a', cdpUrl: liveUrl });
    await new Promise((resolve) => server.close(resolve));
    server = null;

    expect(await getLiveSurface('u1', { workspaceId: 'ws_a' })).toBeNull();
    // Pruning is half the fix: updatedAt never moves for a corpse, but it stays
    // the newest thing in the map, so an unpruned entry keeps winning forever.
    expect(getActiveSurface('u1', { workspaceId: 'ws_a' })).toBeNull();
  });

  it('falls past a dead window to a live one', async () => {
    registerSurface('u1', 'w_live', { workspaceId: 'ws_a', cdpUrl: liveUrl });
    await new Promise((r) => setTimeout(r, 5));
    // Newer, but nothing is listening on it — the shape of a widget that was
    // torn down without its unmount hook running.
    registerSurface('u1', 'w_dead', { workspaceId: 'ws_a', cdpUrl: CDP });

    expect(getActiveSurface('u1', { workspaceId: 'ws_a' }).instanceId).toBe('w_dead');
    expect((await getLiveSurface('u1', { workspaceId: 'ws_a' })).instanceId).toBe('w_live');
  });

  it('will not silently drive a different window than the turn named', async () => {
    registerSurface('u1', 'w_named', { workspaceId: 'ws_a', cdpUrl: CDP });
    registerSurface('u1', 'w_other', { workspaceId: 'ws_a', cdpUrl: liveUrl });

    // The chat captured w_named. It is dead, and the honest answer is "no" —
    // driving w_other would work on a window the user was not looking at.
    expect(await getLiveSurface('u1', { workspaceId: 'ws_a', instanceId: 'w_named' })).toBeNull();
  });

  it('keeps waiting while a window is still opening', async () => {
    setTimeout(() => registerSurface('u1', 'w_late', { workspaceId: 'ws_a', cdpUrl: liveUrl }), 50);
    const surface = await waitForSurface('u1', { workspaceId: 'ws_a' }, 2000, 25);
    expect(surface.instanceId).toBe('w_late');
  });

  it('walks candidates in preference order, not all at once', async () => {
    registerSurface('u1', 'w_1', { workspaceId: 'ws_a', cdpUrl: 'ws://127.0.0.1:1111/aaa' });
    await new Promise((r) => setTimeout(r, 5));
    registerSurface('u1', 'w_2', { workspaceId: 'ws_a', cdpUrl: 'ws://127.0.0.1:2222/bbb' });

    const probed = [];
    const probe = (url) => { probed.push(url); return Promise.resolve(false); };
    expect(await getLiveSurface('u1', { workspaceId: 'ws_a' }, probe)).toBeNull();
    expect(probed).toEqual(['ws://127.0.0.1:2222/bbb', 'ws://127.0.0.1:1111/aaa']);
  });
});

describe('forgetting a surface by its endpoint', () => {
  it('drops the entry holding that URL', () => {
    registerSurface('u1', 'w_1', { workspaceId: 'ws_a', cdpUrl: CDP });
    expect(forgetSurfaceByUrl('u1', CDP)).toBe(true);
    expect(getActiveSurface('u1')).toBeNull();
  });

  it('is a no-op for a URL nobody registered', () => {
    registerSurface('u1', 'w_1', { workspaceId: 'ws_a', cdpUrl: CDP });
    expect(forgetSurfaceByUrl('u1', 'ws://127.0.0.1:9/nope')).toBe(false);
    expect(getActiveSurface('u1').instanceId).toBe('w_1');
  });

  it('proves `dead` is a probe that can actually fail', async () => {
    // Negative control: without this, a probe helper that silently returned
    // true would make every liveness test above pass for the wrong reason.
    registerSurface('u1', 'w_1', { workspaceId: 'ws_a', cdpUrl: CDP });
    expect(await getLiveSurface('u1', { workspaceId: 'ws_a' }, dead)).toBeNull();
  });
});
