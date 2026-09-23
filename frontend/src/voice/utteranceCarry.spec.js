import { describe, it, expect } from 'vitest';
import { covers, carryable, appendCarry, mergeCarry } from './utteranceCarry.js';

describe('utteranceCarry', () => {
  it('prepends words from before the pause to the continuation', () => {
    expect(mergeCarry('look at the voice system, it keeps', 'dropping my words')).toBe(
      'look at the voice system, it keeps dropping my words'
    );
  });

  it('does not duplicate when the model already folded the first half in', () => {
    const full = 'Look at the voice system it keeps dropping my words';
    expect(mergeCarry('look at the voice system, it keeps', full)).toBe(full);
  });

  it('nothing carried: the utterance passes through untouched', () => {
    expect(mergeCarry('', 'check the build')).toBe('check the build');
  });

  it('a cancelled call repeating what already ran is NOT lost speech (the repeat bug)', () => {
    expect(carryable('check the build', 'check the build')).toBe('');
    expect(carryable('Check the build.', 'check the build')).toBe('');
  });

  it('a cancelled call with new words is carried', () => {
    expect(carryable('and then deploy it', 'check the build')).toBe('and then deploy it');
  });

  it('two pauses in one thought accumulate in order, without doubling a retrigger', () => {
    let c = appendCarry('', 'first part');
    c = appendCarry(c, 'first part'); // VAD retrigger on the same half
    c = appendCarry(c, 'second part');
    expect(c).toBe('first part second part');
    expect(mergeCarry(c, 'third part')).toBe('first part second part third part');
  });

  it('covers is punctuation- and case-blind', () => {
    expect(covers('Hey, what ALL can you do?', 'hey what all can you do')).toBe(true);
    expect(covers('something else entirely', 'hey what all can you do')).toBe(false);
  });
});
