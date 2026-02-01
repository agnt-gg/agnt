/**
 * Suite 04 — Streaming Responses
 *
 * Tests adapter.callStream() with no tools.
 * Validates chunk shape, monotonic accumulation, and final consistency.
 */

import * as assert from '../core/assertions.js';
import { basicMessages } from '../core/mocks.js';

export default {
  name: 'streaming',

  async run(harness, result) {
    if (!harness.supportsStreaming) {
      harness.skipTest(result, 'streaming response', 'provider does not support streaming');
      return;
    }

    // ── Test: streaming delivers chunks ───────────────────────────────
    await harness.runTest(result, 'streaming delivers multiple chunks', async () => {
      const chunks = [];
      const { responseMessage } = await harness.adapter.callStream(
        basicMessages,
        [],
        (chunk) => chunks.push(chunk),
        {},
      );

      const checks = [];

      checks.push(assert.greaterThan(chunks.length, 0, 'received at least one chunk'));

      // All chunks should have valid type
      const contentChunks = chunks.filter((c) => c.type === 'content');
      checks.push(assert.greaterThan(contentChunks.length, 0, 'received at least one content chunk'));

      // Each content chunk has delta and accumulated
      for (let i = 0; i < Math.min(contentChunks.length, 3); i++) {
        checks.push(assert.typeOf(contentChunks[i].delta, 'string', `chunk[${i}].delta is string`));
        checks.push(assert.typeOf(contentChunks[i].accumulated, 'string', `chunk[${i}].accumulated is string`));
      }

      // Accumulated content should grow monotonically
      for (let i = 1; i < contentChunks.length; i++) {
        const prev = contentChunks[i - 1].accumulated.length;
        const curr = contentChunks[i].accumulated.length;
        checks.push(assert.ok(
          curr >= prev,
          `accumulated grows: [${i - 1}]=${prev} <= [${i}]=${curr}`,
        ));
      }

      // Final responseMessage should match accumulated
      let finalText = '';
      if (typeof responseMessage.content === 'string') {
        finalText = responseMessage.content;
      } else if (Array.isArray(responseMessage.content)) {
        const tb = responseMessage.content.find((b) => b.type === 'text');
        finalText = tb?.text || '';
      }

      if (contentChunks.length > 0) {
        const lastAccumulated = contentChunks[contentChunks.length - 1].accumulated;
        checks.push(assert.eq(
          finalText,
          lastAccumulated,
          'final content matches last accumulated chunk',
        ));
      }

      checks.push(assert.includes(finalText, '4', 'streamed response contains "4"'));

      return checks;
    });

    // ── Test: stream with longer response ─────────────────────────────
    await harness.runTest(result, 'streaming longer response', async () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'List the numbers 1 through 10, one per line.' },
      ];

      const chunks = [];
      const { responseMessage } = await harness.adapter.callStream(
        messages,
        [],
        (chunk) => chunks.push(chunk),
        {},
      );

      const contentChunks = chunks.filter((c) => c.type === 'content');
      const checks = [];

      // Longer response should produce more chunks
      checks.push(assert.greaterThan(contentChunks.length, 1, 'multiple chunks for longer response'));

      // Should contain numbers
      let text = '';
      if (typeof responseMessage.content === 'string') {
        text = responseMessage.content;
      } else if (Array.isArray(responseMessage.content)) {
        const tb = responseMessage.content.find((b) => b.type === 'text');
        text = tb?.text || '';
      }

      checks.push(assert.includes(text, '5', 'contains number 5'));
      checks.push(assert.includes(text, '10', 'contains number 10'));

      return checks;
    });
  },
};
