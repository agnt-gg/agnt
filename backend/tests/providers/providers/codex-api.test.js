/**
 * OpenAI Codex (API) Provider — Specific Tests
 *
 * Tests unique to the openai-codex provider (API-based, not CLI):
 * - Uses CodexAuthManager for local auth (not remote AuthManager)
 * - Creates a standard OpenAI SDK client
 * - Responses API routing for GPT-5/o-series models
 */

import { OpenAI } from 'openai/index.mjs';
import * as assert from '../core/assertions.js';
import CodexAuthManager from '../../../src/services/auth/CodexAuthManager.js';
import { createLlmAdapter } from '../../../src/services/orchestrator/llmAdapters.js';

export default {
  name: 'codex-api-specific',
  provider: 'openai-codex',

  async run(harness, result) {
    if (harness.provider.toLowerCase() !== 'openai-codex') {
      harness.skipTest(result, 'codex-api-specific', 'not openai-codex provider');
      return;
    }

    // ── Test: client is OpenAI SDK instance ───────────────────────────
    await harness.runTest(result, 'client is OpenAI SDK', async () => [
      assert.instanceOf(harness.client, OpenAI, 'client is OpenAI instance'),
    ]);

    // ── Test: auth uses CodexAuthManager ──────────────────────────────
    await harness.runTest(result, 'CodexAuthManager provides token', async () => {
      const status = await CodexAuthManager.checkApiUsable();
      return [
        assert.ok(status != null, 'status returned'),
        assert.eq(status.available, true, 'available'),
        assert.eq(status.apiUsable, true, 'API usable'),
      ];
    });

    // ── Test: token is available ──────────────────────────────────────
    await harness.runTest(result, 'access token available', async () => {
      const token = CodexAuthManager.getAccessToken();
      return [
        assert.nonEmptyString(token, 'token is non-empty'),
      ];
    });

    // ── Test: adapter routing for standard models ─────────────────────
    await harness.runTest(result, 'standard model gets OpenAiLikeAdapter', async () => {
      const adapter = await createLlmAdapter('openai-codex', harness.client, 'gpt-4.1');
      return [
        assert.eq(adapter.constructor.name, 'OpenAiLikeAdapter', 'adapter is OpenAiLikeAdapter'),
      ];
    });

    // ── Test: adapter routing for GPT-5 models ────────────────────────
    await harness.runTest(result, 'GPT-5 model gets OpenAIResponsesAdapter', async () => {
      const adapter = await createLlmAdapter('openai-codex', harness.client, 'gpt-5');
      return [
        assert.eq(adapter.constructor.name, 'OpenAIResponsesAdapter', 'adapter is OpenAIResponsesAdapter'),
      ];
    });

    // ── Test: adapter routing for o-series models ─────────────────────
    await harness.runTest(result, 'o3 model gets OpenAIResponsesAdapter', async () => {
      const adapter = await createLlmAdapter('openai-codex', harness.client, 'o3');
      return [
        assert.eq(adapter.constructor.name, 'OpenAIResponsesAdapter', 'adapter is OpenAIResponsesAdapter'),
      ];
    });
  },
};
