import { describe, it, expect, beforeEach } from 'vitest';
import { armVoiceTurn, consumeVoiceTurn, clearVoiceTurn } from './voiceTurn.js';

beforeEach(() => clearVoiceTurn());

describe('voiceTurn — exactly the armed turn is a voice turn', () => {
  it('the armed send is a voice turn', () => {
    armVoiceTurn('what is the build status');
    expect(consumeVoiceTurn('what is the build status')).toBe(true);
  });

  it('consumes once — a retry of the same text is not silently spoken', () => {
    armVoiceTurn('run the tests');
    expect(consumeVoiceTurn('run the tests')).toBe(true);
    expect(consumeVoiceTurn('run the tests')).toBe(false);
  });

  it('an unarmed send is never a voice turn', () => {
    expect(consumeVoiceTurn('typed by hand')).toBe(false);
  });

  it('THE LEAK GUARD: a different send cannot consume the arm', () => {
    /**
     * If the armed submit never happens (empty input, disabled composer), a
     * bare boolean would survive and silently mark the user's NEXT TYPED
     * message as spoken — truncating a written answer for no reason. Keying on
     * the text means only the intended send can match.
     */
    armVoiceTurn('the voice instruction');
    expect(consumeVoiceTurn('something the user typed instead')).toBe(false);
    // ...and the arm is still intact for its own turn.
    expect(consumeVoiceTurn('the voice instruction')).toBe(true);
  });

  it('ignores surrounding whitespace on both sides', () => {
    armVoiceTurn('  open the repo  ');
    expect(consumeVoiceTurn('open the repo')).toBe(true);
  });

  it('re-arming replaces the previous arm', () => {
    armVoiceTurn('first');
    armVoiceTurn('second');
    expect(consumeVoiceTurn('first')).toBe(false);
    expect(consumeVoiceTurn('second')).toBe(true);
  });

  it('clearVoiceTurn drops a pending arm', () => {
    armVoiceTurn('abandoned');
    clearVoiceTurn();
    expect(consumeVoiceTurn('abandoned')).toBe(false);
  });

  it('arming nothing arms nothing', () => {
    armVoiceTurn('');
    expect(consumeVoiceTurn('')).toBe(false);
    armVoiceTurn(null);
    expect(consumeVoiceTurn('anything')).toBe(false);
  });

  it('never throws on non-string input', () => {
    expect(() => armVoiceTurn(42)).not.toThrow();
    expect(() => consumeVoiceTurn({})).not.toThrow();
    expect(consumeVoiceTurn(undefined)).toBe(false);
  });
});
