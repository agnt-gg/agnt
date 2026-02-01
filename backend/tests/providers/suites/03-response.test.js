/**
 * Suite 03 — Basic Text Response
 *
 * Tests adapter.call() with no tools — pure text completion.
 * Validates the response shape is correct for each adapter type.
 */

import * as assert from '../core/assertions.js';
import { basicMessages } from '../core/mocks.js';

export default {
  name: 'response',

  async run(harness, result) {
    // ── Test: basic response returns valid shape ─────────────────────
    await harness.runTest(result, 'basic text response', async () => {
      const { responseMessage, toolCalls } = await harness.adapter.call(basicMessages, []);
      const checks = [];

      checks.push(assert.ok(responseMessage != null, 'responseMessage is not null'));
      checks.push(assert.eq(responseMessage.role, 'assistant', 'role is assistant'));

      // Content can be string (OpenAI-like) or array of blocks (Anthropic)
      const hasContent =
        typeof responseMessage.content === 'string' ||
        (Array.isArray(responseMessage.content) && responseMessage.content.length > 0);
      checks.push(assert.ok(hasContent, 'response has content'));

      // Extract text for further checks
      let text = '';
      if (typeof responseMessage.content === 'string') {
        text = responseMessage.content;
      } else if (Array.isArray(responseMessage.content)) {
        const textBlock = responseMessage.content.find((b) => b.type === 'text');
        text = textBlock?.text || '';
      }

      checks.push(assert.greaterThan(text.length, 0, 'response text is non-empty'));
      checks.push(assert.includes(text, '4', 'response contains expected answer "4"'));

      // No tool calls when no tools are provided
      checks.push(assert.isArray(toolCalls, 'toolCalls is array'));
      checks.push(assert.eq(toolCalls.length, 0, 'no tool calls when no tools provided'));

      return checks;
    });

    // ── Test: multi-turn conversation ────────────────────────────────
    await harness.runTest(result, 'multi-turn conversation', async () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant. Be concise.' },
        { role: 'user', content: 'My name is TestUser.' },
        { role: 'assistant', content: 'Hello, TestUser! How can I help you?' },
        { role: 'user', content: 'What is my name? Reply with ONLY the name, nothing else.' },
      ];

      const { responseMessage } = await harness.adapter.call(messages, []);
      const checks = [];

      checks.push(assert.ok(responseMessage != null, 'got a response'));

      let text = '';
      if (typeof responseMessage.content === 'string') {
        text = responseMessage.content;
      } else if (Array.isArray(responseMessage.content)) {
        const textBlock = responseMessage.content.find((b) => b.type === 'text');
        text = textBlock?.text || '';
      }

      checks.push(assert.includes(text.toLowerCase(), 'testuser', 'model remembers the name'));

      return checks;
    });

    // ── Test: empty system prompt handled ─────────────────────────────
    await harness.runTest(result, 'works without system prompt', async () => {
      const messages = [
        { role: 'user', content: 'Say the word "hello" and nothing else.' },
      ];

      const { responseMessage } = await harness.adapter.call(messages, []);
      const checks = [];

      checks.push(assert.ok(responseMessage != null, 'got a response'));

      let text = '';
      if (typeof responseMessage.content === 'string') {
        text = responseMessage.content;
      } else if (Array.isArray(responseMessage.content)) {
        const textBlock = responseMessage.content.find((b) => b.type === 'text');
        text = textBlock?.text || '';
      }

      checks.push(assert.includes(text.toLowerCase(), 'hello', 'response contains "hello"'));

      return checks;
    });
  },
};
