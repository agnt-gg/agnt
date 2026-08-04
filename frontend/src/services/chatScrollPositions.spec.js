import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getScrollPosition,
  setScrollPosition,
  clearScrollPosition,
  renameScrollPosition,
  MAX_POSITIONS,
} from './chatScrollPositions.js';

const KEY = 'chatScrollV1';

const anchored = (anchorId = 'msg-7', anchorOffset = 120) => ({
  anchorId,
  anchorOffset,
  atBottom: false,
  window: 80,
});

beforeEach(() => localStorage.removeItem(KEY));
afterEach(() => {
  localStorage.removeItem(KEY);
  vi.restoreAllMocks();
});

describe('chatScrollPositions — isolation, the property this module exists for', () => {
  it('a position saved under one conversation never appears under another', () => {
    setScrollPosition('convo-a', anchored());
    expect(getScrollPosition('convo-b')).toBeNull();
    expect(getScrollPosition('convo-a')).toMatchObject({ anchorId: 'msg-7', anchorOffset: 120, atBottom: false });
  });

  it('positions for many conversations coexist independently', () => {
    setScrollPosition('a', anchored('a-msg'));
    setScrollPosition('b', anchored('b-msg'));
    setScrollPosition('c', { atBottom: true, anchorId: null, anchorOffset: 0, window: 30 });
    expect(getScrollPosition('a').anchorId).toBe('a-msg');
    expect(getScrollPosition('b').anchorId).toBe('b-msg');
    expect(getScrollPosition('c').atBottom).toBe(true);
  });

  it('persists to the actual blob, not a module closure', () => {
    setScrollPosition('a', anchored());
    expect(JSON.parse(localStorage.getItem(KEY)).a.anchorId).toBe('msg-7');
  });
});

describe('chatScrollPositions — what gets stored', () => {
  it('stores an at-bottom position rather than treating it as absent', () => {
    // Both restore to the bottom, but the entry also carries the window: a
    // user at the bottom of a conversation they expanded to 130 messages
    // should get those 130 back.
    setScrollPosition('a', { atBottom: true, anchorId: null, anchorOffset: 0, window: 130 });
    expect(getScrollPosition('a')).toMatchObject({ atBottom: true, window: 130 });
  });

  it('rounds the offset — sub-pixel precision is noise we would pay storage for', () => {
    setScrollPosition('a', { ...anchored(), anchorOffset: 120.6 });
    expect(getScrollPosition('a').anchorOffset).toBe(121);
  });

  it('records no window when the surface has none (panel chats render everything)', () => {
    setScrollPosition('a', { ...anchored(), window: null });
    expect(getScrollPosition('a').window).toBeNull();
  });

  it('refreshes the timestamp on every write so LRU tracks real use', () => {
    let t = 5000;
    vi.spyOn(Date, 'now').mockImplementation(() => (t += 1000));
    setScrollPosition('a', anchored());
    const first = JSON.parse(localStorage.getItem(KEY)).a.at;
    setScrollPosition('a', anchored('msg-9'));
    expect(JSON.parse(localStorage.getItem(KEY)).a.at).toBeGreaterThan(first);
  });
});

describe('chatScrollPositions — an untrusted blob cannot become a bad scrollTop', () => {
  it('rejects a non-bottom entry with no anchor: it carries no recoverable position', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: { atBottom: false, anchorId: null, anchorOffset: 40 } }));
    expect(getScrollPosition('a')).toBeNull();
  });

  it('refuses to WRITE an unrecoverable entry too', () => {
    setScrollPosition('a', { atBottom: false, anchorId: null, anchorOffset: 40 });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('replaces a NaN offset with 0 rather than propagating it into scrollTop', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: { atBottom: false, anchorId: 'm', anchorOffset: 'oops' } }));
    expect(getScrollPosition('a').anchorOffset).toBe(0);
  });

  it('ignores a non-positive or non-numeric window', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: { atBottom: true, window: -5 }, b: { atBottom: true, window: 'lots' } }));
    expect(getScrollPosition('a').window).toBeNull();
    expect(getScrollPosition('b').window).toBeNull();
  });

  it('floors a fractional window — it indexes an array', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: { atBottom: true, window: 30.9 } }));
    expect(getScrollPosition('a').window).toBe(30);
  });

  it('treats a missing atBottom as bottom, the safe direction', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: { anchorId: 'm', anchorOffset: 10 } }));
    expect(getScrollPosition('a').atBottom).toBe(true);
  });

  it('rejects entries that are not objects', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: 42, b: 'nope', c: [1, 2], d: null }));
    ['a', 'b', 'c', 'd'].forEach((k) => expect(getScrollPosition(k)).toBeNull());
  });
});

describe('chatScrollPositions — bounded by construction', () => {
  it('evicts the OLDEST entries past MAX_POSITIONS, keeping the newest', () => {
    let t = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => (t += 1));
    for (let i = 0; i < MAX_POSITIONS + 5; i++) setScrollPosition(`c${i}`, anchored(`m${i}`));

    const stored = JSON.parse(localStorage.getItem(KEY));
    expect(Object.keys(stored).length).toBe(MAX_POSITIONS);
    expect(getScrollPosition('c0')).toBeNull();
    expect(getScrollPosition(`c${MAX_POSITIONS + 4}`).anchorId).toBe(`m${MAX_POSITIONS + 4}`);
  });
});

describe('chatScrollPositions — following an identity change', () => {
  it('moves the entry from the temp id to the server uuid', () => {
    setScrollPosition('temp-123', anchored('m5'));
    renameScrollPosition('temp-123', 'uuid-abc');
    expect(getScrollPosition('temp-123')).toBeNull();
    expect(getScrollPosition('uuid-abc').anchorId).toBe('m5');
  });

  it('does not resurrect an entry that was never written', () => {
    renameScrollPosition('temp-nothing', 'uuid-abc');
    expect(getScrollPosition('uuid-abc')).toBeNull();
  });

  it('leaves other conversations alone', () => {
    setScrollPosition('temp-1', anchored('m1'));
    setScrollPosition('other', anchored('m2'));
    renameScrollPosition('temp-1', 'uuid-1');
    expect(getScrollPosition('other').anchorId).toBe('m2');
  });

  it('ignores degenerate renames', () => {
    setScrollPosition('a', anchored('m1'));
    renameScrollPosition('a', 'a');
    renameScrollPosition(null, 'b');
    renameScrollPosition('a', null);
    renameScrollPosition(1, 2);
    expect(getScrollPosition('a').anchorId).toBe('m1');
  });
});

describe('chatScrollPositions — clearing', () => {
  it('removes the entry', () => {
    setScrollPosition('a', anchored());
    clearScrollPosition('a');
    expect(getScrollPosition('a')).toBeNull();
  });

  it('leaves the others alone', () => {
    setScrollPosition('a', anchored('m1'));
    setScrollPosition('b', anchored('m2'));
    clearScrollPosition('a');
    expect(getScrollPosition('b').anchorId).toBe('m2');
  });

  it('clearing an absent key does not create a blob', () => {
    clearScrollPosition('nope');
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe('chatScrollPositions — failure is never an error', () => {
  it('a corrupted blob reads as no positions, not a throw', () => {
    localStorage.setItem(KEY, '{not json');
    expect(getScrollPosition('a')).toBeNull();
    expect(() => setScrollPosition('a', anchored())).not.toThrow();
    expect(getScrollPosition('a').anchorId).toBe('msg-7');
  });

  it('a non-object blob is ignored', () => {
    localStorage.setItem(KEY, '[1,2,3]');
    expect(getScrollPosition('a')).toBeNull();
  });

  it('a storage write failure (quota, private mode) is swallowed', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => setScrollPosition('a', anchored())).not.toThrow();
    expect(() => renameScrollPosition('a', 'b')).not.toThrow();
  });

  it('missing or non-string ids are no-ops', () => {
    expect(() => setScrollPosition(null, anchored())).not.toThrow();
    expect(() => clearScrollPosition(undefined)).not.toThrow();
    expect(getScrollPosition(null)).toBeNull();
    expect(getScrollPosition(42)).toBeNull();
  });

  it('a missing position object is a no-op, not a stored undefined', () => {
    setScrollPosition('a', null);
    setScrollPosition('a', undefined);
    expect(getScrollPosition('a')).toBeNull();
  });
});
