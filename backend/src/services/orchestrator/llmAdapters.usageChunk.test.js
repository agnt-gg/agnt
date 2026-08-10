import { describe, it, expect } from 'vitest';
import { createLlmAdapter } from './llmAdapters.js';

/**
 * The billing record must survive a malformed final chunk.
 *
 * With `stream_options: { include_usage: true }` the last chunk carries the
 * entire usage record. OpenAI's spec says its `choices` is an EMPTY ARRAY;
 * several OpenAI-compatible providers omit the field entirely instead.
 *
 * Measured live on kimi (2026-08-09): a completed turn reported
 * inputTokens=undefined, outputTokens=undefined, cost=0. Not a cache bug — the
 * whole ledger was blind, and a request with no usage is indistinguishable
 * from a free one.
 *
 * Root cause was ordering: `chunk.choices[0]` was read first and unguarded, so
 * the usage chunk threw before `if (chunk.usage)` was ever reached. Usage is
 * now read before anything else on the chunk.
 */

function streamOf(chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
    controller: { abort() {} },
  };
}

function clientEmitting(chunks) {
  return { chat: { completions: { create: async () => streamOf(chunks) } } };
}

const USAGE = {
  prompt_tokens: 35398,
  completion_tokens: 57,
  total_tokens: 35455,
  prompt_tokens_details: { cached_tokens: 35328 },
};

const textChunk = { choices: [{ delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] };
const stopChunk = { choices: [{ delta: {}, finish_reason: 'stop' }] };

describe('final usage chunk shapes', () => {
  it.each([
    ['choices omitted entirely (kimi)', { usage: USAGE }],
    ['choices empty array (OpenAI spec)', { choices: [], usage: USAGE }],
    ['choices null', { choices: null, usage: USAGE }],
  ])('captures usage when the final chunk has %s', async (_label, finalChunk) => {
    const client = clientEmitting([textChunk, stopChunk, finalChunk]);
    const adapter = await createLlmAdapter('kimi', client, 'kimi-k2-turbo-preview', {});
    const result = await adapter.callStream([{ role: 'user', content: 'hi' }], [], () => {}, {});

    expect(result.usage, 'usage must survive the chunk shape').toBeDefined();
    expect(result.usage.prompt_tokens).toBe(35398);
    expect(result.usage.completion_tokens).toBe(57);
    expect(result.usage.prompt_tokens_details.cached_tokens).toBe(35328);
  });

  it('still streams the content itself', async () => {
    const client = clientEmitting([textChunk, stopChunk, { usage: USAGE }]);
    const adapter = await createLlmAdapter('kimi', client, 'kimi-k2-turbo-preview', {});
    const result = await adapter.callStream([{ role: 'user', content: 'hi' }], [], () => {}, {});
    expect(result.responseMessage.content).toBe('OK');
  });

  it('ANTI-VACUITY: a usage-bearing chunk without choices really is the trigger', async () => {
    // If the fixture were reachable by the old code too, this suite would pass
    // against the bug. Reading choices[0] off this object throws — that throw
    // is precisely what used to eat the billing record.
    const finalChunk = { usage: USAGE };
    expect(() => finalChunk.choices[0]).toThrow(TypeError);
  });

  it('Cerebras transport survives the same shape', async () => {
    const client = clientEmitting([textChunk, stopChunk, { usage: USAGE }]);
    const adapter = await createLlmAdapter('cerebras', client, 'gpt-oss-120b', {});
    const result = await adapter.callStream([{ role: 'user', content: 'hi' }], [], () => {}, {});
    expect(result.usage?.prompt_tokens).toBe(35398);
  });
});
