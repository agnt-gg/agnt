/**
 * Tests for checkTwitterHealth's error handling.
 *
 * Background: Twitter's GET /2/users/me has a 250-call/24h per-user cap.
 * Routine reconnect / panel-mount traffic blew through the quota during normal
 * use, after which the catch block reported every 429 as "Twitter token
 * validation failed" — which made users think their token was bad when in fact
 * Twitter just refused to validate it. These tests pin the contract:
 *   - 401/403  → genuine auth failure (throws)
 *   - 429      → token treated as healthy with a deferred-validation note
 *   - other    → token treated as healthy (don't fail over transient errors)
 *   - success  → cached for 5 min so we don't burn the daily quota
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';

vi.mock('axios');

// Has to be imported AFTER vi.mock so the mocked axios is in place.
let checkTwitterHealth;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  ({ checkTwitterHealth } = await import('./AuthManager.js'));
});

const ok = (data = { data: { username: 'NathanWilbanks_', id: '123' } }) => ({ data });

const rateLimited = (resetEpochSec) => ({
  isAxiosError: true,
  response: {
    status: 429,
    headers: {
      'x-user-limit-24hour-limit': '250',
      'x-user-limit-24hour-remaining': '0',
      'x-user-limit-24hour-reset': String(resetEpochSec),
    },
    data: { title: 'Too Many Requests', status: 429 },
  },
});

const unauthorized = () => ({
  isAxiosError: true,
  response: { status: 401, data: { title: 'Unauthorized', status: 401 } },
});

describe('checkTwitterHealth', () => {
  it('returns healthy with username/id on success', async () => {
    axios.get.mockResolvedValueOnce(ok());
    const result = await checkTwitterHealth('tok-success');
    expect(result.status).toBe('healthy');
    expect(result.provider).toBe('twitter');
    expect(result.details).toEqual({ username: 'NathanWilbanks_', id: '123' });
  });

  it('caches success for subsequent calls with the same token (no extra HTTP)', async () => {
    axios.get.mockResolvedValueOnce(ok());
    const a = await checkTwitterHealth('tok-cache');
    const b = await checkTwitterHealth('tok-cache');
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
  });

  it('on 429, returns healthy with a deferred-validation note (does NOT throw)', async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    axios.get.mockRejectedValueOnce(rateLimited(reset));

    const result = await checkTwitterHealth('tok-429');

    expect(result.status).toBe('healthy');
    expect(result.details.hasValidToken).toBe(true);
    expect(result.details.note).toMatch(/rate-limited/i);
    expect(result.details.retryAfter).toBe(new Date(reset * 1000).toISOString());
  });

  it('after a 429, subsequent calls short-circuit until reset (no further HTTP)', async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    axios.get.mockRejectedValueOnce(rateLimited(reset));

    await checkTwitterHealth('tok-429-block');
    await checkTwitterHealth('tok-429-block');
    await checkTwitterHealth('tok-429-block');

    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('on 401, throws "Twitter token validation failed" (genuine auth failure)', async () => {
    axios.get.mockRejectedValueOnce(unauthorized());
    await expect(checkTwitterHealth('tok-401')).rejects.toThrow('Twitter token validation failed');
  });

  it('on transient errors (network / 5xx), returns healthy with a note (does NOT throw)', async () => {
    axios.get.mockRejectedValueOnce({ isAxiosError: true, response: { status: 503 } });
    const result = await checkTwitterHealth('tok-503');
    expect(result.status).toBe('healthy');
    expect(result.details.note).toMatch(/transient/i);
  });

  it('treats a network error with no response as transient (does NOT throw)', async () => {
    axios.get.mockRejectedValueOnce({ isAxiosError: true, message: 'ECONNRESET' });
    const result = await checkTwitterHealth('tok-netfail');
    expect(result.status).toBe('healthy');
    expect(result.details.hasValidToken).toBe(true);
  });
});
