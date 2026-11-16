/**
 * A subscriber's plan change, as the server prices and makes it. The upgrade
 * modal and Billing both build the request here and word the server's quote
 * here, so the two cannot drift apart, and the price a customer confirms is
 * the price of the exact request that is then sent.
 */
import { PLANS } from './plans.js';

/** Position on the plan ladder, or -1 for a plan the picker does not sell. */
export function planRank(planType) {
  return PLANS.findIndex((plan) => plan.id === planType);
}

/**
 * True when a choice moves a monthly subscription to yearly billing, on the
 * current plan or a higher one. That is the only change that starts a new
 * billing period at once, so it is the only change a code applies to. A
 * lower plan waits for renewal and keeps the period the customer has.
 */
export function switchesToYearly({ planType, interval }, { currentPlan, currentInterval }) {
  const from = planRank(currentPlan);
  return currentInterval === 'monthly' && interval === 'yearly' && from >= 0 && planRank(planType) >= from;
}

/**
 * The body for POST /users/subscription/preview and /users/subscription/update.
 * The billing period is sent only for a monthly-to-yearly switch, and a code
 * only with it, so every other change keeps the period the customer is on.
 */
export function planChangeRequest(choice, current) {
  const request = { newPlanType: choice.planType };
  if (switchesToYearly(choice, current)) {
    request.interval = 'yearly';
    const code = typeof choice.promoCode === 'string' ? choice.promoCode.trim() : '';
    if (code) request.promoCode = code;
  }
  return request;
}

/** "$1,234.50" for an amount in cents. */
export function formatCents(cents, currency = 'usd') {
  const amount = (Number(cents) || 0) / 100;
  const code = String(currency || 'usd').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

// The same long date agnt.gg shows, e.g. "November 16, 2027".
const onDay = (seconds) =>
  Number.isFinite(seconds) && seconds > 0
    ? ` on ${new Date(seconds * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`
    : '';

/**
 * What a customer confirms, from the server's quote: the amount charged
 * today, what made it smaller, and what the plan renews at. Plain text.
 * `switching` is true for a monthly-to-yearly switch.
 */
export function describeQuote(quote, { switching = false, planName } = {}) {
  const cost = (cents) => formatCents(cents, quote.currency);
  const plan = planName || quote.newPlanName || 'your plan';
  if (quote.isDowngrade) {
    return `Nothing is charged today. You move to ${plan}${onDay(quote.renewal?.date) || ' at renewal'}.`;
  }
  let text;
  if (switching) {
    const reductions = [];
    if (quote.discount > 0) reductions.push(`${cost(quote.discount)} off${quote.promoCode ? ` with ${quote.promoCode}` : ''}`);
    if (quote.credit > 0) reductions.push(`${cost(quote.credit)} for the unused part of this month`);
    text = `You pay ${cost(quote.amountDue)} today${reductions.length ? `, after ${reductions.join(' and ')}` : ''}, and ${plan} is billed yearly from now on.`;
  } else {
    text = `You pay ${cost(quote.amountDue)} today, the difference for the rest of this billing period.`;
  }
  if (Number.isFinite(quote.renewal?.amount)) {
    text += ` It then renews at ${cost(quote.renewal.amount)} a ${quote.interval === 'yearly' ? 'year' : 'month'}${onDay(quote.renewal.date)}.`;
  }
  return text;
}

/** The confirm button states the charge. */
export function confirmLabel(quote) {
  if (quote.isDowngrade) return 'Schedule change';
  return quote.amountDue > 0 ? `Pay ${formatCents(quote.amountDue, quote.currency)}` : 'Confirm';
}
