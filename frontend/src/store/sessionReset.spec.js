/**
 * Everything a session loads, a session end must drop.
 *
 * ---------------------------------------------------------------------------
 * THE BUG
 * ---------------------------------------------------------------------------
 * `logout` cleared four stores by name — agents, workflows, tools, goals —
 * while `initializeStore` fills twelve. The other eight kept the previous
 * user's data AND their `lastFetched` timestamps, so the next user's fetch
 * short-circuited on a cache describing somebody else.
 *
 * A hand-written list of stores, maintained in the auth module, was always
 * going to fall behind the list of stores the app actually loads. So the
 * structural test below DERIVES the required list from `initializeStore`'s own
 * source and fails when the two disagree — which is the only version of this
 * that stays true a year from now.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function ensureLocalStorage() {
  if (typeof globalThis.localStorage?.getItem === 'function') return;
  const map = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(String(k), String(v)),
      removeItem: (k) => map.delete(k),
      clear: () => map.clear(),
    },
    configurable: true,
  });
}
ensureLocalStorage();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.resolve(HERE, p), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const { withUserScopedReset, RESET_MUTATION } = await import('./_utils/userScopedReset.js');

describe('withUserScopedReset — a reset derived from the module itself', () => {
  it('restores every field, including ones added after it was written', () => {
    // The point of deriving: a hand-written clear enumerates the fields that
    // existed the day it was written. This one cannot fall behind.
    const mod = withUserScopedReset({
      namespaced: true,
      state: { items: [], lastFetched: null, isFetching: false, activeId: null },
      mutations: {},
    });
    const state = { items: [{ id: 1 }], lastFetched: 123, isFetching: true, activeId: 'x' };

    mod.mutations[RESET_MUTATION](state);

    expect(state).toEqual({ items: [], lastFetched: null, isFetching: false, activeId: null });
  });

  it('clears the cache timestamp, not just the data', () => {
    // The half that actually bit: data cleared, `lastFetched` left behind, so
    // the next fetch decided it was still fresh and returned nothing.
    const mod = withUserScopedReset({ state: { rows: [], lastFetched: null }, mutations: {} });
    const state = { rows: [1, 2, 3], lastFetched: Date.now() };

    mod.mutations[RESET_MUTATION](state);

    expect(state.lastFetched).toBeNull();
  });

  it('keeps the module\u2019s existing mutations', () => {
    const mod = withUserScopedReset({
      state: { n: 0 },
      mutations: { BUMP(state) { state.n += 1; } },
    });
    expect(typeof mod.mutations.BUMP).toBe('function');
    expect(typeof mod.mutations[RESET_MUTATION]).toBe('function');
  });

  it('resets in place, so components holding the state object still see it', () => {
    const mod = withUserScopedReset({ state: { rows: [] }, mutations: {} });
    const state = { rows: [1] };
    const held = state;

    mod.mutations[RESET_MUTATION](state);

    expect(held.rows).toEqual([]);
  });

  it('hands out a fresh copy each time — no shared reference to the snapshot', () => {
    // If the snapshot were assigned by reference, the first user to push into
    // a reset array would corrupt every future reset.
    const mod = withUserScopedReset({ state: { rows: [] }, mutations: {} });
    const a = { rows: ['dirty'] };
    const b = { rows: ['dirty'] };

    mod.mutations[RESET_MUTATION](a);
    a.rows.push('mutated after reset');
    mod.mutations[RESET_MUTATION](b);

    expect(b.rows).toEqual([]);
  });

  it('supports a state FACTORY as well as a literal', () => {
    // contentOutputs declares a factory on purpose (a shared literal leaked
    // between stores in tests). The wrapper must not care which it gets.
    const mod = withUserScopedReset({ state: () => ({ rows: [], lastFetched: null }), mutations: {} });
    const state = { rows: [1], lastFetched: 5 };

    mod.mutations[RESET_MUTATION](state);

    expect(state).toEqual({ rows: [], lastFetched: null });
  });

  it('deep-clones nested state rather than sharing it', () => {
    const mod = withUserScopedReset({ state: { nested: { list: [], flag: false } }, mutations: {} });
    const state = { nested: { list: [1], flag: true } };

    mod.mutations[RESET_MUTATION](state);
    state.nested.list.push('after');

    const second = { nested: { list: [9], flag: true } };
    mod.mutations[RESET_MUTATION](second);
    expect(second.nested).toEqual({ list: [], flag: false });
  });
});

describe('the reset list cannot drift behind what a session loads', () => {
  const src = stripComments(read('./state.js'));

  /** The modules `initializeStore` dispatches into. */
  function modulesLoadedBySession() {
    const start = src.indexOf('async initializeStore(');
    const end = src.indexOf('async resetUserScopedData(');
    expect(start, 'initializeStore not found in state.js').toBeGreaterThan(-1);
    expect(end, 'resetUserScopedData not found in state.js').toBeGreaterThan(start);
    const body = src.slice(start, end);
    return new Set(
      [...body.matchAll(/dispatch\('([a-zA-Z]+)\/[a-zA-Z]+'\)/g)].map((m) => m[1]),
    );
  }

  /** The modules declared user-scoped, and therefore reset on session end. */
  function modulesResetOnSessionEnd() {
    const block = /const USER_SCOPED_MODULES = \{([\s\S]*?)\};/.exec(src);
    expect(block, 'USER_SCOPED_MODULES not found in state.js').not.toBeNull();
    return new Set(
      block[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  it('finds a non-trivial set on both sides (anti-vacuity)', () => {
    expect(modulesLoadedBySession().size).toBeGreaterThan(5);
    expect(modulesResetOnSessionEnd().size).toBeGreaterThan(5);
  });

  it('every module a session LOADS is a module a session end CLEARS', () => {
    const loaded = modulesLoadedBySession();
    const reset = modulesResetOnSessionEnd();
    const missing = [...loaded].filter((m) => !reset.has(m));

    expect(
      missing,
      `these are loaded by initializeStore but never cleared on logout: ${missing.join(', ')}. ` +
        'Add them to USER_SCOPED_MODULES in store/state.js, or the next user to sign in ' +
        'sees the previous one\u2019s data.',
    ).toEqual([]);
  });

  it('resetUserScopedData actually iterates the table rather than naming stores', () => {
    // A loop over the table is what makes the guard above meaningful; a
    // hand-written list inside the action would pass the check and still drift.
    expect(src).toMatch(/for \(const name of Object\.keys\(USER_SCOPED_MODULES\)\)/);
    expect(src).toMatch(/commit\(`\$\{name\}\/\$\{RESET_MUTATION\}`\)/);
  });

  it('every user-scoped module is registered through the wrapper', () => {
    // Listing a raw module in `modules:` would compile and then silently fail
    // to clear, because it would have no RESET_USER_SCOPED_STATE.
    expect(src).toMatch(/const resettableModules = Object\.fromEntries\(/);
    expect(src).toMatch(/\.\.\.resettableModules,/);
  });

  it('side effects run BEFORE the state they reference is wiped', () => {
    // appAuth keeps `pollingIntervalId` in state: blanking it without clearing
    // the interval leaks a poller that then 401s forever against a dead token.
    // goals keeps live subscription callbacks that CLEAR_GOALS unsubscribes.
    const action = src.slice(src.indexOf('async resetUserScopedData('));
    const stopAt = action.indexOf("dispatch('appAuth/stopPolling')");
    const goalsAt = action.indexOf("commit('goals/CLEAR_GOALS')");
    const loopAt = action.indexOf('for (const name of');

    expect(stopAt).toBeGreaterThan(-1);
    expect(goalsAt).toBeGreaterThan(-1);
    expect(stopAt).toBeLessThan(loopAt);
    expect(goalsAt).toBeLessThan(loopAt);
  });

  it('logout no longer keeps its own private list of stores', () => {
    // The original defect, in its original location.
    const auth = stripComments(read('./auth/userAuth.js'));
    const logout = auth.slice(auth.indexOf('logout({ commit })'));
    expect(logout).not.toMatch(/CLEAR_AGENTS/);
    expect(logout).not.toMatch(/CLEAR_WORKFLOWS/);
    expect(logout).not.toMatch(/root: true/);
  });
});

describe('caches that describe a user are scoped to that user', () => {
  // `withFreshness` has supported `identity` since the license fix, and the
  // comment there spells out exactly why: "a TTL answers 'is this data old?',
  // which is the wrong question for anything fetched on behalf of a subject".
  //
  // It was then applied to ONE action. Six others cached user-specific data on
  // a plain TTL — including appAuth.fetchAllProviders at THIRTY MINUTES, so
  // signing in as a different account showed the previous account's provider
  // connections for half an hour.
  //
  // Counting rather than parsing: every wrapped action must contribute an
  // `identity`, so the counts have to match. Add a seventh cache without one
  // and this fails.
  const FILES = ['./auth/userAuth.js', './auth/appAuth.js', './app/aiProvider.js'];

  it.each(FILES)('%s scopes every withFreshness cache to the session', (file) => {
    const src = stripComments(read(file));
    const wrapped = (src.match(/withFreshness\(\s*'/g) || []).length;
    const scoped = (src.match(/\bidentity:/g) || []).length;

    expect(wrapped, `${file} has no withFreshness call sites — did it move?`).toBeGreaterThan(0);
    expect(
      scoped,
      `${file}: ${wrapped} cached action(s) but only ${scoped} identity scope(s). ` +
        'An unscoped cache serves the previous account\u2019s data to the next one.',
    ).toBeGreaterThanOrEqual(wrapped);
  });

  it('the identity is derived from the token, not from anything mutable', () => {
    // authSubject reads the JWT subject. Deriving it from, say, state.user
    // would be circular: that is one of the values being cached.
    for (const file of FILES) {
      const src = stripComments(read(file));
      expect(src, `${file} does not derive identity from the token`).toMatch(/authSubject\(/);
    }
  });

  it('withFreshness still honours the option (anti-vacuity)', () => {
    const src = stripComments(read('./_utils/withFreshness.js'));
    expect(src).toMatch(/identityChanged/);
  });
});

describe('a real store clears on session end', () => {
  let store;

  beforeEach(async () => {
    // A fresh module registry per test: state.js builds the store at import.
    const mod = await import('./state.js?behavioural');
    store = mod.default;
  });

  it('drops loaded data and the cache timestamp together', async () => {
    store.commit('groups/SET_GROUPS', [{ id: 'g1', name: 'Secret Project' }]);
    expect(store.state.groups.groups).toHaveLength(1);
    expect(store.state.groups.lastFetched).not.toBeNull();

    await store.dispatch('resetUserScopedData');

    expect(store.state.groups.groups).toEqual([]);
    // The half that mattered: with a timestamp left behind, groups/fetchGroups
    // returns the cache and the next user sees the previous user's groups.
    expect(store.state.groups.lastFetched).toBeNull();
  });

  it('clears stores that logout used to miss entirely', async () => {
    store.commit('skills/SET_SKILLS', [{ id: 's1' }]);
    store.commit('agents/SET_AGENTS', [{ id: 'a1' }]);

    await store.dispatch('resetUserScopedData');

    expect(store.state.skills.skills).toEqual([]);
    expect(store.state.agents.agents).toEqual([]);
  });

  it('every user-scoped module really has the reset mutation registered', () => {
    // Proves the wrapper reached the live store, not just the source text.
    const registered = Object.keys(store._mutations).filter((k) => k.endsWith(`/${RESET_MUTATION}`));
    expect(registered.length).toBeGreaterThanOrEqual(10);
  });
});
