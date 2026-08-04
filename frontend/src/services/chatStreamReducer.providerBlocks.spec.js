// Provider block transcripts — the contract that a tool-using turn survives a
// round trip through conversation_logs.
//
// WHY THIS FILE EXISTS
// --------------------
// conversation_logs.full_history is the RAW PROVIDER transcript. A turn that
// calls a tool stops storing `content` as a string and stores a block array
// instead. serverMessagesToUi used to coerce that with String(), producing
// "[object Object],[object Object]" for every tool-using turn on reload —
// with the real words sitting untouched in the `text` blocks, never read.
//
// chatStreamReducer.spec.js already pinned `null -> ''` and called that
// covered, which is exactly why the coercion looked sanctioned for four days.
// A guard that only tests the shape you thought of is not a guard. Every block
// shape the providers actually emit is pinned here.
import { describe, it, expect } from 'vitest';
import {
  flattenProviderMessage,
  hydrateMessage,
  serverMessagesToUi,
  transcriptSubstance,
} from './chatStreamReducer.js';

/**
 * The shape of conversation 70893216, byte-for-byte as the provider stored it:
 * seven plain string turns, then the canvas-tool turns that broke.
 */
const REAL_TRANSCRIPT = [
  { role: 'user', content: 'what is going on in my workspace chats!?!?!?!' },
  { role: 'assistant', content: 'Right now, not much — a clean slate.' },
  { role: 'user', content: 'what do you see??' },
  { role: 'assistant', content: 'One window open: this Chat, docked on the left.' },
  { role: 'user', content: 'add the flight sim' },
  { role: 'assistant', content: '✈️ Flight Sim 3000 is up.' },
  { role: 'user', content: 'can you make your chat here a little less wide' },
  {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'I should read the layout before moving anything.' },
      { type: 'text', text: 'Let me look at the current layout first.' },
      { type: 'tool_use', id: 'toolu_01', name: 'get_canvas_state', input: {} },
    ],
  },
  {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'toolu_01', content: '{"widgets":2}' },
    ],
  },
  {
    role: 'assistant',
    content: [
      { type: 'tool_use', id: 'toolu_02', name: 'move_canvas_widget', input: { id: 'chat', cols: 3 } },
      { type: 'tool_use', id: 'toolu_03', name: 'move_canvas_widget', input: { id: 'sim', cols: 9 } },
    ],
  },
  {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'toolu_02', content: 'ok' },
      { type: 'tool_result', tool_use_id: 'toolu_03', content: 'ok' },
    ],
  },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Done — chat slimmed to 3 columns, Flight Sim stretched to 9×8. 🛫' },
    ],
  },
];

describe('the [object Object] regression', () => {
  it('never renders a coerced object anywhere in a real tool-using transcript', () => {
    const ui = serverMessagesToUi(REAL_TRANSCRIPT);
    for (const m of ui) {
      expect(m.content).not.toContain('[object Object]');
      for (const p of m.contentParts) {
        if (p.type === 'text') expect(p.text).not.toContain('[object Object]');
      }
    }
  });

  it('recovers the exact words the provider stored', () => {
    const ui = serverMessagesToUi(REAL_TRANSCRIPT);
    const text = ui.map((m) => m.content);
    expect(text).toContain('Let me look at the current layout first.');
    expect(text).toContain('Done — chat slimmed to 3 columns, Flight Sim stretched to 9×8. 🛫');
  });

  it('drops the synthetic tool-result turns instead of rendering empty user bubbles', () => {
    const ui = serverMessagesToUi(REAL_TRANSCRIPT);
    // 12 provider rows, 2 of which are pure tool plumbing.
    expect(ui).toHaveLength(10);
    expect(ui.every((m) => m.content || m.toolCalls.length > 0)).toBe(true);
  });

  it('joins each tool result onto the call that asked for it', () => {
    const ui = serverMessagesToUi(REAL_TRANSCRIPT);
    const byId = new Map(ui.flatMap((m) => m.toolCalls.map((tc) => [tc.id, tc])));

    expect(byId.get('toolu_01')).toMatchObject({
      name: 'get_canvas_state',
      result: '{"widgets":2}',
      status: 'completed',
    });
    expect(byId.get('toolu_02')).toMatchObject({ name: 'move_canvas_widget', result: 'ok' });
    expect(byId.get('toolu_03')).toMatchObject({ name: 'move_canvas_widget', result: 'ok' });
  });

  it('keeps the interleave order so a tool card lands where the model put it', () => {
    const ui = serverMessagesToUi(REAL_TRANSCRIPT);
    const withTool = ui.find((m) => m.toolCalls.some((tc) => tc.id === 'toolu_01'));
    expect(withTool.contentParts.map((p) => p.type)).toEqual(['text', 'tool_call']);

    const twoCalls = ui.find((m) => m.toolCalls.length === 2);
    expect(twoCalls.contentParts.map((p) => p.type)).toEqual(['tool_call', 'tool_call']);
  });
});

describe('flattenProviderMessage — block shapes', () => {
  it('reads text out of an Anthropic block array', () => {
    const flat = flattenProviderMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'hello' }],
    });
    expect(flat.text).toBe('hello');
  });

  it('routes thinking blocks to reasoning, never to the bubble', () => {
    const flat = flattenProviderMessage({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'private' },
        { type: 'text', text: 'public' },
      ],
    });
    expect(flat.text).toBe('public');
    expect(flat.reasoning).toBe('private');
  });

  it('joins multiple text blocks rather than keeping only the last', () => {
    const flat = flattenProviderMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }],
    });
    expect(flat.text).toBe('one\ntwo');
  });

  it('accepts the OpenAI content-part spelling', () => {
    const flat = flattenProviderMessage({
      role: 'user',
      content: [{ type: 'input_text', text: 'from openai' }],
    });
    expect(flat.text).toBe('from openai');
  });

  it('normalizes an OpenAI tool_calls array, parsing its JSON arguments', () => {
    const flat = flattenProviderMessage({
      role: 'assistant',
      content: 'calling',
      tool_calls: [{ id: 'call_1', function: { name: 'web_search', arguments: '{"q":"agnt"}' } }],
    });
    expect(flat.toolCalls).toHaveLength(1);
    expect(flat.toolCalls[0]).toMatchObject({ id: 'call_1', name: 'web_search', args: { q: 'agnt' } });
  });

  it('keeps unparseable arguments as raw text instead of losing the call', () => {
    const flat = flattenProviderMessage({
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_2', function: { name: 'x', arguments: '{"truncated"' } }],
    });
    expect(flat.toolCalls[0].args).toBe('{"truncated"');
  });

  it('flattens a tool_result whose content is itself a block array', () => {
    const flat = flattenProviderMessage({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'nested' }] }],
    });
    expect(flat.toolResults).toEqual([{ id: 't1', result: 'nested' }]);
  });

  it('never invents a tool call from a block with no id', () => {
    const flat = flattenProviderMessage({
      role: 'assistant',
      content: [{ type: 'tool_use', name: 'nameless' }],
    });
    expect(flat.toolCalls).toEqual([]);
  });

  it('does not duplicate a call that appears both in blocks and in tool_calls', () => {
    const flat = flattenProviderMessage({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'dup', name: 'a', input: {} }],
      toolCalls: [{ id: 'dup', name: 'a' }],
    });
    expect(flat.toolCalls).toHaveLength(1);
  });
});

describe('tool errors', () => {
  it('marks a failed tool result as an error, not a result', () => {
    const ui = serverMessagesToUi([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'e1', name: 'boom', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'e1', content: 'kaboom', is_error: true }] },
    ]);
    expect(ui[0].toolCalls[0]).toMatchObject({ error: 'kaboom', status: 'error' });
    expect(ui[0].toolCalls[0].result).toBeUndefined();
  });

  it('leaves a call with no result pending rather than claiming it completed', () => {
    const ui = serverMessagesToUi([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'orphan', name: 'x', input: {} }] },
    ]);
    expect(ui[0].toolCalls[0].status).toBe('pending');
  });

  it('ignores a tool_result that matches no known call', () => {
    const ui = serverMessagesToUi([
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'ghost', content: 'x' }] },
    ]);
    expect(ui).toEqual([]);
  });
});

describe('hydrateMessage with provider blocks', () => {
  it('extracts rather than coerces', () => {
    const m = hydrateMessage({ role: 'assistant', content: [{ type: 'text', text: 'real' }] });
    expect(m.content).toBe('real');
    expect(m.contentParts).toEqual([{ type: 'text', text: 'real' }]);
  });

  it('still preserves an explicit contentParts array by identity', () => {
    const parts = [{ type: 'text', text: 'saved' }];
    const m = hydrateMessage({ role: 'assistant', content: 'saved', contentParts: parts });
    expect(m.contentParts).toBe(parts);
  });

  it('keeps a saved tool call\u2019s result and status intact', () => {
    const m = hydrateMessage({
      role: 'assistant',
      content: 'done',
      toolCalls: [{ id: 't', name: 'web_search', args: { q: 1 }, status: 'completed', result: 'r' }],
    });
    expect(m.toolCalls[0]).toMatchObject({ id: 't', name: 'web_search', status: 'completed', result: 'r' });
  });
});

// ---------------------------------------------------------------------------
// The second half of the bug: WHICH transcript wins.
// ---------------------------------------------------------------------------
describe('transcriptSubstance — why row count was the wrong question', () => {
  it('scores a degraded transcript below a good one that has FEWER rows', () => {
    const good = [
      { role: 'assistant', content: 'Let me look at the current layout first.', toolCalls: [{ id: 'a' }] },
    ];
    // What the old coercion produced: more rows, no meaning.
    const degraded = [
      { role: 'assistant', content: '[object Object],[object Object],[object Object]', toolCalls: [] },
      { role: 'user', content: '[object Object]', toolCalls: [] },
      { role: 'assistant', content: '[object Object],[object Object]', toolCalls: [] },
    ];
    expect(degraded.length).toBeGreaterThan(good.length);
    expect(transcriptSubstance(degraded)).toBeLessThan(transcriptSubstance(good));
  });

  it('counts tool calls, so a pure-tool turn is not judged empty', () => {
    expect(transcriptSubstance([{ role: 'assistant', content: '', toolCalls: [{ id: 'a' }, { id: 'b' }] }]))
      .toBeGreaterThan(0);
  });

  it('is 0 for a missing or malformed transcript', () => {
    expect(transcriptSubstance(null)).toBe(0);
    expect(transcriptSubstance([null, undefined])).toBe(0);
  });

  it('grows when a real turn is appended', () => {
    const before = serverMessagesToUi(REAL_TRANSCRIPT);
    const after = serverMessagesToUi([...REAL_TRANSCRIPT, { role: 'user', content: 'and one more thing' }]);
    expect(transcriptSubstance(after)).toBeGreaterThan(transcriptSubstance(before));
  });
});
