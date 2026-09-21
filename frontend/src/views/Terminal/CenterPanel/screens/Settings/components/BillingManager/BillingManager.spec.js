import { describe, expect, it } from 'vitest';
import BillingManager from './BillingManager.vue';

/**
 * The prices shown must be the prices checkout charges. These mirror
 * PLAN_PRICING on api.agnt.gg; if one moves, the other must move with it.
 */
describe('BillingManager pricing', () => {
  const plansFor = (selectedInterval) => BillingManager.computed.plans.call({ selectedInterval });

  it.each([
    ['personal', 'monthly', '$29/mo'],
    ['personal', 'yearly', '$290/year'],
    ['always_on', 'monthly', '$49/mo'],
    ['always_on', 'yearly', '$490/year'],
    ['business', 'monthly', '$99/mo'],
    ['business', 'yearly', '$990/year'],
  ])('shows the %s %s price charged by checkout', (planType, selectedInterval, expectedPrice) => {
    const plan = plansFor(selectedInterval).find((p) => p.planType === planType);
    expect(plan.price).toBe(expectedPrice);
    expect(plan.originalPrice).toBeNull();
  });

  it('lists all six included services on every paid plan', () => {
    const six = ['Hosted instance', 'AGNT Flash', 'Search', 'Sandbox', 'Mail', 'Webhooks'];
    for (const plan of plansFor('monthly').filter((p) => p.planType !== 'enterprise')) {
      const names = plan.features.map((f) => f.text);
      for (const s of six) expect(names, `${plan.name} is missing ${s}`).toContain(s);
      expect(plan.features.filter((f) => six.includes(f.text)).every((f) => f.included)).toBe(true);
    }
  });

  it('maps every displayed plan name to a checkout plan type', () => {
    const plans = plansFor('monthly');
    const map = Object.fromEntries(plans.map((p) => [p.name, p.planType]));
    expect(map).toEqual({ 'AGNT Pro': 'personal', 'Pro + Always-On': 'always_on', 'AGNT Team': 'business', 'Managed Operations': 'enterprise' });
  });
});
