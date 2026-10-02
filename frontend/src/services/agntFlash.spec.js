import { describe, it, expect } from 'vitest';
import { parseAgntNotice, stripAgntNotice, formatCredits, usedShare, hasMoreToSpend } from './agntFlash.js';

const SENTENCE = 'Your free AGNT Flash trial credits are used up. Upgrade at [agnt.gg/pricing](https://agnt.gg/pricing).';

describe('AGNT Flash notices in chat', () => {
  it('reads the code the backend appends and keeps the sentence', () => {
    expect(parseAgntNotice(`${SENTENCE}\n\n<!-- agnt-notice:trial_credit_exhausted -->`)).toEqual({ code: 'trial_credit_exhausted', text: SENTENCE });
  });

  it('is not a notice without the tag, or with the tag anywhere but the end', () => {
    expect(parseAgntNotice(SENTENCE)).toBeNull();
    expect(parseAgntNotice('<!-- agnt-notice:trial_credit_exhausted --> then more text')).toBeNull();
    expect(parseAgntNotice(null)).toBeNull();
    expect(parseAgntNotice('x <!-- agnt-notice:Bad-Code -->')).toBeNull();
  });

  it('strips the tag for display and leaves other messages untouched', () => {
    expect(stripAgntNotice(`${SENTENCE}\n\n<!-- agnt-notice:insufficient_credit -->`)).toBe(SENTENCE);
    expect(stripAgntNotice('plain <!-- a comment --> text')).toBe('plain <!-- a comment --> text');
  });
});

describe('AGNT Flash account math', () => {
  it('formats credits the way the chip shows them', () => {
    expect([formatCredits(9_200_000), formatCredits(100_000_000), formatCredits(450_000), formatCredits(0), formatCredits(-5)]).toEqual(['9.2M', '100M', '450k', '0', '0']);
  });

  it('used share is bounded and safe with no allowance', () => {
    expect(usedShare({ includedCredits: 10_000_000, usedCredits: 8_000_000 })).toBe(0.8);
    expect(usedShare({ includedCredits: 10, usedCredits: 50 })).toBe(1);
    expect(usedShare({ includedCredits: 0, usedCredits: 5 })).toBe(0);
    expect(usedShare(null)).toBe(0);
  });

  it('resumes only once something new to spend has arrived', () => {
    const spent = { remainingCredits: 0, balanceMicroUSD: 0 };
    expect(hasMoreToSpend(spent, spent)).toBe(false);
    expect(hasMoreToSpend({ remainingCredits: 0, balanceMicroUSD: 10_000_000 }, spent)).toBe(true, 'a top-up landed');
    expect(hasMoreToSpend({ remainingCredits: 100_000_000, balanceMicroUSD: 0 }, spent)).toBe(true, 'a plan bundle appeared');
    expect(hasMoreToSpend({ remainingCredits: 0, balanceMicroUSD: 40 }, { remainingCredits: 0, balanceMicroUSD: 40 })).toBe(false, 'a stale small balance is not new money');
    expect(hasMoreToSpend(null, spent)).toBe(false);
  });
});
