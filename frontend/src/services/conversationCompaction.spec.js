import { describe, it, expect } from 'vitest';
import {
  chooseFoldIndex,
  foldHistorySource,
  activeCompactionIndex,
  isFoldedMessage,
  createCompactionMessage,
  compactionWireMessages,
  WIRE_PREAMBLE,
  WIRE_ACK,
} from './conversationCompaction.js';
import { toChatHistory } from './chatService.js';
import { serializeTranscript, parseTranscript } from './conversationTranscript.js';

const u = (id, content = `u-${id}`) => ({ id, role: 'user', content, timestamp: 1 });
const a = (id, content = `a-${id}`) => ({ id, role: 'assistant', content, timestamp: 2 });

describe('chooseFoldIndex', () => {
  it('keeps the tail and always starts it on a user turn', () => {
    const msgs = [u(1), a(2), u(3), a(4), u(5), a(6), u(7), a(8)];
    // keepTail 4 → naive cut at index 4 (u5) — already a user turn.
    expect(chooseFoldIndex(msgs, { keepTail: 4 })).toBe(4);
    // keepTail 3 → naive cut at index 5 (a6); walks back to u5.
    expect(chooseFoldIndex(msgs, { keepTail: 3 })).toBe(4);
  });

  it('refuses when fewer than one full exchange would be folded', () => {
    expect(chooseFoldIndex([u(1), a(2)])).toBe(-1);
    expect(chooseFoldIndex([u(1), a(2), u(3), a(4)])).toBe(-1); // tail eats everything
    expect(chooseFoldIndex([])).toBe(-1);
  });

  it('does not count a previous marker or inline pills as foldable conversation', () => {
    const marker = createCompactionMessage({ summary: 's', foldedCount: 2, tokensBefore: 1, tokensAfter: 1 });
    const pill = { id: 'p', kind: 'skill-pill', role: 'assistant', content: '' };
    // Only u1 is real conversation above the cut → not enough.
    expect(chooseFoldIndex([marker, pill, u(1), a(2), u(3), a(4), u(5)], { keepTail: 4 })).toBe(-1);
  });
});

describe('foldHistorySource', () => {
  it('returns the very same array when there is no marker (identity preserved for memoisers)', () => {
    const msgs = [u(1), a(2)];
    expect(foldHistorySource(msgs)).toBe(msgs);
  });

  it('replaces everything above the LAST marker with its wire turns', () => {
    const old = createCompactionMessage({ summary: 'old summary', foldedCount: 2, tokensBefore: 10, tokensAfter: 2 });
    const fresh = createCompactionMessage({ summary: 'new summary', foldedCount: 4, tokensBefore: 20, tokensAfter: 3 });
    const msgs = [u(1), a(2), old, u(3), a(4), fresh, u(5), a(6)];
    const out = foldHistorySource(msgs);
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(out[0].content).toBe(`${WIRE_PREAMBLE}\n\nnew summary`);
    expect(out[1].content).toBe(WIRE_ACK);
    expect(out[2]).toBe(msgs[6]);
    expect(out[3]).toBe(msgs[7]);
    expect(activeCompactionIndex(msgs)).toBe(5);
  });

  it('wire turns are byte-stable across calls (they head the cached prefix)', () => {
    const marker = createCompactionMessage({ summary: 'S', foldedCount: 1, tokensBefore: 1, tokensAfter: 1 });
    expect(compactionWireMessages(marker)).toEqual(compactionWireMessages(marker));
  });

  it('flags folded originals and nothing else', () => {
    const marker = createCompactionMessage({ summary: 'S', foldedCount: 2, tokensBefore: 1, tokensAfter: 1 });
    const msgs = [u(1), a(2), marker, u(3)];
    expect(isFoldedMessage(msgs, msgs[0])).toBe(true);
    expect(isFoldedMessage(msgs, msgs[2])).toBe(false);
    expect(isFoldedMessage(msgs, msgs[3])).toBe(false);
    expect(isFoldedMessage([u(1)], msgs[0])).toBe(false);
  });
});

describe('every history builder folds the same way', () => {
  it('toChatHistory (unified channels / mobile) sends summary + tail', () => {
    const marker = createCompactionMessage({ summary: 'SUM', foldedCount: 2, tokensBefore: 1, tokensAfter: 1 });
    const out = toChatHistory([u(1), a(2), marker, u(3), a(4)]);
    expect(out).toEqual([
      { role: 'user', content: `${WIRE_PREAMBLE}\n\nSUM` },
      { role: 'assistant', content: WIRE_ACK },
      { role: 'user', content: 'u-3' },
      { role: 'assistant', content: 'a-4' },
    ]);
  });
});

describe('the marker survives a save/load round-trip', () => {
  it('serializeTranscript → parseTranscript keeps role, summary and stats', () => {
    const marker = createCompactionMessage({
      summary: '## Goal\nship',
      foldedCount: 12,
      tokensBefore: 143201,
      tokensAfter: 14880,
      estimatedCost: 0.45,
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      executionId: 'exec-1',
    });
    const raw = serializeTranscript({ conversationId: 'c', title: 't', messages: [u(1), a(2), marker, u(3)] });
    const { messages } = parseTranscript(raw);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'compaction', 'user']);
    expect(messages[2].content).toBe('## Goal\nship');
    expect(messages[2].compaction).toMatchObject({ foldedCount: 12, tokensBefore: 143201, tokensAfter: 14880, estimatedCost: 0.45, model: 'claude-sonnet-4-5' });
    // And the reloaded transcript folds exactly as the live one did.
    expect(foldHistorySource(messages).map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });
});
