/**
 * Unit tests for GenericProviderService
 *
 * Tests cache behavior, model transformation, fallback resolution,
 * and change detection events.
 *
 * Run with: npx vitest run backend/tests/providers/GenericProviderService.test.js
 * Or with Jest: npx jest backend/tests/providers/GenericProviderService.test.js
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import GenericProviderService from '../../src/services/ai/providers/GenericProviderService.js';

// Mock node-fetch
vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

// getFallbackModels() consults a REAL on-disk store of the last successful
// fetch per provider, which outranks the configured fallbacks. Unmocked, these
// tests read whatever the host machine (or an earlier test) left behind, so
// they leak state into one another and depend on the developer's environment.
// Mocked to "nothing persisted" by default; the persisted-wins path gets its
// own explicit test below.
vi.mock('../../src/services/ai/lastModelsCache.js', () => ({
  persistLastModels: vi.fn(),
  getLastSuccessfulModels: vi.fn(() => null),
  getLastSuccessfulEntry: vi.fn(() => null),
}));

import fetch from 'node-fetch';
import { getLastSuccessfulEntry, persistLastModels } from '../../src/services/ai/lastModelsCache.js';
import { provenanceFields } from '../../src/services/ai/modelListing.js';

function createService(overrides = {}) {
  return new GenericProviderService({
    name: 'TestProvider',
    baseURL: 'https://api.test.com/v1',
    fallbackModels: ['model-a', 'model-b'],
    ...overrides,
  });
}

function mockFetchResponse(data, ok = true, status = 200) {
  fetch.mockResolvedValueOnce({
    ok,
    status,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: async () => data,
  });
}

describe('GenericProviderService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLastSuccessfulEntry.mockReturnValue(null);
  });

  describe('fetchModels', () => {
    test('fetches and transforms models from API', async () => {
      const service = createService();
      mockFetchResponse({
        data: [
          { id: 'gpt-4', owned_by: 'openai' },
          { id: 'gpt-3.5', owned_by: 'openai' },
        ],
      });

      const models = await service.fetchModels('test-key');

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('gpt-3.5'); // sorted alphabetically
      expect(models[1].id).toBe('gpt-4');
    });

    test('returns cached models within TTL', async () => {
      const service = createService();
      mockFetchResponse({ data: [{ id: 'model-1' }] });

      // First fetch
      await service.fetchModels('test-key');

      // Second fetch — should NOT call fetch again
      const models = await service.fetchModels('test-key');

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(models).toHaveLength(1);
    });

    test('bypasses cache when useCache=false', async () => {
      const service = createService();
      mockFetchResponse({ data: [{ id: 'model-1' }] });
      mockFetchResponse({ data: [{ id: 'model-1' }, { id: 'model-2' }] });

      await service.fetchModels('test-key');
      const models = await service.fetchModels('test-key', { useCache: false });

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(models).toHaveLength(2);
    });

    test('returns stale cache when API fails', async () => {
      const service = createService();
      mockFetchResponse({ data: [{ id: 'cached-model' }] });

      // Prime the cache
      await service.fetchModels('test-key');

      // Force cache to expire
      service.cacheTimestamp = Date.now() - 2 * 60 * 60 * 1000;

      // API failure
      fetch.mockRejectedValueOnce(new Error('Network error'));

      const models = await service.fetchModels('test-key');
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('cached-model');
    });

    test('returns fallback models when no cache and API fails', async () => {
      const service = createService();
      fetch.mockRejectedValueOnce(new Error('Network error'));

      const models = await service.fetchModels('test-key');

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('model-a');
      expect(models[1].id).toBe('model-b');
      expect(models[0].description).toContain('Fallback');
    });
  });

  describe('cache management', () => {
    test('isCacheValid returns false when no cache', () => {
      const service = createService();
      expect(service.isCacheValid()).toBe(false);
    });

    test('isCacheValid returns true within TTL', async () => {
      const service = createService();
      mockFetchResponse({ data: [{ id: 'test' }] });

      await service.fetchModels('key');
      expect(service.isCacheValid()).toBe(true);
    });

    test('isCacheValid returns false after TTL expires', async () => {
      const service = createService({ cacheTTL: 100 });
      mockFetchResponse({ data: [{ id: 'test' }] });

      await service.fetchModels('key');

      // Simulate cache expiry
      service.cacheTimestamp = Date.now() - 200;
      expect(service.isCacheValid()).toBe(false);
    });

    test('clearCache invalidates cache', async () => {
      const service = createService();
      mockFetchResponse({ data: [{ id: 'test' }] });

      await service.fetchModels('key');
      expect(service.isCacheValid()).toBe(true);

      service.clearCache();
      expect(service.isCacheValid()).toBe(false);
      expect(service.modelsCache).toBeNull();
    });
  });

  describe('auth schemes', () => {
    test('bearer auth adds Authorization header', async () => {
      const service = createService({ authScheme: 'bearer' });
      mockFetchResponse({ data: [] });

      await service.fetchModels('my-token');

      const callArgs = fetch.mock.calls[0];
      expect(callArgs[1].headers.Authorization).toBe('Bearer my-token');
    });

    test('api-key auth adds x-api-key header', async () => {
      const service = createService({ authScheme: 'api-key' });
      mockFetchResponse({ data: [] });

      await service.fetchModels('my-key');

      const callArgs = fetch.mock.calls[0];
      expect(callArgs[1].headers['x-api-key']).toBe('my-key');
    });

    test('query-param auth adds key to URL', async () => {
      const service = createService({ authScheme: 'query-param' });
      mockFetchResponse({ data: [] });

      await service.fetchModels('my-key');

      const callUrl = fetch.mock.calls[0][0];
      expect(callUrl).toContain('key=my-key');
    });
  });

  describe('response data extraction', () => {
    test('extracts from data path (default)', async () => {
      const service = createService();
      mockFetchResponse({ data: [{ id: 'model-1' }] });

      const models = await service.fetchModels('key');
      expect(models).toHaveLength(1);
    });

    test('extracts from root array', async () => {
      const service = createService({ responseDataPath: 'root' });
      mockFetchResponse([{ id: 'model-1' }]);

      const models = await service.fetchModels('key');
      expect(models).toHaveLength(1);
    });

    test('extracts from models path', async () => {
      const service = createService({ responseDataPath: 'models' });
      mockFetchResponse({ models: [{ id: 'model-1' }] });

      const models = await service.fetchModels('key');
      expect(models).toHaveLength(1);
    });
  });

  describe('custom transforms and filters', () => {
    test('applies custom transform', async () => {
      const service = createService({
        transformModel: (raw) => ({
          id: raw.id,
          name: raw.display_name || raw.id,
          custom: true,
        }),
      });
      mockFetchResponse({ data: [{ id: 'test', display_name: 'Test Model' }] });

      const models = await service.fetchModels('key');
      expect(models[0].name).toBe('Test Model');
      expect(models[0].custom).toBe(true);
    });

    test('applies custom filter', async () => {
      const service = createService({
        filterModel: (m) => m.active !== false,
      });
      mockFetchResponse({
        data: [
          { id: 'active', active: true },
          { id: 'inactive', active: false },
          { id: 'default' },
        ],
      });

      const models = await service.fetchModels('key');
      expect(models).toHaveLength(2);
      expect(models.find((m) => m.id === 'inactive')).toBeUndefined();
    });
  });

  describe('change detection', () => {
    test('emits models:added when new models appear', async () => {
      const service = createService();
      const addedHandler = vi.fn();
      service.on('models:added', addedHandler);

      // First fetch
      mockFetchResponse({ data: [{ id: 'model-a' }] });
      await service.fetchModels('key');

      // Expire cache
      service.cacheTimestamp = 0;

      // Second fetch with additional model
      mockFetchResponse({ data: [{ id: 'model-a' }, { id: 'model-b' }] });
      await service.fetchModels('key');

      expect(addedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'TestProvider',
          models: expect.arrayContaining([expect.objectContaining({ id: 'model-b' })]),
        }),
      );
    });

    test('emits models:removed when models disappear', async () => {
      const service = createService();
      const removedHandler = vi.fn();
      service.on('models:removed', removedHandler);

      // First fetch
      mockFetchResponse({ data: [{ id: 'model-a' }, { id: 'model-b' }] });
      await service.fetchModels('key');

      // Expire cache
      service.cacheTimestamp = 0;

      // Second fetch with model removed
      mockFetchResponse({ data: [{ id: 'model-a' }] });
      await service.fetchModels('key');

      expect(removedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'TestProvider',
          models: expect.arrayContaining([expect.objectContaining({ id: 'model-b' })]),
        }),
      );
    });
  });

  describe('getModelNames', () => {
    test('returns array of model IDs', async () => {
      const service = createService();
      mockFetchResponse({ data: [{ id: 'model-a' }, { id: 'model-b' }] });

      const names = await service.getModelNames('key');
      expect(names).toEqual(['model-a', 'model-b']);
    });
  });

  describe('getFallbackModels', () => {
    test('returns formatted fallback objects from ID list', () => {
      const service = createService({ fallbackModels: ['m1', 'm2'] });
      const fallbacks = service.getFallbackModels();

      expect(fallbacks).toHaveLength(2);
      expect(fallbacks[0]).toMatchObject({ id: 'm1', name: 'm1' });
      expect(fallbacks[0].description).toContain('Fallback');
    });

    test('returns custom fallback objects when provided', () => {
      const customFallbacks = [{ id: 'custom', name: 'Custom Model', special: true }];
      const service = createService({ fallbackModelObjects: customFallbacks });

      const fallbacks = service.getFallbackModels();
      expect(fallbacks).toEqual(customFallbacks);
    });

    test('prefers persisted last-successful models over configured fallbacks', () => {
      const persisted = [{ id: 'from-last-run', name: 'From Last Run' }];
      getLastSuccessfulEntry.mockReturnValue({ models: persisted, timestamp: 1 });

      const service = createService({ fallbackModelObjects: [{ id: 'configured' }] });

      expect(service.getFallbackModels()).toEqual(persisted);
      expect(getLastSuccessfulEntry).toHaveBeenCalledWith('testprovider');
    });
  });

  describe('persistence key', () => {
    test('persists under the registry key, not the display name', async () => {
      const service = createService({ key: 'togetherai', name: 'Together AI' });
      mockFetchResponse({ data: [{ id: 'model-a' }] });
      await service.fetchModels('k', { force: true });
      expect(persistLastModels).toHaveBeenCalledWith('togetherai', expect.any(Array), { replaces: ['together ai'] });
    });

    test('still reads a list saved under the old display-name key', () => {
      const legacy = [{ id: 'saved-before-upgrade' }];
      getLastSuccessfulEntry.mockImplementation((key) => (key === 'together ai' ? { models: legacy, timestamp: 5 } : null));
      const service = createService({ key: 'togetherai', name: 'Together AI' });
      expect(service.getFallbackModels()).toEqual(legacy);
      expect(getLastSuccessfulEntry.mock.calls.map(([k]) => k)).toEqual(['togetherai', 'together ai']);
    });
  });

  describe('listing provenance', () => {
    const failWith = (status, body) => fetch.mockResolvedValueOnce({
      ok: false, status, statusText: 'Forbidden', text: async () => body, json: async () => ({}),
    });

    test('a vendor answer is live and not stale', async () => {
      const service = createService();
      mockFetchResponse({ data: [{ id: 'model-a' }] });
      await service.fetchModels('k', { force: true });
      expect(provenanceFields(service.lastListing)).toMatchObject({ source: 'live', stale: false, upstreamError: null });
    });

    test('a cache hit within TTL is cache and not stale', async () => {
      const service = createService();
      mockFetchResponse({ data: [{ id: 'model-a' }] });
      await service.fetchModels('k', { force: true });
      await service.fetchModels('k');
      expect(provenanceFields(service.lastListing)).toMatchObject({ source: 'cache', stale: false });
    });

    test('REGRESSION: a vendor 403 over a saved list is persisted, stale, and carries the reason', async () => {
      // The live Grok case: xAI 403 "used all available credits" while AGNT
      // served a week-old list as if it were fresh.
      getLastSuccessfulEntry.mockReturnValue({ models: [{ id: 'grok-4.3' }], timestamp: Date.parse('2026-09-23T00:00:00Z') });
      const service = createService({ key: 'grokai', name: 'Grok AI' });
      failWith(403, '{"error":"Your team has either used all available credits"}');

      const models = await service.fetchModels('k', { force: true });

      expect(models).toEqual([{ id: 'grok-4.3' }]);
      expect(provenanceFields(service.lastListing)).toMatchObject({
        source: 'persisted', stale: true, fetchedAt: '2026-09-23T00:00:00.000Z',
      });
      expect(service.lastListing.error).toMatch(/403.*used all available credits/);
    });

    test('no saved list: fallback, stale, with the reason', async () => {
      const service = createService();
      fetch.mockRejectedValueOnce(new Error('ECONNRESET'));
      await service.fetchModels('k', { force: true });
      expect(provenanceFields(service.lastListing)).toMatchObject({ source: 'fallback', stale: true, upstreamError: 'ECONNRESET' });
    });

    test('an expired cache served because the refresh failed is stale', async () => {
      const service = createService();
      mockFetchResponse({ data: [{ id: 'model-a' }] });
      await service.fetchModels('k', { force: true });
      failWith(500, 'boom');
      await service.fetchModels('k', { force: true });
      expect(provenanceFields(service.lastListing)).toMatchObject({ source: 'cache', stale: true });
    });

    test('recovers to live once the vendor answers again', async () => {
      const service = createService();
      failWith(500, 'boom');
      await service.fetchModels('k', { force: true });
      mockFetchResponse({ data: [{ id: 'model-a' }] });
      await service.fetchModels('k', { force: true });
      expect(provenanceFields(service.lastListing)).toMatchObject({ source: 'live', stale: false, upstreamError: null });
    });

    test('never exposes the API key, even when a network error embeds the request URL', async () => {
      const key = 'AIzaSyD-this-is-a-secret-gemini-key-123';
      const service = createService({ authScheme: 'query-param' });
      fetch.mockRejectedValueOnce(new Error(`request to https://api.test.com/v1/models?key=${key} failed, reason: getaddrinfo ENOTFOUND`));
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

      await service.fetchModels(key, { force: true });

      expect(service.lastListing.error).not.toContain(key);
      expect(service.lastListing.error).toMatch(/key=\[redacted\].*ENOTFOUND/);
      expect(JSON.stringify(errors.mock.calls)).not.toContain(key);
    });
  });
});
