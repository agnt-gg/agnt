/**
 * Unit tests for the router navigation guard (createAuthGuard).
 *
 * Background: commit 26f9c23 ("fix(router): surface silent auth-guard
 * redirects to /settings") replaced two unconditional `next('/settings')`
 * fallbacks with three concrete behaviours:
 *   1. console warn/error so the bounce is visible in DevTools
 *   2. window 'auth-redirect' event so UI can render a toast/banner later
 *   3. returnTo query param so deep-links can resume after auth
 *
 * This test pins that contract. If a future refactor removes the event,
 * drops returnTo, or reverts to a silent redirect, these tests fail.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAuthGuard } from './authGuard.js';

function makeStore({ user = null, fetchUserAfterDispatch = null, dispatchThrows = null } = {}) {
  const state = { userAuth: { user } };
  return {
    state,
    dispatch: vi.fn(async (action) => {
      if (dispatchThrows && action === 'userAuth/fetchUserData') {
        throw dispatchThrows;
      }
      if (action === 'userAuth/fetchUserData' && fetchUserAfterDispatch !== null) {
        state.userAuth.user = fetchUserAfterDispatch;
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

  it('authenticated user on protected route passes through with next()', async () => {
    const store = makeStore({ user: { id: 'u1', email: 'a@b.c' } });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
    expect(dispatchEventSpy).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('non-auth route (e.g. /settings) passes through even with no user', async () => {
    const store = makeStore({ user: null });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute({ path: '/settings', fullPath: '/settings', meta: {} }), {}, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
    expect(dispatchEventSpy).not.toHaveBeenCalled();
  });

  it('unauthenticated → protected → fetchUserData returns no user: emits auth-redirect, preserves returnTo, warns', async () => {
    const store = makeStore({ user: null, fetchUserAfterDispatch: null });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(store.dispatch).toHaveBeenCalledWith('userAuth/fetchUserData');

    // Contract: redirects to /settings with returnTo preserved
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith({
      path: '/settings',
      query: { returnTo: '/chat?content-id=abc-123' },
    });

    // Contract: surfaces the bounce via window event so UI can react
    expect(dispatchEventSpy).toHaveBeenCalledOnce();
    const event = dispatchEventSpy.mock.calls[0][0];
    expect(event).toBeInstanceOf(CustomEvent);
    expect(event.type).toBe('auth-redirect');
    expect(event.detail).toEqual({ from: '/chat?content-id=abc-123', reason: 'no-user' });

    // Contract: also visible in console for devs
    expect(warnSpy).toHaveBeenCalled();
    const warnMsg = warnSpy.mock.calls[0][0];
    expect(warnMsg).toContain('/chat?content-id=abc-123');
    expect(warnMsg).toContain('redirecting');
  });

  it('fetchUserData throws: still emits auth-redirect with reason fetch-error, error logged', async () => {
    const boom = new Error('network unreachable');
    const store = makeStore({ user: null, dispatchThrows: boom });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith({
      path: '/settings',
      query: { returnTo: '/chat?content-id=abc-123' },
    });

    expect(dispatchEventSpy).toHaveBeenCalledOnce();
    const event = dispatchEventSpy.mock.calls[0][0];
    expect(event.type).toBe('auth-redirect');
    expect(event.detail).toEqual({
      from: '/chat?content-id=abc-123',
      reason: 'fetch-error',
      error: 'network unreachable',
    });

    expect(errorSpy).toHaveBeenCalled();
  });

  it('fetchUserData succeeds in populating user: passes through without redirect', async () => {
    const store = makeStore({ user: null, fetchUserAfterDispatch: { id: 'u2' } });
    const guard = createAuthGuard(store);
    const next = vi.fn();

    await guard(makeRoute(), {}, next);

    expect(store.dispatch).toHaveBeenCalledWith('userAuth/fetchUserData');
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(); // no redirect
    expect(dispatchEventSpy).not.toHaveBeenCalled();
  });

  it('OAuth callback to /settings with ?code redirects to /connectors preserving all query', async () => {
    const store = makeStore({ user: null });
    const guard = createAuthGuard(store);
    const next = vi.fn();
    const query = { code: 'oauth-abc', state: 'xyz', scope: 'read write' };

    await guard(makeRoute({ path: '/settings', fullPath: '/settings?code=oauth-abc&state=xyz&scope=read+write', query, meta: {} }), {}, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith({ path: '/connectors', query });
    // OAuth path should not trip the auth-redirect event
    expect(dispatchEventSpy).not.toHaveBeenCalled();
  });
});
