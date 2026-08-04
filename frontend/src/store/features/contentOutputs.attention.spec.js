/**
 * contentOutputs attention layer: derived getters + the optimistic
 * markRead / markUnread / setArchived actions.
 *
 * The contract under test:
 *   - getters derive unread/visible/archived purely from server columns
 *   - actions flip local state BEFORE the PATCH resolves (optimistic)
 *   - a failed PATCH reverts exactly the fields it touched
 *   - a PATCH for an output not yet in local state still goes to the server
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createStore } from 'vuex';
import contentOutputs from './contentOutputs.js';

const NOW = Date.parse('2026-08-04T12:00:00Z');
const HOUR = 60 * 60 * 1000;

function makeStore() {
  return createStore({ modules: { contentOutputs } });
}

function seed(store, outputs) {
  store.commit('contentOutputs/SET_OUTPUTS', { outputs, totalCount: outputs.length });
}

/** A fetch mock whose resolution the test controls — for in-flight races. */
function deferredFetch() {
  let release;
  const gate = new Promise((r) => { release = r; });
  global.fetch = vi.fn().mockImplementation(async () => {
    await gate;
    return { ok: true, json: async () => ({}) };
  });
  return { release };
}

function row(overrides = {}) {
  return {
    id: 'out-1',
    title: 'Test',
    group_id: null,
    // Naive server strings, exactly as the API sends them.
    created_at: '2026-08-04 10:00:00',
    updated_at: '2026-08-04 11:00:00',
    last_read_at: '2026-08-04 11:30:00',
    archived_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.setItem('token', 'test-token');
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
});

describe('derived getters', () => {
  it('unreadOutputIdSet derives from last_read_at vs updated_at', () => {
    const store = makeStore();
    seed(store, [
      row({ id: 'read' }),
      row({ id: 'stale-read', last_read_at: '2026-08-04 10:30:00' }), // read before last change
      row({ id: 'archived', last_read_at: '2026-08-04 10:30:00', archived_at: '2026-08-04 11:00:00' }),
    ]);
    expect(store.getters['contentOutputs/unreadOutputIdSet']).toEqual(new Set(['stale-read']));
  });

  it('a history of rows with no watermark stays OUT of the unread set', () => {
    // REGRESSION GUARD for the reported bug: every conversation predating the
    // last_read_at column had a NULL watermark, the old predicate read that
    // as "unread", and the triage rail swallowed the entire sidebar.
    const store = makeStore();
    const legacy = Array.from({ length: 50 }, (_, i) =>
      row({ id: `legacy-${i}`, last_read_at: null }));
    seed(store, [...legacy, row({ id: 'waiting', last_read_at: '2026-08-04 10:30:00' })]);

    expect(store.getters['contentOutputs/unreadOutputIdSet']).toEqual(new Set(['waiting']));
    expect(store.getters['contentOutputs/triageRail'].map((o) => o.id)).toEqual(['waiting']);
  });

  it('visibleOutputs / archivedOutputs partition on archived_at', () => {
    const store = makeStore();
    seed(store, [row({ id: 'live' }), row({ id: 'done', archived_at: '2026-08-04 11:00:00' })]);
    expect(store.getters['contentOutputs/visibleOutputs'].map((o) => o.id)).toEqual(['live']);
    expect(store.getters['contentOutputs/archivedOutputs'].map((o) => o.id)).toEqual(['done']);
  });

  it('triageRail is unread-only, oldest first', () => {
    const store = makeStore();
    seed(store, [
      row({ id: 'new-unread', updated_at: '2026-08-04 11:00:00', last_read_at: '2026-08-04 10:00:00' }),
      row({ id: 'old-unread', updated_at: '2026-08-01 09:00:00', last_read_at: '2026-08-01 08:00:00' }),
      row({ id: 'read' }),
    ]);
    expect(store.getters['contentOutputs/triageRail'].map((o) => o.id)).toEqual(['old-unread', 'new-unread']);
  });
});

describe('markRead / markUnread', () => {
  it('markRead flips local state optimistically and PATCHes { read: true }', async () => {
    const store = makeStore();
    seed(store, [row({ id: 'out-1', last_read_at: '2026-08-04 10:00:00' })]);
    expect(store.getters['contentOutputs/unreadOutputIdSet'].has('out-1')).toBe(true);

    // Hold the fetch open to observe the optimistic window.
    let release;
    global.fetch = vi.fn(() => new Promise((r) => { release = () => r({ ok: true, json: async () => ({}) }); }));

    const promise = store.dispatch('contentOutputs/markRead', 'out-1');
    // BEFORE the server responds, the dot is already gone.
    expect(store.getters['contentOutputs/unreadOutputIdSet'].has('out-1')).toBe(false);

    release();
    await promise;

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/content-outputs/out-1/read');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ read: true });
  });

  it('markUnread writes a watermark just before the change — NOT null', async () => {
    const store = makeStore();
    seed(store, [row({ id: 'out-1', updated_at: '2026-08-04 11:00:00' })]);
    expect(store.getters['contentOutputs/unreadOutputIdSet'].has('out-1')).toBe(false);

    await store.dispatch('contentOutputs/markUnread', 'out-1');

    expect(store.getters['contentOutputs/unreadOutputIdSet'].has('out-1')).toBe(true);
    // Null would mean "no watermark", which is explicitly NOT unread — the dot
    // would appear and then vanish on the next refetch. It mirrors the
    // server's own write: one second before updated_at.
    const stored = store.getters['contentOutputs/outputs'].find((o) => o.id === 'out-1').last_read_at;
    expect(stored).not.toBeNull();
    expect(stored.getTime()).toBe(Date.parse('2026-08-04T11:00:00Z') - 1000);

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/content-outputs/out-1/read');
    expect(JSON.parse(opts.body)).toEqual({ read: false });
  });

  it('markUnread survives a row with no usable updated_at', async () => {
    const store = makeStore();
    seed(store, [row({ id: 'out-1', updated_at: null })]);
    await store.dispatch('contentOutputs/markUnread', 'out-1');
    const stored = store.getters['contentOutputs/outputs'].find((o) => o.id === 'out-1').last_read_at;
    expect(stored).toBeInstanceOf(Date);
    expect(Number.isFinite(stored.getTime())).toBe(true);
  });

  it('optimistic markRead is clock-skew-proof: clears the dot even when updated_at is in the client\'s future', async () => {
    const store = makeStore();
    // A server clock ahead of the client (remote backend) produces rows whose
    // updated_at is "in the future" locally. Stamping the watermark with the
    // client clock would lose to it and leave a phantom dot; stamping with
    // the row's own updated_at cannot.
    const future = new Date(Date.now() + 6 * HOUR).toISOString().replace('T', ' ').slice(0, 19);
    seed(store, [row({ id: 'out-1', updated_at: future, last_read_at: '2026-08-04 10:00:00' })]);
    expect(store.getters['contentOutputs/unreadOutputIdSet'].has('out-1')).toBe(true);

    await store.dispatch('contentOutputs/markRead', 'out-1');

    expect(store.getters['contentOutputs/unreadOutputIdSet'].has('out-1')).toBe(false);
  });

  it('a failed PATCH reverts the optimistic flip and rethrows', async () => {
    const store = makeStore();
    seed(store, [row({ id: 'out-1', last_read_at: '2026-08-04 10:00:00' })]);
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    await expect(store.dispatch('contentOutputs/markRead', 'out-1')).rejects.toThrow();

    // Reverted: still unread.
    expect(store.getters['contentOutputs/unreadOutputIdSet'].has('out-1')).toBe(true);
  });

  it('an output not in local state still gets its PATCH (direct URL open)', async () => {
    const store = makeStore();
    seed(store, []);

    await store.dispatch('contentOutputs/markRead', 'not-fetched-yet');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('/content-outputs/not-fetched-yet/read');
  });
});

describe('markAllRead — the rail\'s clear-all button', () => {
  it('clears every requested id in ONE request, optimistically', async () => {
    const store = makeStore();
    seed(store, [
      row({ id: 'a', last_read_at: '2026-08-04 10:00:00' }),
      row({ id: 'b', last_read_at: '2026-08-04 10:30:00' }),
      row({ id: 'untouched', last_read_at: '2026-08-04 10:00:00' }),
    ]);
    expect(store.getters['contentOutputs/unreadOutputIdSet']).toEqual(new Set(['a', 'b', 'untouched']));

    let release;
    global.fetch = vi.fn(() => new Promise((r) => { release = () => r({ ok: true, json: async () => ({ cleared: 2 }) }); }));

    const promise = store.dispatch('contentOutputs/markAllRead', ['a', 'b']);
    // Optimistic: both dots gone before the server answers. The id that was
    // not passed keeps its dot — "all" means all of what was on screen.
    expect(store.getters['contentOutputs/unreadOutputIdSet']).toEqual(new Set(['untouched']));

    release();
    await promise;

    // ONE call, not one per id.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/content-outputs/read-all');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ ids: ['a', 'b'] });
  });

  it('is clock-skew-proof for the same reason markRead is', async () => {
    const store = makeStore();
    const future = new Date(Date.now() + 6 * HOUR).toISOString().replace('T', ' ').slice(0, 19);
    seed(store, [row({ id: 'a', updated_at: future, last_read_at: '2026-08-04 10:00:00' })]);

    await store.dispatch('contentOutputs/markAllRead', ['a']);

    expect(store.getters['contentOutputs/unreadOutputIdSet'].has('a')).toBe(false);
  });

  it('a failed request rolls back EVERY optimistic flip and rethrows', async () => {
    const store = makeStore();
    seed(store, [
      row({ id: 'a', last_read_at: '2026-08-04 10:00:00' }),
      row({ id: 'b', last_read_at: '2026-08-04 10:30:00' }),
    ]);
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    await expect(store.dispatch('contentOutputs/markAllRead', ['a', 'b'])).rejects.toThrow();

    // Both dots are back, and 'b' kept its ORIGINAL stale watermark rather
    // than being reverted to null — a partial rollback is still a bug.
    expect(store.getters['contentOutputs/unreadOutputIdSet']).toEqual(new Set(['a', 'b']));
    expect(store.getters['contentOutputs/outputs'].find((o) => o.id === 'b').last_read_at)
      .toEqual(new Date('2026-08-04T10:30:00Z'));
  });

  it('an empty list is a no-op that never reaches the network', async () => {
    // The route widens a missing `ids` to "everything"; an empty array must
    // therefore never be sent as one.
    const store = makeStore();
    seed(store, [row({ id: 'a', last_read_at: '2026-08-04 10:00:00' })]);

    await store.dispatch('contentOutputs/markAllRead', []);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(store.getters['contentOutputs/unreadOutputIdSet'].has('a')).toBe(true);
  });

  it('ids missing from local state are still sent to the server', async () => {
    const store = makeStore();
    seed(store, [row({ id: 'a', last_read_at: '2026-08-04 10:00:00' })]);

    await store.dispatch('contentOutputs/markAllRead', ['a', 'not-fetched-yet']);

    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ ids: ['a', 'not-fetched-yet'] });
  });
});

describe('setArchived', () => {
  it('archives optimistically, silencing any unread state, and PATCHes', async () => {
    const store = makeStore();
    seed(store, [row({ id: 'out-1', last_read_at: '2026-08-04 10:00:00' })]);
    expect(store.getters['contentOutputs/unreadOutputIdSet'].has('out-1')).toBe(true);

    await store.dispatch('contentOutputs/setArchived', { outputId: 'out-1', archived: true });

    expect(store.getters['contentOutputs/archivedOutputs'].map((o) => o.id)).toEqual(['out-1']);
    expect(store.getters['contentOutputs/visibleOutputs']).toEqual([]);
    // Archived is never unread — archiving IS "done with this".
    expect(store.getters['contentOutputs/unreadOutputIdSet'].has('out-1')).toBe(false);

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/content-outputs/out-1/archive');
    expect(JSON.parse(opts.body)).toEqual({ archived: true });
  });

  it('unarchive restores visibility; a failed PATCH reverts', async () => {
    const store = makeStore();
    seed(store, [row({ id: 'out-1', archived_at: '2026-08-04 11:00:00' })]);

    await store.dispatch('contentOutputs/setArchived', { outputId: 'out-1', archived: false });
    expect(store.getters['contentOutputs/visibleOutputs'].map((o) => o.id)).toEqual(['out-1']);

    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(
      store.dispatch('contentOutputs/setArchived', { outputId: 'out-1', archived: true }),
    ).rejects.toThrow();
    // Reverted to unarchived.
    expect(store.getters['contentOutputs/visibleOutputs'].map((o) => o.id)).toEqual(['out-1']);
  });
});

/**
 * Event-carried row metadata — the payload a save response / realtime
 * broadcast delivers so ONE changed row merges in place. The old behaviour
 * (full-list refetch on every save event, i.e. every ~5s per streaming
 * conversation) was a fetch storm that starved actual conversation loads.
 */
describe('UPSERT_OUTPUT_META', () => {
  it('adds an unknown row at the top, with date boundary conversion', () => {
    const store = makeStore();
    seed(store, [row({ id: 'existing' })]);

    store.commit('contentOutputs/UPSERT_OUTPUT_META', {
      output: row({ id: 'fresh', updated_at: '2026-08-04 11:45:00' }),
    });

    const outputs = store.getters['contentOutputs/outputs'];
    expect(outputs.map((o) => o.id)).toEqual(['fresh', 'existing']);
    expect(outputs[0].updated_at).toBeInstanceOf(Date);
    // Naive SQLite strings are UTC — conversion must not read them as local.
    expect(outputs[0].updated_at.getTime()).toBe(Date.parse('2026-08-04T11:45:00Z'));
    expect(store.getters['contentOutputs/totalCount']).toBe(2);
  });

  it('merges into an existing row; fields ABSENT from the payload survive', () => {
    const store = makeStore();
    seed(store, [row({ id: 'out-1', group_id: 'g1' })]);

    // A payload that genuinely lacks keys (no group_id, no content) — spread
    // semantics must preserve the local values, not null them.
    store.commit('contentOutputs/UPSERT_OUTPUT_META', {
      output: {
        id: 'out-1',
        title: 'Renamed',
        updated_at: '2026-08-04 11:50:00',
        last_read_at: '2026-08-04 11:50:00',
        archived_at: null,
        created_at: '2026-08-04 10:00:00',
      },
    });

    const [merged] = store.getters['contentOutputs/outputs'];
    expect(merged.title).toBe('Renamed');
    expect(merged.group_id).toBe('g1');
    expect(merged.updated_at.getTime()).toBe(Date.parse('2026-08-04T11:50:00Z'));
    expect(store.getters['contentOutputs/totalCount']).toBe(1);
  });

  it('a group move carried by the payload DOES apply — present beats absent', () => {
    const store = makeStore();
    seed(store, [row({ id: 'out-1', group_id: 'g1' })]);
    store.commit('contentOutputs/UPSERT_OUTPUT_META', {
      output: row({ id: 'out-1', group_id: 'g2' }),
    });
    expect(store.getters['contentOutputs/outputs'][0].group_id).toBe('g2');
  });

  it('a viewing-save meta keeps the active conversation read', () => {
    // The server stamps last_read_at atomically with a viewing save; the
    // merged row must therefore never present as unread — this is the
    // flicker-free path for the conversation being looked at.
    const store = makeStore();
    seed(store, [row({ id: 'out-1' })]);

    store.commit('contentOutputs/UPSERT_OUTPUT_META', {
      output: row({ id: 'out-1', updated_at: '2026-08-04 11:55:00', last_read_at: '2026-08-04 11:55:00' }),
    });

    expect(store.getters['contentOutputs/unreadOutputIdSet'].has('out-1')).toBe(false);
  });
});

/**
 * The stale-snapshot guard. A snapshot (full fetch or meta payload) whose
 * data predates an attention write must not revert that write — this is the
 * race that made manually-marked conversations vanish from the Needs-you
 * rail moments after being marked.
 */
describe('attention writes vs stale snapshots', () => {
  it('a meta upsert cannot revert a mark-unread that is still in flight', async () => {
    const store = makeStore();
    seed(store, [row({ id: 'out-1' })]);
    const { release } = deferredFetch();

    const patch = store.dispatch('contentOutputs/markUnread', 'out-1');
    expect(store.getters['contentOutputs/unreadOutputIdSet'].has('out-1')).toBe(true);

    // A save broadcast generated BEFORE the PATCH committed arrives now,
    // still carrying the old "read" watermark.
    store.commit('contentOutputs/UPSERT_OUTPUT_META', {
      output: row({ id: 'out-1' }),
      snapshotStartedAt: Date.now(),
    });

    // THE BUG: this used to flip the row back to read — the dot appeared and
    // vanished, and the conversation would not stay in the rail.
    expect(store.getters['contentOutputs/unreadOutputIdSet'].has('out-1')).toBe(true);

    release();
    await patch;
    expect(store.getters['contentOutputs/unreadOutputIdSet'].has('out-1')).toBe(true);
  });

  it('a full fetch snapshot started before the write settles cannot revert it either', async () => {
    const store = makeStore();
    seed(store, [row({ id: 'out-1' })]);
    const { release } = deferredFetch();

    const snapshotStartedAt = Date.now();
    const patch = store.dispatch('contentOutputs/markUnread', 'out-1');
    release();
    await patch;

    // Snapshot taken before the PATCH settled, delivered after.
    store.commit('contentOutputs/SET_OUTPUTS', {
      outputs: [row({ id: 'out-1' })],
      totalCount: 1,
      fetchStartedAt: snapshotStartedAt,
    });

    expect(store.getters['contentOutputs/unreadOutputIdSet'].has('out-1')).toBe(true);
  });

  it('a snapshot started AFTER the write settles is server truth and applies', async () => {
    const store = makeStore();
    seed(store, [row({ id: 'out-1' })]);
    const { release } = deferredFetch();

    const patch = store.dispatch('contentOutputs/markUnread', 'out-1');
    release();
    await patch;

    // e.g. the user marked it read on ANOTHER device after this write.
    store.commit('contentOutputs/SET_OUTPUTS', {
      outputs: [row({ id: 'out-1', last_read_at: '2026-08-04 11:59:00' })],
      totalCount: 1,
      // Comfortably after the settle — same-millisecond ties must not flake.
      fetchStartedAt: Date.now() + 50,
    });

    expect(store.getters['contentOutputs/unreadOutputIdSet'].has('out-1')).toBe(false);
  });

  it('only attention fields are withheld from a stale snapshot — the rest applies', async () => {
    const store = makeStore();
    seed(store, [row({ id: 'out-1', title: 'Old' })]);
    const { release } = deferredFetch();

    const patch = store.dispatch('contentOutputs/markUnread', 'out-1');
    store.commit('contentOutputs/UPSERT_OUTPUT_META', {
      output: row({ id: 'out-1', title: 'New title', updated_at: '2026-08-04 11:58:00' }),
      snapshotStartedAt: Date.now(),
    });

    const [merged] = store.getters['contentOutputs/outputs'];
    expect(merged.title).toBe('New title');
    expect(store.getters['contentOutputs/unreadOutputIdSet'].has('out-1')).toBe(true);

    release();
    await patch;
  });
});

/**
 * Manual "Mark as Unread" is INTENT with a lifetime: it survives anything
 * except the user actually re-opening the conversation. The autosave layer
 * consults this to decide viewing:true/false — without it, the ~5s autosaves
 * of the open conversation cleared a manual mark within seconds.
 */
describe('manuallyUnread intent', () => {
  it('markUnread records intent; markRead clears it', async () => {
    const store = makeStore();
    seed(store, [row({ id: 'out-1' })]);

    await store.dispatch('contentOutputs/markUnread', 'out-1');
    expect(store.getters['contentOutputs/isManuallyUnread']('out-1')).toBe(true);

    await store.dispatch('contentOutputs/markRead', 'out-1');
    expect(store.getters['contentOutputs/isManuallyUnread']('out-1')).toBe(false);
  });

  it('the rail clear-all also clears intent', async () => {
    const store = makeStore();
    seed(store, [row({ id: 'a' }), row({ id: 'b' })]);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ cleared: 2 }) });

    await store.dispatch('contentOutputs/markUnread', 'a');
    await store.dispatch('contentOutputs/markUnread', 'b');
    await store.dispatch('contentOutputs/markAllRead', ['a', 'b']);

    expect(store.getters['contentOutputs/isManuallyUnread']('a')).toBe(false);
    expect(store.getters['contentOutputs/isManuallyUnread']('b')).toBe(false);
  });

  it('a failed markUnread still records intent locally and rethrows', async () => {
    // The optimistic flip reverts, but intent is the user's statement — the
    // next successful write will honour it. (Design choice: losing the
    // watermark write must not silently lose the user's intent too.)
    const store = makeStore();
    seed(store, [row({ id: 'out-1' })]);
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    await expect(store.dispatch('contentOutputs/markUnread', 'out-1')).rejects.toThrow();
    expect(store.getters['contentOutputs/isManuallyUnread']('out-1')).toBe(true);
  });
});
