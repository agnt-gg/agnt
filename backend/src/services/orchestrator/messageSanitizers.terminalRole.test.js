/**
 * Terminal-role invariant for the outbound sanitizers.
 *
 * The 2026-07-28 opus-5 outage did not end at the adapter. The adapter produced
 * an assistant message with no tool_use plus a tool call that still executed;
 * `sanitizeUnexpectedToolResults` then found the resulting tool_result orphaned,
 * stripped it, found the carrier user message empty, and DELETED the message.
 * That deletion is what actually produced the 400 — the request now ended on an
 * assistant turn, which claude-opus-5 rejects:
 *
 *   "This model does not support assistant message prefill.
 *    The conversation must end with a user message."
 *
 * A repair pass is allowed to change what a message SAYS. It is not allowed to
 * change the SHAPE of the conversation underneath the provider contract.
 */
import { describe, it, expect } from 'vitest';
import {
  sanitizeOrphanToolCalls,
  sanitizeUnexpectedToolResults,
  sanitizeEmptyAssistantMessages,
} from './messageSanitizers.js';

const sanitizeAll = (msgs) =>
  sanitizeEmptyAssistantMessages(sanitizeUnexpectedToolResults(sanitizeOrphanToolCalls(msgs)));

/** The exact production shape: assistant with no tool_use, orphan tool_result after it. */
const outageHistory = () => ([
  { role: 'user', content: 'what can you see???' },
  { role: 'assistant', content: [{ type: 'text', text: '[The model returned an empty response.]' }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_012beTc8LA58curo33tHEius', content: '{"success":true}' }] },
]);

describe('sanitizeUnexpectedToolResults preserves conversation shape', () => {
  it('a user turn whose every block is an orphan is REPLACED, not deleted', () => {
    const out = sanitizeUnexpectedToolResults(outageHistory());

    expect(out).toHaveLength(3);
    expect(out[2].role).toBe('user');
    expect(out[2].content[0].type).toBe('text');
    expect(out[2].content.some((b) => b.type === 'tool_result')).toBe(false);
  });

  it('the history still ends with a user message — the condition opus 5 enforces', () => {
    const out = sanitizeAll(outageHistory());
    expect(out[out.length - 1].role).toBe('user');
  });

  it('the substitute message is non-empty (providers reject empty user content)', () => {
    const out = sanitizeUnexpectedToolResults(outageHistory());
    const text = out[2].content.map((b) => b.text || '').join('');
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it('never merges two assistant turns together mid-history', () => {
    const msgs = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: [{ type: 'text', text: 'first' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'ghost', content: 'x' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'second' }] },
    ];
    const out = sanitizeUnexpectedToolResults(msgs);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].role === out[i - 1].role).toBe(false);
    }
  });

  it('is idempotent — a second pass finds nothing left to repair', () => {
    const once = sanitizeUnexpectedToolResults(outageHistory());
    const twice = sanitizeUnexpectedToolResults(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it('a valid tool_result pair is untouched', () => {
    const msgs = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'x', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
    ];
    const out = sanitizeUnexpectedToolResults(msgs);
    expect(out).toHaveLength(3);
    expect(out[2].content[0].type).toBe('tool_result');
  });

  it('mixed blocks keep the valid results and lose only the orphans', () => {
    const msgs = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'x', input: {} }] },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' },
          { type: 'tool_result', tool_use_id: 'ghost', content: 'orphan' },
        ],
      },
    ];
    const out = sanitizeUnexpectedToolResults(msgs);
    expect(out[2].content).toHaveLength(1);
    expect(out[2].content[0].tool_use_id).toBe('toolu_1');
  });
});

describe('the full outbound pipeline never converts a user-terminated history into an assistant-terminated one', () => {
  const cases = {
    'orphan tool_result at the tail': outageHistory(),
    'orphan tool_result after a real tool round': [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'x', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'ghost', content: 'orphan' }] },
    ],
    'plain conversation': [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      { role: 'user', content: 'again' },
    ],
    'empty trailing assistant then user': [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [] },
      { role: 'user', content: 'again' },
    ],
  };

  for (const [label, msgs] of Object.entries(cases)) {
    it(label, () => {
      expect(msgs[msgs.length - 1].role).toBe('user'); // guard the fixture itself
      const out = sanitizeAll(msgs);
      expect(out.length).toBeGreaterThan(0);
      expect(out[out.length - 1].role).toBe('user');
    });
  }
});
