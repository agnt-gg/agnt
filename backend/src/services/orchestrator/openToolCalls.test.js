import { describe, it, expect, vi } from 'vitest';
import {
  createOpenToolCallLedger,
  wrapSendEventWithLedger,
  INTERRUPTED_MESSAGE,
} from './openToolCalls.js';

const pending = (id, name) => ['tool_pending', { assistantMessageId: 'm1', toolCall: { id, name } }];
const start = (id, name, args = {}) => ['tool_start', { assistantMessageId: 'm1', toolCall: { id, name, args } }];
const end = (id, name) => ['tool_end', { assistantMessageId: 'm1', toolCall: { id, name, result: 'ok' } }];

describe('open tool-call ledger', () => {
  it('a call is open from tool_pending, before any tool_start', () => {
    // THE #88 WINDOW: cards drawn, stream not yet complete, `toolCalls` empty.
    const ledger = createOpenToolCallLedger();
    ledger.observe(...pending('a', 'execute_shell_command'));
    ledger.observe(...pending('b', 'execute_shell_command'));
    ledger.observe(...pending('c', 'execute_shell_command'));
    expect(ledger.entries()).toEqual([
      { id: 'a', name: 'execute_shell_command' },
      { id: 'b', name: 'execute_shell_command' },
      { id: 'c', name: 'execute_shell_command' },
    ]);
  });

  it('a call announced only by tool_start is open too', () => {
    // Chat-completions adapters emit tool_call_delta post-hoc with full args,
    // so some providers never send tool_pending. Openness must not depend on it.
    const ledger = createOpenToolCallLedger();
    ledger.observe(...start('a', 'web_search', { query: 'x' }));
    expect(ledger.entries()).toEqual([{ id: 'a', name: 'web_search' }]);
  });

  it('has() answers the announce-once gate, and closes with the call', () => {
    const ledger = createOpenToolCallLedger();
    expect(ledger.has('a')).toBe(false);
    ledger.observe(...pending('a', 'x'));
    expect(ledger.has('a')).toBe(true);
    ledger.observe(...end('a', 'x'));
    expect(ledger.has('a')).toBe(false);
  });

  it('tool_pending then tool_start for the same id is one open call', () => {
    const ledger = createOpenToolCallLedger();
    ledger.observe(...pending('a', 'write_file'));
    ledger.observe(...start('a', 'write_file'));
    expect(ledger.size).toBe(1);
  });

  it('tool_end closes the call — and only that call', () => {
    const ledger = createOpenToolCallLedger();
    ledger.observe(...pending('a', 'x'));
    ledger.observe(...pending('b', 'y'));
    ledger.observe(...end('a', 'x'));
    expect(ledger.entries()).toEqual([{ id: 'b', name: 'y' }]);
  });

  it('a call that already ended is not re-settled on abort', () => {
    // Delete-on-emit: the client already has a real result for `a`; sending an
    // interrupted result afterwards would overwrite success with failure.
    const ledger = createOpenToolCallLedger();
    ledger.observe(...pending('a', 'x'));
    ledger.observe(...end('a', 'x'));
    expect(ledger.interruptionEvents('m1')).toEqual([]);
  });

  it('interruption events carry the shape the client settlement expects', () => {
    const ledger = createOpenToolCallLedger();
    ledger.observe(...pending('a', 'execute_shell_command'));
    const [evt] = ledger.interruptionEvents('m1');
    expect(evt.assistantMessageId).toBe('m1');
    expect(evt.toolCall).toMatchObject({
      id: 'a',
      name: 'execute_shell_command',
      error: INTERRUPTED_MESSAGE,
      status: 'interrupted',
    });
    expect(JSON.parse(evt.toolCall.result)).toEqual({
      success: false,
      interrupted: true,
      error: INTERRUPTED_MESSAGE,
    });
  });

  it('interruptionEvents does not empty the ledger by itself', () => {
    // Only a SENT tool_end closes a call. If the caller builds the events and
    // the transport throws before they go out, the calls stay visibly open.
    const ledger = createOpenToolCallLedger();
    ledger.observe(...pending('a', 'x'));
    ledger.interruptionEvents('m1');
    expect(ledger.size).toBe(1);
  });

  it('a later announcement never erases a known name', () => {
    const ledger = createOpenToolCallLedger();
    ledger.observe(...pending('a', 'write_file'));
    ledger.observe('tool_start', { toolCall: { id: 'a' } });
    expect(ledger.entries()).toEqual([{ id: 'a', name: 'write_file' }]);
  });

  it('events without a tool-call id are ignored, whatever their name', () => {
    const ledger = createOpenToolCallLedger();
    ledger.observe('tool_pending', {});
    ledger.observe('tool_pending', { toolCall: {} });
    ledger.observe('content_delta', { delta: 'hi' });
    ledger.observe('tool_end', null);
    expect(ledger.size).toBe(0);
  });
});

describe('wrapSendEventWithLedger', () => {
  it('observes then forwards, returning the inner result', () => {
    const ledger = createOpenToolCallLedger();
    const inner = vi.fn(() => 'sent');
    const send = wrapSendEventWithLedger(ledger, inner);

    expect(send(...pending('a', 'x'))).toBe('sent');
    expect(inner).toHaveBeenCalledWith(...pending('a', 'x'));
    expect(ledger.size).toBe(1);
  });

  it('sending the interruption events through the wrapper is what closes them', () => {
    // THE WHOLE FIX IN ONE TEST: announce three, abort mid-announce, settle.
    const ledger = createOpenToolCallLedger();
    const sent = [];
    const send = wrapSendEventWithLedger(ledger, (n, d) => sent.push([n, d]));

    send(...pending('a', 'execute_shell_command'));
    send(...pending('b', 'execute_shell_command'));
    send(...pending('c', 'execute_shell_command'));
    // No tool_start, no completed stream, no `toolCalls` array — abort lands.
    for (const evt of ledger.interruptionEvents('m1')) send('tool_end', evt);

    const ends = sent.filter(([n]) => n === 'tool_end').map(([, d]) => d.toolCall);
    expect(ends.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(ends.every((t) => t.status === 'interrupted')).toBe(true);
    expect(ledger.size).toBe(0);
  });

  it('the ledger records the event even when the transport throws', () => {
    const ledger = createOpenToolCallLedger();
    const send = wrapSendEventWithLedger(ledger, () => { throw new Error('socket gone'); });
    expect(() => send(...pending('a', 'x'))).toThrow('socket gone');
    expect(ledger.size).toBe(1);
  });
});
