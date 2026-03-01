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

import fetch from 'node-fetch';

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
        modelFilter: (m) => m.active !== false,
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
  });
});
