/**
 * Regression gate: an ARGUMENT-LESS Anthropic tool call must survive the stream.
 *
 * WHAT HAPPENED (measured 2026-07-28, execution 3b4cb1d4-f33e-4acf-9a21-c015088d3553)
 * ----------------------------------------------------------------------------------
 * Nathan ran `scan_page_elements` (every parameter optional) on claude-opus-5 in
 * a workspace and got:
 *
 *   400 invalid_request_error — "This model does not support assistant message
 *   prefill. The conversation must end with a user message."
 *
 * The causal chain, end to end:
 *
 *  1. Anthropic streams an argument-less call as ONE `input_json_delta` whose
 *     `partial_json` is the empty string. `_inputJsonString` therefore becomes
 *     `''` — present, but falsy.
 *  2. `content_block_stop` guarded that field with `if (block._inputJsonString)`.
 *     A truthiness test on a string. `''` skipped the whole branch, so
 *     `_inputJsonString` was never deleted.
 *  3. The post-stream "unclosed tool call" sweep tests `!== undefined`, which
 *     `''` satisfies — so a perfectly healthy call was recorded as truncated
 *     ("0 chars of argument JSON received, stop_reason=tool_use") and the whole
 *     request was retried to exhaustion.
 *  4. On the final attempt the tool_use block was filtered OUT of the assistant
 *     message (correct for a genuinely truncated call) while the tool call
 *     itself stayed in `accumulatedToolCalls` — a DESYNC. The assistant message
 *     was left empty and padded with "[The model returned an empty response.]".
 *  5. The orchestrator executed the tool (Nathan saw the result) and appended a
 *     `tool_result` whose `tool_use` no longer existed.
 *  6. `sanitizeUnexpectedToolResults` stripped that orphan, the user message
 *     became empty, the whole message was dropped, and the request ended on an
 *     assistant turn. Anthropic rejected it.
 *
 * The pre-existing suite missed this because its "argument-less" fixture emitted
 * ZERO deltas (`_inputJsonString === undefined`), not one EMPTY delta, which is
 * what the provider actually sends. Both shapes are pinned below.
 */
import { describe, it, expect, vi } from 'vitest';
import { AnthropicAdapter } from './llmAdapters.js';

const TOOLS = [{
  type: 'function',
  function: {
    name: 'scan_page_elements',
    description: 'scan',
    parameters: { type: 'object', properties: { filter: { type: 'string' } }, required: [] },
  },
}];

function streamOf(events) {
  return { async *[Symbol.asyncIterator]() { for (const e of events) yield e; }, abort() {} };
}

function toolUseEvents({ partials, stopReason = 'tool_use', emitStop = true }) {
  return [
    { type: 'message_start', message: { usage: { input_tokens: 100 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_A', name: 'scan_page_elements' } },
    ...partials.map((p) => ({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: p } })),
    ...(emitStop ? [{ type: 'content_block_stop', index: 0 }] : []),
    { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  ];
}

function adapterFor(sequences, { maxRetries = 2 } = {}) {
  let call = 0;
  const client = {
    messages: { stream: vi.fn(async () => streamOf(sequences[Math.min(call++, sequences.length - 1)])) },
  };
  const adapter = new AnthropicAdapter(client, 'claude-opus-5', 'claude-code', {});
  adapter.maxRetries = maxRetries;
  adapter.calculateDelay = () => 0;
  adapter.sleep = async () => {};
  return { adapter, client };
}

const run = (adapter) => adapter.callStream([{ role: 'user', content: 'what can you see???' }], TOOLS, () => {}, {});

describe('argument-less tool call — the shape the provider actually sends', () => {
  it('a single EMPTY input_json_delta is not a truncation', async () => {
    const { adapter } = adapterFor([toolUseEvents({ partials: [''] })]);
    const res = await run(adapter);

    expect(res.invalidToolCalls).toBeUndefined();
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].function.arguments).toBe('{}');
  });

  it('keeps the tool_use block in the assistant message (no empty-response padding)', async () => {
    const { adapter } = adapterFor([toolUseEvents({ partials: [''] })]);
    const res = await run(adapter);

    const blocks = res.responseMessage.content;
    expect(blocks.some((b) => b.type === 'tool_use' && b.id === 'toolu_A')).toBe(true);
    expect(JSON.stringify(blocks)).not.toContain('The model returned an empty response');
  });

  it('does not burn retries on a healthy call', async () => {
    const { adapter, client } = adapterFor([toolUseEvents({ partials: [''] })]);
    await run(adapter);
    expect(client.messages.stream).toHaveBeenCalledTimes(1);
  });

  it('never leaks the internal _inputJsonString accumulator into history', async () => {
    const { adapter } = adapterFor([toolUseEvents({ partials: [''] })]);
    const res = await run(adapter);
    expect(JSON.stringify(res.responseMessage)).not.toContain('_inputJsonString');
  });

  it('whitespace-only argument JSON is also treated as {}', async () => {
    const { adapter } = adapterFor([toolUseEvents({ partials: ['  ', '\n'] })]);
    const res = await run(adapter);
    expect(res.invalidToolCalls).toBeUndefined();
    expect(res.toolCalls[0].function.arguments).toBe('{}');
  });

  it('the zero-delta shape still works (pre-existing fixture, kept as a control)', async () => {
    const { adapter } = adapterFor([toolUseEvents({ partials: [] })]);
    const res = await run(adapter);
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].function.arguments).toBe('{}');
    expect(res.invalidToolCalls).toBeUndefined();
  });

  it('an explicit {} payload is unchanged', async () => {
    const { adapter } = adapterFor([toolUseEvents({ partials: ['{', '}'] })]);
    const res = await run(adapter);
    expect(res.toolCalls[0].function.arguments).toBe('{}');
    expect(res.invalidToolCalls).toBeUndefined();
  });
});

describe('a genuinely truncated call is still rejected (the narrowing must not over-reach)', () => {
  it('incomplete JSON is still recorded as invalid and not emitted', async () => {
    const { adapter } = adapterFor([toolUseEvents({ partials: ['{"filter": "wor'], stopReason: 'max_tokens' })], { maxRetries: 0 });
    const res = await run(adapter);

    expect(res.toolCalls).toHaveLength(0);
    expect(res.invalidToolCalls).toHaveLength(1);
    expect(res.invalidToolCalls[0].toolCall.function.name).toBe('scan_page_elements');
  });

  it('a block that never closes is still recorded as invalid', async () => {
    const { adapter } = adapterFor([toolUseEvents({ partials: ['{"filter": "wor'], emitStop: false })], { maxRetries: 0 });
    const res = await run(adapter);

    expect(res.toolCalls).toHaveLength(0);
    expect(res.invalidToolCalls).toHaveLength(1);
    expect(res.invalidToolCalls[0].unclosed).toBe(true);
  });
});

describe('return-boundary invariant: toolCalls and content can never disagree', () => {
  it('every emitted tool call has a matching tool_use block in the assistant message', async () => {
    const { adapter } = adapterFor([toolUseEvents({ partials: [''] })]);
    const res = await run(adapter);

    const blockIds = new Set(
      (res.responseMessage.content || []).filter((b) => b?.type === 'tool_use').map((b) => b.id),
    );
    for (const tc of res.toolCalls) expect(blockIds.has(tc.id)).toBe(true);
  });

  it('a dropped tool_use block drops its tool call too — an unshowable call must not execute', async () => {
    // Two calls in one turn: one healthy, one truncated. The truncated block is
    // filtered out of the assistant message, so its call must not be emitted —
    // otherwise the orchestrator executes a tool whose tool_use the model can
    // never be shown, and the resulting tool_result is orphaned.
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 100 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_GOOD', name: 'scan_page_elements' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_BAD', name: 'scan_page_elements' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"filter": "wo' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 20 } },
      { type: 'message_stop' },
    ];
    const { adapter } = adapterFor([events], { maxRetries: 0 });
    const res = await run(adapter);

    const blockIds = new Set(
      (res.responseMessage.content || []).filter((b) => b?.type === 'tool_use').map((b) => b.id),
    );
    expect(blockIds.has('toolu_GOOD')).toBe(true);
    expect(blockIds.has('toolu_BAD')).toBe(false);
    expect(res.toolCalls.map((t) => t.id)).toEqual(['toolu_GOOD']);
  });
});
