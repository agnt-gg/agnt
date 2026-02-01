/**
 * Suite 01 — Connection & Authentication
 *
 * Validates that createLlmClient() produces a valid client for each
 * provider and that the adapter is the expected type.
 */

import { Anthropic } from '@anthropic-ai/sdk';
import { OpenAI } from 'openai/index.mjs';
import { GoogleGenAI } from '@google/genai';
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import * as assert from '../core/assertions.js';

const EXPECTED_CLIENT_TYPE = {
  openai:            OpenAI,
  anthropic:         Anthropic,
  'claude-code':     Anthropic,
  gemini:            GoogleGenAI,
  cerebras:          Cerebras,
  // OpenAI-compatible providers all use the OpenAI SDK
  deepseek:          OpenAI,
  groq:              OpenAI,
  grokai:            OpenAI,
  openrouter:        OpenAI,
  togetherai:        OpenAI,
  kimi:              OpenAI,
  minimax:           OpenAI,
  zai:               OpenAI,
  'openai-codex':    OpenAI,
  'openai-codex-cli': OpenAI,
};

export default {
  name: 'connection',

  async run(harness, result) {
    // ── Test: client is not null ──────────────────────────────────────
    await harness.runTest(result, 'client created successfully', async () => [
      assert.ok(harness.client != null, 'client is not null'),
    ]);

    // ── Test: client is expected SDK type ─────────────────────────────
    await harness.runTest(result, 'client is correct SDK type', async () => {
      const provider = harness.provider.toLowerCase();

      // Custom providers always get OpenAI SDK
      if (harness.isCustomProvider) {
        return [assert.instanceOf(harness.client, OpenAI, 'custom provider uses OpenAI SDK')];
      }

      const ExpectedType = EXPECTED_CLIENT_TYPE[provider];
      if (!ExpectedType) {
        return [assert.ok(true, `no SDK type assertion for provider "${provider}" (unknown)`)];
      }

      return [assert.instanceOf(harness.client, ExpectedType, `client is instance of ${ExpectedType.name}`)];
    });

    // ── Test: adapter is not null ─────────────────────────────────────
    await harness.runTest(result, 'adapter created successfully', async () => [
      assert.ok(harness.adapter != null, 'adapter is not null'),
      assert.ok(typeof harness.adapter.call === 'function', 'adapter has call()'),
      assert.ok(typeof harness.adapter.formatToolResults === 'function', 'adapter has formatToolResults()'),
    ]);

    // ── Test: capabilities resolved ───────────────────────────────────
    await harness.runTest(result, 'capabilities resolved', async () => [
      assert.ok(harness.capabilities != null, 'capabilities is not null'),
      assert.ok(harness.capabilities.text != null, 'text capabilities exist'),
      assert.typeOf(harness.supportsStreaming, 'boolean', 'supportsStreaming is boolean'),
      assert.typeOf(harness.supportsTools, 'boolean', 'supportsTools is boolean'),
    ]);

    // ── CLI-specific: claude-code headers ─────────────────────────────
    if (harness.provider.toLowerCase() === 'claude-code') {
      await harness.runTest(result, 'claude-code: OAuth Bearer headers present', async () => {
        const headers = harness.client._options?.defaultHeaders || harness.client.defaultHeaders || {};
        return [
          assert.includes(headers['anthropic-beta'] || '', 'claude-code-20250219', 'has claude-code beta'),
          assert.includes(headers['anthropic-beta'] || '', 'oauth-2025-04-20', 'has oauth beta'),
          assert.eq(headers['x-app'], 'cli', 'x-app is cli'),
          assert.includes(headers['user-agent'] || '', 'claude-cli', 'user-agent contains claude-cli'),
        ];
      });
    }

    // ── CLI-specific: codex-cli uses OpenAI SDK with Responses API ────
    if (harness.provider.toLowerCase() === 'openai-codex-cli') {
      await harness.runTest(result, 'codex-cli: OpenAI SDK with Responses API', async () => [
        assert.instanceOf(harness.client, OpenAI, 'client is OpenAI instance'),
        assert.ok(typeof harness.client.responses?.create === 'function', 'has responses.create()'),
      ]);
    }

    // ── CLI-specific: kimi-code compat headers ────────────────────────
    if (harness.isCustomProvider) {
      await harness.runTest(result, 'custom provider: compat flags', async () => {
        const checks = [assert.ok(true, 'custom provider detected')];
        if (harness.client.__agntCompat?.mapDeveloperRole) {
          checks.push(assert.eq(harness.client.__agntCompat.mapDeveloperRole, true, 'mapDeveloperRole is true'));
        }
        const ua = harness.client?.defaultHeaders?.['User-Agent'];
        if (ua) {
          checks.push(assert.nonEmptyString(ua, 'custom User-Agent header set'));
        }
        return checks;
      });
    }
  },
};
