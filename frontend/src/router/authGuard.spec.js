/**
 * Unit tests for the router navigation guard (createAuthGuard).
 *
 * Background: commit 4bbabfc ("fix(router): surface silent auth-guard
 * redirects to /settings") replaced two unconditional `next('/settings')`
 * fallbacks with structured surfacing. Subsequent commits added clearing
 * of stale token + user (4a6b1a4) and reason-aware classification of WHY
 * the session is no longer trusted.
 *
 * THE GATE'S ORACLE CHANGED (2026-08-06). It used to ask "is there a user
 * object?", populated by a call to the REMOTE auth server — which, when
 * unreachable, answered out of a client-side JWT *decode*. An unverified token
 * therefore walked through this guard into a fully rendered app. It now asks
 * `userAuth/verifySession`, which asks the backend that serves this app's
 * data, and only SESSION.VALID passes.
 *
 * Pinned contract:
 *   1. console warn so the bounce is visible in DevTools
 *   2. window 'auth-redirect' event carrying the full failure record
 *      (reason, status, detail, timestamp) for the UI layer to consume
 *   3. returnTo query param (fullPath) so deep-links can resume after auth
 *   4. event detail.from is the bare path (no ?query noise) since it's
 *      rendered in user-facing modal copy
 *   5. CLEAR_TOKEN + SET_USER(null) ONLY for definitive rejections
 *      (http_401, http_403, unauthenticated_response, no_token); transient
 *      failures (http_5xx, network_error, timeout) leave the token alone
 *      so users are not logged out by an outage
 *   6. the gate probes the DATA backend via verifySession, and an
 *      unconfirmed session (UNKNOWN) does NOT pass
 *
 * If a future refactor removes the event, drops returnTo, reverts to a
 * silent redirect, starts clearing tokens on transient failures, or lets an
 * unverified session through — these tests fail.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Node 22+ warning: localStorage may be undefined when modules that touch
// user.config.js are pulled in via the auth store graph. Ensure a store exists
// before dynamic imports resolve.
if (typeof globalThis.localStorage?.getItem !== 'function') {
  const map = new Map();
  const store = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(String(k), String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
}

const { createAuthGuard } = await import('./authGuard.js');
const { SESSION } = await import('@/store/auth/userAuth.js');

function makeStore({
  sessionState = SESSION.UNKNOWN,
  sessionAfterVerify = null,
  dispatchThrows = null,
  lastAuthFailure = null,
  user = null,
} = {}) {
  const state = { userAuth: { user, lastAuthFailure, sessionState } };
  return {
    state,
    dispatch: vi.fn(async (action) => {
      if (dispatchThrows && action === 'userAuth/verifySession') {
        throw dispatchThrows;
      }
      if (action === 'userAuth/verifySession' && sessionAfterVerify !== null) {
        state.userAuth.sessionState = sessionAfterVerify;
        if (sessionAfterVerify === SESSION.VALID) {
          state.userAuth.user = { id: 'verified' };
          state.userAuth.lastAuthFailure = null;
        }
        return sessionAfterVerify;
      }
      return state.userAuth.sessionState;
    }),
    commit: vi.fn((type, payload) => {
      // Reflect mutations into state so handleAuthFailure can read them back.
      if (type === 'userAuth/SET_AUTH_FAILURE') {
        state.userAuth.lastAuthFailure = payload;
      }
      if (type === 'userAuth/SET_SESSION_STATE') {
        state.userAuth.sessionState = payload;
      }
    }),
  };
}

function makeRoute(overrides = {}) {
  return {
    path: '/chat',
    fullPath: '/chat?content-id=abc-123',
    query: {},
    meta: { requiresAuth: true },
    ...overrides,
  };
}

describe('createAuthGuard', () => {
  let dispatchEventSpy;
  let warnSpy;
  let errorSpy;
  let logSpy;

  beforeEach(() => {
    dispatchEventSpy = vi.spyOn(window, 'dispatchEvent').mockImplementation(() => true);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    dispatchEventSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  // --- happy paths ---

  it('confirmed session on protected route passes through with next()', async () => {
    const store = makeStore({ sessionState: SESSION.VALID });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
    expect(dispatchEventSpy).not.toHaveBeenCalled();
    // Already confirmed — no re-probe. This is what keeps the gate free in
    // steady state and is why verifySession needs no TTL cache.
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(store.commit).not.toHaveBeenCalled();
  });

  it('non-auth route (e.g. /settings) passes through with no session', async () => {
    const store = makeStore({ sessionState: SESSION.INVALID });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute({ path: '/settings', fullPath: '/settings', meta: {} }), {}, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
    expect(dispatchEventSpy).not.toHaveBeenCalled();
    expect(store.commit).not.toHaveBeenCalled();
  });

  it('verifySession confirms the session: passes through without redirect or clearing', async () => {
    const store = makeStore({ sessionAfterVerify: SESSION.VALID });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(store.dispatch).toHaveBeenCalledWith('userAuth/verifySession');
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
    expect(dispatchEventSpy).not.toHaveBeenCalled();
    expect(store.commit).not.toHaveBeenCalledWith('userAuth/CLEAR_TOKEN');
    expect(store.commit).not.toHaveBeenCalledWith('userAuth/SET_USER', null);
  });

  // --- THE BUG THIS GUARD EXISTS TO CLOSE ---

  it('a user object without a confirmed session does NOT get in', async () => {
    // This is the exact shape of the original failure: fetchUserData could not
    // reach the remote auth server, so it DECODED the local JWT and committed
    // the result as `user`. The old gate read `user` and let it through, and
    // the app rendered in full for a session nobody had verified.
    const store = makeStore({
      user: { id: 'decoded-from-an-unverified-jwt', email: 'a@b.c' },
      sessionState: SESSION.UNKNOWN,
      sessionAfterVerify: SESSION.UNKNOWN,
      lastAuthFailure: { reason: 'network_error', detail: 'Network Error', timestamp: 1 },
    });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(next).toHaveBeenCalledWith({
      path: '/settings',
      query: { returnTo: '/chat?content-id=abc-123' },
    });
    expect(next).not.toHaveBeenCalledWith();
  });

  it('asks the backend that serves the data, not the remote auth server', async () => {
    // fetchUserData talks to api.agnt.gg and can answer from a JWT decode.
    // If the gate ever routes through it again, the fallback becomes a session
    // grant again.
    const store = makeStore({ sessionAfterVerify: SESSION.VALID });
    const guard = createAuthGuard(store);

    await guard(makeRoute(), {}, vi.fn());

    expect(store.dispatch).toHaveBeenCalledWith('userAuth/verifySession');
    expect(store.dispatch).not.toHaveBeenCalledWith(
      'userAuth/fetchUserData',
      expect.anything(),
    );
  });

  it('UNKNOWN (could not check) is not a pass', async () => {
    const store = makeStore({
      sessionAfterVerify: SESSION.UNKNOWN,
      lastAuthFailure: { reason: 'http_5xx', status: 503, timestamp: 1 },
    });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(next).toHaveBeenCalledWith({
      path: '/settings',
      query: { returnTo: '/chat?content-id=abc-123' },
    });
  });

  it('OAuth callback to /settings with ?code redirects to /connectors preserving all query', async () => {
    const store = makeStore({ sessionState: SESSION.INVALID });
    const guard = createAuthGuard(store);
    const next = vi.fn();
    const query = { code: 'oauth-abc', state: 'xyz', scope: 'read write' };

    await guard(makeRoute({ path: '/settings', fullPath: '/settings?code=oauth-abc&state=xyz&scope=read+write', query, meta: {} }), {}, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith({ path: '/connectors', query });
    expect(dispatchEventSpy).not.toHaveBeenCalled();
    expect(store.commit).not.toHaveBeenCalled();
  });

  // --- definitive rejection paths (clear token) ---

  it('lite /m/chat auth failure bounces to /m (not full Settings)', async () => {
    const failure = { reason: 'no_token', timestamp: 1 };
    const store = makeStore({ sessionAfterVerify: SESSION.INVALID, lastAuthFailure: failure });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(
      makeRoute({
        path: '/m/chat',
        fullPath: '/m/chat',
        meta: { requiresAuth: true, lite: true },
      }),
      {},
      next,
    );

    expect(next).toHaveBeenCalledWith({
      path: '/m',
      query: { returnTo: '/m/chat' },
    });
  });

  it('http_401 (token explicitly rejected): clears token + user, emits event with reason', async () => {
    const failure = { reason: 'http_401', status: 401, detail: 'token expired', timestamp: 12345 };
    const store = makeStore({ sessionAfterVerify: SESSION.INVALID, lastAuthFailure: failure });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    // returnTo carries fullPath so deep-link resume preserves the query.
    expect(next).toHaveBeenCalledWith({
      path: '/settings',
      query: { returnTo: '/chat?content-id=abc-123' },
    });
    expect(dispatchEventSpy).toHaveBeenCalledOnce();
    const event = dispatchEventSpy.mock.calls[0][0];
    expect(event.type).toBe('auth-redirect');
    // detail.from is user-facing copy → bare path, no query noise.
    expect(event.detail).toMatchObject({
      from: '/chat',
      reason: 'http_401',
      status: 401,
      detail: 'token expired',
    });
    // Definitive rejection → clear
    expect(store.commit).toHaveBeenCalledWith('userAuth/CLEAR_TOKEN');
    expect(store.commit).toHaveBeenCalledWith('userAuth/SET_USER', null);
  });

  it('http_403 (account forbidden): clears token + user', async () => {
    const failure = { reason: 'http_403', status: 403, detail: 'account suspended', timestamp: 1 };
    const store = makeStore({ sessionAfterVerify: SESSION.INVALID, lastAuthFailure: failure });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(store.commit).toHaveBeenCalledWith('userAuth/CLEAR_TOKEN');
    expect(store.commit).toHaveBeenCalledWith('userAuth/SET_USER', null);
    expect(dispatchEventSpy.mock.calls[0][0].detail.reason).toBe('http_403');
  });

  it('unauthenticated_response (server says no user): clears token + user', async () => {
    const failure = { reason: 'unauthenticated_response', status: 200, detail: null, timestamp: 1 };
    const store = makeStore({ sessionAfterVerify: SESSION.INVALID, lastAuthFailure: failure });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(store.commit).toHaveBeenCalledWith('userAuth/CLEAR_TOKEN');
    expect(store.commit).toHaveBeenCalledWith('userAuth/SET_USER', null);
  });

  it('no_token (localStorage empty): clears (no-op clear is fine) + emits', async () => {
    const failure = { reason: 'no_token', timestamp: 1 };
    const store = makeStore({ sessionAfterVerify: SESSION.INVALID, lastAuthFailure: failure });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(store.commit).toHaveBeenCalledWith('userAuth/CLEAR_TOKEN');
    expect(store.commit).toHaveBeenCalledWith('userAuth/SET_USER', null);
    expect(dispatchEventSpy.mock.calls[0][0].detail.reason).toBe('no_token');
  });

  // --- transient failure paths (DO NOT clear token) ---

  it('http_5xx (server error): emits event but does NOT clear token', async () => {
    const failure = { reason: 'http_5xx', status: 503, detail: 'Service Unavailable', timestamp: 1 };
    const store = makeStore({ sessionAfterVerify: SESSION.UNKNOWN, lastAuthFailure: failure });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    // returnTo still carries fullPath even on transient failure paths.
    expect(next).toHaveBeenCalledWith({
      path: '/settings',
      query: { returnTo: '/chat?content-id=abc-123' },
    });
    expect(dispatchEventSpy.mock.calls[0][0].detail.reason).toBe('http_5xx');
    // Transient → DO NOT clear: an outage shouldn't log the user out
    expect(store.commit).not.toHaveBeenCalledWith('userAuth/CLEAR_TOKEN');
    expect(store.commit).not.toHaveBeenCalledWith('userAuth/SET_USER', null);
  });

  it('network_error (offline / DNS / CORS): emits event but does NOT clear token', async () => {
    const failure = { reason: 'network_error', detail: 'Network Error', timestamp: 1 };
    const store = makeStore({ sessionAfterVerify: SESSION.UNKNOWN, lastAuthFailure: failure });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(dispatchEventSpy.mock.calls[0][0].detail.reason).toBe('network_error');
    expect(store.commit).not.toHaveBeenCalledWith('userAuth/CLEAR_TOKEN');
    expect(store.commit).not.toHaveBeenCalledWith('userAuth/SET_USER', null);
  });

  it('timeout (slow upstream): emits event but does NOT clear token', async () => {
    const failure = { reason: 'timeout', detail: 'timeout of 10000ms exceeded', timestamp: 1 };
    const store = makeStore({ sessionAfterVerify: SESSION.UNKNOWN, lastAuthFailure: failure });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(dispatchEventSpy.mock.calls[0][0].detail.reason).toBe('timeout');
    expect(store.commit).not.toHaveBeenCalledWith('userAuth/CLEAR_TOKEN');
    expect(store.commit).not.toHaveBeenCalledWith('userAuth/SET_USER', null);
  });

  // --- defensive paths ---

  it('verifySession throws unexpectedly: synthesizes unknown failure, emits event, does NOT clear', async () => {
    const boom = new Error('thrown by a bug, not classified');
    const store = makeStore({ dispatchThrows: boom });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(next).toHaveBeenCalledWith({
      path: '/settings',
      query: { returnTo: '/chat?content-id=abc-123' },
    });
    // Synthesized failure → unknown reason, detail carries the thrown message
    expect(store.commit).toHaveBeenCalledWith(
      'userAuth/SET_AUTH_FAILURE',
      expect.objectContaining({ reason: 'unknown', detail: 'thrown by a bug, not classified' }),
    );
    expect(dispatchEventSpy.mock.calls[0][0].detail.reason).toBe('unknown');
    // unknown is treated as transient — defensive default, don't kick people out
    expect(store.commit).not.toHaveBeenCalledWith('userAuth/CLEAR_TOKEN');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('a thrown verifySession still leaves the session UNCONFIRMED, never valid', async () => {
    // Fail closed. If the probe blows up we know strictly less than nothing
    // about the session, and the one unacceptable outcome is letting it read
    // as signed in.
    const store = makeStore({ dispatchThrows: new Error('boom') });
    const guard = createAuthGuard(store);

    await guard(makeRoute(), {}, vi.fn());

    expect(store.commit).toHaveBeenCalledWith('userAuth/SET_SESSION_STATE', SESSION.UNKNOWN);
    expect(store.state.userAuth.sessionState).not.toBe(SESSION.VALID);
  });

  it('emits with timestamp from the failure record so admins can correlate logs', async () => {
    const failure = { reason: 'http_401', status: 401, detail: null, timestamp: 1700000000000 };
    const store = makeStore({ sessionAfterVerify: SESSION.INVALID, lastAuthFailure: failure });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(dispatchEventSpy.mock.calls[0][0].detail.timestamp).toBe(1700000000000);
  });

  it('warns to console with structured detail so admins can grep', async () => {
    const failure = { reason: 'http_401', status: 401, detail: 'expired', timestamp: 1 };
    const store = makeStore({ sessionAfterVerify: SESSION.INVALID, lastAuthFailure: failure });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(warnSpy).toHaveBeenCalled();
    const [msg, payload] = warnSpy.mock.calls[0];
    // Warn log uses fullPath so admins can grep by the exact route the user
    // tried, query string and all.
    expect(msg).toContain('/chat?content-id=abc-123');
    expect(payload).toMatchObject({ reason: 'http_401', status: 401 });
  });
});
