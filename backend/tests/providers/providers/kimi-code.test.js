/**
 * Kimi Code Provider — Specific Tests
 *
 * Kimi Code is configured as a custom OpenAI-compatible provider
 * with base URL https://api.kimi.com/coding/v1.
 *
 * Tests unique to Kimi Code:
 * - User-Agent: KimiCLI/0.77 header
 * - developer role → system role mapping (__agntCompat.mapDeveloperRole)
 * - reasoning_content accumulation in streaming
 * - Correct adapter selection (OpenAiLikeAdapter)
 */

import * as assert from '../core/assertions.js';

export default {
  name: 'kimi-code-specific',
  provider: 'kimi-code', // will match by custom provider name

  async run(harness, result) {
    // This suite runs for custom providers whose base URL contains api.kimi.com/coding
    const isKimiCode =
      harness.isCustomProvider &&
      harness.client?.__agntCompat?.mapDeveloperRole === true;

    if (!isKimiCode) {
      harness.skipTest(result, 'kimi-code-specific', 'not a Kimi Code custom provider');
      return;
    }

    // ── Test: User-Agent header is KimiCLI ────────────────────────────
    await harness.runTest(result, 'User-Agent is KimiCLI', async () => {
      const ua = harness.client?.defaultHeaders?.['User-Agent'] || '';
      return [
        assert.includes(ua, 'KimiCLI', 'User-Agent contains KimiCLI'),
      ];
    });

    // ── Test: mapDeveloperRole compat flag set ────────────────────────
    await harness.runTest(result, 'mapDeveloperRole compat flag set', async () => [
      assert.eq(harness.client.__agntCompat.mapDeveloperRole, true, 'mapDeveloperRole is true'),
    ]);

    // ── Test: adapter is OpenAiLikeAdapter ────────────────────────────
    await harness.runTest(result, 'adapter is OpenAiLikeAdapter', async () => {
      const name = harness.adapter.constructor.name;
      return [
        assert.eq(name, 'OpenAiLikeAdapter', `adapter is ${name}`),
      ];
    });

    // ── Test: developer role mapped to system in call() ───────────────
    await harness.runTest(result, 'developer role mapped to system', async () => {
      // Send a developer-role message — should be mapped to system internally
      const messages = [
        { role: 'developer', content: 'You are a helpful coding assistant.' },
        { role: 'user', content: 'Say "ok" and nothing else.' },
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

        return [
          assert.ok(responseMessage != null, 'got response with developer role message'),
          assert.greaterThan(text.length, 0, 'non-empty response'),
        ];
      } catch (err) {
        return [assert.ok(false, `developer role caused error: ${err.message.substring(0, 100)}`)];
      }
    });

    // ── Test: streaming captures reasoning_content ────────────────────
    if (harness.supportsStreaming) {
      await harness.runTest(result, 'streaming captures reasoning_content', async () => {
        const messages = [
          { role: 'user', content: 'Think step by step: what is 15 * 17?' },
        ];

        const chunks = [];
        const { responseMessage } = await harness.adapter.callStream(
          messages,
          [],
          (chunk) => chunks.push(chunk),
          {},
        );

        const checks = [];
        checks.push(assert.ok(responseMessage != null, 'got streamed response'));

        // reasoning_content may or may not be present depending on model
        if (responseMessage.reasoning_content) {
          checks.push(assert.nonEmptyString(
            responseMessage.reasoning_content,
            'reasoning_content is non-empty',
          ));
        } else {
          checks.push(assert.ok(true, 'reasoning_content not present (model-dependent)'));
        }

        return checks;
      });
    } else {
      harness.skipTest(result, 'streaming captures reasoning_content', 'no streaming support');
    }

    // ── Test: basic response works ────────────────────────────────────
    await harness.runTest(result, 'basic response', async () => {
      const messages = [
        { role: 'user', content: 'What is 2+2? Reply with only the number.' },
      ];

      const { responseMessage } = await harness.adapter.call(messages, []);

      let text = '';
      if (typeof responseMessage.content === 'string') {
        text = responseMessage.content;
      } else if (Array.isArray(responseMessage.content)) {
        const tb = responseMessage.content.find((b) => b.type === 'text');
        text = tb?.text || '';
      }

      return [
        assert.ok(responseMessage != null, 'got response'),
        assert.includes(text, '4', 'correct answer'),
      ];
    });
  },
};
