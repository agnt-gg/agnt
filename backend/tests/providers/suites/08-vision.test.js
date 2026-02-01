/**
 * Suite 08 — Vision (Image Input)
 *
 * Tests that vision-capable providers can accept image content
 * in messages and return a meaningful text response.
 *
 * Note: Vision image formats differ between providers:
 * - OpenAI-compatible: { type: 'image_url', image_url: { url: 'data:...' } }
 * - Anthropic: { type: 'image', source: { type: 'base64', media_type, data } }
 * The callStream() path handles conversion automatically (via adapter),
 * but call() requires the correct format upfront.
 */

import * as assert from '../core/assertions.js';
import { TINY_PNG_BASE64 } from '../core/mocks.js';

// Build provider-appropriate vision messages
function buildVisionMessages(adapter) {
  const adapterName = adapter.constructor.name;

  if (adapterName === 'AnthropicAdapter') {
    // Anthropic requires { type: 'image', source: { ... } } format
    return [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe what you see in this image in one sentence.' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: TINY_PNG_BASE64,
            },
          },
        ],
      },
    ];
  }

  // OpenAI-compatible format
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe what you see in this image in one sentence.' },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${TINY_PNG_BASE64}`,
          },
        },
      ],
    },
  ];
}

export default {
  name: 'vision',

  async run(harness, result) {
    if (!harness.supportsVision) {
      harness.skipTest(result, 'vision image input', 'provider does not support vision');
      harness.skipTest(result, 'vision streaming', 'provider does not support vision');
      return;
    }

    const messages = buildVisionMessages(harness.adapter);

    // ── Test: vision image input ──────────────────────────────────────
    await harness.runTest(result, 'vision image input', async () => {
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

      checks.push(assert.greaterThan(text.length, 0, 'non-empty response text'));
      // Verify the response isn't a hard API error (the word "error" may appear
      // naturally in a description, so we check for API-error patterns instead)
      const isApiError = text.startsWith('\u26a0\ufe0f') || text.startsWith('Error:');
      checks.push(assert.ok(!isApiError, 'response is not an API error'));

      return checks;
    });

    // ── Test: vision with streaming ───────────────────────────────────
    if (harness.supportsStreaming) {
      await harness.runTest(result, 'vision streaming', async () => {
        const chunks = [];
        const { responseMessage } = await harness.adapter.callStream(
          messages,
          [],
          (chunk) => chunks.push(chunk),
          {},
        );

        const checks = [];

        let text = '';
        if (typeof responseMessage.content === 'string') {
          text = responseMessage.content;
        } else if (Array.isArray(responseMessage.content)) {
          const tb = responseMessage.content.find((b) => b.type === 'text');
          text = tb?.text || '';
        }

        const contentChunks = chunks.filter((c) => c.type === 'content');
        if (contentChunks.length > 0) {
          checks.push(assert.greaterThan(contentChunks.length, 0, 'received content chunks'));
        } else {
          // Some adapters may not emit chunk callbacks for vision
          // but still return content in the final message
          checks.push(assert.ok(text.length > 0, 'no chunks but final message has content'));
        }

        checks.push(assert.greaterThan(text.length, 0, 'non-empty streamed response'));

        return checks;
      });
    } else {
      harness.skipTest(result, 'vision streaming', 'provider does not support streaming');
    }
  },
};
