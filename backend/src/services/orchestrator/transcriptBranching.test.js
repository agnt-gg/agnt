import { describe, it, expect } from 'vitest';
import { CUT_MODES, isUtterance, parseCut, locateAnchor, cutTranscript, finalResponseOf } from './transcriptBranching.js';
import { ATTACHED_FILES_HEADER } from './historyRehydration.js';
import { TURN_MARKERS } from './turnRegister.js';

/**
 * A provider transcript as conversation_logs stores it (Anthropic shape): a
 * system row, a tool round whose result rides a synthetic user row, a
 * decorated user message, and a repeated "continue".
 */
const SYSTEM = { role: 'system', content: 'You are Annie.' };
const transcript = () => [
  SYSTEM,
  { role: 'user', content: 'find the bug' },
  { role: 'assistant', content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 't1', name: 'grep', input: { q: 'x' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'match at a.js:3' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'It is in a.js.' }] },
  { role: 'user', content: 'continue' },
  { role: 'assistant', content: 'Fixed a.js.' },
  { role: 'user', content: `${ATTACHED_FILES_HEADER}\n- spec.md\n\nreview this` },
  { role: 'assistant', content: 'Reviewed.' },
  { role: 'user', content: 'continue' },
  { role: 'assistant', content: 'All done.' },
];

describe('isUtterance', () => {
  it('counts typed user rows and not tool-result plumbing', () => {
    const rows = transcript();
    expect(isUtterance(rows[1])).toBe(true);
    expect(isUtterance(rows[3])).toBe(false);
    expect(isUtterance(rows[2])).toBe(false);
    expect(isUtterance({ role: 'user', content: [{ type: 'text', text: 'hi' }, { type: 'image', source: {} }] })).toBe(true);
    expect(isUtterance({ role: 'user', content: [] })).toBe(false);
  });
});

describe('parseCut', () => {
  it('accepts a well-formed cut in an allowed mode', () => {
    expect(parseCut({ anchorText: 'hi', sameTextAfter: 2, mode: 'before' })).toEqual({ anchorText: 'hi', sameTextAfter: 2, mode: 'before' });
    expect(parseCut({ anchorText: 'hi', mode: 'turn' })).toEqual({ anchorText: 'hi', sameTextAfter: 0, mode: 'turn' });
  });

  it.each([
    [null],
    [{}],
    [{ anchorText: '', mode: 'before' }],
    [{ anchorText: 7, mode: 'before' }],
    [{ anchorText: 'hi', sameTextAfter: -1, mode: 'before' }],
    [{ anchorText: 'hi', sameTextAfter: 1.5, mode: 'before' }],
    [{ anchorText: 'hi', mode: 'sideways' }],
  ])('rejects %j', (body) => {
    expect(parseCut(body)).toBeNull();
  });

  it('rejects a mode the caller does not allow', () => {
    expect(parseCut({ anchorText: 'hi', mode: 'turn' }, ['before', 'through'])).toBeNull();
    expect(CUT_MODES).toEqual(['before', 'through', 'turn']);
  });
});

describe('locateAnchor', () => {
  it('finds the user row by the words the client holds, searching from the end', () => {
    expect(locateAnchor(transcript(), { anchorText: 'find the bug' })).toBe(1);
  });

  it('tells identical messages apart by how many follow the anchor', () => {
    expect(locateAnchor(transcript(), { anchorText: 'continue', sameTextAfter: 0 })).toBe(9);
    expect(locateAnchor(transcript(), { anchorText: 'continue', sameTextAfter: 1 })).toBe(5);
    expect(locateAnchor(transcript(), { anchorText: 'continue', sameTextAfter: 2 })).toBe(-1);
  });

  it('matches through the server decoration of the user words', () => {
    expect(locateAnchor(transcript(), { anchorText: 'review this' })).toBe(7);
    const voiced = [{ role: 'user', content: `${TURN_MARKERS[0]}\n\nhello there` }];
    expect(locateAnchor(voiced, { anchorText: 'hello there' })).toBe(0);
  });

  it('never matches a substring, a tool result, or an assistant row', () => {
    expect(locateAnchor(transcript(), { anchorText: 'find the' })).toBe(-1);
    expect(locateAnchor(transcript(), { anchorText: 'match at a.js:3' })).toBe(-1);
    expect(locateAnchor(transcript(), { anchorText: 'Fixed a.js.' })).toBe(-1);
  });
});

describe('cutTranscript', () => {
  it('before: drops the anchor and everything after it, keeping the system row', () => {
    const result = cutTranscript(transcript(), { anchorText: 'continue', sameTextAfter: 1, mode: 'before' });
    expect(result.ok).toBe(true);
    expect(result.messages).toEqual(transcript().slice(0, 5));
    expect(result.messages[0]).toBe(SYSTEM);
  });

  it('through: keeps the anchor and drops its reply', () => {
    const result = cutTranscript(transcript(), { anchorText: 'review this', mode: 'through' });
    expect(result.messages.at(-1).content).toContain('review this');
    expect(result.messages).toHaveLength(8);
  });

  it('turn: keeps the whole turn, tool round included, up to the next typed message', () => {
    const result = cutTranscript(transcript(), { anchorText: 'find the bug', mode: 'turn' });
    expect(result.messages).toEqual(transcript().slice(0, 5));
    expect(result.messages.at(-1).content[0].text).toBe('It is in a.js.');
  });

  it('turn on the last turn keeps the whole transcript', () => {
    expect(cutTranscript(transcript(), { anchorText: 'continue', mode: 'turn' }).messages).toHaveLength(11);
  });

  it('survives a compacted head: an anchor after the summary still cuts', () => {
    const compacted = [SYSTEM, { role: 'user', content: '[Previous conversation summary]\nThey fixed a.js.' }, ...transcript().slice(7)];
    const result = cutTranscript(compacted, { anchorText: 'continue', mode: 'before' });
    expect(result.messages).toEqual(compacted.slice(0, 4));
  });

  it('fails closed: an anchor inside the compacted head is not found', () => {
    const compacted = [SYSTEM, { role: 'user', content: '[Previous conversation summary]\nThey fixed a.js.' }, ...transcript().slice(7)];
    expect(cutTranscript(compacted, { anchorText: 'find the bug', mode: 'before' })).toEqual({ ok: false, reason: 'anchor-not-found' });
  });

  it('refuses a malformed call without throwing', () => {
    expect(cutTranscript(null, { anchorText: 'x', mode: 'before' })).toEqual({ ok: false, reason: 'no-transcript' });
    expect(cutTranscript(transcript(), { anchorText: 'x', mode: 'up' })).toEqual({ ok: false, reason: 'bad-cut' });
  });

  it('does not mutate its input', () => {
    const rows = transcript();
    const before = JSON.stringify(rows);
    cutTranscript(rows, { anchorText: 'continue', mode: 'before' });
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe('finalResponseOf', () => {
  it('is the last assistant text in either shape, or empty', () => {
    expect(finalResponseOf(transcript())).toBe('All done.');
    expect(finalResponseOf(transcript().slice(0, 5))).toBe('It is in a.js.');
    expect(finalResponseOf([SYSTEM, { role: 'user', content: 'hi' }])).toBe('');
  });
});
