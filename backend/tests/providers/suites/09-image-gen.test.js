/**
 * Suite 09 — Image Generation
 *
 * Tests image generation capabilities for providers that support it.
 * Image generation uses a separate code path from chat completions,
 * so this suite validates the ProviderRegistry metadata rather than
 * making actual generation calls (which are expensive).
 */

import * as assert from '../core/assertions.js';
import {
  getImageGenCapabilities,
  getDefaultImageModel,
  isValidImageModel,
  getImageGenProviders,
} from '../../../src/services/ai/ProviderRegistry.js';

export default {
  name: 'image-gen',

  async run(harness, result) {
    if (!harness.supportsImageGen) {
      harness.skipTest(result, 'image-gen capabilities registered', 'provider does not support image generation');
      harness.skipTest(result, 'default image model set', 'provider does not support image generation');
      harness.skipTest(result, 'image model validation', 'provider does not support image generation');
      return;
    }

    const provider = harness.provider.toLowerCase();

    // ── Test: capabilities registered ─────────────────────────────────
    await harness.runTest(result, 'image-gen capabilities registered', async () => {
      const caps = getImageGenCapabilities(provider);
      const checks = [];

      checks.push(assert.ok(caps != null, 'imageGen capabilities exist'));
      checks.push(assert.isArray(caps.models, 'models is array'));
      checks.push(assert.greaterThan(caps.models.length, 0, 'has at least one model'));
      checks.push(assert.isArray(caps.operations, 'operations is array'));
      checks.push(assert.greaterThan(caps.operations.length, 0, 'has at least one operation'));
      checks.push(assert.includes(caps.operations, 'generate', 'supports generate operation'));

      return checks;
    });

    // ── Test: default image model set ─────────────────────────────────
    await harness.runTest(result, 'default image model set', async () => {
      const defaultModel = getDefaultImageModel(provider);
      return [
        assert.nonEmptyString(defaultModel, 'default model is non-empty string'),
        assert.ok(isValidImageModel(provider, defaultModel), 'default model is in valid models list'),
      ];
    });

    // ── Test: image model validation ──────────────────────────────────
    await harness.runTest(result, 'image model validation', async () => {
      const caps = getImageGenCapabilities(provider);
      const checks = [];

      // Valid model should pass
      checks.push(assert.ok(
        isValidImageModel(provider, caps.models[0]),
        `${caps.models[0]} is valid`,
      ));

      // Invalid model should fail
      checks.push(assert.ok(
        !isValidImageModel(provider, 'nonexistent-model-xyz'),
        'nonexistent model is invalid',
      ));

      return checks;
    });

    // ── Test: provider appears in image gen providers list ────────────
    await harness.runTest(result, 'listed in image-gen providers', async () => {
      const providers = getImageGenProviders();
      const found = providers.find((p) => p.provider === provider);
      return [
        assert.ok(found != null, `${provider} is listed in getImageGenProviders()`),
      ];
    });
  },
};
