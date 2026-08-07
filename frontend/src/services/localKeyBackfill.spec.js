/**
 * Backfilling remotely-stored provider API keys into local storage.
 *
 * THE FAILURE MODE THIS SUITE IS REALLY ABOUT
 * -------------------------------------------
 * The value held remotely is NOT the API key. It is the key encrypted by this
 * UI with a shared handshake constant, stored verbatim by the API. If the
 * backfill forgets to unwrap that layer, the local store encrypts the
 * ciphertext a second time and every later decrypt yields the inner ciphertext
 * instead of the key. Nothing throws. The provider simply starts failing,
 * later, somewhere else — so the round trip is asserted end to end rather than
 * trusting the call to look right.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import CryptoJS from 'crypto-js';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/tt.config.js', () => ({
  API_CONFIG: { BASE_URL: 'http://localhost:3333/api', REMOTE_URL: 'https://api.test' },
}));

// The real module — the whole point is that this file already exists here and
// does not need to be duplicated anywhere else.
vi.mock('@/views/_utils/encryption.js', async () => {
  const KEY = 'e0ed19e2df64db0f26f4d744ac244c84';
  return {
    encrypt: (text) => CryptoJS.AES.encrypt(text, KEY).toString(),
    decrypt: (cipher) => {
      try {
        return CryptoJS.AES.decrypt(cipher, KEY).toString(CryptoJS.enc.Utf8);
      } catch {
        return '';
      }
    },
  };
});

const axios = (await import('axios')).default;
const { encrypt } = await import('@/views/_utils/encryption.js');
const { backfillLocalProviderKeys } = await import('./localKeyBackfill.js');

const notFound = () => {
  const error = new Error('not found');
  error.response = { status: 404 };
  return error;
};

beforeEach(() => {
  vi.clearAllMocks();
  axios.post.mockResolvedValue({ data: { success: true } });
});

describe('the handshake layer', () => {
  it('stores the PLAINTEXT key locally, not the ciphertext', async () => {
    axios.get.mockResolvedValue({ data: { success: true, apiKey: encrypt('sk-live-abc123') } });

    const result = await backfillLocalProviderKeys({ token: 't1', remoteApps: ['openai'], localApps: [] });

    expect(result.copied).toEqual(['openai']);
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toBe('http://localhost:3333/api/providers/openai/auth/connect');
    // THE assertion. If the unwrap is ever dropped, this is the line that fails.
    expect(body.apiKey).toBe('sk-live-abc123');
    expect(body.apiKey).not.toMatch(/^U2FsdGVkX1/);
  });

  it('anti-vacuity: the fixture really is handshake ciphertext', () => {
    const wire = encrypt('sk-live-abc123');
    expect(wire).not.toBe('sk-live-abc123');
    expect(wire).toMatch(/^U2FsdGVkX1/);
  });

  it('refuses to store a value that is not handshake ciphertext', async () => {
    axios.get.mockResolvedValue({ data: { success: true, apiKey: 'not-handshake-wrapped' } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await backfillLocalProviderKeys({ token: 't1', remoteApps: ['weird'], localApps: [] });

    // Storing it raw would create a local key that looks present and never works.
    expect(axios.post).not.toHaveBeenCalled();
    expect(result.failed).toEqual(['weird']);
  });

  it('is not fooled by CryptoJS returning residue for a non-ciphertext input', async () => {
    // REGRESSION GUARD, and the reason the check is structural rather than
    // behavioural. CryptoJS does not zero-fill its WordArrays, so decrypting a
    // non-ciphertext string returns '' in a quiet process and can return short
    // garbage in one that has already run AES. This test simulates the bad case
    // directly instead of hoping the suite ordering reproduces it.
    const encryption = await import('@/views/_utils/encryption.js');
    const spy = vi.spyOn(encryption, 'decrypt').mockReturnValue('\u0014>garbage');
    axios.get.mockResolvedValue({ data: { success: true, apiKey: 'plainly-not-ciphertext' } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await backfillLocalProviderKeys({ token: 't1', remoteApps: ['weird'], localApps: [] });

    expect(axios.post, 'residue was written to local storage as a working key').not.toHaveBeenCalled();
    expect(result.failed).toEqual(['weird']);
    // The structural check should have short-circuited before decrypt ran.
    expect(spy).not.toHaveBeenCalled();
  });

  it('anti-vacuity: real ciphertext DOES carry the salted header', () => {
    // If this prefix ever changed, the structural check above would silently
    // reject every legitimate value and the backfill would quietly do nothing.
    expect(encrypt('sk-live-abc123')).toMatch(/^U2FsdGVkX1/);
  });
});

describe('scope', () => {
  it('only touches providers that are NOT already local', async () => {
    axios.get.mockResolvedValue({ data: { success: true, apiKey: encrypt('sk-remote') } });

    const result = await backfillLocalProviderKeys({
      token: 't1',
      remoteApps: ['openai', 'anthropic'],
      localApps: ['openai'],
    });

    expect(result.copied).toEqual(['anthropic']);
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get.mock.calls[0][0]).toContain('/auth/apikeys/anthropic');
  });

  it('does nothing when everything is already local', async () => {
    const result = await backfillLocalProviderKeys({
      token: 't1',
      remoteApps: ['openai'],
      localApps: ['openai'],
    });
    expect(result.copied).toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('sends the bearer token on both legs', async () => {
    axios.get.mockResolvedValue({ data: { success: true, apiKey: encrypt('sk-a') } });
    await backfillLocalProviderKeys({ token: 't1', remoteApps: ['openai'], localApps: [] });

    expect(axios.get.mock.calls[0][1].headers.Authorization).toBe('Bearer t1');
    expect(axios.post.mock.calls[0][2].headers.Authorization).toBe('Bearer t1');
  });

  it('is a no-op without a token, rather than calling anonymously', async () => {
    const result = await backfillLocalProviderKeys({ token: null, remoteApps: ['openai'], localApps: [] });
    expect(result).toEqual({ copied: [], skipped: 0, failed: [] });
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe('providers that are not key-based', () => {
  it('treats a 404 as "OAuth provider" rather than an error', async () => {
    axios.get.mockRejectedValue(notFound());

    const result = await backfillLocalProviderKeys({ token: 't1', remoteApps: ['google'], localApps: [] });

    expect(result.failed).toEqual([]);
    expect(result.skipped).toBe(1);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('skips an empty stored value', async () => {
    axios.get.mockResolvedValue({ data: { success: true } });
    const result = await backfillLocalProviderKeys({ token: 't1', remoteApps: ['openai'], localApps: [] });
    expect(result.skipped).toBe(1);
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('resilience', () => {
  it('one bad provider does not stop the rest', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    axios.get.mockImplementation(async (url) => {
      if (url.includes('/broken')) throw new Error('ECONNRESET');
      return { data: { success: true, apiKey: encrypt('sk-good') } };
    });

    const result = await backfillLocalProviderKeys({
      token: 't1',
      remoteApps: ['broken', 'openai'],
      localApps: [],
    });

    expect(result.failed).toEqual(['broken']);
    expect(result.copied).toEqual(['openai']);
  });

  it('a failed local save is reported, not swallowed as success', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    axios.get.mockResolvedValue({ data: { success: true, apiKey: encrypt('sk-a') } });
    axios.post.mockRejectedValue(new Error('local backend down'));

    const result = await backfillLocalProviderKeys({ token: 't1', remoteApps: ['openai'], localApps: [] });
    expect(result.copied).toEqual([]);
    expect(result.failed).toEqual(['openai']);
  });
});
