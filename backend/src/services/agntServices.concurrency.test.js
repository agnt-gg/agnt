import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The hosted services refuse overflow rather than queueing it — search runs
 * ONE concurrent scrape on most plans. The orchestrator fans out several
 * scrapes per turn, so the client has to queue or five of six calls come back
 * "service_busy". Retrying alone does not fix it; the retries collide too.
 */
vi.mock('./auth/sessionTokenCache.js', () => ({ authHeader: () => ({ Authorization: 'Bearer t' }), getSessionToken: () => 't' }));
vi.mock('./auth/planEntitlements.js', () => ({ hasFeature: async () => true, isEnforcing: () => false }));
vi.mock('./auth/planDenial.js', () => ({ planDenialMessageFor: () => 'upgrade' }));

describe('callService concurrency gate', () => {
  beforeEach(() => vi.resetModules());

  it('never exceeds the service limit, and every call still completes', async () => {
    const { callService } = await import('./agntServices.js');
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ textContent: 'x' }) };
    }));

    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => callService('search', '/scrape', { method: 'POST', idempotent: true, body: { url: 'https://e' + i } })));
    expect(results).toHaveLength(6);
    expect(peak, 'search allows one concurrent call').toBe(1);
    vi.unstubAllGlobals();
  });

  it('retries a busy service with the SAME idempotency key, so a retry is not a second charge', async () => {
    const { callService } = await import('./agntServices.js');
    const keys = [];
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      keys.push(opts.headers['Idempotency-Key']);
      call++;
      if (call === 1) return { ok: false, status: 429, headers: { get: () => null }, text: async () => JSON.stringify({ error: 'service_busy' }) };
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ ok: true }) };
    }));

    await callService('search', '/scrape', { method: 'POST', idempotent: true, body: {} });
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    vi.unstubAllGlobals();
  });

  it('does not retry a deterministic refusal', async () => {
    const { callService } = await import('./agntServices.js');
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      return { ok: false, status: 503, headers: { get: () => null }, text: async () => JSON.stringify({ error: 'page_blocked' }) };
    }));

    const error = await callService('search', '/scrape', { method: 'POST', idempotent: true, body: {} }).catch((e) => e);
    expect(error.code).toBe('page_blocked');
    expect(calls, 'a blocked page will still be blocked next time').toBe(1);
    vi.unstubAllGlobals();
  });
});
