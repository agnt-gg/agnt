/**
 * Unit tests for the router navigation guard (createAuthGuard).
 *
 * Background: commit 4bbabfc ("fix(router): surface silent auth-guard
 * redirects to /settings") replaced two unconditional `next('/settings')`
 * fallbacks with structured surfacing. Subsequent commits added clearing
 * of stale token + user (4a6b1a4) and reason-aware classification of WHY
 * the session is no longer trusted (this commit).
 *
 * Pinned contract:
 *   1. console warn so the bounce is visible in DevTools
 *   2. window 'auth-redirect' event carrying the full failure record
 *      (reason, status, detail, timestamp) for the UI layer to consume
 *   3. returnTo query param so deep-links can resume after auth
 *   4. CLEAR_TOKEN + SET_USER(null) ONLY for definitive rejections
 *      (http_401, http_403, unauthenticated_response, no_token); transient
 *      failures (http_5xx, network_error, timeout) leave the token alone
 *      so users are not logged out by an outage
 *
 * If a future refactor removes the event, drops returnTo, reverts to a
 * silent redirect, or starts clearing tokens on transient failures, these
 * tests fail.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAuthGuard } from './authGuard.js';

function makeStore({
  user = null,
  fetchUserAfterDispatch = null,
  dispatchThrows = null,
  lastAuthFailure = null,
} = {}) {
  const state = { userAuth: { user, lastAuthFailure } };
  return {
    state,
    dispatch: vi.fn(async (action) => {
      if (dispatchThrows && action === 'userAuth/fetchUserData') {
        throw dispatchThrows;
      }
      if (action === 'userAuth/fetchUserData' && fetchUserAfterDispatch !== null) {
        state.userAuth.user = fetchUserAfterDispatch;
        state.userAuth.lastAuthFailure = null;
      }
    }),
    commit: vi.fn((type, payload) => {
      // Reflect SET_AUTH_FAILURE into state so handleAuthFailure can read it
      // back on the unknown-error path.
      if (type === 'userAuth/SET_AUTH_FAILURE') {
        state.userAuth.lastAuthFailure = payload;
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

  it('authenticated user on protected route passes through with next()', async () => {
    const store = makeStore({ user: { id: 'u1', email: 'a@b.c' } });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
    expect(dispatchEventSpy).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(store.commit).not.toHaveBeenCalled();
  });

  it('non-auth route (e.g. /settings) passes through even with no user', async () => {
    const store = makeStore({ user: null });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute({ path: '/settings', fullPath: '/settings', meta: {} }), {}, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
    expect(dispatchEventSpy).not.toHaveBeenCalled();
    expect(store.commit).not.toHaveBeenCalled();
  });

  it('fetchUserData succeeds in populating user: passes through without redirect or clearing', async () => {
    const store = makeStore({ user: null, fetchUserAfterDispatch: { id: 'u2' } });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(store.dispatch).toHaveBeenCalledWith('userAuth/fetchUserData');
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
    expect(dispatchEventSpy).not.toHaveBeenCalled();
    // No CLEAR_TOKEN, no SET_USER(null) on the happy path
    expect(store.commit).not.toHaveBeenCalledWith('userAuth/CLEAR_TOKEN');
    expect(store.commit).not.toHaveBeenCalledWith('userAuth/SET_USER', null);
  });

  it('OAuth callback to /settings with ?code redirects to /connectors preserving all query', async () => {
    const store = makeStore({ user: null });
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

  it('http_401 (token explicitly rejected): clears token + user, emits event with reason', async () => {
    const failure = { reason: 'http_401', status: 401, detail: 'token expired', timestamp: 12345 };
    const store = makeStore({ user: null, lastAuthFailure: failure });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(next).toHaveBeenCalledWith({
      path: '/settings',
      query: { returnTo: '/chat?content-id=abc-123' },
    });
    expect(dispatchEventSpy).toHaveBeenCalledOnce();
    const event = dispatchEventSpy.mock.calls[0][0];
    expect(event.type).toBe('auth-redirect');
    expect(event.detail).toMatchObject({
      from: '/chat?content-id=abc-123',
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
    const store = makeStore({ user: null, lastAuthFailure: failure });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(store.commit).toHaveBeenCalledWith('userAuth/CLEAR_TOKEN');
    expect(store.commit).toHaveBeenCalledWith('userAuth/SET_USER', null);
    expect(dispatchEventSpy.mock.calls[0][0].detail.reason).toBe('http_403');
  });

  it('unauthenticated_response (server says no user): clears token + user', async () => {
    const failure = { reason: 'unauthenticated_response', status: 200, detail: null, timestamp: 1 };
    const store = makeStore({ user: null, lastAuthFailure: failure });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(store.commit).toHaveBeenCalledWith('userAuth/CLEAR_TOKEN');
    expect(store.commit).toHaveBeenCalledWith('userAuth/SET_USER', null);
  });

  it('no_token (localStorage empty): clears (no-op clear is fine) + emits', async () => {
    const failure = { reason: 'no_token', timestamp: 1 };
    const store = makeStore({ user: null, lastAuthFailure: failure });
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
    const store = makeStore({ user: null, lastAuthFailure: failure });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

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
    const store = makeStore({ user: null, lastAuthFailure: failure });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(dispatchEventSpy.mock.calls[0][0].detail.reason).toBe('network_error');
    expect(store.commit).not.toHaveBeenCalledWith('userAuth/CLEAR_TOKEN');
    expect(store.commit).not.toHaveBeenCalledWith('userAuth/SET_USER', null);
  });

  it('timeout (slow upstream): emits event but does NOT clear token', async () => {
    const failure = { reason: 'timeout', detail: 'timeout of 10000ms exceeded', timestamp: 1 };
    const store = makeStore({ user: null, lastAuthFailure: failure });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(dispatchEventSpy.mock.calls[0][0].detail.reason).toBe('timeout');
    expect(store.commit).not.toHaveBeenCalledWith('userAuth/CLEAR_TOKEN');
    expect(store.commit).not.toHaveBeenCalledWith('userAuth/SET_USER', null);
  });

  // --- defensive paths ---

  it('fetchUserData throws unexpectedly: synthesizes unknown failure, emits event, does NOT clear', async () => {
    const boom = new Error('thrown by a bug, not classified');
    const store = makeStore({ user: null, dispatchThrows: boom });
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

  it('emits with timestamp from the failure record so admins can correlate logs', async () => {
    const failure = { reason: 'http_401', status: 401, detail: null, timestamp: 1700000000000 };
    const store = makeStore({ user: null, lastAuthFailure: failure });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(dispatchEventSpy.mock.calls[0][0].detail.timestamp).toBe(1700000000000);
  });

  it('warns to console with structured detail so admins can grep', async () => {
    const failure = { reason: 'http_401', status: 401, detail: 'expired', timestamp: 1 };
    const store = makeStore({ user: null, lastAuthFailure: failure });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(warnSpy).toHaveBeenCalled();
    const [msg, payload] = warnSpy.mock.calls[0];
    expect(msg).toContain('/chat?content-id=abc-123');
    expect(payload).toMatchObject({ reason: 'http_401', status: 401 });
  });
});
