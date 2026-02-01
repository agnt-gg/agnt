/**
 * Suite 07 — MCP Tool Integration
 *
 * MCP tools use the same OpenAI function-calling format as regular tools.
 * This suite verifies the model can invoke MCP-style tool schemas
 * through the adapter layer.
 */

import * as assert from '../core/assertions.js';
import { mcpFilesystemTool, mcpDatabaseTool, mcpMessages } from '../core/mocks.js';

export default {
  name: 'mcp',

  async run(harness, result) {
    if (!harness.supportsTools) {
      harness.skipTest(result, 'MCP tool invocation', 'provider does not support tools');
      harness.skipTest(result, 'MCP tool selection from multiple', 'provider does not support tools');
      return;
    }

    // ── Test: model invokes MCP-style tool ────────────────────────────
    await harness.runTest(result, 'MCP tool invocation', async () => {
      const { toolCalls } = await harness.adapter.call(mcpMessages, [mcpFilesystemTool]);

      const checks = [];
      checks.push(assert.isArray(toolCalls, 'toolCalls is array'));
      checks.push(assert.greaterThan(toolCalls.length, 0, 'at least one tool call'));

      if (toolCalls.length > 0) {
        checks.push(assert.isValidToolCall(toolCalls[0], 'MCP tool call'));
        checks.push(assert.eq(toolCalls[0].function.name, 'mcp_filesystem_read', 'called mcp_filesystem_read'));

        let args;
        try {
          args = JSON.parse(toolCalls[0].function.arguments);
          checks.push(assert.ok(true, 'MCP arguments parsed'));
          checks.push(assert.typeOf(args.path, 'string', 'path argument is string'));
        } catch {
          checks.push(assert.ok(false, 'MCP arguments not valid JSON'));
        }
      }

      return checks;
    });

    // ── Test: model selects correct MCP tool from multiple ────────────
    await harness.runTest(result, 'MCP tool selection from multiple', async () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant with MCP tools. Use the most appropriate tool.' },
        { role: 'user', content: 'Read the contents of the file /etc/hostname using the mcp_filesystem_read tool.' },
      ];

      const { toolCalls } = await harness.adapter.call(messages, [mcpFilesystemTool, mcpDatabaseTool]);

      const checks = [];
      checks.push(assert.greaterThan(toolCalls.length, 0, 'at least one tool call'));

      if (toolCalls.length > 0) {
        checks.push(assert.eq(
          toolCalls[0].function.name,
          'mcp_filesystem_read',
          'chose filesystem over database',
        ));
      }

      return checks;
    });

    // ── Test: MCP tool with streaming ─────────────────────────────────
    if (harness.supportsStreaming) {
      await harness.runTest(result, 'MCP tool via streaming', async () => {
        const { toolCalls } = await harness.adapter.callStream(
          mcpMessages,
          [mcpFilesystemTool],
          () => {},
          {},
        );

        const checks = [];
        checks.push(assert.greaterThan(toolCalls.length, 0, 'MCP tool called via streaming'));

        if (toolCalls.length > 0) {
          checks.push(assert.isValidToolCall(toolCalls[0], 'streamed MCP tool call'));
        }

        return checks;
      });
    } else {
      harness.skipTest(result, 'MCP tool via streaming', 'provider does not support streaming');
    }
  },
};
