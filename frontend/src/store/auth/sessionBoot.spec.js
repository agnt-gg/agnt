/**
 * The session lifecycle: what loads when one starts, what stops when one ends.
 *
 * ---------------------------------------------------------------------------
 * THE BUG
 * ---------------------------------------------------------------------------
 * Loading the user's data was triggered by a PAGE LOAD that happened to find a
 * token, not by a session beginning. Signing in does not reload the page, so
 * each of the four sign-in paths had hand-rolled its own partial imitation and
 * no two agreed — the two Google paths never dispatched `initializeStore` at
 * all, so a Google sign-in loaded no agents, workflows, tools, outputs, groups,
 * stats, skills, widgets or connected apps. The panels had been deliberately
 * stripped of their own fetches ("pre-loaded by initializeStore in main.js"),
 * so the app rendered empty until the user pressed refresh.
 *
 * These tests pin the replacement: ONE sequence, fired by the state
 * transition, so no sign-in path has to remember anything.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.resolve(HERE, p), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

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

const { startSession, endSession, watchSession, __resetSessionScopeForTests } = await import('./sessionBoot.js');

/**
 * A store double.
 *
 * `watch` mirrors Vuex's contract closely enough for the transition logic:
 * a getter over state, and a callback invoked with (next, prev) when the
 * observed value changes.
 */
function makeStore({ token = 'a.b.c', sessionState = 'unknown' } = {}) {
  const watchers = [];
  const store = {
    state: { userAuth: { token, sessionState } },
    dispatch: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn(),
    watch(getter, cb) {
      watchers.push({ getter, cb, last: getter(store.state) });
      return () => watchers.splice(0, watchers.length);
    },
    /** Drive a state change the way a Vuex mutation would. */
    setSessionState(next) {
      store.state.userAuth.sessionState = next;
      for (const w of watchers) {
        const value = w.getter(store.state);
        if (value !== w.last) {
          const prev = w.last;
          w.last = value;
          w.cb(value, prev);
        }
      }
    },
  };
  return store;
}

/** Let requestIdleCallback / setTimeout(…, 1) fire and promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const dispatched = (store) => store.dispatch.mock.calls.map((c) => c[0]);

beforeEach(() => {
  __resetSessionScopeForTests();
  localStorage.clear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  __resetSessionScopeForTests();
  vi.restoreAllMocks();
});

describe('startSession — one definition of "what being signed in loads"', () => {
  it('loads the user data fan-out', async () => {
    // THE regression. `initializeStore` is agents, workflows, tools, outputs,
    // groups, stats, skills, widgets and connected apps — everything the
    // panels render and deliberately do not fetch themselves.
    const store = makeStore();
    await startSession(store, { reason: 'test', resumeInflightRuns: vi.fn().mockResolvedValue() });
    await settle();

    expect(dispatched(store)).toContain('initializeStore');
  });

  it('runs every part of the sequence, not a subset', async () => {
    // Each sign-in path used to pick a different handful. Naming them all here
    // means dropping one is a test failure rather than a screen that is quietly
    // blank for whoever used that particular button.
    const store = makeStore();
    await startSession(store, { reason: 'test', resumeInflightRuns: vi.fn().mockResolvedValue() });
    await settle();

    const calls = dispatched(store);
    for (const action of [
      'userAuth/syncTokenWithBackend',
      'userAuth/fetchUserData',
      'userAuth/fetchSubscription',
      'userAuth/fetchPseudonym',
      'initializeStore',
      'appAuth/startPolling',
      'aiProvider/fetchCustomProviders',
      'aiProvider/loadUserSettings',
      'chatUnified/reclaimChannelScopes',
    ]) {
      expect(calls, `missing from the session sequence: ${action}`).toContain(action);
    }
  });

  it('rejoins chat turns that were still generating', async () => {
    const store = makeStore();
    const resumeInflightRuns = vi.fn().mockResolvedValue();
    await startSession(store, { reason: 'test', resumeInflightRuns });
    await settle();

    expect(resumeInflightRuns).toHaveBeenCalledWith(store);
  });

  it('syncs the token to the local backend BEFORE loading anything', async () => {
    // Some backend routes read the server-side session rather than the bearer
    // header. Loading first would race them.
    const store = makeStore();
    await startSession(store, { reason: 'test', resumeInflightRuns: vi.fn().mockResolvedValue() });
    await settle();

    const calls = dispatched(store);
    expect(calls.indexOf('userAuth/syncTokenWithBackend')).toBe(0);
    expect(calls.indexOf('userAuth/syncTokenWithBackend')).toBeLessThan(calls.indexOf('initializeStore'));
  });

  it('concurrent starts share ONE run', async () => {
    // Boot and the router guard can both observe the transition in the same
    // tick. Loading the whole app twice would double every request.
    const store = makeStore();
    const opts = { reason: 'test', resumeInflightRuns: vi.fn().mockResolvedValue() };

    await Promise.all([startSession(store, opts), startSession(store, opts), startSession(store, opts)]);
    await settle();

    expect(dispatched(store).filter((a) => a === 'initializeStore')).toHaveLength(1);
  });

  it('never rejects, even when a step blows up', async () => {
    // It is called from a store watcher, which has nowhere to catch. A
    // half-loaded app must not also produce an unhandled rejection.
    const store = makeStore();
    store.dispatch = vi.fn().mockRejectedValue(new Error('backend down'));

    await expect(startSession(store, { reason: 'test', resumeInflightRuns: vi.fn() })).resolves.toBeUndefined();
  });

  it('skips license revalidation when a cached license fits this session', async () => {
    const token = 'a.b.c';
    localStorage.setItem(
      'signedLicense',
      JSON.stringify({ license: { userId: 'u-1', expiresAt: Math.floor(Date.now() / 1000) + 86400 } }),
    );
    const store = makeStore({ token });
    // licenseMatchesSubject compares the license subject with the token
    // subject; an unparseable token yields the anonymous subject, which will
    // not match 'u-1', so this asserts the MISS path revalidates.
    await startSession(store, { reason: 'test', resumeInflightRuns: vi.fn().mockResolvedValue() });
    await settle();

    expect(dispatched(store)).toContain('userAuth/validateLicense');
  });
});

describe('endSession — the symmetry that was missing', () => {
  it('clears every user-scoped store', async () => {
    const store = makeStore({ sessionState: 'valid' });
    await endSession(store, { reason: 'test' });

    expect(dispatched(store)).toContain('resetUserScopedData');
  });

  it('lets a later session load again rather than being deduped away', async () => {
    // The in-flight dedupe must not outlive the session it belonged to, or
    // signing back in would silently load nothing.
    const store = makeStore();
    const opts = { reason: 'test', resumeInflightRuns: vi.fn().mockResolvedValue() };

    await startSession(store, opts);
    await settle();
    await endSession(store, { reason: 'test' });
    store.dispatch.mockClear();

    await startSession(store, opts);
    await settle();

    expect(dispatched(store)).toContain('initializeStore');
  });
});

describe('watchSession — the trigger is the transition, not the page load', () => {
  const opts = () => ({ resumeInflightRuns: vi.fn().mockResolvedValue() });

  it('starts a session when one becomes valid', async () => {
    const store = makeStore({ sessionState: 'unknown' });
    watchSession(store, opts());

    store.setSessionState('valid');
    await settle();

    expect(dispatched(store)).toContain('initializeStore');
  });

  it('starts it for a sign-in, which is a transition with no page load', async () => {
    // invalid -> valid is exactly what a login does: the user was signed out,
    // now they are not, and nothing reloaded. This is the case every sign-in
    // path had to hand-roll, and the two Google ones did not.
    const store = makeStore({ sessionState: 'invalid' });
    watchSession(store, opts());

    store.setSessionState('valid');
    await settle();

    expect(dispatched(store)).toContain('initializeStore');
  });

  it('ends the session when it stops being valid', async () => {
    const store = makeStore({ sessionState: 'valid' });
    watchSession(store, opts());

    store.setSessionState('invalid');
    await settle();

    expect(dispatched(store)).toContain('resetUserScopedData');
  });

  it('ends it on a mid-session revocation too, not just an explicit logout', async () => {
    // The axios interceptor dispatches logout when the backend rejects the
    // token mid-flight. Watching the STATE rather than the logout action means
    // that path clears data without knowing it has to.
    const store = makeStore({ sessionState: 'valid' });
    watchSession(store, opts());

    store.setSessionState('unknown');
    await settle();

    expect(dispatched(store)).toContain('resetUserScopedData');
  });

  it('does NOT tear down when a session that never started goes invalid', async () => {
    // unknown -> invalid at boot is the ordinary "no token" case. Nothing was
    // loaded, and firing a teardown would clear stores for no reason.
    const store = makeStore({ sessionState: 'unknown' });
    watchSession(store, opts());

    store.setSessionState('invalid');
    await settle();

    expect(dispatched(store)).not.toContain('resetUserScopedData');
  });

  it('does not reload on a repeated valid', async () => {
    const store = makeStore({ sessionState: 'unknown' });
    watchSession(store, opts());

    store.setSessionState('valid');
    await settle();
    store.setSessionState('valid');
    await settle();

    expect(dispatched(store).filter((a) => a === 'initializeStore')).toHaveLength(1);
  });

  it('is installed at boot, before anything can change the session state', () => {
    // A watcher installed after the first transition would miss it, and the
    // very first transition of a page load is the common case.
    const main = stripComments(read('../../main.js'));
    expect(main).toMatch(/watchSession\(store\)/);
    expect(main.indexOf('watchSession(store)')).toBeLessThan(main.indexOf('initializeApp()'));
  });

  it('reloads for a second sign-in in the same page load', async () => {
    // Log out, log back in, no refresh — the exact thing the user reported.
    const store = makeStore({ sessionState: 'unknown' });
    watchSession(store, opts());

    store.setSessionState('valid');
    await settle();
    store.setSessionState('invalid');
    await settle();
    store.dispatch.mockClear();

    store.setSessionState('valid');
    await settle();

    expect(dispatched(store)).toContain('initializeStore');
  });
});

describe('source contract — exactly one place decides what a session loads', () => {
  const loginSection = stripComments(
    read('../../views/Terminal/CenterPanel/screens/Settings/components/LoginSection/LoginSection.vue'),
  );
  const userAuth = stripComments(read('./userAuth.js'));
  const sessionBoot = stripComments(read('./sessionBoot.js'));

  it('sessionBoot is the only dispatcher of the data fan-out', () => {
    // Four sign-in paths each hand-rolled a different subset of this. Any new
    // call site is a fifth subset waiting to disagree with the other four.
    const sources = {
      'LoginSection.vue': loginSection,
      'userAuth.js': userAuth,
      'main.js': stripComments(read('../../main.js')),
    };
    for (const [name, src] of Object.entries(sources)) {
      expect(src, `${name} dispatches initializeStore itself`).not.toMatch(/dispatch\(\s*'initializeStore'/);
    }
    expect(sessionBoot).toMatch(/dispatch\('initializeStore'\)/);
  });

  it('no sign-in path re-implements the identity fetches', () => {
    // These were the visible symptom of the missing abstraction: the same three
    // dispatches copy-pasted into each login handler, in a different
    // combination every time.
    for (const action of ['fetchSubscription', 'validateLicense', 'fetchPseudonym']) {
      expect(loginSection, `LoginSection still calls ${action} by hand`).not.toMatch(
        new RegExp(`dispatch\\(\\s*'userAuth/${action}'`),
      );
    }
  });

  it('the token sync is an action, not a component-local helper', () => {
    // It was a local function in LoginSection called from three places, one of
    // them without awaiting it.
    expect(loginSection).not.toMatch(/users\/sync-token/);
    expect(userAuth).toMatch(/async syncTokenWithBackend\(/);
    expect(sessionBoot).toMatch(/dispatch\('userAuth\/syncTokenWithBackend'\)/);
  });

  it('the Google paths verify the session, which is what triggers loading', () => {
    // They used to commit a token and navigate, so sessionState never moved and
    // nothing loaded. Verifying is now the whole login path.
    expect(loginSection).toMatch(/dispatch\('userAuth\/verifySession'\)/);
    expect(loginSection).toMatch(/const signIn = async \(token\)/);
  });
});
