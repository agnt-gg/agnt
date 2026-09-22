import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * THE CLIENT NEVER CAPS PARALLELISM.
 *
 * A caller may fire as many service calls as it likes, all at once, and spend
 * its entire monthly allowance in a single run if that is what it wants. That
 * is the user's call to make, not this module's. An earlier version of this
 * file queued calls behind a per-service limit; it made a wide fan-out slow
 * and, worse, made the client the thing deciding how fast someone may use what
 * they paid for. It is gone, and this test exists so it does not come back.
 *
 * Waiting is only ever a response to the SERVICE saying it is busy — never a
 * decision made here before the request is sent.
 */
vi.mock('./auth/sessionTokenCache.js', () => ({ authHeader: () => ({ Authorization: 'Bearer t' }), getSessionToken: () => 't' }));
vi.mock('./auth/planEntitlements.js', () => ({ hasFeature: async () => true, isEnforcing: () => false }));
vi.mock('./auth/planDenial.js', () => ({ planDenialMessageFor: () => 'upgrade' }));

const ok = (body = {}) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) });
const fail = (status, error) => ({ ok: false, status, headers: { get: () => null }, text: async () => JSON.stringify({ error }) });

describe('callService parallelism', () => {
  beforeEach(() => vi.resetModules());

  it('sends every call immediately — nothing is queued or throttled locally', async () => {
    const { callService } = await import('./agntServices.js');
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return ok({ done: true });
    }));

    const count = 50;
    await Promise.all(Array.from({ length: count }, (_, i) => callService('search', '/search', { method: 'POST', body: { query: 'q' + i } })));
    expect(peak, 'all 50 must be in flight together; any lower number means a local cap was reintroduced').toBe(count);
    vi.unstubAllGlobals();
  });

  it('retries only when the SERVICE reports busy, reusing the idempotency key so a retry is not a second charge', async () => {
    const { callService } = await import('./agntServices.js');
    const keys = [];
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      keys.push(opts.headers['Idempotency-Key']);
      return ++call === 1 ? fail(429, 'service_busy') : ok({ done: true });
    }));

    await callService('search', '/search', { method: 'POST', idempotent: true, body: {} });
    expect(keys).toHaveLength(2);
    expect(keys[0], 'a retry must not mint a new key').toBe(keys[1]);
    vi.unstubAllGlobals();
  });

  it('does not retry a deterministic refusal', async () => {
    const { callService } = await import('./agntServices.js');
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { calls++; return fail(400, 'invalid_search'); }));

    const error = await callService('search', '/search', { method: 'POST', body: {} }).catch((e) => e);
    expect(error.code).toBe('invalid_search');
    expect(calls, 'an invalid request will still be invalid next time').toBe(1);
    vi.unstubAllGlobals();
  });
});
