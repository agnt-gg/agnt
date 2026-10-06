/**
 * The signed-in person's AGNT Flash account, as chat needs it: how many credits
 * are left, and a one-click way to buy more.
 *
 * Both calls skip the local Pro gate on purpose. A free account has a trial to
 * read and may buy prepaid credit; models.agnt.gg authenticates the session and
 * is the authority on what this account may do.
 */
import { callService, ServiceError } from './agntServices.js';

/** The prepaid amounts models.agnt.gg sells, in cents. Mirrors its funding route. */
export const TOP_UP_AMOUNTS_CENTS = Object.freeze([1000, 2500, 5000]);

/** Only Stripe-hosted checkout pages are ever opened from the app. */
const CHECKOUT_HOST = 'checkout.stripe.com';

const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/**
 * Normalise /usage into the few fields chat renders.
 *
 * "Left" is what has been CHARGED, never what is held. While a reply runs the
 * gateway reserves its worst case and its own remainingCredits subtracts that
 * hold, so a balance read mid-reply dipped and then rose again when the request
 * settled ("the credits left went UP"). The hold is reported on its own.
 */
export function toFlashAccount(usage) {
  const includedCredits = count(usage.includedCredits ?? usage.includedUnits);
  const usedCredits = count(usage.usedCredits ?? usage.usedUnits);
  const hasTotals = (usage.includedCredits ?? usage.includedUnits) !== undefined && (usage.usedCredits ?? usage.usedUnits) !== undefined;
  return {
    source: usage.source || 'payg',
    planName: usage.planName || null,
    trial: usage.source === 'agnt_trial',
    includedCredits,
    usedCredits,
    remainingCredits: hasTotals ? Math.max(0, includedCredits - usedCredits) : count(usage.remainingCredits ?? usage.remainingUnits),
    reservedCredits: count(usage.reservedCredits ?? usage.reservedUnits),
    balanceMicroUSD: count(usage.balance?.available),
    resetAt: usage.resetAt ?? null,
  };
}

export async function getFlashAccount() {
  return toFlashAccount(await callService('models', '/usage', { planGate: false, retries: 2, timeoutMs: 15000 }));
}

/**
 * Start a Stripe checkout for prepaid AGNT Flash credit. Returns the URL to open.
 * Not retried: a checkout is a purchase, and the idempotency key covers one call.
 */
export async function startTopUp(amountCents) {
  if (!TOP_UP_AMOUNTS_CENTS.includes(amountCents)) {
    throw new ServiceError('models', 400, 'unsupported_topup', { message: 'Top-ups are $10, $25 or $50.' });
  }
  const result = await callService('models', '/funding/checkout', {
    method: 'POST',
    body: { amountCents },
    idempotent: true,
    planGate: false,
    retries: 0,
    timeoutMs: 30000,
  });
  let url;
  try {
    url = new URL(result?.url);
  } catch {
    url = null;
  }
  if (!url || url.protocol !== 'https:' || url.hostname !== CHECKOUT_HOST) {
    throw new ServiceError('models', 502, 'checkout_unavailable', { message: 'Checkout could not be opened. Try again in a moment.' });
  }
  return { url: url.href, orderId: result.orderId || null };
}
