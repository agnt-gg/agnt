/**
 * Behavioural tests for the session gate.
 *
 * ---------------------------------------------------------------------------
 * THE BUG (Nathan's Mac, 2026-08-06)
 * ---------------------------------------------------------------------------
 * The app rendered a full, populated UI for a session nobody had verified.
 * Three independent defects stacked:
 *
 *   1. `isAuthenticated` was `!!state.token` — a string in localStorage.
 *   2. Session validity was asked of api.agnt.gg, while the agents, chats and
 *      outputs on screen came from a DIFFERENT backend that was never asked.
 *   3. When api.agnt.gg was unreachable, the client DECODED the JWT and
 *      committed the result as the signed-in user.
 *
 * So: token present → app renders → auth server unreachable → user
 * reconstructed from the very token in question → complete session, zero
 * server confirmation.
 *
 * These tests pin the replacement: a tristate whose only rendering state is
 * granted by the backend that serves the data.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

vi.mock('axios', () => ({
  default: { get: vi.fn(), post: vi.fn().mockResolvedValue({ data: {} }) },
}));

const axios = (await import('axios')).default;
const { default: userAuth, SESSION } = await import('./userAuth.js');
const { API_CONFIG } = await import('@/tt.config.js');

const OK = {
  status: 200,
  data: { isAuthenticated: true, user: { id: 'u-1', email: 'a@b.c', auth_type: 'local' } },
};

/** An axios-shaped rejection. */
function httpError(status, data = {}) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
  });
}

function harness({ token = 'a.b.c' } = {}) {
  const state = { ...userAuth.state, token, user: null, sessionState: SESSION.UNKNOWN };
  const commit = vi.fn((type, payload) => {
    const m = userAuth.mutations[type];
    if (m) m(state, payload);
  });
  const dispatch = vi.fn();
  return { state, commit, dispatch };
}

const verify = (h) => userAuth.actions.verifySession({ commit: h.commit, state: h.state, dispatch: h.dispatch });

describe('verifySession — the only thing that may grant a session', () => {
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    axios.get.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('asks the backend that SERVES THE DATA, not the remote auth server', async () => {
    // The whole fix in one assertion. BASE_URL is the backend this window
    // talks to; REMOTE_URL is api.agnt.gg, which holds none of the data on
    // screen and whose opinion the data routes never consult.
    axios.get.mockResolvedValue(OK);
    const h = harness();

    await verify(h);

    expect(axios.get).toHaveBeenCalledOnce();
    const url = axios.get.mock.calls[0][0];
    expect(url).toBe(`${API_CONFIG.BASE_URL}/users/auth/status`);
    expect(url).not.toContain('api.agnt.gg');
  });

  it('grants VALID only on a positive confirmation', async () => {
    axios.get.mockResolvedValue(OK);
    const h = harness();

    await expect(verify(h)).resolves.toBe(SESSION.VALID);
    expect(h.state.sessionState).toBe(SESSION.VALID);
    expect(h.state.user).toMatchObject({ id: 'u-1' });
    expect(userAuth.getters.isAuthenticated(h.state)).toBe(true);
  });

  it('a token with no confirmation is NOT a session', async () => {
    // The original defect, stated directly: a token existed, so the app
    // rendered. Here the token exists and the probe has not answered.
    const h = harness();
    expect(h.state.token).toBeTruthy();
    expect(userAuth.getters.isAuthenticated(h.state)).toBe(false);
  });

  it('401 → INVALID (definitively rejected)', async () => {
    axios.get.mockRejectedValue(httpError(401, { error: 'Authentication required', reason: 'invalid' }));
    const h = harness();

    await expect(verify(h)).resolves.toBe(SESSION.INVALID);
    expect(h.state.sessionState).toBe(SESSION.INVALID);
    expect(h.state.lastAuthFailure).toMatchObject({ reason: 'http_401' });
    expect(userAuth.getters.isAuthenticated(h.state)).toBe(false);
  });

  it('403 → INVALID', async () => {
    axios.get.mockRejectedValue(httpError(403, { error: 'Forbidden' }));
    const h = harness();
    await expect(verify(h)).resolves.toBe(SESSION.INVALID);
  });

  it('no token at all → INVALID without a request', async () => {
    const h = harness({ token: null });

    await expect(verify(h)).resolves.toBe(SESSION.INVALID);
    expect(axios.get).not.toHaveBeenCalled();
    expect(h.state.lastAuthFailure).toMatchObject({ reason: 'no_token' });
  });

  it('a 200 that confirms nobody is a refusal, not an outage', async () => {
    axios.get.mockResolvedValue({ status: 200, data: { isAuthenticated: false, user: null } });
    const h = harness();

    await expect(verify(h)).resolves.toBe(SESSION.INVALID);
    expect(h.state.lastAuthFailure).toMatchObject({ reason: 'unauthenticated_response' });
  });

  // --- the asymmetry: silence grants nothing and destroys nothing ---

  it('server error → UNKNOWN: not signed in, but not signed OUT either', async () => {
    axios.get.mockRejectedValue(httpError(503, { error: 'Service Unavailable' }));
    const h = harness();

    await expect(verify(h)).resolves.toBe(SESSION.UNKNOWN);
    expect(userAuth.getters.isAuthenticated(h.state)).toBe(false);
    // The credential survives — an outage must not cost the user their login.
    expect(h.state.token).toBe('a.b.c');
    expect(h.commit).not.toHaveBeenCalledWith('CLEAR_TOKEN');
  });

  it('network error → UNKNOWN, token preserved', async () => {
    axios.get.mockRejectedValue(new Error('Network Error'));
    const h = harness();

    await expect(verify(h)).resolves.toBe(SESSION.UNKNOWN);
    expect(h.state.token).toBe('a.b.c');
  });

  it('timeout → UNKNOWN, token preserved', async () => {
    axios.get.mockRejectedValue(Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' }));
    const h = harness();

    await expect(verify(h)).resolves.toBe(SESSION.UNKNOWN);
    expect(h.state.token).toBe('a.b.c');
  });

  it('NEVER invents a user when it cannot reach the backend', async () => {
    // This is the JWT-decode fallback, which is what turned an unreachable
    // auth server into a fully rendered app. A real token is supplied so a
    // decode WOULD succeed if anything still attempted one.
    const realJwt = [
      Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
      Buffer.from(JSON.stringify({ id: 'u-1', email: 'a@b.c' })).toString('base64url'),
      'sig',
    ].join('.');
    axios.get.mockRejectedValue(new Error('Network Error'));
    const h = harness({ token: realJwt });

    await verify(h);

    expect(h.state.sessionState).toBe(SESSION.UNKNOWN);
    expect(h.state.user).toBeNull();
    expect(userAuth.getters.isAuthenticated(h.state)).toBe(false);
  });

  // --- concurrency ---

  it('concurrent callers share ONE round trip', async () => {
    // Boot and the router guard both ask at the same instant on every launch.
    axios.get.mockResolvedValue(OK);
    const h = harness();

    const results = await Promise.all([verify(h), verify(h), verify(h)]);

    expect(axios.get).toHaveBeenCalledOnce();
    expect(results).toEqual([SESSION.VALID, SESSION.VALID, SESSION.VALID]);
  });

  it('does not cache the answer across calls — a revoked session must be seen', async () => {
    // Sharing an IN-FLIGHT promise is fine; retaining a SETTLED one is a cache,
    // and a cached security gate keeps saying "valid" after the session died.
    axios.get.mockResolvedValue(OK);
    const h = harness();
    await verify(h);

    axios.get.mockRejectedValue(httpError(401, { error: 'Authentication required', reason: 'invalid' }));
    await expect(verify(h)).resolves.toBe(SESSION.INVALID);
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('a failed probe does not poison later ones', async () => {
    axios.get.mockRejectedValue(new Error('Network Error'));
    const h = harness();
    await verify(h);

    axios.get.mockResolvedValue(OK);
    await expect(verify(h)).resolves.toBe(SESSION.VALID);
  });
});

describe('session invariants', () => {
  it('clearing the token ends the session, whoever clears it', async () => {
    // Enforced in the mutation rather than at call sites, so a future caller
    // cannot produce the impossible state "valid session, no credential".
    const state = { ...userAuth.state, token: 't', sessionState: SESSION.VALID };
    userAuth.mutations.CLEAR_TOKEN(state);
    expect(state.sessionState).toBe(SESSION.INVALID);
    expect(userAuth.getters.isAuthenticated(state)).toBe(false);
  });

  it('a NEW token is unverified until the backend says otherwise', async () => {
    const state = { ...userAuth.state, token: null, sessionState: SESSION.VALID };
    userAuth.mutations.SET_TOKEN(state, 'fresh.token.here');
    expect(state.sessionState).toBe(SESSION.UNKNOWN);
    expect(userAuth.getters.isAuthenticated(state)).toBe(false);
  });

  it('logout leaves nothing that reads as signed in', async () => {
    const state = { ...userAuth.state, token: 't', sessionState: SESSION.VALID, user: { id: 'u' } };
    const commit = vi.fn((type, payload) => {
      const m = userAuth.mutations[type];
      if (m) m(state, payload);
    });

    userAuth.actions.logout({ commit });

    expect(state.sessionState).toBe(SESSION.INVALID);
    expect(state.token).toBeNull();
    expect(userAuth.getters.isAuthenticated(state)).toBe(false);
  });

  it('isAuthenticated is not derived from the token', async () => {
    // The literal shape of the original bug: `!!state.token`.
    const withToken = { ...userAuth.state, token: 'looks-legit', sessionState: SESSION.UNKNOWN };
    expect(userAuth.getters.isAuthenticated(withToken)).toBe(false);

    const confirmed = { ...userAuth.state, token: null, sessionState: SESSION.VALID };
    expect(userAuth.getters.isAuthenticated(confirmed)).toBe(true);
  });
});
