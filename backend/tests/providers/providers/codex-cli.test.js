/**
 * OpenAI Codex CLI Provider — Specific Tests
 *
 * Tests unique to the openai-codex-cli provider:
 * - Uses CodexAuthManager for local auth (same as openai-codex)
 * - Creates a standard OpenAI SDK client (no subprocess)
 * - Responses API routing for GPT-5/codex models (full tool support)
 * - Tool support is now enabled
 */

import { OpenAI } from 'openai/index.mjs';
import * as assert from '../core/assertions.js';
import CodexAuthManager from '../../../src/services/auth/CodexAuthManager.js';
import { createLlmAdapter } from '../../../src/services/orchestrator/llmAdapters.js';
import { PROVIDER_CAPABILITIES } from '../../../src/services/ai/ProviderRegistry.js';

export default {
  name: 'codex-cli-specific',
  provider: 'openai-codex-cli',

  async run(harness, result) {
    if (harness.provider.toLowerCase() !== 'openai-codex-cli') {
      harness.skipTest(result, 'codex-cli-specific', 'not openai-codex-cli provider');
      return;
    }

    // ── Test: client is OpenAI SDK instance ───────────────────────────
    await harness.runTest(result, 'client is OpenAI SDK', async () => [
      assert.instanceOf(harness.client, OpenAI, 'client is OpenAI instance'),
    ]);

    // ── Test: tool support is enabled in registry ────────────────────
    await harness.runTest(result, 'tool support is enabled', async () => {
      const caps = PROVIDER_CAPABILITIES['openai-codex-cli'];
      return [
        assert.ok(caps != null, 'capabilities exist'),
        assert.eq(caps.text.supportsTools, true, 'supportsTools is true'),
      ];
    });

    // ── Test: auth uses CodexAuthManager ──────────────────────────────
    await harness.runTest(result, 'CodexAuthManager provides token', async () => {
      const status = await CodexAuthManager.checkApiUsable();
      return [
        assert.ok(status != null, 'status returned'),
        assert.eq(status.available, true, 'available'),
      ];
    });

    // ── Test: auth token is available ────────────────────────────────
    await harness.runTest(result, 'auth token available', async () => {
      const token = CodexAuthManager.getAccessToken();
      return [
        assert.nonEmptyString(token, 'access token is non-empty'),
      ];
    });

    // ── Test: API usability check ────────────────────────────────────
    await harness.runTest(result, 'API usability check', async () => {
      const status = await CodexAuthManager.checkApiUsable();
      return [
        assert.ok(status != null, 'status object returned'),
        assert.eq(status.available, true, 'available is true'),
        assert.hasProperty(status, 'apiUsable', 'has apiUsable field'),
      ];
    });

    // ── Test: default model adapter is CodexResponsesAdapter ────────
    // gpt-5-codex requires Responses API
    await harness.runTest(result, 'gpt-5-codex gets CodexResponsesAdapter', async () => {
      const adapter = await createLlmAdapter('openai-codex-cli', harness.client, 'gpt-5-codex');
      return [
        assert.eq(adapter.constructor.name, 'CodexResponsesAdapter', 'adapter is CodexResponsesAdapter'),
      ];
    });

    // ── Test: gpt-5 also routes to Responses adapter ─────────────────
    await harness.runTest(result, 'gpt-5 gets CodexResponsesAdapter', async () => {
      const adapter = await createLlmAdapter('openai-codex-cli', harness.client, 'gpt-5');
      return [
        assert.eq(adapter.constructor.name, 'CodexResponsesAdapter', 'adapter is CodexResponsesAdapter'),
      ];
    });

    // ── Test: non-Responses model falls back to OpenAiLikeAdapter ────
    await harness.runTest(result, 'standard model falls back to OpenAiLikeAdapter', async () => {
      const adapter = await createLlmAdapter('openai-codex-cli', harness.client, 'gpt-4.1');
      return [
        assert.eq(adapter.constructor.name, 'OpenAiLikeAdapter', 'adapter is OpenAiLikeAdapter'),
      ];
    });

    // ── Test: harness adapter matches Responses API adapter ──────────
    await harness.runTest(result, 'harness adapter is CodexResponsesAdapter', async () => {
      const name = harness.adapter.constructor.name;
      return [
        assert.eq(name, 'CodexResponsesAdapter', `adapter class is ${name}`),
      ];
    });

    // ── Test: client has standard OpenAI SDK shape ───────────────────
    await harness.runTest(result, 'client has chat.completions.create()', async () => [
      assert.ok(typeof harness.client.chat?.completions?.create === 'function', 'create is function'),
    ]);

    // ── Test: client has responses API shape ─────────────────────────
    await harness.runTest(result, 'client has responses.create()', async () => [
      assert.ok(typeof harness.client.responses?.create === 'function', 'responses.create is function'),
    ]);
  },
};
