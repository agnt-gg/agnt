/**
 * Claude Code Provider — Specific Tests
 *
 * Tests unique to the claude-code provider:
 * - OAuth Bearer auth (not x-api-key)
 * - Required beta headers
 * - System prompt identity block
 * - Anthropic adapter selection
 * - Local auth manager integration
 */

import * as assert from '../core/assertions.js';
import ClaudeCodeAuthManager from '../../../src/services/auth/ClaudeCodeAuthManager.js';

export default {
  name: 'claude-code-specific',
  provider: 'claude-code',

  async run(harness, result) {
    // Only run for claude-code
    if (harness.provider.toLowerCase() !== 'claude-code') {
      harness.skipTest(result, 'claude-code-specific', 'not claude-code provider');
      return;
    }

    // ── Test: OAuth token is available ─────────────────────────────────
    await harness.runTest(result, 'OAuth token available', async () => {
      const token = ClaudeCodeAuthManager.getAccessToken();
      return [
        assert.nonEmptyString(token, 'access token is non-empty'),
      ];
    });

    // ── Test: client uses authToken, not apiKey ───────────────────────
    await harness.runTest(result, 'client uses Bearer auth (not x-api-key)', async () => {
      const opts = harness.client._options || {};
      return [
        assert.ok(opts.apiKey === null || opts.apiKey === undefined, 'apiKey is null/undefined'),
        assert.nonEmptyString(opts.authToken || '', 'authToken is set'),
      ];
    });

    // ── Test: all required beta headers present ───────────────────────
    await harness.runTest(result, 'required beta headers present', async () => {
      const headers = harness.client._options?.defaultHeaders || harness.client.defaultHeaders || {};
      const beta = headers['anthropic-beta'] || '';

      return [
        assert.includes(beta, 'claude-code-20250219', 'claude-code beta flag'),
        assert.includes(beta, 'oauth-2025-04-20', 'oauth beta flag'),
        assert.includes(beta, 'fine-grained-tool-streaming', 'tool streaming beta'),
        assert.includes(beta, 'interleaved-thinking', 'interleaved thinking beta'),
        assert.includes(beta, 'prompt-caching', 'prompt caching beta'),
        assert.eq(headers['x-app'], 'cli', 'x-app header is cli'),
        assert.includes(headers['user-agent'] || '', 'claude-cli', 'user-agent has claude-cli'),
        assert.eq(headers['anthropic-dangerous-direct-browser-access'], 'true', 'browser access header'),
      ];
    });

    // ── Test: adapter is AnthropicAdapter ─────────────────────────────
    await harness.runTest(result, 'adapter is AnthropicAdapter', async () => {
      const name = harness.adapter.constructor.name;
      return [
        assert.eq(name, 'AnthropicAdapter', `adapter class is ${name}`),
      ];
    });

    // ── Test: adapter provider field is 'claude-code' ─────────────────
    await harness.runTest(result, 'adapter provider field is claude-code', async () => [
      assert.eq(harness.adapter.provider, 'claude-code', 'adapter.provider is claude-code'),
    ]);

    // ── Test: max tokens resolved for model ───────────────────────────
    await harness.runTest(result, 'max tokens resolved for model', async () => {
      if (typeof harness.adapter._getMaxTokensForModel !== 'function') {
        return [assert.ok(true, '_getMaxTokensForModel not exposed (OK)')];
      }
      const maxTokens = harness.adapter._getMaxTokensForModel();
      return [
        assert.greaterThan(maxTokens, 0, 'max tokens > 0'),
        assert.ok(maxTokens >= 4096, `max tokens >= 4096 (got ${maxTokens})`),
      ];
    });

    // ── Test: API check succeeds ──────────────────────────────────────
    await harness.runTest(result, 'API status check succeeds', async () => {
      if (typeof ClaudeCodeAuthManager.checkApiStatus !== 'function') {
        return [assert.ok(true, 'checkApiStatus not available (OK)')];
      }
      const status = await ClaudeCodeAuthManager.checkApiStatus();
      return [
        assert.ok(status != null, 'status returned'),
      ];
    });

    // ── Test: tool format transformation ──────────────────────────────
    await harness.runTest(result, 'tools transformed to Anthropic format', async () => {
      if (typeof harness.adapter._transformToolsToAnthropic !== 'function') {
        return [assert.ok(true, '_transformToolsToAnthropic not exposed (OK)')];
      }

      const openaiTools = [{
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: { x: { type: 'string' } } },
        },
      }];

      const anthropicTools = harness.adapter._transformToolsToAnthropic(openaiTools);
      const checks = [];
      checks.push(assert.isArray(anthropicTools, 'result is array'));
      checks.push(assert.eq(anthropicTools.length, 1, 'one tool'));
      checks.push(assert.eq(anthropicTools[0].name, 'test_tool', 'name preserved'));
      checks.push(assert.eq(anthropicTools[0].description, 'A test tool', 'description preserved'));
      checks.push(assert.hasProperty(anthropicTools[0], 'input_schema', 'has input_schema'));
      // Should NOT have 'function' wrapper
      checks.push(assert.ok(!anthropicTools[0].function, 'no function wrapper'));

      return checks;
    });

    // ── Test: tool result format is Anthropic-style ───────────────────
    await harness.runTest(result, 'tool results formatted as Anthropic user message', async () => {
      const toolResults = [{
        tool_call_id: 'call_abc',
        role: 'tool',
        name: 'test_tool',
        content: '{"result": "ok"}',
      }];

      const formatted = harness.adapter.formatToolResults(toolResults);
      const checks = [];

      checks.push(assert.isArray(formatted, 'formatted is array'));
      checks.push(assert.eq(formatted.length, 1, 'one formatted message'));
      checks.push(assert.eq(formatted[0].role, 'user', 'wrapped in user message'));
      checks.push(assert.isArray(formatted[0].content, 'content is array'));

      if (Array.isArray(formatted[0].content) && formatted[0].content.length > 0) {
        checks.push(assert.eq(formatted[0].content[0].type, 'tool_result', 'type is tool_result'));
        checks.push(assert.eq(formatted[0].content[0].tool_use_id, 'call_abc', 'tool_use_id matches'));
      }

      return checks;
    });
  },
};
