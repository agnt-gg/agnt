/**
 * Cross-device preference sync — client contract.
 *
 * Each of these is a bug a user would actually report, in their words:
 *   "my theme didn't follow me to the laptop"
 *   "my laptop panels got resized to my desktop's widths"
 *   "I changed the theme while it was loading and it flipped back"
 *   "dragging a panel hammers the server"
 *   "it kept flickering between two themes forever"       (the echo loop)
 *   "an old tab I left open reset my theme overnight"
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStore } from 'vuex';

vi.mock('@/tt.config.js', () => ({
  API_CONFIG: { BASE_URL: 'http://localhost:3333/api' },
}));

const {
  getDeviceId,
  getDeviceLabel,
  hydrateFromServer,
  startPreferenceSync,
  stopPreferenceSync,
  _resetForTests,
  _internal,
} = await import('./userPreferences.js');

const { default: themeModule } = await import('@/store/app/theme.js');

// theme.js exports `state` as a plain object, so every createStore() would
// otherwise share one mutable instance and a commit in one test would leak
// into the next.
const BASE_STATE = structuredClone(themeModule.state);

/**
 * @param sessionValid mirrors userAuth's sessionState tristate resolved to a
 *   boolean. Sync gates on the BACKEND-CONFIRMED session, not on a token
 *   string, so the stub has to model the getter rather than localStorage.
 */
const makeStore = (sessionValid = true) =>
  createStore({
    modules: {
      theme: { ...themeModule, namespaced: true, state: structuredClone(BASE_STATE) },
      userAuth: {
        namespaced: true,
        state: () => ({}),
        getters: { isAuthenticated: () => sessionValid },
      },
    },
  });

let fetchMock;

/** Last PUT body sent, parsed. */
const putBodies = () =>
  fetchMock.mock.calls
    .filter(([, opts]) => opts?.method === 'PUT')
    .map(([, opts]) => JSON.parse(opts.body));

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'test-jwt');
  _resetForTests();
  vi.useFakeTimers();
  fetchMock = vi.fn().mockResolvedValue(okJson({ success: true, preferences: null }));
  globalThis.fetch = fetchMock;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────
describe('device identity', () => {
  it('mints an id that satisfies the server validator', () => {
    const id = getDeviceId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it('is stable across calls — a new id every boot would leak device buckets', () => {
    expect(getDeviceId()).toBe(getDeviceId());
  });

  it('persists so a reload keeps the same geometry bucket', () => {
    const first = getDeviceId();
    expect(localStorage.getItem('agnt:deviceId')).toBe(first);
  });

  it('rejects a corrupted stored id rather than sending it and 400ing forever', () => {
    localStorage.setItem('agnt:deviceId', 'not a valid id!!');
    expect(getDeviceId()).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(getDeviceId()).not.toBe('not a valid id!!');
  });

  it('produces a human-recognisable label, not a fingerprint', () => {
    expect(typeof getDeviceLabel()).toBe('string');
    expect(getDeviceLabel().length).toBeGreaterThan(0);
    expect(getDeviceLabel().length).toBeLessThanOrEqual(64);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('routing: taste syncs globally, pixels stay per-device', () => {
  it('sends theme in the global scope', async () => {
    const store = makeStore();
    startPreferenceSync(store);
    store.commit('theme/SET_THEME', 'cyberpunk');
    await vi.advanceTimersByTimeAsync(500);

    const [body] = putBodies();
    expect(body.global).toEqual({ currentTheme: 'cyberpunk' });
    expect(body.device).toBeUndefined();
  });

  it('sends panel geometry in the device scope, with a deviceId', async () => {
    const store = makeStore();
    startPreferenceSync(store);
    store.commit('theme/SET_PANEL_WIDTHS', { leftWidth: 520, rightWidth: 300 });
    await vi.advanceTimersByTimeAsync(500);

    const [body] = putBodies();
    expect(body.device).toEqual({ leftPanelWidth: 520, rightPanelWidth: 300 });
    expect(body.global).toBeUndefined();
    expect(body.deviceId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it('expands a multi-key mutation into every key it wrote', async () => {
    const store = makeStore();
    startPreferenceSync(store);
    store.commit('theme/SET_THREE_PANEL_WIDTHS', { actualLeftWidth: 300, mainWidth: 800, rightWidth: 400 });
    await vi.advanceTimersByTimeAsync(500);

    expect(putBodies()[0].device).toEqual({
      actualLeftPanelWidth: 300,
      mainContentWidth: 800,
      rightPanelWidth: 400,
    });
  });

  it('ignores mutations that are not synced settings', async () => {
    const store = makeStore();
    startPreferenceSync(store);
    store.commit('theme/SET_PROMO_BANNER_CLOSED', true);
    store.commit('theme/SET_RATE_LIMIT_BANNER_CLOSED', true);
    await vi.advanceTimersByTimeAsync(500);

    expect(putBodies()).toHaveLength(0);
  });

  it('never syncs the background-exists flag — the media itself is not synced', () => {
    expect(_internal.MUTATION_MAP['theme/SET_HAS_CUSTOM_BACKGROUND']).toBeUndefined();
    expect(_internal.MUTATION_MAP['theme/SET_BACKGROUND_FILE_NAME']).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('debounce — a drag must not hammer the server', () => {
  it('coalesces a burst into ONE request', async () => {
    const store = makeStore();
    startPreferenceSync(store);
    for (let w = 300; w <= 320; w++) {
      store.commit('theme/SET_PANEL_WIDTHS', { leftWidth: w, rightWidth: 384 });
    }
    await vi.advanceTimersByTimeAsync(500);

    const bodies = putBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].device.leftPanelWidth).toBe(320); // the final value wins
  });

  it('merges both scopes from one burst into a single request', async () => {
    const store = makeStore();
    startPreferenceSync(store);
    store.commit('theme/SET_THEME', 'nord');
    store.commit('theme/SET_UI_SCALE', 110);
    await vi.advanceTimersByTimeAsync(500);

    const bodies = putBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].global).toEqual({ currentTheme: 'nord' });
    expect(bodies[0].device).toEqual({ uiScale: 110 });
  });

  it('stamps updatedAt when the user ACTED, not when the debounce flushed', async () => {
    const store = makeStore();
    startPreferenceSync(store);

    const actedAt = Date.now();
    store.commit('theme/SET_THEME', 'ember');
    await vi.advanceTimersByTimeAsync(500);

    const { updatedAt } = putBodies()[0];
    // Backdating to flush time would let a slow client lose to a stale one.
    expect(updatedAt).toBeGreaterThanOrEqual(actedAt);
    expect(updatedAt).toBeLessThan(actedAt + _internal.PUSH_DEBOUNCE_MS);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('hydration', () => {
  it('applies a theme set on another device', async () => {
    const store = makeStore();
    fetchMock.mockResolvedValue(
      okJson({ success: true, preferences: { global: { currentTheme: 'cyberpunk' }, device: {} } }),
    );

    await hydrateFromServer(store);
    expect(store.state.theme.currentTheme).toBe('cyberpunk');
  });

  it('applies this device geometry without touching global taste', async () => {
    const store = makeStore();
    fetchMock.mockResolvedValue(
      okJson({ success: true, preferences: { global: {}, device: { leftPanelWidth: 275 } } }),
    );

    await hydrateFromServer(store);
    expect(store.state.theme.leftPanelWidth).toBe(275);
  });

  it('asks for THIS device bucket by id', async () => {
    const store = makeStore();
    await hydrateFromServer(store);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(`deviceId=${getDeviceId()}`);
  });

  it('★ does NOT echo hydrated values back to the server', async () => {
    const store = makeStore();
    fetchMock.mockResolvedValue(
      okJson({ success: true, preferences: { global: { currentTheme: 'midnight' }, device: {} } }),
    );

    startPreferenceSync(store);
    await vi.advanceTimersByTimeAsync(1000);

    // An echo would push the value straight back, bump updatedAt, and let a
    // stale device win the next comparison — forever.
    expect(putBodies()).toHaveLength(0);
  });

  it('★ does NOT undo a change the user made while hydration was in flight', async () => {
    const store = makeStore();
    let resolveFetch;
    fetchMock.mockReturnValue(new Promise((r) => { resolveFetch = r; }));

    startPreferenceSync(store);

    // The user picks a theme before the server responds.
    store.commit('theme/SET_THEME', 'hacker');

    // ...and only now does the (older) server state arrive.
    resolveFetch(okJson({ success: true, preferences: { global: { currentTheme: 'light' }, device: {} } }));
    await vi.advanceTimersByTimeAsync(1000);

    expect(store.state.theme.currentTheme).toBe('hacker');
  });

  it('still applies untouched keys when one key was edited in flight', async () => {
    const store = makeStore();
    let resolveFetch;
    fetchMock.mockReturnValue(new Promise((r) => { resolveFetch = r; }));

    startPreferenceSync(store);
    store.commit('theme/SET_THEME', 'hacker');

    resolveFetch(okJson({
      success: true,
      preferences: { global: { currentTheme: 'light', fontFamily: 'mono' }, device: {} },
    }));
    await vi.advanceTimersByTimeAsync(1000);

    expect(store.state.theme.currentTheme).toBe('hacker'); // user's edit kept
    expect(store.state.theme.fontFamily).toBe('mono');     // other device's setting still lands
  });

  it('ignores unknown keys from a newer server without throwing', async () => {
    const store = makeStore();
    fetchMock.mockResolvedValue(
      okJson({ success: true, preferences: { global: { futureKey: 'x', currentTheme: 'nord' }, device: {} } }),
    );

    await expect(hydrateFromServer(store)).resolves.toBeTruthy();
    expect(store.state.theme.currentTheme).toBe('nord');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('degrades quietly', () => {
  it('does not sync for a session the backend has not confirmed', async () => {
    // A token string in localStorage is NOT a session. Gating on one is how
    // the app came to render a full UI for an unverified user; preferences
    // must not reintroduce that by making requests boot deliberately defers.
    localStorage.setItem('token', 'stale-jwt');
    const store = makeStore(false);
    startPreferenceSync(store);
    store.commit('theme/SET_THEME', 'rose');
    await vi.advanceTimersByTimeAsync(500);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.state.theme.currentTheme).toBe('rose'); // still works locally
    expect(localStorage.getItem('currentTheme')).toBe('rose');
  });

  it('reports an unverified session distinctly when hydrating', async () => {
    const store = makeStore(false);
    await expect(hydrateFromServer(store)).resolves.toEqual({ skipped: 'unverified-session' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('survives an offline hydrate and leaves local state alone', async () => {
    const store = makeStore();
    const before = store.state.theme.currentTheme;
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(hydrateFromServer(store)).resolves.toEqual({ skipped: 'offline' });
    expect(store.state.theme.currentTheme).toBe(before);
  });

  it('survives a failed push without losing the local change', async () => {
    const store = makeStore();
    startPreferenceSync(store);
    fetchMock.mockRejectedValue(new Error('500'));

    store.commit('theme/SET_THEME', 'ember');
    await vi.advanceTimersByTimeAsync(500);

    expect(store.state.theme.currentTheme).toBe('ember');
    expect(localStorage.getItem('currentTheme')).toBe('ember');
  });

  /**
   * Fail the first N PUTs and let everything else through.
   *
   * Method-aware on purpose: startPreferenceSync issues a GET before any PUT,
   * so a bare mockRejectedValueOnce is swallowed by the hydrate and the push
   * under test quietly succeeds — the test then passes for the wrong reason.
   */
  const failPuts = (n) => {
    let failures = 0;
    fetchMock.mockImplementation((_url, opts = {}) => {
      if (opts.method === 'PUT' && failures < n) {
        failures += 1;
        return Promise.reject(new Error('network down'));
      }
      return Promise.resolve(okJson({ success: true, preferences: null }));
    });
  };

  it('★ re-sends a change whose push failed, instead of dropping it silently', async () => {
    const store = makeStore();
    startPreferenceSync(store);

    // The local write already succeeded, so a dropped push is invisible: the
    // theme is applied HERE and nowhere else, forever, with no error anywhere.
    failPuts(1);
    store.commit('theme/SET_THEME', 'ember');
    await vi.advanceTimersByTimeAsync(500);
    expect(putBodies()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(3000); // past the 2s retry backoff

    const bodies = putBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[1].global).toEqual({ currentTheme: 'ember' });
  });

  it('lets a newer change win when merging a failed batch back in', async () => {
    const store = makeStore();
    startPreferenceSync(store);

    failPuts(1);
    store.commit('theme/SET_THEME', 'ember');
    await vi.advanceTimersByTimeAsync(500);

    // Changed again while the retry was pending: the newer value is the user's
    // real intent and must not be reverted by the replayed batch.
    store.commit('theme/SET_THEME', 'nord');
    await vi.advanceTimersByTimeAsync(3000);

    const last = putBodies().at(-1);
    expect(last.global.currentTheme).toBe('nord');
  });

  it('backs off rather than hammering a server that is down', async () => {
    const store = makeStore();
    startPreferenceSync(store);
    fetchMock.mockRejectedValue(new Error('503'));

    store.commit('theme/SET_THEME', 'ember');
    await vi.advanceTimersByTimeAsync(500);
    const afterFirst = putBodies().length;

    // 10s of downtime: with a 2s base doubling to 4s and 8s this is ~3 more
    // attempts, not the ~25 a fixed debounce-interval retry would produce.
    await vi.advanceTimersByTimeAsync(10000);
    const attempts = putBodies().length - afterFirst;
    expect(attempts).toBeGreaterThan(0);
    expect(attempts).toBeLessThan(6);
  });

  it('tolerates a server returning no preferences block', async () => {
    const store = makeStore();
    fetchMock.mockResolvedValue(okJson({ success: true }));
    await expect(hydrateFromServer(store)).resolves.toEqual({ skipped: 'empty' });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('hydration repaint window', () => {
  const hydrating = () => document.documentElement.classList.contains('prefs-hydrating');

  it('★ keeps the class on long enough for the transition to actually run', async () => {
    const store = makeStore();
    fetchMock.mockResolvedValue(
      okJson({ success: true, preferences: { global: { currentTheme: 'cyberpunk' }, device: {} } }),
    );

    await hydrateFromServer(store);
    // The apply loop is synchronous. Removing the class at the end of it would
    // take it off in the same frame it went on, and the browser would never
    // run the transition at all — the easing would silently never happen.
    expect(hydrating()).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    expect(hydrating()).toBe(false);
  });

  it('does not open the window when the server agrees with local state', async () => {
    const store = makeStore();
    fetchMock.mockResolvedValue(okJson({ success: true, preferences: { global: {}, device: {} } }));

    await hydrateFromServer(store);
    // The common case. Transitioning every element for a repaint that never
    // happens is pure cost.
    expect(hydrating()).toBe(false);
  });

  it('does not leave the app stuck transitioning when an apply throws', async () => {
    const store = makeStore();
    vi.spyOn(store, 'dispatch').mockImplementation(() => {
      throw new Error('boom');
    });
    fetchMock.mockResolvedValue(
      okJson({ success: true, preferences: { global: { currentTheme: 'nord' }, device: {} } }),
    );

    await hydrateFromServer(store);
    await vi.advanceTimersByTimeAsync(500);
    expect(hydrating()).toBe(false);
  });
});

describe('session teardown — sign-out no longer reloads the page', () => {
  it('★ never sends one user\u2019s queued preferences under the next user\u2019s token', async () => {
    const store = makeStore();
    startPreferenceSync(store);

    store.commit('theme/SET_THEME', 'ember'); // queued, not yet flushed
    stopPreferenceSync();                     // endSession fires here
    await vi.advanceTimersByTimeAsync(2000);

    expect(putBodies()).toHaveLength(0);
  });

  it('stops watching the store, so a later change is not attributed to the old session', async () => {
    const store = makeStore();
    startPreferenceSync(store);
    stopPreferenceSync();

    store.commit('theme/SET_THEME', 'nord');
    await vi.advanceTimersByTimeAsync(2000);

    expect(putBodies()).toHaveLength(0);
  });

  it('clears touchedKeys so the NEXT user\u2019s hydration is not suppressed', async () => {
    const store = makeStore();
    startPreferenceSync(store);
    store.commit('theme/SET_THEME', 'ember'); // marks currentTheme as touched
    stopPreferenceSync();

    const next = makeStore();
    fetchMock.mockResolvedValue(
      okJson({ success: true, preferences: { global: { currentTheme: 'rose' }, device: {} } }),
    );
    const result = await hydrateFromServer(next);

    expect(result.applied).toContain('currentTheme');
    expect(next.state.theme.currentTheme).toBe('rose');
  });

  it('drops a retry that was pending when the session ended', async () => {
    const store = makeStore();
    startPreferenceSync(store);
    fetchMock.mockRejectedValue(new Error('offline'));

    store.commit('theme/SET_THEME', 'ember');
    await vi.advanceTimersByTimeAsync(500);
    const beforeStop = putBodies().length;

    stopPreferenceSync();
    await vi.advanceTimersByTimeAsync(30000);

    expect(putBodies()).toHaveLength(beforeStop);
  });
});

describe('never takes session boot down with it', () => {
  it('★ does not throw on a store it cannot subscribe to', () => {
    // startPreferenceSync runs inside sessionBoot's idle() — a timer with no
    // caller — so a synchronous throw escapes as an unhandled ERROR and aborts
    // every step queued after it (run resumption, channel reclaim). Preferences
    // are cosmetic and must never be able to do that.
    expect(() => startPreferenceSync({})).not.toThrow();
    expect(() => startPreferenceSync(null)).not.toThrow();
  });

  it('does not throw when hydration blows up synchronously', () => {
    const store = makeStore();
    fetchMock.mockImplementation(() => {
      throw new Error('synchronous explosion');
    });
    expect(() => startPreferenceSync(store)).not.toThrow();
  });
});

describe('transport', () => {
  it('owns Authorization — a caller cannot override or drop it', async () => {
    const store = makeStore();
    localStorage.setItem('token', 'real-jwt');
    fetchMock.mockResolvedValue(okJson({ success: true, preferences: null }));

    await hydrateFromServer(store);

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer real-jwt');
  });
});

describe('localStorage stays the first-paint source', () => {
  it('a synced value is written to localStorage so the NEXT boot paints it instantly', async () => {
    const store = makeStore();
    fetchMock.mockResolvedValue(
      okJson({ success: true, preferences: { global: { currentTheme: 'nord' }, device: {} } }),
    );

    await hydrateFromServer(store);
    // Without this the feature would only work while online, and every reload
    // would flash the old theme before the network answered.
    expect(localStorage.getItem('currentTheme')).toBe('nord');
  });
});
