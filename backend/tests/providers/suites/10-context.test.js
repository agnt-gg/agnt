/**
 * Suite 10 — Context Window Management
 *
 * Tests that the adapter handles long messages gracefully.
 * The production code uses manageContext() to trim messages
 * before they hit the provider API. This suite verifies:
 * - The adapter doesn't crash on long input
 * - Token-limit errors are handled (context reduction or clear error)
 */

import * as assert from '../core/assertions.js';
import { longContextMessages } from '../core/mocks.js';

export default {
  name: 'context',

  async run(harness, result) {
    // ── Test: moderate-length context works ───────────────────────────
    await harness.runTest(result, 'moderate context handled', async () => {
      // ~2000 tokens — should be within limits for all providers
      const messages = longContextMessages(2000);
      const { responseMessage } = await harness.adapter.call(messages, []);

      const checks = [];
      checks.push(assert.ok(responseMessage != null, 'got a response'));

      let text = '';
      if (typeof responseMessage.content === 'string') {
        text = responseMessage.content;
      } else if (Array.isArray(responseMessage.content)) {
        const tb = responseMessage.content.find((b) => b.type === 'text');
        text = tb?.text || '';
      }

      checks.push(assert.greaterThan(text.length, 0, 'response is non-empty'));

      return checks;
    });

    // ── Test: long conversation history ───────────────────────────────
    await harness.runTest(result, 'long conversation history', async () => {
      // Build a conversation with many turns
      const messages = [
        { role: 'system', content: 'You are a helpful assistant. Be concise.' },
      ];

      for (let i = 0; i < 20; i++) {
        messages.push({ role: 'user', content: `This is message number ${i + 1}. Remember this number.` });
        messages.push({ role: 'assistant', content: `I've noted message number ${i + 1}.` });
      }

      messages.push({ role: 'user', content: 'How many messages have I sent? Respond with just the number.' });

      const { responseMessage } = await harness.adapter.call(messages, []);

      const checks = [];
      checks.push(assert.ok(responseMessage != null, 'got a response'));

      // We just verify it doesn't crash — exact recall depends on model
      let text = '';
      if (typeof responseMessage.content === 'string') {
        text = responseMessage.content;
      } else if (Array.isArray(responseMessage.content)) {
        const tb = responseMessage.content.find((b) => b.type === 'text');
        text = tb?.text || '';
      }
      checks.push(assert.greaterThan(text.length, 0, 'response is non-empty'));

      return checks;
    });

    // ── Test: adapter handles messages-only (no system) ───────────────
    await harness.runTest(result, 'handles messages without system prompt', async () => {
      const messages = [
        { role: 'user', content: 'The quick brown fox jumps over the lazy dog. '.repeat(50) + '\n\nSummarize the above in one word.' },
      ];

      const { responseMessage } = await harness.adapter.call(messages, []);

      const checks = [];
      checks.push(assert.ok(responseMessage != null, 'got a response'));

      return checks;
    });
  },
};
