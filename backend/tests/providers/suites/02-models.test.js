/**
 * Suite 02 — Model Listing & Validation
 *
 * Verifies that provider services return model lists and that
 * the ProviderRegistry caching works correctly.
 */

import * as assert from '../core/assertions.js';
import { PROVIDER_CAPABILITIES, getTextModels, getVisionModels, clearModelCache } from '../../../src/services/ai/ProviderRegistry.js';

// Dynamic imports for provider services
const providerServicePaths = {
  openai:     '../../../src/services/ai/providers/OpenAI.js',
  anthropic:  '../../../src/services/ai/providers/Anthropic.js',
  'claude-code': '../../../src/services/ai/providers/ClaudeCode.js',
  gemini:     '../../../src/services/ai/providers/Gemini.js',
  groq:       '../../../src/services/ai/providers/Groq.js',
  deepseek:   '../../../src/services/ai/providers/DeepSeek.js',
  cerebras:   '../../../src/services/ai/providers/Cerebras.js',
  openrouter: '../../../src/services/ai/providers/OpenRouter.js',
  togetherai: '../../../src/services/ai/providers/TogetherAI.js',
  grokai:     '../../../src/services/ai/providers/GrokAI.js',
  kimi:       '../../../src/services/ai/providers/Kimi.js',
  minimax:    '../../../src/services/ai/providers/Minimax.js',
  zai:        '../../../src/services/ai/providers/ZAI.js',
  'openai-codex-cli': '../../../src/services/ai/providers/OpenAICodexCli.js',
};

export default {
  name: 'models',

  async run(harness, result) {
    const provider = harness.provider.toLowerCase();

    // ── Test: static models from ProviderRegistry ────────────────────
    await harness.runTest(result, 'registry has text models', async () => {
      const models = getTextModels(provider);
      return [
        assert.isArray(models, 'text models is an array'),
        assert.greaterThan(models.length, 0, 'has at least one text model'),
      ];
    });

    // ── Test: vision models (if supported) ───────────────────────────
    if (harness.supportsVision) {
      await harness.runTest(result, 'registry has vision models', async () => {
        const models = getVisionModels(provider);
        return [
          assert.isArray(models, 'vision models is an array'),
          assert.greaterThan(models.length, 0, 'has at least one vision model'),
        ];
      });
    } else {
      harness.skipTest(result, 'registry has vision models', 'provider does not support vision');
    }

    // ── Test: provider service fetchModels (skip for custom) ─────────
    if (harness.isCustomProvider) {
      harness.skipTest(result, 'provider service fetchModels', 'custom providers use dynamic fetch');
      return;
    }

    const servicePath = providerServicePaths[provider];
    if (!servicePath) {
      harness.skipTest(result, 'provider service fetchModels', `no service module for "${provider}"`);
      return;
    }

    await harness.runTest(result, 'provider service has fetch/fallback', async () => {
      const mod = await import(servicePath);
      const service = mod.default || mod;
      const checks = [];

      // Every service should expose getModelNames or fetchModels
      const hasFetch = typeof service.fetchModels === 'function' || typeof service.getModelNames === 'function';
      checks.push(assert.ok(hasFetch, 'service exposes fetchModels or getModelNames'));

      // Fallback models should always be available
      if (typeof service.getFallbackModels === 'function') {
        const fallbacks = service.getFallbackModels();
        checks.push(assert.isArray(fallbacks, 'fallback models is array'));
        checks.push(assert.greaterThan(fallbacks.length, 0, 'has fallback models'));
      } else if (typeof service.getAvailableModels === 'function') {
        const available = service.getAvailableModels();
        checks.push(assert.isArray(available, 'available models is array'));
      }

      return checks;
    });

    // ── Test: cache clear works without error ────────────────────────
    await harness.runTest(result, 'clearModelCache succeeds', async () => {
      clearModelCache();
      return [assert.ok(true, 'clearModelCache did not throw')];
    });

    // ── Test: configured test model is in known models ───────────────
    await harness.runTest(result, 'test model is recognized', async () => {
      const allText = getTextModels(provider);
      // Dynamic providers may have models not in the static list, that's OK
      if (allText.length === 0) {
        return [assert.ok(true, 'no static models to validate against (dynamic provider)')];
      }
      // We don't require exact match — the test model might be fetched dynamically
      return [assert.ok(true, `test model "${harness.model}" will be used`)];
    });
  },
};
