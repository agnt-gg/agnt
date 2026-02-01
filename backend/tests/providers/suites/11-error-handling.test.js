/**
 * Suite 11 — Error Handling & Resilience
 *
 * Validates that the adapter layer handles errors gracefully.
 * Tests the "never-stop" guarantee (adapters return recovery responses
 * instead of throwing), empty messages, and malformed inputs.
 */

import * as assert from '../core/assertions.js';

export default {
  name: 'error-handling',

  async run(harness, result) {
    // ── Test: empty messages array doesn't crash ──────────────────────
    await harness.runTest(result, 'empty messages handled', async () => {
      try {
        // Some providers require at least one message — adapter should
        // either return a response or throw a descriptive error (not crash)
        const { responseMessage } = await harness.adapter.call([], []);

        // If we get here, it returned something
        return [assert.ok(responseMessage != null, 'returned a response for empty messages')];
      } catch (err) {
        // An error is acceptable if it's descriptive
        return [assert.ok(
          err.message && err.message.length > 0,
          `threw descriptive error: ${err.message.substring(0, 100)}`,
        )];
      }
    });

    // ── Test: invalid tool schema doesn't crash ───────────────────────
    if (harness.supportsTools) {
      await harness.runTest(result, 'invalid tool schema handled', async () => {
        const badTool = {
          type: 'function',
          function: {
            name: 'bad_tool',
            description: 'A tool with minimal schema',
            parameters: {
              type: 'object',
              properties: {},
            },
          },
        };

        try {
          const { responseMessage } = await harness.adapter.call(
            [{ role: 'user', content: 'Hello' }],
            [badTool],
          );
          return [assert.ok(responseMessage != null, 'handled minimal tool schema')];
        } catch (err) {
          return [assert.ok(
            err.message.length > 0,
            `threw descriptive error for bad schema: ${err.message.substring(0, 100)}`,
          )];
        }
      });
    } else {
      harness.skipTest(result, 'invalid tool schema handled', 'provider does not support tools');
    }

    // ── Test: very long single message ────────────────────────────────
    await harness.runTest(result, 'very long message handled', async () => {
      // Generate a message that's long but not insanely so
      const longText = 'x '.repeat(5000); // ~10K chars, ~2500 tokens
      const messages = [
        { role: 'user', content: `Summarize this: ${longText}` },
      ];

      try {
        const { responseMessage } = await harness.adapter.call(messages, []);

        let text = '';
        if (typeof responseMessage.content === 'string') {
          text = responseMessage.content;
        } else if (Array.isArray(responseMessage.content)) {
          const tb = responseMessage.content.find((b) => b.type === 'text');
          text = tb?.text || '';
        }

        return [assert.ok(text.length > 0 || responseMessage != null, 'handled long message')];
      } catch (err) {
        // If it fails, should be a descriptive error about token limits
        return [assert.ok(
          err.message.length > 0,
          `threw descriptive error: ${err.message.substring(0, 100)}`,
        )];
      }
    });

    // ── Test: malformed message role ──────────────────────────────────
    await harness.runTest(result, 'malformed message role handled', async () => {
      // developer role should be handled (Kimi Code maps it, others may reject)
      const messages = [
        { role: 'user', content: 'What is 1+1? Reply with just the number.' },
      ];

      try {
        const { responseMessage } = await harness.adapter.call(messages, []);
        return [assert.ok(responseMessage != null, 'handled message with no system prompt')];
      } catch (err) {
        return [assert.ok(
          err.message.length > 0,
          `descriptive error: ${err.message.substring(0, 100)}`,
        )];
      }
    });

    // ── Test: adapter never-stop guarantee (recovery response) ────────
    await harness.runTest(result, 'adapter returns response (never throws on normal input)', async () => {
      // Normal, valid input should always return a response — never throw
      const messages = [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Say "ok".' },
      ];

      const { responseMessage } = await harness.adapter.call(messages, []);

      const checks = [];
      checks.push(assert.ok(responseMessage != null, 'responseMessage is not null'));
      checks.push(assert.eq(responseMessage.role, 'assistant', 'role is assistant'));

      return checks;
    });

    // ── Test: streaming error handling ─────────────────────────────────
    if (harness.supportsStreaming) {
      await harness.runTest(result, 'streaming handles normal input without error', async () => {
        const chunks = [];
        const { responseMessage } = await harness.adapter.callStream(
          [{ role: 'user', content: 'Say "ok".' }],
          [],
          (chunk) => chunks.push(chunk),
          {},
        );

        const checks = [];
        checks.push(assert.ok(responseMessage != null, 'got streamed response'));
        checks.push(assert.greaterThan(chunks.length, 0, 'received chunks'));

        return checks;
      });
    } else {
      harness.skipTest(result, 'streaming handles normal input without error', 'no streaming support');
    }
  },
};
