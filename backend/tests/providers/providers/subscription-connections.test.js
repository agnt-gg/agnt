import * as assert from '../core/assertions.js';
import { getConnection } from '../../../src/services/ai/connectionRuntime.js';
import { createLlmAdapter } from '../../../src/services/orchestrator/llmAdapters.js';
import { OpenAI } from 'openai/index.mjs';

/** Live-only gauntlet. Unit tests exercise the same paths with injected I/O. */
export default ['claude-code', 'openai-codex', 'gemini-cli', 'antigravity'].map(provider => ({
  name: `${provider}-connection`,
  provider,
  async run(harness, result) {
    const connection = getConnection(provider);
    await harness.runTest(result, 'connection supplies an access token', async () => [
      assert.nonEmptyString(await connection.getAccessToken(), 'access token is non-empty'),
    ]);
    await harness.runTest(result, 'connection status is available and usable', async () => {
      const status = await connection.checkApiUsable();
      return [assert.eq(status.available, true, 'available'), assert.eq(status.apiUsable, true, 'API usable')];
    });
    if (provider === 'claude-code') {
      await harness.runTest(result, 'messages SDK carries OAuth headers', async () => {
        const options = harness.client._options || {}, headers = options.defaultHeaders || {};
        return [assert.ok(options.apiKey == null, 'not an API-key client'), assert.nonEmptyString(options.authToken || '', 'Bearer token'),
          ...['claude-code-20250219', 'oauth-2025-04-20', 'fine-grained-tool-streaming', 'interleaved-thinking', 'prompt-caching'].map(flag => assert.includes(headers['anthropic-beta'] || '', flag, flag)),
          assert.eq(headers['x-app'], 'cli', 'wire application'), assert.includes(headers['user-agent'] || '', 'claude-cli', 'wire identity'),
          assert.eq(harness.adapter.constructor.name, 'AnthropicAdapter', 'messages adapter')];
      });
      await harness.runTest(result, 'tool definitions and results retain messages format', async () => {
        const tools = harness.adapter._transformToolsToAnthropic([{ type: 'function', function: { name: 'probe', description: 'Probe', parameters: { type: 'object', properties: {} } } }]);
        const messages = harness.adapter.formatToolResults([{ tool_call_id: 'call_probe', name: 'probe', role: 'tool', content: '{}' }]);
        return [assert.eq(tools[0].name, 'probe', 'tool name'), assert.hasProperty(tools[0], 'input_schema', 'input schema'),
          assert.eq(messages[0].role, 'user', 'tool carrier'), assert.eq(messages[0].content[0].tool_use_id, 'call_probe', 'paired result')];
      });
    } else if (provider === 'openai-codex') {
      await harness.runTest(result, 'responses SDK and adapter routing', async () => {
        const checks = [assert.instanceOf(harness.client, OpenAI, 'OpenAI SDK'), assert.ok(typeof harness.client.responses?.create === 'function', 'responses.create')];
        for (const model of ['gpt-5-codex', 'gpt-5', 'o3']) {
          const adapter = await createLlmAdapter(provider, harness.client, model);
          checks.push(assert.eq(adapter.constructor.name, 'ConnectionResponsesAdapter', `connection adapter: ${model}`));
        }
        let rejected = false;
        try { await createLlmAdapter(provider, harness.client, 'gpt-4.1'); } catch { rejected = true; }
        checks.push(assert.ok(rejected, 'unsupported chat-completions model is rejected'));
        return checks;
      });
    } else {
      await harness.runTest(result, 'gateway exposes generation and streaming', async () => [
        assert.ok(typeof harness.client.models?.generateContent === 'function', 'generateContent'),
        assert.ok(typeof harness.client.models?.generateContentStream === 'function', 'generateContentStream'),
      ]);
    }
  },
}));
