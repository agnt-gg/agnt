import { describe, it, expect } from 'vitest';
import {
  spokenRegister,
  spokenRegisterComplete,
  assessSpokenLength,
  DEFAULT_VOICE_POLICY,
} from './voiceReplyPolicy.js';

describe('spokenRegister — the opening paragraph is what gets spoken', () => {
  it('takes everything up to the first blank line', () => {
    const answer = 'Three tests were failing, same root cause. Fixed.\n\n## What was wrong\nThe endpointer never saw a transcript.';
    expect(spokenRegister(answer)).toBe('Three tests were failing, same root cause. Fixed.');
  });

  it('is a literal PREFIX of the written answer — they cannot contradict', () => {
    const answer = 'Yes, it merged this morning.\n\nCommit abc123, on main.';
    expect(answer.startsWith(spokenRegister(answer))).toBe(true);
  });

  it('a single-paragraph answer is spoken whole', () => {
    // Nothing to leave on screen means it was short enough to say.
    expect(spokenRegister('Yes, already merged.')).toBe('Yes, already merged.');
  });

  it('treats a whitespace-only line as blank', () => {
    // A "blank" line very often carries trailing spaces. Missing that would
    // hand the ENTIRE answer to the voice — the exact failure this prevents.
    const answer = 'The lead sentence.\n   \nThe detail nobody should hear.';
    expect(spokenRegister(answer)).toBe('The lead sentence.');
    expect(spokenRegister('Lead.\n\t\nDetail.')).toBe('Lead.');
  });

  it('keeps a multi-line opening paragraph intact', () => {
    const answer = 'First line of the lead.\nStill the lead.\n\nDetail.';
    expect(spokenRegister(answer)).toBe('First line of the lead.\nStill the lead.');
  });

  it('is safe on empty and non-string input', () => {
    expect(spokenRegister('')).toBe('');
    expect(spokenRegister(null)).toBe('');
    expect(spokenRegister(undefined)).toBe('');
  });
});

describe('spokenRegister — streaming behaviour', () => {
  /**
   * Called repeatedly on a growing string. Before the blank line arrives the
   * whole answer looks like the lead and the result grows with it; the moment
   * the blank line lands the result is fixed forever. That is what makes the
   * voice speak the lead as it streams and then fall silent for the detail,
   * with no coordination between the two.
   */
  it('grows while the lead is still arriving', () => {
    expect(spokenRegister('Three tests')).toBe('Three tests');
    expect(spokenRegister('Three tests were failing')).toBe('Three tests were failing');
  });

  it('STOPS growing once the blank line lands', () => {
    const lead = 'Three tests were failing. Fixed.';
    const withDetail = `${lead}\n\nHere is the whole diff and every file I touched.`;
    const more = `${withDetail} And more detail still.`;
    expect(spokenRegister(withDetail)).toBe(lead);
    expect(spokenRegister(more)).toBe(lead);
  });

  it('reports when the register is final', () => {
    expect(spokenRegisterComplete('still streaming the lead')).toBe(false);
    expect(spokenRegisterComplete('lead.\n\ndetail')).toBe(true);
    expect(spokenRegisterComplete('lead.\n  \ndetail')).toBe(true);
  });
});

describe('assessSpokenLength — diagnostic, never enforced', () => {
  it('counts words', () => {
    expect(assessSpokenLength('one two three').words).toBe(3);
  });

  it('flags a spoken register that ran long', () => {
    const long = Array.from({ length: 80 }, () => 'word').join(' ');
    expect(assessSpokenLength(long).tooLong).toBe(true);
  });

  it('accepts a short one', () => {
    expect(assessSpokenLength('Yes, already merged.').tooLong).toBe(false);
  });

  it('is zero for empty input', () => {
    expect(assessSpokenLength('')).toEqual({ words: 0, tooLong: false });
    expect(assessSpokenLength(null).words).toBe(0);
  });

  it('has a sane default budget', () => {
    expect(DEFAULT_VOICE_POLICY.maxWords).toBeGreaterThan(10);
  });
});
