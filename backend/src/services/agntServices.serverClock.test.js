import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Cursors are compared with timestamps the SERVICE assigned. serverNow() must
 * follow the service's clock (from the Date header) and never run ahead of it,
 * whichever way this machine's clock is wrong.
 */
vi.mock('./auth/sessionTokenCache.js', () => ({ authHeader: () => ({}), getSessionToken: () => 't' }));
vi.mock('./auth/planEntitlements.js', () => ({ hasFeature: () => true, isEnforcing: () => false }));
const { callService, serverNow, __resetServerClockForTests } = await import('./agntServices.js');

const respondWithServerTime = (serverMs) =>
  vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json', Date: new Date(serverMs).toUTCString() } }));

describe('serverNow', () => {
  beforeEach(() => __resetServerClockForTests());
  afterEach(() => vi.unstubAllGlobals());

  it('before any response, it errs a minute early', () => {
    const before = Date.now();
    expect(serverNow()).toBeLessThanOrEqual(before - 59_000);
  });

  it('tracks a service clock that is 10 minutes BEHIND this machine, and is never ahead of it', async () => {
    const serverTime = Date.now() - 10 * 60_000;
    vi.stubGlobal('fetch', respondWithServerTime(serverTime));
    await callService('mail', '/usage');
    const estimate = serverNow();
    expect(estimate).toBeLessThanOrEqual(serverTime + 1000); // never ahead (header is to the second)
    expect(estimate).toBeGreaterThan(serverTime - 3000); // and not wildly early
  });

  it('tracks a service clock that is AHEAD of this machine', async () => {
    const serverTime = Date.now() + 5 * 60_000;
    vi.stubGlobal('fetch', respondWithServerTime(serverTime));
    await callService('mail', '/usage');
    expect(serverNow()).toBeGreaterThan(Date.now() + 4 * 60_000);
    expect(serverNow()).toBeLessThanOrEqual(serverTime + 1000);
  });
});
