import { describe, expect, it } from 'vitest';
import BillingManager from './BillingManager.vue';

describe('BillingManager pricing', () => {
  it.each([
    ['monthly', '$29/mo'],
    ['yearly', '$290/year'],
  ])('shows the %s Personal price charged by checkout', (selectedInterval, expectedPrice) => {
    const { activePrices } = BillingManager.data();
    const plans = BillingManager.computed.plans.call({ selectedInterval, activePrices });
    const personalPlan = plans.find((plan) => plan.name === 'Personal Pro');

    expect(personalPlan.price).toBe(expectedPrice);
    expect(personalPlan.originalPrice).toBeNull();
  });
});
