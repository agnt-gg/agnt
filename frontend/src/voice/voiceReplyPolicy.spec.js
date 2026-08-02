import { describe, it, expect } from 'vitest';
import { buildVoicePromptAddendum, assessSpokenLength, DEFAULT_VOICE_POLICY } from './voiceReplyPolicy.js';

describe('buildVoicePromptAddendum', () => {
  it('tells the model it is being spoken aloud', () => {
    const p = buildVoicePromptAddendum();
    expect(p).toMatch(/SPOKEN ALOUD/i);
    expect(p).toMatch(/listening, not reading/i);
  });

  it('states the length budget numerically', () => {
    const p = buildVoicePromptAddendum({ maxSentences: 2, maxWords: 40 });
    expect(p).toContain('2 sentences');
    expect(p).toContain('40 words');
  });

  it('forbids reading code and tables aloud but keeps them in the chat', () => {
    const p = buildVoicePromptAddendum();
    expect(p).toMatch(/do not read code/i);
    expect(p).toMatch(/render in the chat/i);
  });

  it('warns that only the spoken prefix was heard on an interruption', () => {
    const p = buildVoicePromptAddendum();
    expect(p).toMatch(/interrupt/i);
    expect(p).toMatch(/only heard the words spoken so far/i);
  });

  it('can disable tool narration', () => {
    expect(buildVoicePromptAddendum({ narrateTools: true })).toMatch(/before a slow tool call/i);
    expect(buildVoicePromptAddendum({ narrateTools: false })).not.toMatch(/before a slow tool call/i);
  });

  it('is a non-empty string with defaults', () => {
    const p = buildVoicePromptAddendum();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(100);
  });
});

describe('assessSpokenLength', () => {
  it('is zero for empty input', () => {
    expect(assessSpokenLength('')).toEqual({ words: 0, sentences: 0, tooLong: false });
    expect(assessSpokenLength(null).words).toBe(0);
  });

  it('accepts a short spoken reply', () => {
    const r = assessSpokenLength('The build is green. Three tests were added.');
    expect(r.tooLong).toBe(false);
    expect(r.sentences).toBe(2);
  });

  it('flags a reply that is too long to listen to', () => {
    const long = Array.from({ length: 30 }, () => 'word word word').join(' ') + '.';
    expect(assessSpokenLength(long).tooLong).toBe(true);
  });

  it('flags too many sentences even when short', () => {
    const many = 'One. Two. Three. Four. Five.';
    expect(assessSpokenLength(many, { maxSentences: 3 }).tooLong).toBe(true);
  });

  it('counts an unterminated sentence as one', () => {
    expect(assessSpokenLength('no terminator here').sentences).toBe(1);
  });

  it('honours policy overrides', () => {
    const text = 'One. Two. Three. Four.';
    expect(assessSpokenLength(text, { maxSentences: 10, maxWords: 100 }).tooLong).toBe(false);
  });

  it('uses sane defaults', () => {
    expect(DEFAULT_VOICE_POLICY.maxSentences).toBeGreaterThan(0);
    expect(DEFAULT_VOICE_POLICY.maxWords).toBeGreaterThan(10);
  });
});
