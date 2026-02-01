/**
 * Suite 05 — Tool Calls (Non-Streaming)
 *
 * Tests adapter.call(messages, tools) where the model should invoke tools.
 * Validates tool call shape, argument parsing, and multi-tool scenarios.
 */

import * as assert from '../core/assertions.js';
import { weatherTool, calculatorTool, toolMessages, multiToolMessages, mockWeatherResult } from '../core/mocks.js';

export default {
  name: 'tool-calls',

  async run(harness, result) {
    if (!harness.supportsTools) {
      harness.skipTest(result, 'single tool call', 'provider does not support tools');
      harness.skipTest(result, 'tool arguments are valid JSON', 'provider does not support tools');
      harness.skipTest(result, 'tool result formatting', 'provider does not support tools');
      harness.skipTest(result, 'multi-tool call', 'provider does not support tools');
      return;
    }

    // ── Test: single tool call ────────────────────────────────────────
    await harness.runTest(result, 'single tool call', async () => {
      const { responseMessage, toolCalls } = await harness.adapter.call(toolMessages, [weatherTool]);

      const checks = [];
      checks.push(assert.ok(responseMessage != null, 'responseMessage is not null'));
      checks.push(assert.isArray(toolCalls, 'toolCalls is array'));
      checks.push(assert.greaterThan(toolCalls.length, 0, 'at least one tool call'));

      if (toolCalls.length > 0) {
        checks.push(assert.isValidToolCall(toolCalls[0], 'first tool call'));
        checks.push(assert.eq(toolCalls[0].function.name, 'get_weather', 'called get_weather'));
      }

      return checks;
    });

    // ── Test: tool arguments are valid JSON with correct params ───────
    await harness.runTest(result, 'tool arguments are valid JSON', async () => {
      const { toolCalls } = await harness.adapter.call(toolMessages, [weatherTool]);

      const checks = [];
      if (toolCalls.length === 0) {
        checks.push(assert.ok(false, 'no tool calls returned'));
        return checks;
      }

      let args;
      try {
        args = JSON.parse(toolCalls[0].function.arguments);
        checks.push(assert.ok(true, 'arguments parsed as JSON'));
      } catch {
        checks.push(assert.ok(false, 'arguments is not valid JSON'));
        return checks;
      }

      checks.push(assert.typeOf(args.location, 'string', 'location is a string'));
      checks.push(assert.greaterThan(args.location.length, 0, 'location is non-empty'));

      return checks;
    });

    // ── Test: tool result formatting ──────────────────────────────────
    await harness.runTest(result, 'tool result formatting', async () => {
      const toolResult = mockWeatherResult('call_test_123');
      const formatted = harness.adapter.formatToolResults([toolResult]);

      const checks = [];
      checks.push(assert.isArray(formatted, 'formatted is array'));
      checks.push(assert.greaterThan(formatted.length, 0, 'formatted is non-empty'));

      // Anthropic wraps in user message; OpenAI returns as-is
      const first = formatted[0];
      checks.push(assert.ok(first != null, 'first formatted result exists'));

      if (first.role === 'user') {
        // Anthropic format
        checks.push(assert.isArray(first.content, 'Anthropic: content is array'));
        if (Array.isArray(first.content) && first.content.length > 0) {
          checks.push(assert.eq(first.content[0].type, 'tool_result', 'Anthropic: type is tool_result'));
          checks.push(assert.eq(first.content[0].tool_use_id, 'call_test_123', 'Anthropic: tool_use_id matches'));
        }
      } else if (first.role === 'tool') {
        // OpenAI format
        checks.push(assert.eq(first.tool_call_id, 'call_test_123', 'OpenAI: tool_call_id matches'));
        checks.push(assert.nonEmptyString(first.content, 'OpenAI: content is non-empty string'));
      }

      return checks;
    });

    // ── Test: multi-tool call ─────────────────────────────────────────
    await harness.runTest(result, 'multi-tool call', async () => {
      const { toolCalls } = await harness.adapter.call(multiToolMessages, [weatherTool]);

      const checks = [];
      checks.push(assert.isArray(toolCalls, 'toolCalls is array'));

      // Model may call tool once or multiple times — at least one call is required
      checks.push(assert.greaterThan(toolCalls.length, 0, 'at least one tool call'));

      // Validate all tool calls
      for (let i = 0; i < toolCalls.length; i++) {
        checks.push(assert.isValidToolCall(toolCalls[i], `tool call [${i}]`));
      }

      return checks;
    });

    // ── Test: calculator tool with different schema ────────────────────
    await harness.runTest(result, 'calculator tool call', async () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant. Always use tools when available.' },
        { role: 'user', content: 'Calculate 15 * 17 using the calculate tool.' },
      ];

      const { toolCalls } = await harness.adapter.call(messages, [calculatorTool]);

      const checks = [];
      checks.push(assert.isArray(toolCalls, 'toolCalls is array'));
      checks.push(assert.greaterThan(toolCalls.length, 0, 'at least one tool call'));

      if (toolCalls.length > 0) {
        checks.push(assert.eq(toolCalls[0].function.name, 'calculate', 'called calculate'));
        let args;
        try {
          args = JSON.parse(toolCalls[0].function.arguments);
          checks.push(assert.nonEmptyString(args.expression, 'expression is non-empty'));
        } catch {
          checks.push(assert.ok(false, 'failed to parse calculator arguments'));
        }
      }

      return checks;
    });

    // ── Test: multiple tools available, model picks correct one ───────
    await harness.runTest(result, 'model selects correct tool from multiple', async () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant. Use the most appropriate tool.' },
        { role: 'user', content: 'What is the weather in Paris?' },
      ];

      const { toolCalls } = await harness.adapter.call(messages, [weatherTool, calculatorTool]);

      const checks = [];
      checks.push(assert.greaterThan(toolCalls.length, 0, 'at least one tool call'));

      if (toolCalls.length > 0) {
        checks.push(assert.eq(toolCalls[0].function.name, 'get_weather', 'chose weather over calculator'));
      }

      return checks;
    });
  },
};
