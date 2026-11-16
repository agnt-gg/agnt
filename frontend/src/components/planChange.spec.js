import { describe, it, expect } from 'vitest';
import { confirmLabel, describeQuote, formatCents, planChangeRequest, switchesToYearly } from './planChange.js';

const monthlyPro = { currentPlan: 'personal', currentInterval: 'monthly' };

describe('planChangeRequest: the billing period is sent only for a monthly-to-yearly switch', () => {
  it.each([
    ['monthly to yearly on the same plan, with a code', { planType: 'personal', interval: 'yearly', promoCode: ' SAVE25 ' }, monthlyPro, { newPlanType: 'personal', interval: 'yearly', promoCode: 'SAVE25' }],
    ['monthly to yearly on a higher plan, blank code', { planType: 'business', interval: 'yearly', promoCode: '   ' }, monthlyPro, { newPlanType: 'business', interval: 'yearly' }],
    ['an upgrade that stays monthly: no billing period, no code', { planType: 'business', interval: 'monthly', promoCode: 'SAVE25' }, monthlyPro, { newPlanType: 'business' }],
    ['a yearly plan is never sent a billing period', { planType: 'business', interval: 'monthly' }, { currentPlan: 'personal', currentInterval: 'yearly' }, { newPlanType: 'business' }],
    ['a downgrade keeps its billing period and drops the code', { planType: 'personal', interval: 'yearly', promoCode: 'SAVE25' }, { currentPlan: 'business', currentInterval: 'monthly' }, { newPlanType: 'personal' }],
    ['an unknown billing period is left as it is', { planType: 'business', interval: 'yearly' }, { currentPlan: 'personal', currentInterval: null }, { newPlanType: 'business' }],
  ])('%s', (_, choice, current, expected) => {
    expect(planChangeRequest(choice, current)).toEqual(expected);
  });

  it('a plan the picker does not sell, or no plan, is never a switch', () => {
    expect(switchesToYearly({ planType: 'business', interval: 'yearly' }, { currentPlan: 'enterprise', currentInterval: 'monthly' })).toBe(false);
    expect(switchesToYearly({ planType: 'business', interval: 'yearly' }, { currentPlan: null, currentInterval: 'monthly' })).toBe(false);
  });
});

describe('describeQuote: what a customer confirms', () => {
  const renews = 1893456000;
  // agnt.gg's format, so the app and the site say the same thing.
  const day = new Date(renews * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  it('dates read in full, as on agnt.gg, never as digits and slashes', () => {
    const quote = { amountDue: 100, discount: 0, credit: 0, currency: 'usd', interval: 'yearly', isDowngrade: false, renewal: { amount: 100, date: renews } };
    expect(describeQuote(quote)).toContain(` on ${day}.`);
    expect(describeQuote(quote)).not.toMatch(/\d+\/\d+\/\d+/);
  });

  it('a switch says what is paid today, what made it smaller, and what it renews at', () => {
    const quote = { amountDue: 6250, discount: 2500, credit: 1250, promoCode: 'SAVE25', currency: 'usd', interval: 'yearly', isDowngrade: false, renewal: { amount: 10000, date: renews } };
    expect(describeQuote(quote, { switching: true, planName: 'AGNT Team' })).toBe(
      `You pay $62.50 today, after $25.00 off with SAVE25 and $12.50 for the unused part of this month, and AGNT Team is billed yearly from now on. It then renews at $100.00 a year on ${day}.`,
    );
    expect(confirmLabel(quote)).toBe('Pay $62.50');
  });

  it('an upgrade that keeps its billing period is the difference for the rest of the period', () => {
    const quote = { amountDue: 2000, discount: 0, credit: 1000, currency: 'usd', interval: 'monthly', isDowngrade: false, renewal: { amount: 9900, date: renews } };
    expect(describeQuote(quote, { planName: 'AGNT Team' })).toBe(
      `You pay $20.00 today, the difference for the rest of this billing period. It then renews at $99.00 a month on ${day}.`,
    );
  });

  it('a downgrade charges nothing now', () => {
    const quote = { amountDue: 0, isDowngrade: true, currency: 'usd', interval: 'monthly', renewal: { amount: 2900, date: renews } };
    expect(describeQuote(quote, { planName: 'AGNT Pro' })).toBe(`Nothing is charged today. You move to AGNT Pro on ${day}.`);
    expect(confirmLabel(quote)).toBe('Schedule change');
  });

  it('amounts are dollars and cents with separators', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(undefined)).toBe('$0.00');
    expect(confirmLabel({ amountDue: 0, isDowngrade: false })).toBe('Confirm');
  });
});
