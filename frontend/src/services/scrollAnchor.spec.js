import { describe, it, expect } from 'vitest';
import { isAtBottom, pickAnchor, resolveScrollTarget, BOTTOM_THRESHOLD } from './scrollAnchor.js';

// Three messages, 200px each, in a 1000px-tall content area.
const ITEMS = [
  { id: 'm1', top: 0, height: 200 },
  { id: 'm2', top: 200, height: 200 },
  { id: 'm3', top: 400, height: 200 },
];

describe('isAtBottom', () => {
  it('is true at the exact bottom', () => {
    expect(isAtBottom(600, 1000, 400)).toBe(true);
  });

  it('is true within the threshold, because the autoscroll uses the same one', () => {
    // A position the autoscroll considers "bottom" must be recorded as bottom,
    // or restoring it would be instantly overridden by the next chunk.
    expect(isAtBottom(600 - (BOTTOM_THRESHOLD - 1), 1000, 400)).toBe(true);
  });

  it('is false beyond the threshold', () => {
    expect(isAtBottom(600 - (BOTTOM_THRESHOLD + 1), 1000, 400)).toBe(false);
  });

  it('is true when nothing can scroll', () => {
    expect(isAtBottom(0, 300, 400)).toBe(true);
  });

  it('treats unmeasurable geometry as bottom rather than inventing a position', () => {
    expect(isAtBottom(NaN, 1000, 400)).toBe(true);
    expect(isAtBottom(0, undefined, 400)).toBe(true);
  });
});

describe('pickAnchor', () => {
  it('picks the topmost visible message, even when it is scrolled halfway off', () => {
    expect(pickAnchor(ITEMS, 300)).toEqual({ anchorId: 'm2', anchorOffset: 100 });
  });

  it('picks the first message at the very top, with zero offset', () => {
    expect(pickAnchor(ITEMS, 0)).toEqual({ anchorId: 'm1', anchorOffset: 0 });
  });

  it('picks the message whose top exactly equals the viewport top', () => {
    expect(pickAnchor(ITEMS, 400)).toEqual({ anchorId: 'm3', anchorOffset: 0 });
  });

  it('falls back to the LAST message when scrolled past every message', () => {
    // Trailing non-message content (the processing indicator, the floor queue)
    // can sit below the last message. Anchoring to it is still meaningful.
    expect(pickAnchor(ITEMS, 900)).toEqual({ anchorId: 'm3', anchorOffset: 500 });
  });

  it('returns null when there is nothing to anchor to', () => {
    expect(pickAnchor([], 100)).toBeNull();
    expect(pickAnchor(null, 100)).toBeNull();
    expect(pickAnchor(undefined, 100)).toBeNull();
  });

  it('skips entries with no usable id', () => {
    const items = [{ id: null, top: 0, height: 200 }, { id: 'real', top: 200, height: 200 }];
    expect(pickAnchor(items, 0)).toEqual({ anchorId: 'real', anchorOffset: -200 });
  });

  it('survives unmeasured items (jsdom, or a node not yet laid out)', () => {
    const items = [{ id: 'a', top: NaN, height: undefined }];
    expect(pickAnchor(items, 0)).toEqual({ anchorId: 'a', anchorOffset: 0 });
  });
});

describe('resolveScrollTarget — the round trip', () => {
  const geom = { scrollHeight: 1000, clientHeight: 400 };

  it('reproduces the exact position when the layout has not changed', () => {
    const anchor = pickAnchor(ITEMS, 300);
    expect(resolveScrollTarget({ items: ITEMS, ...anchor, atBottom: false, ...geom })).toBe(300);
  });

  it('follows the anchor when everything above it grew', () => {
    // MathJax typeset the two messages above; each got 50px taller. The user
    // must still be looking at the same point in the same message.
    const grown = [
      { id: 'm1', top: 0, height: 250 },
      { id: 'm2', top: 250, height: 250 },
      { id: 'm3', top: 500, height: 200 },
    ];
    const anchor = pickAnchor(ITEMS, 300); // m2 + 100
    expect(resolveScrollTarget({ items: grown, ...anchor, atBottom: false, scrollHeight: 1100, clientHeight: 400 })).toBe(350);
  });

  it('follows the anchor when earlier messages were prepended by the window', () => {
    const withEarlier = [
      { id: 'older', top: 0, height: 1000 },
      { id: 'm1', top: 1000, height: 200 },
      { id: 'm2', top: 1200, height: 200 },
      { id: 'm3', top: 1400, height: 200 },
    ];
    const anchor = pickAnchor(ITEMS, 300);
    expect(
      resolveScrollTarget({ items: withEarlier, ...anchor, atBottom: false, scrollHeight: 2000, clientHeight: 400 }),
    ).toBe(1300);
  });
});

describe('resolveScrollTarget — every failure resolves to the BOTTOM', () => {
  const geom = { scrollHeight: 1000, clientHeight: 400 };
  const MAX = 600;

  it('bottom intent goes to the bottom', () => {
    expect(resolveScrollTarget({ items: ITEMS, anchorId: null, atBottom: true, ...geom })).toBe(MAX);
  });

  it('a deleted anchor (edit-and-resend truncated the tail) goes to the bottom, NOT the top', () => {
    // This is the whole point of the fallback direction. Landing on message 1
    // of 200 is the papercut this feature exists to remove.
    const target = resolveScrollTarget({ items: ITEMS, anchorId: 'deleted-msg', anchorOffset: 40, atBottom: false, ...geom });
    expect(target).toBe(MAX);
    expect(target).not.toBe(0);
  });

  it('a missing anchor id goes to the bottom', () => {
    expect(resolveScrollTarget({ items: ITEMS, anchorId: null, atBottom: false, ...geom })).toBe(MAX);
    expect(resolveScrollTarget({ items: ITEMS, anchorId: '', atBottom: false, ...geom })).toBe(MAX);
  });

  it('an empty or absent transcript goes to the bottom', () => {
    expect(resolveScrollTarget({ items: [], anchorId: 'm1', atBottom: false, ...geom })).toBe(MAX);
    expect(resolveScrollTarget({ items: null, anchorId: 'm1', atBottom: false, ...geom })).toBe(MAX);
  });

  it('an undefined atBottom is treated as bottom, so a partial entry cannot land on the top', () => {
    expect(resolveScrollTarget({ items: ITEMS, anchorId: 'm2', ...geom })).toBe(MAX);
  });
});

describe('resolveScrollTarget — clamping', () => {
  it('never returns a negative scrollTop', () => {
    const items = [{ id: 'a', top: 0, height: 100 }];
    expect(resolveScrollTarget({ items, anchorId: 'a', anchorOffset: -500, atBottom: false, scrollHeight: 1000, clientHeight: 400 })).toBe(0);
  });

  it('never returns past the maximum scrollable offset', () => {
    const items = [{ id: 'a', top: 900, height: 100 }];
    expect(resolveScrollTarget({ items, anchorId: 'a', anchorOffset: 500, atBottom: false, scrollHeight: 1000, clientHeight: 400 })).toBe(600);
  });

  it('returns 0 when the content no longer overflows', () => {
    const items = [{ id: 'a', top: 0, height: 100 }];
    expect(resolveScrollTarget({ items, anchorId: 'a', anchorOffset: 50, atBottom: false, scrollHeight: 200, clientHeight: 400 })).toBe(0);
  });

  it('never emits NaN into a scrollTop assignment', () => {
    const items = [{ id: 'a', top: NaN, height: 10 }];
    const target = resolveScrollTarget({ items, anchorId: 'a', anchorOffset: NaN, atBottom: false, scrollHeight: NaN, clientHeight: NaN });
    expect(Number.isFinite(target)).toBe(true);
    expect(target).toBe(0);
  });
});
