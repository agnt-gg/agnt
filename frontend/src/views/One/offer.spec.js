import { describe, it, expect } from 'vitest';
import { CURRENT_OFFER, offerApplies, offerDismissedKey, offerEndsOn, offerLive, offerTimeLeft } from './offer.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;

describe('the running offer', () => {
  it('is Black Friday: the code in Stripe, ending when the code expires (Nov 30, 11:59 pm PT)', () => {
    expect(CURRENT_OFFER.code).toBe('BLACKFRIDAY');
    expect(new Date(CURRENT_OFFER.endsAt).toISOString()).toBe('2026-12-01T07:59:59.000Z');
    expect(offerEndsOn(CURRENT_OFFER)).toBe('Mon, Nov 30');
    expect(CURRENT_OFFER.title).toBe('12 months for the price of 6');
  });

  it('runs until the deadline, not at or after it', () => {
    expect(offerLive(CURRENT_OFFER, CURRENT_OFFER.endsAt - 1)).toBe(true);
    expect(offerLive(CURRENT_OFFER, CURRENT_OFFER.endsAt)).toBe(false);
    expect(offerLive(null, 0)).toBe(false);
  });

  it.each([
    ['nothing until the status has loaded', null, false],
    ['a free account', { planType: 'free', interval: null }, true],
    ['Pro billed monthly', { planType: 'personal', interval: 'monthly' }, true],
    ['Team billed monthly', { planType: 'business', interval: 'monthly' }, true],
    ['Pro + Always-On billed monthly', { planType: 'always_on', interval: 'monthly' }, true],
    ['a plan billed yearly cannot use the code', { planType: 'personal', interval: 'yearly' }, false],
    ['a renewal already cancelled', { planType: 'personal', interval: 'monthly', cancelAtPeriodEnd: true }, false],
    ['a plan the picker does not sell', { planType: 'enterprise', interval: 'monthly' }, false],
    ['a plan with no billing period (lifetime, founder)', { planType: 'personal', interval: null }, false],
  ])('is for %s: %s', (_, subscription, expected) => {
    expect(offerApplies(subscription)).toBe(expected);
  });

  it('says how long is left in words', () => {
    const at = (ms) => offerTimeLeft(CURRENT_OFFER, CURRENT_OFFER.endsAt - ms);
    expect(at(14 * DAY + 13 * HOUR)).toBe('14 days left');
    expect(at(2 * DAY)).toBe('2 days left');
    expect(at(DAY + 5 * HOUR)).toBe('1 day left');
    expect(at(5 * HOUR + 59 * 60_000)).toBe('5 hours left');
    expect(at(HOUR + 1)).toBe('1 hour left');
    expect(at(59 * 60_000)).toBe('Less than an hour left');
  });

  it('keeps closing per offer, so closing one never hides the next', () => {
    expect(offerDismissedKey(CURRENT_OFFER)).toBe('agnt:offer-dismissed:blackfriday-2026');
    expect(offerDismissedKey({ id: 'next-offer' })).not.toBe(offerDismissedKey(CURRENT_OFFER));
  });
});
