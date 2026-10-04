import { describe, it, expect } from 'vitest';
import { applySteerToTranscript, repairLegacySteerReplayBlocks } from './steeredTranscript.js';
const event = { assistantMessageId: 'a1', round: 3, content: 'change direction' };
const seed = () => [{ id: 'u1', role: 'user', content: 'go' }, { id: 'a1', role: 'assistant', content: 'before' }, { id: 'a2', role: 'assistant', content: 'after' }];

describe('legacy replay bursts', () => {
  const original = () => [
    { id: 'u1', role: 'user', content: 'go' },
    { id: 'a1', role: 'assistant', content: 'before first' },
    { id: 'msg-steer-100', role: 'user', content: 'first', timestamp: 100 },
    { id: 'a2', role: 'assistant', content: 'after first' },
    { id: 'msg-steer-200', role: 'user', content: 'second', timestamp: 200 },
    { id: 'a3', role: 'assistant', content: 'after second' },
  ];
  const copies = () => [
    { id: 'msg-steer-900', role: 'user', content: 'first', timestamp: 900 },
    { id: 'msg-steer-950', role: 'user', content: 'second', timestamp: 950 },
  ];
  it('repairs only an ordered, uninterrupted replay block with originals at assistant seams', () => {
    const messages = [...original(), ...copies(), { id: 'a4', role: 'assistant', content: 'still working' }];
    const repaired = repairLegacySteerReplayBlocks(messages);
    expect(repaired.map(m => m.id)).toEqual(['u1', 'a1', 'msg-steer-100', 'a2', 'msg-steer-200', 'a3', 'a4']);
    expect(messages).toHaveLength(9); // caller copy untouched
    expect(repairLegacySteerReplayBlocks(repaired)).toEqual(repaired);
  });
  it('leaves one repeated message, reversed text, and ordinary user messages untouched', () => {
    for (const tail of [copies().slice(0, 1), copies().reverse(), copies().map((m, i) => ({ ...m, id: `user-${i}` }))]) {
      const messages = [...original(), ...tail];
      expect(repairLegacySteerReplayBlocks(messages)).toEqual(messages);
    }
  });
  it('never reaches across a new human turn', () => {
    const messages = [...original(), { id: 'u2', role: 'user', content: 'new question' }, ...copies()];
    expect(repairLegacySteerReplayBlocks(messages)).toEqual(messages);
  });
});

describe('steer replay identity and placement', () => {
  it('places a replayed steer at its seam, never at the tail', () => {
    const messages = seed();
    applySteerToTranscript(messages, event);
    expect(messages.map(m => m.content)).toEqual(['go', 'before', 'change direction', 'after']);
  });
  it('is idempotent across repeated deliveries, including after JSON persistence', () => {
    let messages = seed();
    applySteerToTranscript(messages, event);
    const id = messages[2].id;
    messages = JSON.parse(JSON.stringify(messages));
    applySteerToTranscript(messages, event);
    applySteerToTranscript(messages, event);
    expect(messages).toHaveLength(4);
    expect(messages[2].id).toBe(id);
    expect(messages[2].steerAfterMessageId).toBe('a1');
  });
  it('adopts an old saved steer in the exact seam even when serialization dropped its marker', () => {
    const messages = seed();
    messages.splice(2, 0, { id: 'msg-steer-123', role: 'user', content: event.content, timestamp: 123 });
    applySteerToTranscript(messages, event);
    expect(messages).toHaveLength(4);
    expect(messages[2]).toMatchObject({ id: 'msg-steer-123', steered: true, steerAfterMessageId: 'a1', steerRound: 3 });
  });
  it('keeps identical human text from another turn, not content-based global deduplication', () => {
    const messages = seed();
    messages.unshift({ id: 'old-user', role: 'user', content: event.content });
    applySteerToTranscript(messages, event);
    expect(messages.filter(m => m.content === event.content)).toHaveLength(2);
  });
  it('separate seams with identical words remain separate messages', () => {
    const messages = seed();
    applySteerToTranscript(messages, event);
    applySteerToTranscript(messages, { ...event, assistantMessageId: 'a2', round: 4 });
    expect(messages.filter(m => m.steered)).toHaveLength(2);
  });
  it('does not mistake the initial human question for a steer', () => {
    const messages = seed();
    messages[0].content = event.content;
    applySteerToTranscript(messages, event);
    expect(messages.filter(m => m.role === 'user')).toHaveLength(2);
  });
  it('uses a server identity when present and accepts old servers with no anchor', () => {
    const messages = seed();
    applySteerToTranscript(messages, { ...event, steerMessageId: 'server-steer-1', timestamp: 25 });
    expect(messages[2]).toMatchObject({ id: 'server-steer-1', timestamp: 25 });
    applySteerToTranscript(messages, { content: 'old server' }, { fallbackId: 'legacy-1' });
    expect(messages.at(-1).content).toBe('old server');
  });
});
