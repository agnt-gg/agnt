/**
 * Suite 06 — Tool Calls with Streaming
 *
 * Tests adapter.callStream(messages, tools, onChunk).
 * Validates tool call delta accumulation and AJV validation.
 */

import * as assert from '../core/assertions.js';
import { weatherTool, toolMessages, multiToolMessages } from '../core/mocks.js';

export default {
  name: 'tool-streaming',

  async run(harness, result) {
    if (!harness.supportsTools || !harness.supportsStreaming) {
      const reason = !harness.supportsTools
        ? 'provider does not support tools'
        : 'provider does not support streaming';
      harness.skipTest(result, 'streaming tool call', reason);
      harness.skipTest(result, 'tool call deltas accumulated correctly', reason);
      harness.skipTest(result, 'streaming multi-tool', reason);
      return;
    }

    // ── Test: streaming with tool call ────────────────────────────────
    await harness.runTest(result, 'streaming tool call', async () => {
      const contentChunks = [];
      const toolChunks = [];

      const { responseMessage, toolCalls } = await harness.adapter.callStream(
        toolMessages,
        [weatherTool],
        (chunk) => {
          if (chunk.type === 'content') contentChunks.push(chunk);
          if (chunk.type === 'tool_call_delta') toolChunks.push(chunk);
        },
        {},
      );

      const checks = [];
      checks.push(assert.ok(responseMessage != null, 'responseMessage is not null'));
      checks.push(assert.isArray(toolCalls, 'toolCalls is array'));
      checks.push(assert.greaterThan(toolCalls.length, 0, 'at least one tool call'));

      if (toolCalls.length > 0) {
        checks.push(assert.isValidToolCall(toolCalls[0], 'streamed tool call'));
        checks.push(assert.eq(toolCalls[0].function.name, 'get_weather', 'called get_weather'));
      }

      return checks;
    });

    // ── Test: tool call deltas accumulated correctly ──────────────────
    await harness.runTest(result, 'tool call deltas accumulated correctly', async () => {
      const toolChunks = [];

      const { toolCalls } = await harness.adapter.callStream(
        toolMessages,
        [weatherTool],
        (chunk) => {
          if (chunk.type === 'tool_call_delta') toolChunks.push(chunk);
        },
        {},
      );

      const checks = [];

      if (toolCalls.length === 0) {
        checks.push(assert.ok(false, 'no tool calls to validate'));
        return checks;
      }

      // Final tool call should have parseable arguments
      const finalArgs = toolCalls[0].function.arguments;
      let parsed;
      try {
        parsed = JSON.parse(finalArgs);
        checks.push(assert.ok(true, 'final arguments are valid JSON'));
      } catch {
        checks.push(assert.ok(false, `final arguments not valid JSON: ${finalArgs.substring(0, 100)}`));
        return checks;
      }

      checks.push(assert.typeOf(parsed.location, 'string', 'location param is string'));

      // Tool chunks should have index and toolCall properties
      if (toolChunks.length > 0) {
        checks.push(assert.hasProperty(toolChunks[0], 'index', 'chunk has index'));
        checks.push(assert.hasProperty(toolChunks[0], 'toolCall', 'chunk has toolCall'));
      }

      return checks;
    });

    // ── Test: streaming with multiple tool calls ─────────────────────
    await harness.runTest(result, 'streaming multi-tool', async () => {
      const toolChunks = [];

      const { toolCalls } = await harness.adapter.callStream(
        multiToolMessages,
        [weatherTool],
        (chunk) => {
          if (chunk.type === 'tool_call_delta') toolChunks.push(chunk);
        },
        {},
      );

      const checks = [];
      checks.push(assert.isArray(toolCalls, 'toolCalls is array'));
      checks.push(assert.greaterThan(toolCalls.length, 0, 'at least one tool call'));

      // Validate each tool call
      for (let i = 0; i < toolCalls.length; i++) {
        checks.push(assert.isValidToolCall(toolCalls[i], `streamed tool call [${i}]`));
      }

      return checks;
    });
  },
};
