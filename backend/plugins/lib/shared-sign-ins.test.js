import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchSharedSignInIds, sharedIdsFromResponse, __resetSharedSignInCache } from './shared-sign-ins.js';

const reply = (status, body) => vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));

beforeEach(() => __resetSharedSignInCache());

describe('sharedIdsFromResponse', () => {
  it('reads the anonymous bare array and the signed-in { providers } shape', () => {
    expect(sharedIdsFromResponse([{ id: 'Google' }, { id: 'notion' }])).toEqual(['google', 'notion']);
    expect(sharedIdsFromResponse({ providers: [{ id: 'slack', is_global: '1' }] })).toEqual(['slack']);
  });

  it('never counts a private sign-in as shared, even if one slips into the answer', () => {
    expect(sharedIdsFromResponse([{ id: 'google', is_global: '1' }, { id: 'calendly', is_global: '0' }])).toEqual(['google']);
  });

  it('anything else is unknown, not empty', () => {
    expect(sharedIdsFromResponse({ error: 'x' })).toBeNull();
    expect(sharedIdsFromResponse(null)).toBeNull();
  });
});

describe('fetchSharedSignInIds', () => {
  it('asks anonymously: no Authorization header, ever', async () => {
    const fetchImpl = reply(200, [{ id: 'google' }]);
    expect(await fetchSharedSignInIds({ baseUrl: 'https://api.test', fetchImpl })).toEqual(['google']);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.test/auth/providers');
    expect(init.headers).toBeUndefined();
  });

  it('a failure, an error status or an empty list is null (unknown), never []', async () => {
    expect(await fetchSharedSignInIds({ baseUrl: 'https://a.test', fetchImpl: vi.fn(async () => { throw new Error('offline'); }) })).toBeNull();
    expect(await fetchSharedSignInIds({ baseUrl: 'https://b.test', fetchImpl: reply(503, {}) })).toBeNull();
    expect(await fetchSharedSignInIds({ baseUrl: 'https://c.test', fetchImpl: reply(200, []) })).toBeNull();
  });

  it('caches a good answer per server, and fresh: true asks again', async () => {
    const fetchImpl = reply(200, [{ id: 'google' }]);
    await fetchSharedSignInIds({ baseUrl: 'https://api.test', fetchImpl });
    await fetchSharedSignInIds({ baseUrl: 'https://api.test', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await fetchSharedSignInIds({ baseUrl: 'https://api.test', fetchImpl, fresh: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
