// Storage quota + reclaim of the abandoned per-channel split keys.
//
// THE BUG THESE PIN:
// persistNow() wrote every channel into ONE localStorage key and swallowed any
// failure. Once the origin filled up, setItem threw QuotaExceededError, the
// catch logged it, and EVERY chat surface silently stopped saving — the user's
// only signal was conversations quietly not being there after a reload.
// Measured on a real profile: 8.15 MB used against a 10 MB quota, of which
// ~2 MB was `conv:unified:*` keys belonging to a persistence scheme that exists
// in no source file, no shipped bundle, and no commit.
//
// So: make a full quota RECOVERABLE (evict the coldest channels, keep saving),
// make it LOUD when it truly cannot be satisfied, and give back the space the
// dead scheme is squatting on — folding its data in first, because a stale
// split key can hold a LONGER transcript than the live map.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/services/chatService.js', () => ({
  streamChat: vi.fn(), toChatHistory: vi.fn(), reattachRun: vi.fn(), cancelRun: vi.fn(),
}));
vi.mock('@/services/inflightRuns.js', () => ({ markRunStarted: vi.fn(), markRunEnded: vi.fn() }));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelRouting: vi.fn(() => ({ mode: 'pinned', provider: 'p', model: 'm' })),
  resolveChannelEnabledTools: vi.fn(),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));

const STORAGE_KEY = 'unifiedChatConversations';
const INDEX_KEY = `${STORAGE_KEY}:index`;
const RECLAIM_FLAG = `${STORAGE_KEY}:reclaimed:v1`;

const conv = (n, lastUpdate) => ({
  messages: Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: 'user', content: `msg ${i}` })),
  conversationId: null,
  lastUpdate,
  suggestions: [],
});

/** Reject writes to STORAGE_KEY above `limit` characters, like a real quota. */
function capStorageAt(limit) {
  const real = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key, value) {
    if (key === STORAGE_KEY && String(value).length > limit) {
      const err = new Error('quota');
      err.name = 'QuotaExceededError';
      throw err;
    }
    return real.call(this, key, value);
  });
}

let mod;
async function load() {
  vi.resetModules();
  mod = await import('./chatUnified.js');
  return mod;
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
describe('a full quota keeps the live conversation durable', () => {
  it('evicts the coldest channels and still saves', async () => {
    await load();
    const state = { conversations: {} };
    const conversations = {
      'agent:cold': conv(200, 1000),
      'agent:warm': conv(200, 2000),
      'agent:live': conv(5, 9000),
    };

    // Room for roughly one large channel plus the small live one.
    const full = JSON.stringify(conversations).length;
    capStorageAt(Math.floor(full * 0.7));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mod.default.mutations.PERSIST_CONVERSATIONS({ conversations });

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(saved['agent:live']).toBeTruthy();          // never sacrificed
    expect(saved['agent:cold']).toBeUndefined();       // coldest went first
    expect(warn).toHaveBeenCalled();                   // and it said so
    expect(state).toBeTruthy();
  });

  it('evicts no more than it has to', async () => {
    await load();
    const conversations = {
      'agent:cold': conv(200, 1000),
      'agent:warm': conv(200, 2000),
      'agent:live': conv(5, 9000),
    };
    capStorageAt(Math.floor(JSON.stringify(conversations).length * 0.7));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    mod.default.mutations.PERSIST_CONVERSATIONS({ conversations });

    // 'warm' still fits once 'cold' is gone, so it must survive.
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))['agent:warm']).toBeTruthy();
  });

  it('never evicts the live conversation to make room for itself', async () => {
    await load();
    const conversations = {
      'agent:a': conv(100, 7000),
      'agent:b': conv(100, 8000),
      'agent:c': conv(100, 9000),
    };
    capStorageAt(10); // nothing fits
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    mod.default.mutations.PERSIST_CONVERSATIONS({ conversations });

    // Refusing to write is correct: the alternative is deleting the thread the
    // user is in so that a truncated copy of it can be saved.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('NOT saving'));
  });

  it('reports non-quota failures instead of looping on them', async () => {
    await load();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new TypeError('serialization exploded');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    mod.default.mutations.PERSIST_CONVERSATIONS({ conversations: { 'agent:a': conv(1, 1) } });

    expect(error).toHaveBeenCalledWith('[chatUnified] Failed to persist conversations:', expect.any(TypeError));
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('reclaiming the abandoned split-key scheme', () => {
  it('removes the dead keys and its index', async () => {
    localStorage.setItem('conv:unified:widget:cw_a', JSON.stringify(conv(2, 100)));
    localStorage.setItem('conv:unified:workflow:wf_b', JSON.stringify(conv(2, 100)));
    localStorage.setItem(INDEX_KEY, '["widget:cw_a"]');

    await load();

    expect(localStorage.getItem('conv:unified:widget:cw_a')).toBeNull();
    expect(localStorage.getItem('conv:unified:workflow:wf_b')).toBeNull();
    expect(localStorage.getItem(INDEX_KEY)).toBeNull();
    expect(localStorage.getItem(RECLAIM_FLAG)).toBeTruthy();
  });

  it('adopts a split transcript that is LONGER than the live one', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'widget:cw_a': conv(1, 100) }));
    localStorage.setItem('conv:unified:widget:cw_a', JSON.stringify(conv(9, 500)));

    const { default: store } = await load();

    expect(store.state.conversations['widget:cw_a'].messages).toHaveLength(9);
    // …and the merge is durable, not just in memory.
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))['widget:cw_a'].messages).toHaveLength(9);
  });

  it('never clobbers a longer live transcript with a stale one', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'widget:cw_a': conv(9, 500) }));
    localStorage.setItem('conv:unified:widget:cw_a', JSON.stringify(conv(1, 100)));

    const { default: store } = await load();
    expect(store.state.conversations['widget:cw_a'].messages).toHaveLength(9);
  });

  it('runs once — a channel deleted after the reclaim stays deleted', async () => {
    localStorage.setItem('conv:unified:widget:cw_a', JSON.stringify(conv(3, 100)));
    await load();
    expect(localStorage.getItem(RECLAIM_FLAG)).toBeTruthy();

    // Re-seed the dead key: a second boot must ignore it rather than
    // resurrecting data the user has since removed.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({}));
    localStorage.setItem('conv:unified:widget:cw_a', JSON.stringify(conv(3, 100)));
    const { default: store } = await load();
    expect(store.state.conversations['widget:cw_a']).toBeUndefined();
  });

  it('tolerates an unreadable split key without aborting the pass', async () => {
    localStorage.setItem('conv:unified:widget:cw_bad', '{not json');
    localStorage.setItem('conv:unified:widget:cw_good', JSON.stringify(conv(4, 200)));

    const { default: store } = await load();

    expect(localStorage.getItem('conv:unified:widget:cw_bad')).toBeNull();
    expect(store.state.conversations['widget:cw_good'].messages).toHaveLength(4);
  });

  it('is a no-op — and writes nothing — when there is nothing to reclaim', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'agent:a': conv(1, 1) }));
    const before = localStorage.getItem(STORAGE_KEY);
    await load();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });
});
