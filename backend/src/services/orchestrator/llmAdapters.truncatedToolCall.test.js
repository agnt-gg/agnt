/**
 * Regression gate: a truncated Anthropic tool call must never become `{}`.
 *
 * WHAT HAPPENED (measured 2026-07-28)
 * -----------------------------------
 * Anthropic streams tool arguments as `input_json_delta` fragments and closes
 * the content block even when generation stopped early — most often
 * `stop_reason: max_tokens` partway through a large argument payload.
 *
 * The `content_block_stop` handler caught the resulting JSON SyntaxError and
 * substituted `block.input = {}`, then emitted the tool call anyway. Nothing
 * downstream could tell that apart from the model deliberately calling a tool
 * with no arguments, so it executed.
 *
 * Production evidence: 73 of 3,519 `edit_file` calls ran with `{}`, all from
 * Claude-Code, growing 2 -> 13 -> 58 over May/June/July. Each one resolved its
 * absent `path` to the workspace root and failed with
 * `EISDIR: illegal operation on a directory, read`. The model then reissued the
 * same call ~20s later with full arguments and it succeeded — proving the
 * arguments were never the problem; the transport was.
 *
 * A second, quieter failure shared the cause: a `tool_use` block that never
 * received `content_block_stop` was dropped in total silence. The model
 * believed it had called a tool; the orchestrator saw none; the turn stopped.
 *
 * These tests drive the REAL adapter with synthetic streams.
 */
import { describe, it, expect, vi } from 'vitest';
import { AnthropicAdapter } from './llmAdapters.js';

const FULL_ARGS = JSON.stringify({
  path: 'C:\\work\\file.js',
  edits: [{ search: 'const a = 1;', replace: 'const a = 2;' }],
  description: 'bump a',
});

const TOOLS = [{
  type: 'function',
  function: {
    name: 'edit_file',
    description: 'edit',
    parameters: { type: 'object', properties: {}, required: ['path', 'edits', 'description'] },
  },
}];

function streamOf(events) {
  return { async *[Symbol.asyncIterator]() { for (const e of events) yield e; }, abort() {} };
}

/**
 * @param partials  input_json_delta fragments
 * @param stopReason  value reported on message_delta
 * @param emitStop  whether content_block_stop arrives
 */
function toolUseEvents({ partials, stopReason = 'tool_use', emitStop = true, text = null }) {
  return [
    { type: 'message_start', message: { usage: { input_tokens: 100 } } },
    ...(text ? [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index: 0 },
    ] : []),
    { type: 'content_block_start', index: text ? 1 : 0, content_block: { type: 'tool_use', id: 'toolu_A', name: 'edit_file' } },
    ...partials.map((p) => ({ type: 'content_block_delta', index: text ? 1 : 0, delta: { type: 'input_json_delta', partial_json: p } })),
    ...(emitStop ? [{ type: 'content_block_stop', index: text ? 1 : 0 }] : []),
    { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 64000 } },
    { type: 'message_stop' },
  ];
}

/** Build an adapter whose stream yields `sequences[n]` on attempt n. */
function adapterFor(sequences, { maxRetries = 0 } = {}) {
  let call = 0;
  const client = {
    messages: {
      stream: vi.fn(async () => streamOf(sequences[Math.min(call++, sequences.length - 1)])),
    },
  };
  const adapter = new AnthropicAdapter(client, 'claude-opus-5', 'claude-code', {});
  adapter.maxRetries = maxRetries;
  adapter.calculateDelay = () => 0;
  adapter.sleep = async () => {};
  return { adapter, client };
}

const run = (adapter, onChunk = () => {}) =>
  adapter.callStream([{ role: 'user', content: 'edit it' }], TOOLS, onChunk, {});

describe('control: an intact tool call is unaffected', () => {
  it('emits exactly one tool call with the full arguments', async () => {
    const { adapter } = adapterFor([toolUseEvents({ partials: [FULL_ARGS.slice(0, 30), FULL_ARGS.slice(30)] })]);
    const res = await run(adapter);

    expect(res.toolCalls).toHaveLength(1);
    expect(JSON.parse(res.toolCalls[0].function.arguments)).toEqual(JSON.parse(FULL_ARGS));
    expect(res.invalidToolCalls).toBeUndefined();
  });

  it('keeps the tool_use block in the assistant message', async () => {
    const { adapter } = adapterFor([toolUseEvents({ partials: [FULL_ARGS] })]);
    const res = await run(adapter);
    const blocks = res.responseMessage.content;
    expect(blocks.some((b) => b.type === 'tool_use' && b.id === 'toolu_A')).toBe(true);
  });

  it('a genuinely argument-less tool call still yields {} — only the schema knows if that is legal', async () => {
    // list_tools / get_canvas_state legitimately send no arguments. The adapter
    // must not guess; the orchestrator's required-param gate decides.
    const { adapter } = adapterFor([toolUseEvents({ partials: [] })]);
    const res = await run(adapter);
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].function.arguments).toBe('{}');
  });
});

describe('truncated arguments (the EISDIR bug)', () => {
  it('does NOT emit a tool call with {} when the argument JSON is incomplete', async () => {
    const { adapter } = adapterFor([toolUseEvents({ partials: [FULL_ARGS.slice(0, 40)], stopReason: 'max_tokens' })]);
    const res = await run(adapter);

    expect(res.toolCalls).toHaveLength(0);
    expect(res.toolCalls.some((tc) => tc.function.arguments === '{}')).toBe(false);
  });

  it('reports the truncation as invalidToolCalls, activating the orchestrator recovery path', async () => {
    const { adapter } = adapterFor([toolUseEvents({ partials: [FULL_ARGS.slice(0, 40)], stopReason: 'max_tokens' })]);
    const res = await run(adapter);

    expect(res.invalidToolCalls).toHaveLength(1);
    expect(res.invalidToolCalls[0].toolCall.function.name).toBe('edit_file');
    expect(res.invalidToolCalls[0].issues.join(' ')).toMatch(/truncated/i);
    // The partial payload is preserved for diagnosis rather than discarded.
    expect(res.invalidToolCalls[0].toolCall.function.arguments).toBe(FULL_ARGS.slice(0, 40));
  });

  it('drops the corrupt tool_use block from the assistant message (no orphan tool_use)', async () => {
    // An assistant tool_use with no matching tool_result on the next turn is
    // rejected outright by Anthropic ("unexpected tool_use_id").
    const { adapter } = adapterFor([
      toolUseEvents({ partials: [FULL_ARGS.slice(0, 40)], stopReason: 'max_tokens', text: 'Let me fix that.' }),
    ]);
    const res = await run(adapter);

    const blocks = res.responseMessage.content;
    expect(blocks.some((b) => b.type === 'tool_use')).toBe(false);
    expect(blocks.some((b) => b.type === 'text')).toBe(true);
    expect(blocks.every(Boolean)).toBe(true);
  });

  it('retries the request when attempts remain, and succeeds on the retry', async () => {
    const { adapter, client } = adapterFor([
      toolUseEvents({ partials: [FULL_ARGS.slice(0, 40)], stopReason: 'max_tokens' }),
      toolUseEvents({ partials: [FULL_ARGS] }),
    ], { maxRetries: 2 });

    const res = await run(adapter);

    expect(client.messages.stream).toHaveBeenCalledTimes(2);
    expect(res.toolCalls).toHaveLength(1);
    expect(JSON.parse(res.toolCalls[0].function.arguments).path).toBe('C:\\work\\file.js');
    expect(res.invalidToolCalls).toBeUndefined();
  });

  it('gives up cleanly after exhausting retries rather than executing garbage', async () => {
    const truncated = toolUseEvents({ partials: [FULL_ARGS.slice(0, 40)], stopReason: 'max_tokens' });
    const { adapter, client } = adapterFor([truncated], { maxRetries: 2 });

    const res = await run(adapter);

    expect(client.messages.stream).toHaveBeenCalledTimes(3);
    expect(res.toolCalls).toHaveLength(0);
    expect(res.invalidToolCalls).toHaveLength(1);
  });

  it('never announces a corrupt tool call to the UI as completed', async () => {
    const chunks = [];
    const { adapter } = adapterFor([toolUseEvents({ partials: [FULL_ARGS.slice(0, 40)], stopReason: 'max_tokens' })]);
    await run(adapter, (c) => chunks.push(c));

    // content_block_start still emits a pending pill with empty arguments (the
    // UI needs it to render immediately), but no finalized call is ever sent.
    const finalized = chunks.filter((c) => c.type === 'tool_call_delta' && c.toolCall?.function?.arguments === '{}');
    expect(finalized).toHaveLength(0);
  });
});

describe('unclosed tool_use block (silently dropped before this fix)', () => {
  it('detects a tool_use that never received content_block_stop', async () => {
    const { adapter } = adapterFor([
      toolUseEvents({ partials: [FULL_ARGS.slice(0, 40)], stopReason: 'max_tokens', emitStop: false }),
    ]);
    const res = await run(adapter);

    expect(res.toolCalls).toHaveLength(0);
    expect(res.invalidToolCalls).toHaveLength(1);
    expect(res.invalidToolCalls[0].unclosed).toBe(true);
    expect(res.invalidToolCalls[0].issues.join(' ')).toMatch(/never closed/i);
  });

  it('retries an unclosed block and recovers', async () => {
    const { adapter, client } = adapterFor([
      toolUseEvents({ partials: [FULL_ARGS.slice(0, 20)], stopReason: 'max_tokens', emitStop: false }),
      toolUseEvents({ partials: [FULL_ARGS] }),
    ], { maxRetries: 1 });

    const res = await run(adapter);
    expect(client.messages.stream).toHaveBeenCalledTimes(2);
    expect(res.toolCalls).toHaveLength(1);
  });

  it('never leaks _inputJsonString into the assistant message', async () => {
    // Anthropic rejects unknown fields: "_inputJsonString: Extra inputs are not permitted"
    const { adapter } = adapterFor([
      toolUseEvents({ partials: [FULL_ARGS.slice(0, 40)], stopReason: 'max_tokens', emitStop: false, text: 'working' }),
    ]);
    const res = await run(adapter);
    expect(JSON.stringify(res.responseMessage)).not.toContain('_inputJsonString');
  });
});

describe('the truncation ledger does not leak across retry attempts', () => {
  it('a clean retry after a truncated attempt reports no invalid calls', async () => {
    const { adapter } = adapterFor([
      toolUseEvents({ partials: [FULL_ARGS.slice(0, 40)], stopReason: 'max_tokens' }),
      toolUseEvents({ partials: [FULL_ARGS] }),
    ], { maxRetries: 3 });

    const res = await run(adapter);
    // Declared inside the attempt loop, so attempt N+1 starts empty. If it
    // were hoisted, this would report a stale failure on a successful turn.
    expect(res.invalidToolCalls).toBeUndefined();
    expect(res.toolCalls).toHaveLength(1);
  });
});
