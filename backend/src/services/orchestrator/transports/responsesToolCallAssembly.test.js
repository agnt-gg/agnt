// Regression coverage for agnt-gg/agnt#163: parallel Responses tool calls
// reached the executor with empty or concatenated arguments.
import { describe, expect, it } from 'vitest';
import { createLlmAdapter } from '../llmAdapters.js';

function streamFrom(events) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
  };
}

const READ_ARGS = '{"path":"a.txt"}';
const LIST_ARGS = '{"dir":"src"}';

function fnItem(id, callId, name, args) {
  return { id, type: 'function_call', call_id: callId, name, ...(args === undefined ? {} : { arguments: args }) };
}

const addedA = { type: 'response.output_item.added', output_index: 1, item: fnItem('fc_a', 'call_a', 'read_file', '') };
const addedB = { type: 'response.output_item.added', output_index: 2, item: fnItem('fc_b', 'call_b', 'list_files', '') };
const deltaA = { type: 'response.function_call_arguments.delta', item_id: 'fc_a', output_index: 1, delta: READ_ARGS };
const deltaB = { type: 'response.function_call_arguments.delta', item_id: 'fc_b', output_index: 2, delta: LIST_ARGS };
const doneA = { type: 'response.function_call_arguments.done', item_id: 'fc_a', output_index: 1, arguments: READ_ARGS };
const doneB = { type: 'response.function_call_arguments.done', item_id: 'fc_b', output_index: 2, arguments: LIST_ARGS };
const reasoning = { id: 'rs_1', type: 'reasoning', summary: [], encrypted_content: 'x' };
const completed = {
  type: 'response.completed',
  response: {
    id: 'resp_1',
    output: [reasoning, fnItem('fc_a', 'call_a', 'read_file', READ_ARGS), fnItem('fc_b', 'call_b', 'list_files', LIST_ARGS)],
    usage: { input_tokens: 1, output_tokens: 1 },
  },
};

const EXPECTED = [
  { id: 'call_a', name: 'read_file', arguments: READ_ARGS },
  { id: 'call_b', name: 'list_files', arguments: LIST_ARGS },
];

const summarize = (toolCalls) => toolCalls.map((call) => ({ id: call.id, name: call.function.name, arguments: call.function.arguments }));

const TOOLS = [
  { type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } },
  { type: 'function', function: { name: 'list_files', parameters: { type: 'object' } } },
];

// Both Responses consumers share the bug and the fix; run every case through each.
const ADAPTERS = [
  ['openai-codex (ChatGPT backend)', 'openai-codex', 'gpt-5.5'],
  ['openai (public Responses API)', 'openai', 'gpt-5.5'],
];

async function runStream(provider, model, events, onChunk = () => {}) {
  const client = { responses: { create: async () => streamFrom(events) } };
  const adapter = await createLlmAdapter(provider, client, model);
  adapter.maxRetries = 0;
  const result = await adapter.callStream([{ role: 'user', content: 'go' }], TOOLS, onChunk);
  return result.toolCalls;
}

describe.each(ADAPTERS)('Responses tool-call assembly via %s', (_label, provider, model) => {
  it('serial calls: each call gets its own arguments', async () => {
    const calls = await runStream(provider, model, [addedA, deltaA, doneA, addedB, deltaB, doneB, completed]);
    expect(summarize(calls)).toEqual(EXPECTED);
  });

  it('interleaved calls: deltas are routed by item identity, not to the latest call', async () => {
    const calls = await runStream(provider, model, [addedA, addedB, deltaA, doneA, deltaB, doneB]);
    expect(summarize(calls)).toEqual(EXPECTED);
  });

  it('routes by output_index when item_id is absent', async () => {
    const strip = ({ item_id, ...rest }) => rest;
    const calls = await runStream(provider, model, [addedA, addedB, strip(deltaB), strip(deltaA)]);
    expect(summarize(calls)).toEqual(EXPECTED);
  });

  it('arguments only on .done events are applied', async () => {
    const calls = await runStream(provider, model, [addedA, addedB, doneA, doneB]);
    expect(summarize(calls)).toEqual(EXPECTED);
  });

  it('arguments only in response.completed repair an equal-count result', async () => {
    const calls = await runStream(provider, model, [addedA, addedB, completed]);
    expect(summarize(calls)).toEqual(EXPECTED);
  });

  it('arguments complete on output_item.added are kept', async () => {
    const calls = await runStream(provider, model, [
      { ...addedA, item: fnItem('fc_a', 'call_a', 'read_file', READ_ARGS) },
      { ...addedB, item: fnItem('fc_b', 'call_b', 'list_files', LIST_ARGS) },
    ]);
    expect(summarize(calls)).toEqual(EXPECTED);
  });

  it('final output corrects a corrupted streamed argument string', async () => {
    const misrouted = { ...deltaA, delta: '{"path":' };
    const calls = await runStream(provider, model, [addedA, addedB, misrouted, completed]);
    expect(summarize(calls)).toEqual(EXPECTED);
  });

  it('repeated item/completion events are idempotent: each call exactly once', async () => {
    const calls = await runStream(provider, model, [addedA, addedA, addedB, deltaA, doneA, deltaB, doneB, completed, completed]);
    expect(summarize(calls)).toEqual(EXPECTED);
  });

  it('truncated stream keeps the partial arguments so the executor refuses them (never coerced to {})', async () => {
    const partialA = { ...deltaA, delta: '{"path":"a.' };
    const calls = await runStream(provider, model, [addedA, addedB, partialA, deltaB]);
    expect(summarize(calls)).toEqual([
      { id: 'call_a', name: 'read_file', arguments: '{"path":"a.' },
      { id: 'call_b', name: 'list_files', arguments: LIST_ARGS },
    ]);
    expect(() => JSON.parse(calls[0].function.arguments)).toThrow();
  });

  it('identity-less deltas from serial legacy streams still go to the current call', async () => {
    const bare = ({ item_id, output_index, ...rest }) => rest;
    const calls = await runStream(provider, model, [
      bare(addedA), bare(deltaA), bare(addedB), bare(deltaB),
    ]);
    expect(summarize(calls)).toEqual(EXPECTED);
  });

  it('a delta for an unknown item is not grafted onto another call', async () => {
    const stray = { type: 'response.function_call_arguments.delta', item_id: 'fc_zzz', output_index: 9, delta: '{"x":1}' };
    const calls = await runStream(provider, model, [addedA, deltaA, stray]);
    expect(summarize(calls)).toEqual([EXPECTED[0]]);
  });

  it('streamed tool_call_delta chunks carry the owning call index', async () => {
    const chunks = [];
    await runStream(provider, model, [addedA, addedB, deltaA, deltaB], (chunk) => {
      if (chunk.type === 'tool_call_delta' && chunk.toolCall.function.arguments) {
        chunks.push([chunk.index, chunk.toolCall.id]);
      }
    });
    expect(chunks).toEqual([[0, 'call_a'], [1, 'call_b']]);
  });
});
