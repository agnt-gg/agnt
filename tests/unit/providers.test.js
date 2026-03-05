/**
 * Provider configuration and schema validation tests.
 *
 * Run: node --test tests/unit/providers.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getAllProviderConfigs,
  getProviderConfig,
  getModelMetadata,
  getAllModelMetadata,
  buildBaseURLs,
} from '../../backend/src/services/ai/providerConfigs.js';

// ─────────────────────────── PROVIDER CONFIG TESTS ───────────────────────────

describe('Provider Configs', () => {
  const configs = getAllProviderConfigs();

  it('should have at least 10 providers', () => {
    assert.ok(configs.length >= 10, `Expected >= 10 providers, got ${configs.length}`);
  });

  for (const config of configs) {
    describe(`Provider: ${config.name} (${config.key})`, () => {
      it('should have required fields', () => {
        assert.ok(config.key, 'missing key');
        assert.ok(config.name, 'missing name');
        assert.ok(config.baseURL, 'missing baseURL');
        assert.ok(config.sdkType, 'missing sdkType');
        assert.ok(config.authScheme, 'missing authScheme');
      });

      it('should have a valid baseURL', () => {
        assert.doesNotThrow(() => new URL(config.baseURL), `Invalid baseURL: ${config.baseURL}`);
      });

      it('should have a valid sdkType', () => {
        const validTypes = ['openai', 'anthropic', 'gemini', 'cerebras'];
        assert.ok(validTypes.includes(config.sdkType), `Invalid sdkType: ${config.sdkType}`);
      });

      it('should have a valid authScheme', () => {
        const validSchemes = ['bearer', 'api-key', 'query-param', 'codex', 'codex-cli', 'claude-code'];
        assert.ok(validSchemes.includes(config.authScheme), `Invalid authScheme: ${config.authScheme}`);
      });

      it('should have fallbackModels array with at least 1 model', () => {
        assert.ok(Array.isArray(config.fallbackModels), 'fallbackModels should be an array');
        assert.ok(config.fallbackModels.length >= 1, `Expected >= 1 fallback model, got ${config.fallbackModels.length}`);
      });

      it('should have capabilities object', () => {
        assert.ok(config.capabilities, 'missing capabilities');
        assert.ok(config.capabilities.text, 'missing text capabilities');
      });

      if (config.fallbackVisionModels) {
        it('should have vision capability if visionModels defined', () => {
          assert.ok(config.capabilities.vision, `Has fallbackVisionModels but no vision capability`);
        });
      }

      if (config.modelMetadata) {
        it('should have valid model metadata', () => {
          for (const [modelId, meta] of Object.entries(config.modelMetadata)) {
            assert.ok(typeof meta.contextWindow === 'number', `${modelId}: contextWindow should be number`);
            assert.ok(meta.contextWindow > 0, `${modelId}: contextWindow should be > 0`);
            assert.ok(typeof meta.maxOutputTokens === 'number', `${modelId}: maxOutputTokens should be number`);
            assert.ok(typeof meta.supportsTools === 'boolean', `${modelId}: supportsTools should be boolean`);
            assert.ok(typeof meta.reasoning === 'boolean', `${modelId}: reasoning should be boolean`);
          }
        });
      }
    });
  }
});

// ─────────────────────────── STATIC MODEL PROVIDER TESTS ───────────────────────────

describe('Static Model Providers', () => {
  it('ZAI should be staticModels (no /models endpoint)', () => {
    const zai = getProviderConfig('zai');
    assert.ok(zai, 'ZAI provider not found');
    assert.strictEqual(zai.staticModels, true, 'ZAI should have staticModels: true');
  });

  it('MiniMax should be staticModels (no /models endpoint)', () => {
    const minimax = getProviderConfig('minimax');
    assert.ok(minimax, 'MiniMax provider not found');
    assert.strictEqual(minimax.staticModels, true, 'MiniMax should have staticModels: true');
  });

  it('ZAI should have GLM-5 and free models', () => {
    const zai = getProviderConfig('zai');
    assert.ok(zai.fallbackModels.includes('GLM-5'), 'Missing GLM-5');
    assert.ok(zai.fallbackModels.includes('GLM-4.7-Flash'), 'Missing GLM-4.7-Flash (free)');
    assert.ok(zai.fallbackModels.includes('GLM-4.5-Flash'), 'Missing GLM-4.5-Flash (free)');
  });

  it('ZAI free models should have $0 pricing', () => {
    const meta = getAllModelMetadata('zai');
    assert.strictEqual(meta['GLM-4.7-Flash'].inputCostPer1M, 0);
    assert.strictEqual(meta['GLM-4.7-Flash'].outputCostPer1M, 0);
    assert.strictEqual(meta['GLM-4.5-Flash'].inputCostPer1M, 0);
    assert.strictEqual(meta['GLM-4.5-Flash'].outputCostPer1M, 0);
  });

  it('MiniMax should include M2.5 models', () => {
    const minimax = getProviderConfig('minimax');
    assert.ok(minimax.fallbackModels.includes('MiniMax-M2.5'), 'Missing MiniMax-M2.5');
    assert.ok(minimax.fallbackModels.includes('MiniMax-M2.5-highspeed'), 'Missing MiniMax-M2.5-highspeed');
  });

  it('OpenAI Codex CLI should be staticModels', () => {
    const codexCli = getProviderConfig('openai-codex-cli');
    assert.ok(codexCli, 'OpenAI Codex CLI provider not found');
    assert.strictEqual(codexCli.staticModels, true);
  });
});

// ─────────────────────────── KIMI PROVIDER TESTS ───────────────────────────

describe('Kimi Provider', () => {
  it('should have correct base URL', () => {
    const kimi = getProviderConfig('kimi');
    assert.strictEqual(kimi.baseURL, 'https://api.moonshot.ai/v1');
  });

  it('should include latest K2 models', () => {
    const kimi = getProviderConfig('kimi');
    assert.ok(kimi.fallbackModels.includes('kimi-k2.5'), 'Missing kimi-k2.5');
    assert.ok(kimi.fallbackModels.includes('kimi-k2-thinking'), 'Missing kimi-k2-thinking');
    assert.ok(kimi.fallbackModels.includes('kimi-k2'), 'Missing kimi-k2');
  });

  it('should have model metadata for K2 models', () => {
    const meta = getAllModelMetadata('kimi');
    assert.ok(meta['kimi-k2.5'], 'Missing metadata for kimi-k2.5');
    assert.ok(meta['kimi-k2'], 'Missing metadata for kimi-k2');
    assert.ok(meta['kimi-k2-thinking'].reasoning === true, 'kimi-k2-thinking should be a reasoning model');
  });

  it('should use bearer auth', () => {
    const kimi = getProviderConfig('kimi');
    assert.strictEqual(kimi.authScheme, 'bearer');
  });
});

// ─────────────────────────── GEMINI SCHEMA FIX TESTS ───────────────────────────

describe('Gemini Schema Fix (_fixSchemaForGemini)', () => {
  // Import the adapter to test the schema fix method
  let fixSchema;

  it('should be importable', async () => {
    // We need to instantiate a GeminiAdapter to access _fixSchemaForGemini
    // Since it requires constructor args, we'll create a minimal instance
    const { GeminiAdapter } = await import('../../backend/src/services/orchestrator/llmAdapters.js');
    const adapter = new GeminiAdapter({}, 'gemini-2.5-pro', { tools: [] });
    fixSchema = (schema) => adapter._fixSchemaForGemini(schema);
    assert.ok(fixSchema, 'Should have _fixSchemaForGemini method');
  });

  it('should add missing items to array properties', async () => {
    const { GeminiAdapter } = await import('../../backend/src/services/orchestrator/llmAdapters.js');
    const adapter = new GeminiAdapter({}, 'gemini-2.5-pro', { tools: [] });

    const schema = {
      type: 'object',
      properties: {
        labels: { type: 'array', description: 'A list of labels' },
        tags: { type: 'array', description: 'A list of tags' },
      },
    };

    const fixed = adapter._fixSchemaForGemini(schema);
    assert.deepStrictEqual(fixed.properties.labels.items, { type: 'string' }, 'labels should get default items');
    assert.deepStrictEqual(fixed.properties.tags.items, { type: 'string' }, 'tags should get default items');
  });

  it('should not overwrite existing items on array properties', async () => {
    const { GeminiAdapter } = await import('../../backend/src/services/orchestrator/llmAdapters.js');
    const adapter = new GeminiAdapter({}, 'gemini-2.5-pro', { tools: [] });

    const schema = {
      type: 'object',
      properties: {
        scores: { type: 'array', items: { type: 'number' } },
      },
    };

    const fixed = adapter._fixSchemaForGemini(schema);
    assert.deepStrictEqual(fixed.properties.scores.items, { type: 'number' }, 'Should preserve existing items');
  });

  it('should filter empty strings from enum arrays', async () => {
    const { GeminiAdapter } = await import('../../backend/src/services/orchestrator/llmAdapters.js');
    const adapter = new GeminiAdapter({}, 'gemini-2.5-pro', { tools: [] });

    const schema = {
      type: 'object',
      properties: {
        color: { type: 'string', enum: ['', 'red', 'blue', 'green'] },
        orientation: { type: 'string', enum: ['', 'landscape', 'portrait'] },
      },
    };

    const fixed = adapter._fixSchemaForGemini(schema);
    assert.deepStrictEqual(fixed.properties.color.enum, ['red', 'blue', 'green']);
    assert.deepStrictEqual(fixed.properties.orientation.enum, ['landscape', 'portrait']);
  });

  it('should delete enum entirely if all values are empty strings', async () => {
    const { GeminiAdapter } = await import('../../backend/src/services/orchestrator/llmAdapters.js');
    const adapter = new GeminiAdapter({}, 'gemini-2.5-pro', { tools: [] });

    const schema = {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['', ''] },
      },
    };

    const fixed = adapter._fixSchemaForGemini(schema);
    assert.strictEqual(fixed.properties.status.enum, undefined, 'Should delete empty enum');
  });

  it('should remove enum from non-string types', async () => {
    const { GeminiAdapter } = await import('../../backend/src/services/orchestrator/llmAdapters.js');
    const adapter = new GeminiAdapter({}, 'gemini-2.5-pro', { tools: [] });

    const schema = {
      type: 'object',
      properties: {
        count: { type: 'integer', enum: [1, 2, 3] },
        featured: { type: 'boolean', enum: [true, false] },
      },
    };

    const fixed = adapter._fixSchemaForGemini(schema);
    assert.strictEqual(fixed.properties.count.enum, undefined, 'Should remove enum from integer');
    assert.strictEqual(fixed.properties.featured.enum, undefined, 'Should remove enum from boolean');
  });

  it('should handle nested object schemas recursively', async () => {
    const { GeminiAdapter } = await import('../../backend/src/services/orchestrator/llmAdapters.js');
    const adapter = new GeminiAdapter({}, 'gemini-2.5-pro', { tools: [] });

    const schema = {
      type: 'object',
      properties: {
        config: {
          type: 'object',
          properties: {
            items: { type: 'array' }, // missing items
            mode: { type: 'string', enum: ['', 'fast', 'slow'] }, // empty enum value
          },
        },
      },
    };

    const fixed = adapter._fixSchemaForGemini(schema);
    assert.deepStrictEqual(fixed.properties.config.properties.items.items, { type: 'string' });
    assert.deepStrictEqual(fixed.properties.config.properties.mode.enum, ['fast', 'slow']);
  });

  it('should handle the exact errors from the TODO', async () => {
    // Reproduces the exact Gemini errors reported in TODO.md
    const { GeminiAdapter } = await import('../../backend/src/services/orchestrator/llmAdapters.js');
    const adapter = new GeminiAdapter({}, 'gemini-2.5-pro', { tools: [] });

    const schema = {
      type: 'object',
      properties: {
        labels: { type: 'array' }, // "labels.items: missing field"
        lineItems: { type: 'array' }, // "lineItems.items: missing field"
        featured: { type: 'string', enum: ['', 'yes', 'no'] }, // "featured.enum[0]: cannot be empty"
        color: { type: 'string', enum: ['', 'red', 'blue'] }, // "color.enum[0]: cannot be empty"
        orientation: { type: 'string', enum: ['', 'landscape'] }, // "orientation.enum[0]: cannot be empty"
        trackRoles: { type: 'array' }, // "trackRoles.items: missing field"
        hashFields: { type: 'array' }, // "hashFields.items: missing field"
      },
    };

    const fixed = adapter._fixSchemaForGemini(schema);

    // All arrays should now have items
    assert.ok(fixed.properties.labels.items, 'labels should have items');
    assert.ok(fixed.properties.lineItems.items, 'lineItems should have items');
    assert.ok(fixed.properties.trackRoles.items, 'trackRoles should have items');
    assert.ok(fixed.properties.hashFields.items, 'hashFields should have items');

    // All enums should have no empty strings
    assert.ok(!fixed.properties.featured.enum.includes(''), 'featured enum should not have empty string');
    assert.ok(!fixed.properties.color.enum.includes(''), 'color enum should not have empty string');
    assert.ok(!fixed.properties.orientation.enum.includes(''), 'orientation enum should not have empty string');
  });
});

// ─────────────────────────── BASE URL TESTS ───────────────────────────

describe('Base URLs', () => {
  const urls = buildBaseURLs();

  it('should include all provider keys', () => {
    const configs = getAllProviderConfigs();
    for (const config of configs) {
      assert.ok(urls[config.key], `Missing base URL for ${config.key}`);
    }
  });

  it('should have correct ZAI base URL', () => {
    assert.strictEqual(urls.zai, 'https://api.z.ai/api/paas/v4');
  });

  it('should have correct MiniMax base URL', () => {
    assert.strictEqual(urls.minimax, 'https://api.minimax.io/v1');
  });

  it('should have correct Kimi base URL', () => {
    assert.strictEqual(urls.kimi, 'https://api.moonshot.ai/v1');
  });

  it('should include local provider', () => {
    assert.strictEqual(urls.local, 'http://127.0.0.1:1234/v1');
  });
});

// ─────────────────────────── GENERIC PROVIDER SERVICE TESTS ───────────────────────────

describe('GenericProviderService', () => {
  it('should return fallback models immediately on first fetch', async () => {
    const { default: GenericProviderService } = await import('../../backend/src/services/ai/providers/GenericProviderService.js');

    const service = new GenericProviderService({
      name: 'TestProvider',
      baseURL: 'https://fake.api.test/v1',
      fallbackModels: ['model-a', 'model-b'],
    });

    // Stub _fetchAllPages to avoid real network call
    service._fetchAllPages = async () => {
      throw new Error('no network in tests');
    };

    // First call should return fallbacks immediately (background fetch fails silently)
    const models = await service.fetchModels('fake-key');
    assert.ok(Array.isArray(models), 'Should return an array');
    assert.strictEqual(models.length, 2, 'Should return 2 fallback models');
    assert.strictEqual(models[0].id, 'model-a');
    assert.strictEqual(models[1].id, 'model-b');
  });

  it('should return cached models when cache is valid', async () => {
    const { default: GenericProviderService } = await import('../../backend/src/services/ai/providers/GenericProviderService.js');

    const service = new GenericProviderService({
      name: 'TestProvider',
      baseURL: 'https://fake.api.test/v1',
      fallbackModels: ['model-a'],
    });

    // Manually populate cache
    service.modelsCache = [{ id: 'cached-model', name: 'cached-model' }];
    service.cacheTimestamp = Date.now();

    const models = await service.fetchModels('fake-key');
    assert.strictEqual(models.length, 1);
    assert.strictEqual(models[0].id, 'cached-model');
  });

  it('should clear cache properly', async () => {
    const { default: GenericProviderService } = await import('../../backend/src/services/ai/providers/GenericProviderService.js');

    const service = new GenericProviderService({
      name: 'TestProvider',
      baseURL: 'https://fake.api.test/v1',
      fallbackModels: ['model-a'],
    });

    service.modelsCache = [{ id: 'cached' }];
    service.cacheTimestamp = Date.now();
    assert.ok(service.isCacheValid());

    service.clearCache();
    assert.ok(!service.isCacheValid());
    assert.strictEqual(service.modelsCache, null);
  });
});
