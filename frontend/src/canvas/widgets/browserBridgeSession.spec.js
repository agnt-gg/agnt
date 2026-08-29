/**
 * CONTRACT: the bridge lives as long as the SURFACE, not as long as the widget.
 *
 * Regression test for a bug that shipped and was hit in normal use. The widget
 * opened its bridge from a one-shot `dom-ready` listener, which assumed the
 * guest webContents inside the <webview> lasts exactly as long as the Vue
 * component. It does not: a renderer crash, an out-of-memory reap or a
 * re-parent during a canvas re-layout all destroy and rebuild it, and main.js
 * closes the bridge on `destroyed` so a debugger is never left on a corpse.
 *
 * After the first rebuild there was therefore no bridge and nothing that could
 * open one. The widget kept announcing the dead ws:// URL on its heartbeat, the
 * backend probed it, pruned it, and every later turn was told "there is no
 * Browser widget open" — while the widget sat on screen showing a page.
 *
 * Symptom, exactly: several successful navigations, then permanent failure.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBridgeSession } from './browserBridgeSession.js';

let guestId;
let started;
let bridgeApi;
let announce;
let status;

/** A main-process stand-in with the real idempotent-start semantics. */
function makeBridgeApi() {
  const live = new Map();
  return {
    start: vi.fn(async (id) => {
      started.push(id);
      if (live.has(id)) return { ok: true, cdpUrl: live.get(id), reused: true };
      const url = `ws://127.0.0.1:${5000 + id}/tok${id}`;
      live.set(id, url);
      return { ok: true, cdpUrl: url, reused: false };
    }),
    stop: vi.fn((id) => live.delete(id)),
    /** What main.js does on `destroyed`: the bridge goes with the guest. */
    killBridgeFor: (id) => live.delete(id),
  };
}

function makeSession() {
  return createBridgeSession({
    bridgeApi,
    getWebContentsId: () => guestId,
    announce,
    onStatus: (m) => { status.push(m); },
  });
}

beforeEach(() => {
  guestId = 1;
  started = [];
  bridgeApi = makeBridgeApi();
  announce = vi.fn();
  status = [];
});

describe('the guest can be rebuilt underneath the widget', () => {
  it('OPENS A NEW BRIDGE when the webContents id changes', async () => {
    // THE BUG. With `{ once: true }` this second refresh never happened, so the
    // widget was left holding an endpoint whose server had already closed.
    const session = makeSession();
    await session.refresh();
    const first = session.cdpUrl;

    // The guest crashes and Electron rebuilds it with a new id; main.js closes
    // the old bridge on 'destroyed'.
    bridgeApi.killBridgeFor(1);
    guestId = 2;

    await session.refresh();

    expect(session.cdpUrl).not.toBe(first);
    expect(session.webContentsId).toBe(2);
    expect(started).toEqual([1, 2]);
    // And the backend is told about the NEW endpoint, not the dead one.
    expect(announce).toHaveBeenLastCalledWith(session.cdpUrl);
  });

  it('NEVER announces the dead URL after the guest is replaced', async () => {
    const session = makeSession();
    await session.refresh();
    const dead = session.cdpUrl;
    const before = announce.mock.calls.length; // announcing it WHILE alive was right

    bridgeApi.killBridgeFor(1);
    guestId = 2;
    await session.refresh();
    await session.refresh();

    // Announcing a closed socket is what poisoned the registry: the backend
    // probes it, prunes it, and then reports that no widget is open at all.
    const after = announce.mock.calls.slice(before).map(([url]) => url);
    expect(after.length).toBeGreaterThan(0);
    expect(after).not.toContain(dead);
  });

  it('re-asserts on every refresh, repairing a bridge lost for any other reason', async () => {
    // The session must not need to know WHY the bridge went away. Re-asserting
    // unconditionally is what makes it robust against causes not yet met.
    const session = makeSession();
    await session.refresh();

    bridgeApi.killBridgeFor(1); // same id, bridge gone
    await session.refresh();

    expect(started).toEqual([1, 1]);
    expect(session.cdpUrl).toBeTruthy();
    expect(announce).toHaveBeenCalledTimes(2);
  });

  it('survives a guest that is mid-rebuild', async () => {
    const session = createBridgeSession({
      bridgeApi,
      getWebContentsId: () => { throw new Error('The WebView must be attached'); },
      announce,
      onStatus: (m) => { status.push(m); },
    });

    await expect(session.refresh()).resolves.toBeNull();
    expect(announce).not.toHaveBeenCalled();
    // Not an error state: dom-ready or the next heartbeat will find it.
    expect(status).toEqual([]);
  });

  it('treats a null id as nothing to do', async () => {
    guestId = null;
    const session = makeSession();

    await expect(session.refresh()).resolves.toBeNull();
    expect(bridgeApi.start).not.toHaveBeenCalled();
  });
});

describe('overlapping refreshes', () => {
  it('shares one attempt, so two starts never race to attach a debugger', async () => {
    // dom-ready and the heartbeat routinely land together.
    const session = makeSession();

    const [a, b, c] = await Promise.all([session.refresh(), session.refresh(), session.refresh()]);

    expect(bridgeApi.start).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('allows a later refresh once the first has settled', async () => {
    const session = makeSession();
    await session.refresh();
    await session.refresh();
    expect(bridgeApi.start).toHaveBeenCalledTimes(2);
  });
});

describe('failure is reported, not hidden', () => {
  it('surfaces the reason and announces nothing', async () => {
    bridgeApi.start = vi.fn(async () => ({ ok: false, error: 'That browser surface no longer exists.' }));
    const session = makeSession();

    await expect(session.refresh()).resolves.toBeNull();

    expect(status).toContain('That browser surface no longer exists.');
    expect(announce).not.toHaveBeenCalled();
    expect(session.cdpUrl).toBeNull();
  });

  it('FORGETS a previously-good URL when a later start fails', async () => {
    // Same class as the bug this file exists for: holding an endpoint that is
    // no longer real. A stale cdpUrl here would be handed straight back to the
    // announcer the moment anything read it, re-poisoning the registry.
    const session = makeSession();
    await session.refresh();
    expect(session.cdpUrl).toBeTruthy();

    bridgeApi.start = vi.fn(async () => ({ ok: false, error: 'That browser surface no longer exists.' }));
    await session.refresh();

    expect(session.cdpUrl).toBeNull();
  });

  it('clears the message once the bridge comes back', async () => {
    let fail = true;
    bridgeApi.start = vi.fn(async (id) => (fail
      ? { ok: false, error: 'boom' }
      : { ok: true, cdpUrl: `ws://127.0.0.1:9/tok${id}` }));
    const session = makeSession();

    await session.refresh();
    fail = false;
    await session.refresh();

    // A stale error pane over a working browser is its own bug.
    expect(status[status.length - 1]).toBe('');
    expect(session.cdpUrl).toBeTruthy();
  });
});

describe('teardown', () => {
  it('releases the current bridge and forgets it', async () => {
    const session = makeSession();
    await session.refresh();

    session.stop();

    expect(bridgeApi.stop).toHaveBeenCalledWith(1);
    expect(session.cdpUrl).toBeNull();
    expect(session.webContentsId).toBeNull();
  });

  it('is safe before a bridge was ever opened', () => {
    const session = makeSession();
    expect(() => session.stop()).not.toThrow();
    expect(bridgeApi.stop).not.toHaveBeenCalled();
  });

  it('does not throw when the window is already gone', async () => {
    const session = makeSession();
    await session.refresh();
    bridgeApi.stop = vi.fn(() => { throw new Error('window destroyed'); });

    expect(() => session.stop()).not.toThrow();
  });
});
