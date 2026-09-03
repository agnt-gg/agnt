/**
 * Transport contract: `tool_call_complete` is emitted once per tool call, at
 * the moment its arguments are complete, and only for calls that will be in
 * the returned `toolCalls`. The orchestrator starts executing on this chunk
 * while the model is still writing the next call (eagerToolRuns.js), so a
 * false announcement here executes a call the model never made.
 */
import { describe, it, expect, vi } from 'vitest';
import { AnthropicAdapter, OpenAiLikeAdapter } from './llmAdapters.js';

const TOOLS = [{
  type: 'function',
  function: {
    name: 'execute_shell_command',
    description: 'run',
    parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  },
}];

function streamOf(events) {
  return { async *[Symbol.asyncIterator]() { for (const e of events) yield e; }, abort() {} };
}

describe('Anthropic', () => {
  function adapterFor(events) {
    const client = { messages: { stream: vi.fn(async () => streamOf(events)) } };
    const adapter = new AnthropicAdapter(client, 'claude-opus-5', 'claude-code', {});
    adapter.maxRetries = 0;
    adapter.calculateDelay = () => 0;
    adapter.sleep = async () => {};
    return adapter;
  }
  const toolUse = (index, id, json) => [
    { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name: 'execute_shell_command' } },
    { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json } },
    { type: 'content_block_stop', index },
  ];

  it('announces each call complete at its content_block_stop, before the stream ends', async () => {
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 1 } } },
      ...toolUse(0, 'toolu_A', '{"command":"echo A"}'),
      ...toolUse(1, 'toolu_B', '{"command":"echo B"}'),
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ];
    const seen = [];
    const res = await adapterFor(events).callStream([{ role: 'user', content: 'go' }], TOOLS, (c) => seen.push(c), {});

    const complete = seen.filter((c) => c.type === 'tool_call_complete');
    expect(complete.map((c) => c.toolCall.id)).toEqual(['toolu_A', 'toolu_B']);
    expect(complete[0].toolCall.function.arguments).toBe('{"command":"echo A"}');
    // A is complete before B is even announced.
    const aComplete = seen.findIndex((c) => c.type === 'tool_call_complete' && c.toolCall.id === 'toolu_A');
    const bAnnounced = seen.findIndex((c) => c.type === 'tool_call_delta' && c.toolCall.id === 'toolu_B');
    expect(aComplete).toBeLessThan(bAnnounced);
    // And every completed call is in the returned set, verbatim.
    expect(res.toolCalls.map((t) => t.id)).toEqual(['toolu_A', 'toolu_B']);
  });

  it('never announces a truncated call complete', async () => {
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 1 } } },
      ...toolUse(0, 'toolu_GOOD', '{"command":"echo A"}'),
      ...toolUse(1, 'toolu_BAD', '{"command":"ec'),
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ];
    const seen = [];
    const res = await adapterFor(events).callStream([{ role: 'user', content: 'go' }], TOOLS, (c) => seen.push(c), {});
    expect(seen.filter((c) => c.type === 'tool_call_complete').map((c) => c.toolCall.id)).toEqual(['toolu_GOOD']);
    expect(res.toolCalls.map((t) => t.id)).toEqual(['toolu_GOOD']);
  });
});

describe('Chat Completions', () => {
  const chunk = (delta, finish_reason = null) => ({ choices: [{ index: 0, delta, finish_reason }] });
  const tc = (index, fields) => chunk({ tool_calls: [{ index, ...fields }] });
  function adapterFor(chunks) {
    const client = { chat: { completions: { create: vi.fn(async () => streamOf(chunks)) } } };
    const adapter = new OpenAiLikeAdapter(client, 'gpt-5', { provider: 'openai' });
    adapter.maxRetries = 0;
    return adapter;
  }

  it('announces call N complete when call N+1 opens; the last call is left to the round', async () => {
    const chunks = [
      tc(0, { id: 'call_A', type: 'function', function: { name: 'execute_shell_command', arguments: '' } }),
      tc(0, { function: { arguments: '{"command":' } }),
      tc(0, { function: { arguments: '"echo A"}' } }),
      tc(1, { id: 'call_B', type: 'function', function: { name: 'execute_shell_command', arguments: '' } }),
      tc(1, { function: { arguments: '{"command":"echo B"}' } }),
      chunk({}, 'tool_calls'),
    ];
    const seen = [];
    const res = await adapterFor(chunks).callStream([{ role: 'user', content: 'go' }], TOOLS, (c) => seen.push(c));

    const complete = seen.filter((c) => c.type === 'tool_call_complete');
    expect(complete.map((c) => c.toolCall.id)).toEqual(['call_A']);
    expect(complete[0].toolCall.function.arguments).toBe('{"command":"echo A"}');
    const aComplete = seen.indexOf(complete[0]);
    const bDelta = seen.findIndex((c) => c.type === 'tool_call_delta' && c.toolCall.id === 'call_B');
    expect(aComplete).toBeLessThan(bDelta);
    expect(res.toolCalls.map((t) => t.id)).toEqual(['call_A', 'call_B']);
  });

  it('does not announce a call whose arguments fail the schema', async () => {
    const chunks = [
      tc(0, { id: 'call_BAD', type: 'function', function: { name: 'execute_shell_command', arguments: '{"nope":1}' } }),
      tc(1, { id: 'call_B', type: 'function', function: { name: 'execute_shell_command', arguments: '{"command":"echo B"}' } }),
      chunk({}, 'tool_calls'),
    ];
    const seen = [];
    await adapterFor(chunks).callStream([{ role: 'user', content: 'go' }], TOOLS, (c) => seen.push(c));
    expect(seen.filter((c) => c.type === 'tool_call_complete')).toHaveLength(0);
  });

  it('never leaks a marker onto the tool call sent back to the provider', async () => {
    const chunks = [
      tc(0, { id: 'call_A', type: 'function', function: { name: 'execute_shell_command', arguments: '{"command":"echo A"}' } }),
      tc(1, { id: 'call_B', type: 'function', function: { name: 'execute_shell_command', arguments: '{"command":"echo B"}' } }),
      chunk({}, 'tool_calls'),
    ];
    const res = await adapterFor(chunks).callStream([{ role: 'user', content: 'go' }], TOOLS, () => {});
    for (const call of res.responseMessage.tool_calls) {
      expect(Object.keys(call).sort()).toEqual(['function', 'id', 'type']);
    }
  });
});
