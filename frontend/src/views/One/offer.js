/**
 * The offer AGNT One shows in its corner card and on its rail, and who it is
 * for. CURRENT_OFFER is the switch: replace it for the next offer, or set it
 * to null, and the card and the rail button are gone. Closing the card is
 * kept per offer, so closing one never hides the next.
 */
import { planRank } from '@/components/planChange.js';

export const CURRENT_OFFER = Object.freeze({
  id: 'blackfriday-2026',
  code: 'BLACKFRIDAY',
  eyebrow: 'Black Friday',
  title: '12 months for the price of 6',
  body: 'On yearly plans, with code',
  railLabel: 'Black Friday deal',
  // When the code expires in Stripe: Nov 30, 11:59 pm PT.
  endsAt: Date.UTC(2026, 11, 1, 7, 59, 59),
});

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** True until the offer's code expires. */
export function offerLive(offer, now) {
  return !!offer && now < offer.endsAt;
}

/**
 * Whether the code can help this account: a free account buying a yearly
 * plan, or a plan billed monthly moving to yearly. A yearly plan, a renewal
 * already cancelled, or a plan the picker does not sell cannot use it.
 * Nothing until the subscription status has loaded.
 */
export function offerApplies(subscription) {
  if (!subscription) return false;
  const { planType, interval, cancelAtPeriodEnd } = subscription;
  if (!planType || planType === 'free') return true;
  return planRank(planType) >= 0 && interval === 'monthly' && !cancelAtPeriodEnd;
}

/** "14 days left", "1 day left", "5 hours left", "1 hour left", "Less than an hour left". */
export function offerTimeLeft(offer, now) {
  const ms = offer.endsAt - now;
  if (ms >= 2 * DAY) return `${Math.floor(ms / DAY)} days left`;
  if (ms >= DAY) return '1 day left';
  if (ms >= 2 * HOUR) return `${Math.floor(ms / HOUR)} hours left`;
  if (ms >= HOUR) return '1 hour left';
  return 'Less than an hour left';
}

/** "Mon, Nov 30": the day it ends where the deadline is set. */
export function offerEndsOn(offer) {
  return new Date(offer.endsAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
}

/** Where closing the card is kept: one key per offer. */
export function offerDismissedKey(offer) {
  return `agnt:offer-dismissed:${offer.id}`;
}
