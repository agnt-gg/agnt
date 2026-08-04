// LIVE == RELOADED. The contract, made executable.
//
// WHY THIS FILE EXISTS
// --------------------
// Two bugs shipped in a row from the same blind spot, and neither was caught by
// the tests that existed:
//
//   1. serverMessagesToUi called String() on a provider block array, so every
//      tool-using turn reloaded as "[object Object],[object Object]".
//   2. After that was fixed, it still emitted one bubble per PROVIDER ROW, so a
//      tool-using answer reloaded shattered into three bubbles — one of them
//      nothing but orphaned tool cards.
//
// Both were tested "thoroughly" against shapes someone sat down and imagined.
// That is the flaw: a transcript test written by enumerating cases can only
// ever cover the cases its author already thought of, and the bug is always in
// the case they did not.
//
// So this file does not enumerate anything. It builds a turn the way the LIVE
// stream builds it, builds the transcript the way the PROVIDER stores it, and
// asserts the user sees the same answer either way. Any future divergence —
// a new block type, a new provider, another well-meaning coercion — breaks
// this without anyone having to predict it first.
//
// ONE thing is deliberately not compared byte for byte, and it is worth saying
// exactly what and why. `contentParts` — the thing actually rendered — IS
// compared strictly. The flat `content` string is compared with whitespace
// removed, because the two sides legitimately join prose differently: the live
// stream concatenates text deltas with no separator ("…first.Done — …"), while
// the stored transcript keeps them as discrete text blocks and rejoins them as
// paragraphs. Neither is wrong; the provider transcript simply never recorded
// the gap, so demanding byte equality there would pin a fiction. Same words,
// same order, same parts is the real contract.
import { describe, it, expect } from 'vitest';
import {
  createAssistantMessage,
  applyStreamEvent,
  serverMessagesToUi,
} from './chatStreamReducer.js';

/**
 * What a surface actually shows: the order of the parts, the words, and the
 * tool cards with their outcomes. Ids and timestamps are storage detail.
 */
function renderSignature(message) {
  return {
    role: message.role,
    // Same words in the same order — see the note above on join whitespace.
    text: (message.content || '').replace(/\s+/g, ''),
    parts: (message.contentParts || []).map((p) =>
      p.type === 'text' ? `text:${(p.text || '').trim()}` : `tool:${p.toolCallId}`
    ),
    tools: (message.toolCalls || []).map((tc) => ({
      id: tc.id,
      name: tc.name,
      status: tc.status,
      result: tc.result,
      error: tc.error,
    })),
  };
}

/** Replay a turn exactly as the orchestrator streams it. */
function streamTurn(events) {
  const message = createAssistantMessage({ id: 'live' });
  for (const [name, data] of events) applyStreamEvent(message, name, data);
  return message;
}

describe('a tool-using answer survives the round trip through conversation_logs', () => {
  // The turn from conversation 70893216: a word, a read, two writes, a wrap-up.
  const LIVE = streamTurn([
    ['reasoning_delta', { delta: 'I should read the layout before moving anything.' }],
    ['content_delta', { delta: 'Let me look at the current layout first.' }],
    ['tool_start', { toolCall: { id: 'toolu_01', name: 'get_canvas_state', args: {} } }],
    ['tool_end', { toolCall: { id: 'toolu_01', name: 'get_canvas_state', result: '{"widgets":2}' } }],
    ['tool_start', { toolCall: { id: 'toolu_02', name: 'move_canvas_widget', args: { id: 'chat', cols: 3 } } }],
    ['tool_end', { toolCall: { id: 'toolu_02', name: 'move_canvas_widget', result: 'ok' } }],
    ['tool_start', { toolCall: { id: 'toolu_03', name: 'move_canvas_widget', args: { id: 'sim', cols: 9 } } }],
    ['tool_end', { toolCall: { id: 'toolu_03', name: 'move_canvas_widget', result: 'ok' } }],
    ['content_delta', { delta: 'Done — chat slimmed to 3 columns, Flight Sim stretched to 9×8. 🛫' }],
    ['done', {}],
  ]);

  // The same turn as the provider persists it: one row per model call, with the
  // tool outputs coming back on synthetic user rows.
  const STORED = [
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'I should read the layout before moving anything.' },
        { type: 'text', text: 'Let me look at the current layout first.' },
        { type: 'tool_use', id: 'toolu_01', name: 'get_canvas_state', input: {} },
      ],
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: '{"widgets":2}' }] },
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
    { role: 'assistant', content: [{ type: 'text', text: 'Done — chat slimmed to 3 columns, Flight Sim stretched to 9×8. 🛫' }] },
  ];

  it('reloads as ONE message, exactly as it streamed', () => {
    const reloaded = serverMessagesToUi(STORED);
    expect(reloaded).toHaveLength(1);
    expect(renderSignature(reloaded[0])).toEqual(renderSignature(LIVE));
  });

  it('reloads the same reasoning', () => {
    expect(serverMessagesToUi(STORED)[0].reasoning.trim()).toBe(LIVE.reasoning.trim());
  });

  it('is not vacuous: a lost text block breaks it', () => {
    const damaged = STORED.map((m) => ({
      ...m,
      content: Array.isArray(m.content) ? m.content.filter((b) => b.type !== 'text') : m.content,
    }));
    expect(renderSignature(serverMessagesToUi(damaged)[0])).not.toEqual(renderSignature(LIVE));
  });

  it('is not vacuous: splitting the turn back into rows breaks it', () => {
    // Exactly the old behaviour — one bubble per provider row.
    const perRow = STORED.filter((m) => m.role === 'assistant').map((m) => serverMessagesToUi([m])[0]);
    expect(perRow.length).toBeGreaterThan(1);
    expect(perRow.map(renderSignature)).not.toEqual([renderSignature(LIVE)]);
  });
});

describe('a plain answer is unaffected by any of this', () => {
  it('reloads a no-tool turn byte for byte', () => {
    const live = streamTurn([
      ['content_delta', { delta: '# Heading\n\nSome **markdown** and a list:\n- one\n- two' }],
      ['done', {}],
    ]);
    const reloaded = serverMessagesToUi([{ role: 'assistant', content: live.content }]);
    expect(reloaded[0].content).toBe(live.content);
    expect(renderSignature(reloaded[0])).toEqual(renderSignature(live));
  });

  it('reloads a failed tool with its error, not a phantom success', () => {
    const live = streamTurn([
      ['content_delta', { delta: 'Trying.' }],
      ['tool_start', { toolCall: { id: 'x1', name: 'boom', args: {} } }],
      ['tool_end', { toolCall: { id: 'x1', name: 'boom', error: 'kaboom' } }],
      ['done', {}],
    ]);
    const reloaded = serverMessagesToUi([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Trying.' },
          { type: 'tool_use', id: 'x1', name: 'boom', input: {} },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x1', content: 'kaboom', is_error: true }] },
    ]);
    expect(renderSignature(reloaded[0])).toEqual(renderSignature(live));
  });
});
