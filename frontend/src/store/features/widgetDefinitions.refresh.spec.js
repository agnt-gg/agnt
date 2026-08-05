/**
 * Cache invalidation for widget definitions.
 *
 * THE BUG: `ensureDefinitionLoaded` treats "the source_code key exists" as
 * "this row is current" — deliberately, so rendering doesn't re-fetch a body
 * on every tick. That makes it structurally unable to notice a row that
 * changed server-side, so a widget edited from chat rendered its OLD source
 * forever until a full page reload. `refreshDefinition` is the invalidation
 * half of that contract.
 *
 * These tests pin both halves: the cache must still short-circuit (or we've
 * traded a staleness bug for a fetch storm), and the refresh must always win.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import widgetDefinitions from './widgetDefinitions.js';

const { actions, mutations } = widgetDefinitions;

/** Minimal Vuex harness: real mutations, recorded commits. */
function makeContext(initial = []) {
  const state = { definitions: [...initial], isLoaded: false, isLoading: false };
  const commits = [];
  const commit = (type, payload) => {
    commits.push({ type, payload });
    const name = type.includes('/') ? type.split('/').pop() : type;
    if (mutations[name]) mutations[name](state, payload);
  };
  return { state, commit, commits, dispatch: vi.fn(), getters: {} };
}

const OLD = {
  id: 'cw_room',
  name: 'The Room',
  source_code: '<h1>old</h1>',
  updated_at: '2026-08-05T17:00:00Z',
};
const NEW = {
  id: 'cw_room',
  name: 'The Room',
  source_code: '<h1>new — with the plan deck</h1>',
  updated_at: '2026-08-05T17:30:00Z',
};

describe('widgetDefinitions / refreshDefinition', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete global.fetch;
  });

  it('replaces a cached body even though the row is already hydrated', async () => {
    // The exact scenario that shipped broken: the store already holds
    // source_code, so ensureDefinitionLoaded would short-circuit and the
    // canvas would keep rendering `old` forever.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ widget: NEW }),
    });

    const ctx = makeContext([OLD]);
    const result = await actions.refreshDefinition(ctx, 'cw_room');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.source_code).toBe(NEW.source_code);
    expect(ctx.state.definitions[0].source_code).toBe(NEW.source_code);
    expect(ctx.state.definitions[0].updated_at).toBe(NEW.updated_at);
  });

  it('adds the row when the widget was created elsewhere', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ widget: NEW }),
    });

    const ctx = makeContext([]);
    await actions.refreshDefinition(ctx, 'cw_room');

    expect(ctx.state.definitions).toHaveLength(1);
    expect(ctx.state.definitions[0].id).toBe('cw_room');
  });

  it('leaves the cached row untouched when the fetch fails', async () => {
    // Degrading to the previous body beats blanking a widget the user is
    // looking at. A 500 must not clear the canvas.
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const ctx = makeContext([OLD]);
    const result = await actions.refreshDefinition(ctx, 'cw_room');

    expect(result).toBeNull();
    expect(ctx.state.definitions[0].source_code).toBe(OLD.source_code);
  });

  it('swallows a network error rather than rejecting into the socket handler', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'));

    const ctx = makeContext([OLD]);
    await expect(actions.refreshDefinition(ctx, 'cw_room')).resolves.toBeNull();
    expect(ctx.state.definitions[0].source_code).toBe(OLD.source_code);
  });

  it('is a no-op without an id', async () => {
    global.fetch = vi.fn();
    const ctx = makeContext([OLD]);

    expect(await actions.refreshDefinition(ctx, undefined)).toBeNull();
    expect(await actions.refreshDefinition(ctx, '')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not share the coalescing map with ensureDefinitionLoaded, and a late stale response cannot win', async () => {
    // A refresh answered by a request that started BEFORE the change would
    // silently reinstate the stale body — the bug wearing a disguise.
    // Two guarantees are pinned here: the refresh issues its OWN request
    // (not coalesced), and the older response loses even when it lands last.
    let resolveFirst;
    global.fetch = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((r) => { resolveFirst = () => r({ ok: true, json: async () => ({ widget: OLD }) }); }),
      )
      .mockResolvedValueOnce({ ok: true, json: async () => ({ widget: NEW }) });

    const ctx = makeContext([]);
    const inflight = actions.ensureDefinitionLoaded(ctx, 'cw_room');
    const refreshed = actions.refreshDefinition(ctx, 'cw_room');

    resolveFirst();
    await inflight;
    await refreshed;

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(ctx.state.definitions[0].source_code).toBe(NEW.source_code);
  });
});

describe('widgetDefinitions / ensureDefinitionLoaded (unchanged contract)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete global.fetch;
  });

  it('still short-circuits on a hydrated row — refresh must not become the default', async () => {
    global.fetch = vi.fn();
    const ctx = makeContext([OLD]);

    // The action is async, so the short-circuit still resolves a Promise —
    // what matters is that it resolves the CACHED object and never fetches.
    const result = await actions.ensureDefinitionLoaded(ctx, 'cw_room');

    expect(result).toBe(ctx.state.definitions[0]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('still fetches a row that has no source_code key', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ widget: NEW }) });
    const ctx = makeContext([{ id: 'cw_room', name: 'The Room' }]);

    await actions.ensureDefinitionLoaded(ctx, 'cw_room');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(ctx.state.definitions[0].source_code).toBe(NEW.source_code);
  });
});

describe('widgetDefinitions / UPDATE_DEFINITION monotonicity', () => {
  it('rejects an older row landing on top of a newer one', () => {
    const state = { definitions: [{ ...NEW }] };
    mutations.UPDATE_DEFINITION(state, { id: 'cw_room', updates: OLD });
    expect(state.definitions[0].source_code).toBe(NEW.source_code);
  });

  it('accepts a newer row', () => {
    const state = { definitions: [{ ...OLD }] };
    mutations.UPDATE_DEFINITION(state, { id: 'cw_room', updates: NEW });
    expect(state.definitions[0].source_code).toBe(NEW.source_code);
  });

  it('accepts an equal timestamp — a same-second re-fetch must not be dropped', () => {
    const state = { definitions: [{ ...OLD }] };
    mutations.UPDATE_DEFINITION(state, {
      id: 'cw_room',
      updates: { ...OLD, source_code: '<h1>same second, new body</h1>' },
    });
    expect(state.definitions[0].source_code).toBe('<h1>same second, new body</h1>');
  });

  it('does not block partial updates that carry no timestamp', () => {
    // Renames, thumbnails and is_shared toggles legitimately arrive without
    // updated_at. Gating those on a timestamp comparison would silently drop
    // every one of them.
    const state = { definitions: [{ ...NEW }] };
    mutations.UPDATE_DEFINITION(state, { id: 'cw_room', updates: { name: 'Renamed' } });
    expect(state.definitions[0].name).toBe('Renamed');
    expect(state.definitions[0].source_code).toBe(NEW.source_code);
  });
});

describe('widgetDefinitions / REMOVE_DEFINITION', () => {
  it('drops the row so a deleted widget stops rendering', () => {
    const state = { definitions: [OLD, { id: 'cw_other', source_code: 'x' }] };
    mutations.REMOVE_DEFINITION(state, 'cw_room');
    expect(state.definitions.map((d) => d.id)).toEqual(['cw_other']);
  });
});
