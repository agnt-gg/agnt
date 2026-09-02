import { describe, it, expect } from 'vitest';
import { isOpenToolCall, settleOpenToolCalls, healStaleToolCalls, INTERRUPTED_STATUS, INTERRUPTED_RESULT } from './toolCallSettlement.js';

const open = (id) => ({ id, name: 'read_file', args: {}, status: 'pending' });
const done = (id) => ({ id, name: 'read_file', args: {}, status: 'completed', result: '{"ok":true}' });
const errored = (id) => ({ id, name: 'read_file', args: {}, error: 'boom' });

describe('isOpenToolCall', () => {
  it('is open only with neither result nor error', () => {
    expect(isOpenToolCall(open('a'))).toBe(true);
    expect(isOpenToolCall(done('b'))).toBe(false);
    expect(isOpenToolCall(errored('c'))).toBe(false);
    expect(isOpenToolCall({ id: 'd', result: '' })).toBe(false); // empty string is still a result
    expect(isOpenToolCall(null)).toBe(false);
  });
});

describe('settleOpenToolCalls', () => {
  it('marks every open call interrupted with a parseable result and leaves the rest untouched by identity', () => {
    const a = open('a'), b = done('b'), c = errored('c'), d = open('d');
    const { toolCalls, changed } = settleOpenToolCalls([a, b, c, d], { at: 1234 });
    expect(changed).toBe(2);
    expect(toolCalls[1]).toBe(b);
    expect(toolCalls[2]).toBe(c);
    expect(toolCalls[0].status).toBe(INTERRUPTED_STATUS);
    expect(JSON.parse(toolCalls[0].result)).toEqual(INTERRUPTED_RESULT);
    expect(toolCalls[0].error).toBe(INTERRUPTED_RESULT.error);
    expect(toolCalls[0].interruptedAt).toBe(1234);
    expect(toolCalls[3].status).toBe(INTERRUPTED_STATUS);
  });

  it('is a no-op on empty or absent input', () => {
    expect(settleOpenToolCalls([]).changed).toBe(0);
    expect(settleOpenToolCalls(undefined)).toEqual({ toolCalls: [], changed: 0 });
  });

  it('is idempotent', () => {
    const once = settleOpenToolCalls([open('a')]).toolCalls;
    const twice = settleOpenToolCalls(once);
    expect(twice.changed).toBe(0);
    expect(twice.toolCalls[0]).toBe(once[0]);
  });
});

describe('healStaleToolCalls', () => {
  const messages = [
    { id: 'u1', role: 'user', content: 'hi' },
    { id: 'a1', role: 'assistant', content: 'x', toolCalls: [open('t1'), done('t2')] },
    { id: 'a2', role: 'assistant', content: 'y', toolCalls: [open('t3')] },
    { id: 'a3', role: 'assistant', content: 'z' },
  ];

  it('settles open calls on every non-live assistant message', () => {
    const { messages: out, healed } = healStaleToolCalls(messages);
    expect(healed).toBe(2);
    expect(out[1].toolCalls[0].status).toBe(INTERRUPTED_STATUS);
    expect(out[1].toolCalls[1].status).toBe('completed');
    expect(out[2].toolCalls[0].status).toBe(INTERRUPTED_STATUS);
    expect(out[0]).toBe(messages[0]);
    expect(out[3]).toBe(messages[3]);
  });

  it('leaves the live streaming message alone', () => {
    const { messages: out, healed } = healStaleToolCalls(messages, { liveMessageId: 'a2' });
    expect(healed).toBe(1);
    expect(out[2]).toBe(messages[2]);
    expect(out[2].toolCalls[0].status).toBe('pending');
  });

  it('REGRESSION: a real aborted-conversation shape (709 of 1087 open) heals to zero open', () => {
    const big = [];
    for (let i = 0; i < 40; i++) {
      const tcs = [];
      for (let j = 0; j < 27; j++) tcs.push(j % 3 === 0 ? done(`m${i}t${j}`) : open(`m${i}t${j}`));
      big.push({ id: `m${i}`, role: 'assistant', content: 'c', toolCalls: tcs, contentParts: tcs.map((t) => ({ type: 'tool_call', toolCallId: t.id })) });
    }
    const { messages: out, healed } = healStaleToolCalls(big);
    expect(healed).toBe(40 * 18);
    expect(out.flatMap((m) => m.toolCalls).filter(isOpenToolCall)).toHaveLength(0);
    // contentParts (the interleaving) is preserved untouched
    expect(out[0].contentParts).toBe(big[0].contentParts);
  });
});
