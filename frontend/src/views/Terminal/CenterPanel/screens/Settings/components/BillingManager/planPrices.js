/**
 * Plan prices in whole US dollars, per plan type. These mirror PLAN_PRICING
 * on api.agnt.gg — what checkout actually charges; change them there first.
 *
 * Every price label AND the yearly "Save N%" badge are derived from this one
 * table. The badge used to be typed in by hand ("Save 33%") while the prices
 * gave 16.7% (a year costs ten months), which is what happens when a claim
 * about numbers is not computed from the numbers.
 */
export const PLAN_PRICES = Object.freeze({
  personal: Object.freeze({ monthly: 29, yearly: 290 }),
  always_on: Object.freeze({ monthly: 49, yearly: 490 }),
  business: Object.freeze({ monthly: 99, yearly: 990 }),
});

/** "$29/mo" or "$290/year". */
export function priceLabel(planType, yearly) {
  const price = PLAN_PRICES[planType];
  if (!price) return 'Custom';
  return yearly ? `$${price.yearly}/year` : `$${price.monthly}/mo`;
}

/**
 * Whole-percent saving of paying yearly over twelve monthly payments, for the
 * plan that saves the LEAST — so the badge is true of every plan it sits over,
 * never only of the best one. Nearest whole percent (16.7% → 17%).
 */
export function yearlySavingsPercent(prices = PLAN_PRICES) {
  const savings = Object.values(prices)
    .filter((p) => p.monthly > 0 && p.yearly > 0)
    .map((p) => 1 - p.yearly / (p.monthly * 12));
  if (!savings.length) return 0;
  return Math.max(0, Math.round(Math.min(...savings) * 100));
}
