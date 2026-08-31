/**
 * THE ROSTER DERIVER — what the sidebar's avatars are drawn from.
 *
 * The contract that matters most here is the THREE-WAY return: a real roster,
 * an empty roster, and "I cannot tell". The storage layer COALESCEs on null,
 * so collapsing the third case into the second would silently erase a good
 * roster the first time a save carried an unparseable payload.
 */
import { describe, it, expect } from 'vitest';
import {
  participantsOfMessages,
  participantsOfTranscript,
  serializeParticipants,
  MAX_PARTICIPANTS,
} from './transcriptParticipants.js';

const transcript = (messages) => JSON.stringify({ messages });

describe('participantsOfMessages', () => {
  it('lists agents in join order', () => {
    expect(
      participantsOfMessages([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'assistant', content: 'on it', agentId: 'a1', agentName: 'Sol' },
        { role: 'assistant', content: 'and me', agentId: 'a2', agentName: 'Fable' },
      ]),
    ).toEqual([
      { id: 'a1', name: 'Sol' },
      { id: 'a2', name: 'Fable' },
    ]);
  });

  it('never lists Annie — an unattributed assistant message is the orchestrator', () => {
    // She is in every conversation by definition, so storing her would be one
    // wasted entry per row for a fact the UI already knows. Every surface
    // paints her first regardless.
    expect(
      participantsOfMessages([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ]),
    ).toEqual([]);
  });

  it('deduplicates a repeat speaker', () => {
    const roster = participantsOfMessages([
      { role: 'assistant', agentId: 'a1', agentName: 'Sol' },
      { role: 'assistant', agentId: 'a1', agentName: 'Sol' },
      { role: 'assistant', agentId: 'a1', agentName: 'Sol' },
    ]);
    expect(roster).toEqual([{ id: 'a1', name: 'Sol' }]);
  });

  it('keeps two DIFFERENT agents that share a display name distinct', () => {
    // This install really has three agents called "Social Media Manager".
    // Keying on the name alone would merge them into one avatar.
    const roster = participantsOfMessages([
      { role: 'assistant', agentId: 'a1', agentName: 'Social Media Manager' },
      { role: 'assistant', agentId: 'a2', agentName: 'Social Media Manager' },
    ]);
    expect(roster).toHaveLength(2);
    expect(roster.map((p) => p.id)).toEqual(['a1', 'a2']);
  });

  it('treats a renamed agent as one participant, because the id is the key', () => {
    const roster = participantsOfMessages([
      { role: 'assistant', agentId: 'a1', agentName: 'Scout' },
      { role: 'assistant', agentId: 'a1', agentName: 'Scout Mk2' },
    ]);
    expect(roster).toEqual([{ id: 'a1', name: 'Scout' }]);
  });

  it('accepts a name-only message from an older transcript', () => {
    expect(participantsOfMessages([{ role: 'assistant', agentName: 'Sol' }])).toEqual([
      { id: null, name: 'Sol' },
    ]);
  });

  it('ignores user messages even when they carry agent fields', () => {
    expect(
      participantsOfMessages([{ role: 'user', content: 'hi', agentId: 'a1', agentName: 'Sol' }]),
    ).toEqual([]);
  });

  it('caps the roster so one pathological conversation cannot bloat the column', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      role: 'assistant',
      agentId: `a${i}`,
      agentName: `Agent ${i}`,
    }));
    expect(participantsOfMessages(many)).toHaveLength(MAX_PARTICIPANTS);
  });

  it('survives junk in the array without throwing', () => {
    expect(
      participantsOfMessages([null, undefined, 42, 'nope', { role: 'assistant', agentId: 'a1', agentName: 'Sol' }]),
    ).toEqual([{ id: 'a1', name: 'Sol' }]);
  });

  it('returns [] for a non-array', () => {
    expect(participantsOfMessages(null)).toEqual([]);
    expect(participantsOfMessages('{}')).toEqual([]);
  });
});

describe('participantsOfTranscript', () => {
  it('reads the serializeTranscript() shape', () => {
    expect(
      participantsOfTranscript(transcript([{ role: 'assistant', agentId: 'a1', agentName: 'Sol' }])),
    ).toEqual([{ id: 'a1', name: 'Sol' }]);
  });

  it('reads a bare array, which older clients sent', () => {
    expect(
      participantsOfTranscript(JSON.stringify([{ role: 'assistant', agentId: 'a1', agentName: 'Sol' }])),
    ).toEqual([{ id: 'a1', name: 'Sol' }]);
  });

  it('returns NULL — not [] — for content it cannot read', () => {
    // The distinction is the whole point: null means "leave the stored roster
    // alone", [] means "there are genuinely no agents". Collapsing them would
    // erase a good roster on the first save of an HTML artifact.
    expect(participantsOfTranscript('<h1>an artifact</h1>')).toBeNull();
    expect(participantsOfTranscript('')).toBeNull();
    expect(participantsOfTranscript(null)).toBeNull();
    expect(participantsOfTranscript(JSON.stringify({ notMessages: true }))).toBeNull();
  });

  it('returns [] for a real transcript that genuinely has no agents', () => {
    expect(participantsOfTranscript(transcript([{ role: 'assistant', content: 'hi' }]))).toEqual([]);
  });
});

describe('serializeParticipants', () => {
  it('produces compact JSON for a real roster', () => {
    const json = serializeParticipants(
      transcript([{ role: 'assistant', agentId: 'a1', agentName: 'Sol' }]),
    );
    expect(JSON.parse(json)).toEqual([{ id: 'a1', name: 'Sol' }]);
  });

  it('stores NULL rather than the string "[]" for a solo conversation', () => {
    // NULL already means "Annie alone". Writing two bytes that say the same
    // thing would put a value on every solo row that carries no information.
    expect(serializeParticipants(transcript([{ role: 'assistant', content: 'hi' }]))).toBeNull();
  });

  it('stores NULL for unreadable content, so COALESCE keeps what is there', () => {
    expect(serializeParticipants('<h1>not a transcript</h1>')).toBeNull();
  });

  it('never stores an icon — they are data-URLs up to ~233KB', () => {
    const json = serializeParticipants(
      transcript([
        {
          role: 'assistant',
          agentId: 'a1',
          agentName: 'Sol',
          agentIcon: `data:image/png;base64,${'A'.repeat(5000)}`,
        },
      ]),
    );
    expect(json).not.toContain('base64');
    expect(json.length).toBeLessThan(120);
  });
});
