/**
 * Regression gate: a stream that completes CLEANLY and delivers nothing is
 * retried on the same model.
 *
 * WHAT HAPPENED (measured 2026-08-23, openrouter/stealth/ox-alpha)
 * ---------------------------------------------------------------
 * Nathan's chat produced this and then abandoned his chosen model:
 *
 *   [Stream Complete] { contentLength: 0, reasoningContentLength: 0,
 *                       toolCallsCount: 0, finishReason: 'stop' }
 *   [OpenAiLike Stream] Empty response model=stealth/ox-alpha provider=openrouter
 *   [Chat] Provider failover: openrouter/stealth/ox-alpha → OpenAI-Codex/gpt-5.6-sol
 *
 * The adapter already retried empty streams — but the guard led with
 * `!finishReason`, because it was written for the case where an upstream
 * half-closes the HTTP connection mid-response. A provider that politely
 * reports `finish_reason: 'stop'` and sends nothing at all never matched, so
 * it was never retried.
 *
 * That is a real and frequent shape, not a curiosity. Measured against the
 * live API: roughly one ox-alpha request in ten returns a single chunk
 * carrying only finish_reason 'stop', in ~1.3s — and the byte-identical
 * request then succeeds. Three consecutive retries returned full answers
 * (1592, 1624 and 1880 chars), which is what proves it transient rather than
 * a property of the request.
 *
 * The cost of not retrying was not just a wasted call: the orchestrator saw
 * an empty response and failed over to an entirely different provider, so the
 * model the user picked was dropped over a blip that one retry fixes.
 */
import { describe, it, expect, vi } from 'vitest';
import { OpenAiLikeAdapter } from './llmAdapters.js';

function streamOf(chunks) {
  return {
    async *[Symbol.asyncIterator]() { for (const c of chunks) yield c; },
    abort() {},
  };
}

const chunk = (delta, finish_reason = null) => ({
  choices: [{ index: 0, delta, finish_reason }],
});

/** The exact wire shape: one chunk, finish_reason only, nothing else. */
const POLITE_EMPTY = [chunk({ role: 'assistant', content: '' }, 'stop')];
const REAL_ANSWER = [
  chunk({ role: 'assistant', content: 'The auth guard holds.' }),
  chunk({}, 'stop'),
];

/**
 * @param streams one array of chunks per attempt; the last repeats if the
 *                adapter asks for more.
 */
function adapterFor(streams, { model = 'stealth/ox-alpha' } = {}) {
  let attempt = 0;
  const create = vi.fn(async () => streamOf(streams[Math.min(attempt++, streams.length - 1)]));
  const adapter = new OpenAiLikeAdapter(
    { chat: { completions: { create } } },
    model,
    { provider: 'openrouter' },
  );
  // Real backoff would make this suite take ~14s to prove a branch.
  adapter.sleep = () => Promise.resolve();
  return { adapter, create };
}

const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the web',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
};

// Tools MUST be declared when a fixture emits a call for one — an undeclared
// call fails AJV validation and the adapter retries with schema guidance,
// which would be mistaken here for the retry under test.
const run = (adapter, { context = {}, tools = [] } = {}) =>
  adapter.callStream([{ role: 'user', content: 'keep going pls' }], tools, () => {}, context);

describe("empty stream with finish_reason 'stop'", () => {
  it('retries the same model and returns the answer', async () => {
    const { adapter, create } = adapterFor([POLITE_EMPTY, REAL_ANSWER]);

    const result = await run(adapter);

    expect(create, 'a polite empty must be retried, not surrendered').toHaveBeenCalledTimes(2);
    expect(result.responseMessage.content).toBe('The auth guard holds.');
  });

  it('retries up to the adapter budget when the provider keeps answering empty', async () => {
    const { adapter, create } = adapterFor([POLITE_EMPTY]);

    await run(adapter);

    expect(create).toHaveBeenCalledTimes(adapter.maxRetries + 1);
  });

  it('leaves the terminal outcome exactly as it was, so failover still fires', async () => {
    // This change adds RETRIES and nothing else. Once they are spent the
    // adapter must land on the same result it always did — the empty-response
    // placeholder, flagged as recovered — because that is what the
    // orchestrator keys on to hand a genuinely-down provider to the next one.
    // Nathan's log shows that handoff working; it must keep working.
    const { adapter } = adapterFor([POLITE_EMPTY]);

    const result = await run(adapter);

    expect(result.responseMessage.content).toContain('empty response');
    expect(result.recoveredFromError).toBe(true);
    expect(result.toolCalls).toHaveLength(0);
  });

  it('does not retry when the client aborted', async () => {
    // A user hitting Stop produces an empty stream too. Retrying it would
    // restart work they just cancelled.
    const { adapter, create } = adapterFor([POLITE_EMPTY, REAL_ANSWER]);

    await run(adapter, { context: { abortSignal: { aborted: true } } });

    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('an explained silence is not retried', () => {
  // These finish_reasons EXPLAIN the empty response. An identical retry would
  // reproduce them exactly, so it would burn the budget and the user's money.
  it.each([
    ['length', 'output budget was consumed'],
    ['content_filter', 'the response was blocked'],
  ])('finish_reason=%s is left alone (%s)', async (finishReason) => {
    const { adapter, create } = adapterFor([
      [chunk({ role: 'assistant', content: '' }, finishReason)],
      REAL_ANSWER,
    ]);

    await run(adapter);

    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('a stream that produced SOMETHING is never retried', () => {
  it('leaves a normal answer alone', async () => {
    const { adapter, create } = adapterFor([REAL_ANSWER]);

    const result = await run(adapter);

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.responseMessage.content).toBe('The auth guard holds.');
  });

  it('leaves a reasoning-only answer to the reasoning fallback', async () => {
    // Reasoning counts as output. This is the ox-alpha shape fixed separately
    // in llmAdapters.openRouterReasoning.test.js — it must resolve there, not
    // by re-rolling the request.
    const { adapter, create } = adapterFor([
      [chunk({ role: 'assistant', content: '', reasoning: 'The answer is 391.' }), chunk({}, 'stop')],
      REAL_ANSWER,
    ]);

    const result = await run(adapter);

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.responseMessage.content).toBe('The answer is 391.');
  });

  it('leaves a tool call alone even though content is empty', async () => {
    // finish_reason 'tool_calls' with empty content is CORRECT.
    const { adapter, create } = adapterFor([
      [
        chunk({ role: 'assistant', content: '' }),
        chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"query":"btc"}' } }] }),
        chunk({}, 'tool_calls'),
      ],
      REAL_ANSWER,
    ]);

    const result = await run(adapter, { tools: [WEB_SEARCH_TOOL] });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.toolCalls).toHaveLength(1);
  });
});

describe('the pre-existing half-close path is untouched', () => {
  it('still retries an empty stream that never sent a finish_reason', async () => {
    const { adapter, create } = adapterFor([[chunk({ role: 'assistant', content: '' })], REAL_ANSWER]);

    const result = await run(adapter);

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.responseMessage.content).toBe('The auth guard holds.');
  });

  it('still surfaces the connection-dropped message when it never recovers', async () => {
    const { adapter } = adapterFor([[chunk({ role: 'assistant', content: '' })]]);

    const result = await run(adapter);

    expect(result.responseMessage.content).toContain('Connection dropped');
    expect(result.recoveredFromError).toBe(true);
  });
});
