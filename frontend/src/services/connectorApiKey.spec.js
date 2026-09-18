/**
 * Where a connector-only key is written.
 *
 * The bug this guards: a connector-catalogue provider has no row in the remote
 * key store, so `POST {REMOTE_URL}/auth/apikeys/:id` cannot attach the key to
 * anything. The tile renders, the user pastes a key, the save reports failure
 * (or worse, succeeds against nothing) and the provider never connects.
 *
 * So the assertions that matter are not only "connect was called" but "the
 * remote store was NOT touched". A future refactor that restores the remote
 * POST would still satisfy the first and fail the second.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usesLocalKeyStore, saveConnectorApiKey } from './connectorApiKey.js';
import providerAuthService from '@/services/providerAuthService.js';

vi.mock('@/services/providerAuthService.js', () => ({
  default: { connect: vi.fn() },
}));

describe('usesLocalKeyStore', () => {
  it('is true for a connector-catalogue provider, in any casing', () => {
    expect(usesLocalKeyStore('typesafe')).toBe(true);
    expect(usesLocalKeyStore('TypeSafe')).toBe(true);
  });

  it('is false for ordinary providers, which keep the remote path', () => {
    for (const id of ['openai', 'anthropic', 'slack', 'firecrawl']) {
      expect(usesLocalKeyStore(id), id).toBe(false);
    }
  });

  it('is false for junk rather than throwing', () => {
    for (const id of [undefined, null, '', 0, {}]) {
      expect(usesLocalKeyStore(id)).toBe(false);
    }
  });
});

describe('saveConnectorApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('fetch must not be called'))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the key to the LOCAL connect route', async () => {
    providerAuthService.connect.mockResolvedValue({ success: true, providerId: 'typesafe' });

    await saveConnectorApiKey('typesafe', 'sk-not-a-real-key');

    expect(providerAuthService.connect).toHaveBeenCalledTimes(1);
    expect(providerAuthService.connect).toHaveBeenCalledWith('typesafe', { apiKey: 'sk-not-a-real-key' });
  });

  it('never posts to the remote key store', async () => {
    providerAuthService.connect.mockResolvedValue({ success: true });

    await saveConnectorApiKey('typesafe', 'sk-not-a-real-key');

    // providerAuthService is mocked, so any fetch here would be a hand-rolled
    // POST to REMOTE_URL — the exact defect this module exists to prevent.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns the route result so callers can use it', async () => {
    providerAuthService.connect.mockResolvedValue({ success: true, message: 'saved locally' });
    await expect(saveConnectorApiKey('typesafe', 'k')).resolves.toEqual({
      success: true,
      message: 'saved locally',
    });
  });

  it('throws the route error when the save reports failure', async () => {
    // A 400 from the connect route resolves — it does not reject — so a
    // success:false body must not be mistaken for a saved key.
    providerAuthService.connect.mockResolvedValue({
      success: false,
      error: 'apiKey is required in request body',
    });

    await expect(saveConnectorApiKey('typesafe', '')).rejects.toThrow('apiKey is required in request body');
  });

  it('throws on an empty or malformed response rather than reporting success', async () => {
    for (const bad of [undefined, null, {}, '']) {
      providerAuthService.connect.mockResolvedValue(bad);
      await expect(saveConnectorApiKey('typesafe', 'k')).rejects.toThrow('Failed to save API key');
    }
  });

  it('lets a transport error propagate unchanged', async () => {
    providerAuthService.connect.mockRejectedValue(new Error('Network Error'));
    await expect(saveConnectorApiKey('typesafe', 'k')).rejects.toThrow('Network Error');
  });
});
