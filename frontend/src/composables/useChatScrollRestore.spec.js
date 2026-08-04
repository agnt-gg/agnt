import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useChatScrollRestore, measureItems } from './useChatScrollRestore.js';
import { getScrollPosition, setScrollPosition } from '@/services/chatScrollPositions.js';

const KEY = 'chatScrollV1';

/**
 * A stand-in for the scrollable transcript.
 *
 * jsdom reports 0 for every layout property, so a real element proves nothing
 * about geometry. This stub is honest about the ONE contract the composable
 * relies on — that a child's getBoundingClientRect().top is expressed in
 * viewport coordinates and therefore moves as the container scrolls — which is
 * exactly the arithmetic measureItems() has to undo.
 */
function makeEl({ scrollTop = 0, scrollHeight = 2000, clientHeight = 400, items = [], growBy = 0, growFor = 0 } = {}) {
  const listeners = new Map();
  let growthLeft = growFor;

  const el = {
    scrollTop,
    clientHeight,
    get scrollHeight() {
      // Simulates content settling after mount (MathJax, images) by growing
      // the document on each read for the first `growFor` reads.
      if (growthLeft > 0) {
        growthLeft -= 1;
        scrollHeight += growBy;
      }
      return scrollHeight;
    },
    getBoundingClientRect: () => ({ top: 0, height: clientHeight }),
    querySelectorAll: () =>
      items.map((i) => ({
        getAttribute: () => i.id,
        getBoundingClientRect: () => ({ top: i.top - el.scrollTop, height: i.height }),
      })),
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) {
      listeners.get(name)?.delete(fn);
    },
    fire(name) {
      [...(listeners.get(name) || [])].forEach((fn) => fn());
    },
    listenerCount() {
      return [...listeners.values()].reduce((n, s) => n + s.size, 0);
    },
  };
  return el;
}

const ITEMS = [
  { id: 'm1', top: 0, height: 500 },
  { id: 'm2', top: 500, height: 500 },
  { id: 'm3', top: 1000, height: 500 },
];

const frames = (n = 4) =>
  new Promise((resolve) => {
    let left = n;
    const tick = () => (left-- <= 0 ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => localStorage.removeItem(KEY));
afterEach(() => {
  localStorage.removeItem(KEY);
  vi.restoreAllMocks();
});

describe('measureItems — viewport coordinates become content coordinates', () => {
  it('reports a message top relative to the transcript, not the viewport', () => {
    const el = makeEl({ scrollTop: 700, items: ITEMS });
    expect(measureItems(el)).toEqual([
      { id: 'm1', top: 0, height: 500 },
      { id: 'm2', top: 500, height: 500 },
      { id: 'm3', top: 1000, height: 500 },
    ]);
  });

  it('returns nothing for a missing or non-element target', () => {
    expect(measureItems(null)).toEqual([]);
    expect(measureItems({})).toEqual([]);
  });
});

describe('captureNow — what we agree to remember', () => {
  it('records bottom intent, not a pixel, when the user is at the bottom', () => {
    const el = makeEl({ scrollTop: 1600, scrollHeight: 2000, clientHeight: 400, items: ITEMS });
    const s = useChatScrollRestore({ getEl: () => el, getKey: () => 'c1' });
    s.captureNow();
    expect(getScrollPosition('c1')).toMatchObject({ atBottom: true, anchorId: null });
  });

  it('records the topmost visible message and how far into it we are', () => {
    const el = makeEl({ scrollTop: 600, scrollHeight: 2000, clientHeight: 400, items: ITEMS });
    const s = useChatScrollRestore({ getEl: () => el, getKey: () => 'c1' });
    s.captureNow();
    expect(getScrollPosition('c1')).toMatchObject({ atBottom: false, anchorId: 'm2', anchorOffset: 100 });
  });

  it('records the message-window size, without which the anchor cannot be mounted', () => {
    const el = makeEl({ scrollTop: 600, items: ITEMS });
    const s = useChatScrollRestore({ getEl: () => el, getKey: () => 'c1', getWindow: () => 130 });
    s.captureNow();
    expect(getScrollPosition('c1').window).toBe(130);
  });

  it('does nothing when the transcript cannot scroll', () => {
    const el = makeEl({ scrollTop: 0, scrollHeight: 300, clientHeight: 400, items: ITEMS });
    const s = useChatScrollRestore({ getEl: () => el, getKey: () => 'c1' });
    s.captureNow();
    expect(getScrollPosition('c1')).toBeNull();
  });

  it('does nothing without an element or a key', () => {
    const s1 = useChatScrollRestore({ getEl: () => null, getKey: () => 'c1' });
    expect(() => s1.captureNow()).not.toThrow();
    const el = makeEl({ scrollTop: 600, items: ITEMS });
    const s2 = useChatScrollRestore({ getEl: () => el, getKey: () => null });
    s2.captureNow();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe('captureNow — never overwrite a real position with an artefact', () => {
  it('refuses to save while a restore is settling', async () => {
    setScrollPosition('c1', { anchorId: 'm3', anchorOffset: 0, atBottom: false, window: null });
    const el = makeEl({ scrollTop: 0, scrollHeight: 2000, clientHeight: 400, items: ITEMS });
    const s = useChatScrollRestore({ getEl: () => el, getKey: () => 'c1' });

    const p = s.restore('c1');
    // Mid-settle the transcript is still growing and scrollTop is whatever the
    // loop has reached. Saving that would destroy the user's real position.
    s.captureNow('c1');
    expect(getScrollPosition('c1').anchorId).toBe('m3');
    await p;
    await frames(6);
  });

  it('a debounced capture is ignored while restoring', async () => {
    const el = makeEl({ scrollTop: 0, scrollHeight: 2000, clientHeight: 400, items: ITEMS });
    const s = useChatScrollRestore({ getEl: () => el, getKey: () => 'c1', debounceMs: 1 });
    const p = s.restore('c1');
    s.scheduleCapture();
    await sleep(20);
    expect(localStorage.getItem(KEY)).toBeNull();
    await p;
    await frames(6);
  });
});

describe('scheduleCapture — debounce', () => {
  it('coalesces a burst of scroll events into one write', async () => {
    const el = makeEl({ scrollTop: 600, scrollHeight: 2000, clientHeight: 400, items: ITEMS });
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    const s = useChatScrollRestore({ getEl: () => el, getKey: () => 'c1', debounceMs: 10 });
    for (let i = 0; i < 20; i++) s.scheduleCapture();
    await sleep(40);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('teardown cancels a pending write', async () => {
    const el = makeEl({ scrollTop: 600, items: ITEMS });
    const s = useChatScrollRestore({ getEl: () => el, getKey: () => 'c1', debounceMs: 10 });
    s.scheduleCapture();
    s.teardown();
    await sleep(40);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe('flushCapture — the outgoing conversation, not the incoming one', () => {
  it('saves under the EXPLICIT key even after the active conversation changed', () => {
    // This is the cross-contamination guard. On a switch the watcher fires
    // while getKey() already returns the NEW id, but the DOM under us is still
    // the OLD conversation's — so the position must be filed under the old id.
    const el = makeEl({ scrollTop: 600, scrollHeight: 2000, clientHeight: 400, items: ITEMS });
    const s = useChatScrollRestore({ getEl: () => el, getKey: () => 'incoming' });
    s.flushCapture('outgoing');
    expect(getScrollPosition('outgoing')).toMatchObject({ anchorId: 'm2' });
    expect(getScrollPosition('incoming')).toBeNull();
  });

  it('cancels the pending debounce so it cannot fire against the new transcript', async () => {
    const el = makeEl({ scrollTop: 600, scrollHeight: 2000, clientHeight: 400, items: ITEMS });
    const s = useChatScrollRestore({ getEl: () => el, getKey: () => 'incoming', debounceMs: 10 });
    s.scheduleCapture();
    s.flushCapture('outgoing');
    await sleep(40);
    expect(getScrollPosition('incoming')).toBeNull();
  });
});

describe('restore — landing on the right pixel', () => {
  it('with no saved position, lands at the bottom (never the top)', async () => {
    const el = makeEl({ scrollTop: 0, scrollHeight: 2000, clientHeight: 400, items: ITEMS });
    const s = useChatScrollRestore({ getEl: () => el, getKey: () => 'fresh' });
    await s.restore('fresh');
    await frames(6);
    expect(el.scrollTop).toBe(1600);
  });

  it('lands on the saved anchor', async () => {
    setScrollPosition('c1', { anchorId: 'm2', anchorOffset: 100, atBottom: false, window: null });
    const el = makeEl({ scrollTop: 0, scrollHeight: 2000, clientHeight: 400, items: ITEMS });
    const s = useChatScrollRestore({ getEl: () => el, getKey: () => 'c1' });
    await s.restore('c1');
    await frames(6);
    expect(el.scrollTop).toBe(600);
  });

  it('keeps correcting as late content grows the document under it', async () => {
    // The one-shot version of this lands correctly and then drifts. The anchor
    // moves down 300px as content above it settles; the loop must follow it.
    setScrollPosition('c1', { anchorId: 'm3', anchorOffset: 0, atBottom: false, window: null });
    const items = [
      { id: 'm1', top: 0, height: 500 },
      { id: 'm2', top: 500, height: 500 },
      { id: 'm3', top: 1000, height: 500 },
    ];
    const el = makeEl({ scrollTop: 0, scrollHeight: 2000, clientHeight: 400, items, growBy: 100, growFor: 3 });
    const s = useChatScrollRestore({ getEl: () => el, getKey: () => 'c1' });
    await s.restore('c1');
    // Content settles late: everything above m3 gets taller.
    items[1].height = 800;
    items[2].top = 1300;
    await frames(8);
    expect(el.scrollTop).toBe(1300);
  });

  it('restores the message window BEFORE looking for the anchor', async () => {
    // Restoring the anchor first would search a 30-message DOM for a message
    // that only exists at 130, and silently fall back to the bottom.
    const order = [];
    setScrollPosition('c1', { anchorId: 'm2', anchorOffset: 0, atBottom: false, window: 130 });
    const el = makeEl({ scrollTop: 0, scrollHeight: 2000, clientHeight: 400, items: ITEMS });
    const s = useChatScrollRestore({
      getEl: () => {
        order.push('measure');
        return el;
      },
      getKey: () => 'c1',
      setWindow: (n) => order.push(`window:${n}`),
    });
    await s.restore('c1');
    await frames(4);
    expect(order[0]).toBe('window:130');
  });

  it('pins to the bottom for an at-bottom entry, leaving live autoscroll armed', async () => {
    setScrollPosition('c1', { anchorId: null, anchorOffset: 0, atBottom: true, window: null });
    const el = makeEl({ scrollTop: 0, scrollHeight: 2000, clientHeight: 400, items: ITEMS, growBy: 500, growFor: 2 });
    const s = useChatScrollRestore({ getEl: () => el, getKey: () => 'c1' });
    await s.restore('c1');
    await frames(8);
    // Exactly the bottom of the FINAL height, not the height at first paint.
    expect(el.scrollHeight - el.scrollTop - el.clientHeight).toBe(0);
  });

  it('does not throw when the element disappears mid-restore', async () => {
    setScrollPosition('c1', { anchorId: 'm2', anchorOffset: 0, atBottom: false, window: null });
    let el = makeEl({ scrollTop: 0, scrollHeight: 2000, clientHeight: 400, items: ITEMS });
    const s = useChatScrollRestore({ getEl: () => el, getKey: () => 'c1' });
    const p = s.restore('c1');
    el = null;
    await expect(p).resolves.toBeUndefined();
    await frames(4);
  });
});

describe('restore — yielding to the user', () => {
  it('aborts the moment the user scrolls with the wheel', async () => {
    setScrollPosition('c1', { anchorId: 'm1', anchorOffset: 0, atBottom: false, window: null });
    const el = makeEl({ scrollTop: 0, scrollHeight: 2000, clientHeight: 400, items: ITEMS, growBy: 200, growFor: 50 });
    const s = useChatScrollRestore({ getEl: () => el, getKey: () => 'c1' });
    await s.restore('c1');
    expect(s.isRestoring.value).toBe(true);
    el.fire('wheel');
    expect(s.isRestoring.value).toBe(false);

    el.scrollTop = 42;
    await frames(6);
    expect(el.scrollTop).toBe(42); // the loop is genuinely dead, not just flagged
  });

  it('removes every abort listener when it finishes', async () => {
    setScrollPosition('c1', { anchorId: 'm2', anchorOffset: 0, atBottom: false, window: null });
    const el = makeEl({ scrollTop: 0, scrollHeight: 2000, clientHeight: 400, items: ITEMS });
    const s = useChatScrollRestore({ getEl: () => el, getKey: () => 'c1' });
    await s.restore('c1');
    await frames(8);
    expect(el.listenerCount()).toBe(0);
  });

  it('teardown stops an in-flight settle loop', async () => {
    setScrollPosition('c1', { anchorId: 'm1', anchorOffset: 0, atBottom: false, window: null });
    const el = makeEl({ scrollTop: 0, scrollHeight: 2000, clientHeight: 400, items: ITEMS, growBy: 200, growFor: 50 });
    const s = useChatScrollRestore({ getEl: () => el, getKey: () => 'c1' });
    await s.restore('c1');
    s.teardown();
    expect(s.isRestoring.value).toBe(false);
    expect(el.listenerCount()).toBe(0);
  });
});

describe('restore — overlapping opens', () => {
  it('the last caller wins; the earlier loop does not fight it', async () => {
    // Real sequence: the switch watcher restores while the canvas still shows
    // a loading spinner, then the loader restores against the real transcript.
    setScrollPosition('c1', { anchorId: 'm1', anchorOffset: 0, atBottom: false, window: null });
    setScrollPosition('c2', { anchorId: 'm3', anchorOffset: 0, atBottom: false, window: null });
    const el = makeEl({ scrollTop: 0, scrollHeight: 2000, clientHeight: 400, items: ITEMS });
    const s = useChatScrollRestore({ getEl: () => el, getKey: () => 'c2' });

    await s.restore('c1');
    await s.restore('c2');
    await frames(8);
    expect(el.scrollTop).toBe(1000);
    expect(el.listenerCount()).toBe(0);
  });
});
