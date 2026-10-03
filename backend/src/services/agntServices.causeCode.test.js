import { describe, it, expect, vi, afterEach } from 'vitest';

// callService keeps the network cause, so a caller can tell "never connected"
// from "dropped after sending" (agntMail.sendMail relies on it).
vi.mock('./auth/sessionTokenCache.js', () => ({ authHeader: () => ({}), getSessionToken: () => 't' }));
vi.mock('./auth/planEntitlements.js', () => ({ hasFeature: () => true, isEnforcing: () => false }));
const { callService, neverReached } = await import('./agntServices.js');

describe('callService unreachable errors', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('carries the cause code of a refused connection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }));
    const error = await callService('mail', '/inboxes', { retries: 0 }).catch((e) => e);
    expect(error).toMatchObject({ status: 0, code: 'unreachable' });
    expect(error.detail).toMatchObject({ causeCode: 'ECONNREFUSED', timedOut: false });
    expect(neverReached(error)).toBe(true);
  });

  it('marks a timeout, which is never treated as unsent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    }));
    const error = await callService('mail', '/inboxes', { retries: 0 }).catch((e) => e);
    expect(error.detail.timedOut).toBe(true);
    expect(neverReached(error)).toBe(false);
  });
});
