import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import BillingManager from './BillingManager.vue';
import { PLAN_PRICES, yearlySavingsPercent } from './planPrices.js';

/**
 * data() is the one place a stale identifier fails at runtime and nowhere
 * else: the build passes, the computed tests pass, and Settings goes blank
 * for every user. Mounting is the only test that catches it.
 */
describe('BillingManager mounts', () => {
  it('renders the plan ladder for a signed-in user', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    const store = createStore({
      modules: {
        userAuth: { namespaced: true, state: { token: 't', planType: 'free', user: { email: 'a@b.co' } }, getters: { isPremium: () => false, licenseInfo: () => null, planName: () => 'Community Core' }, actions: { fetchLicense: () => null, fetchSubscription: () => null } },
      },
    });
    const wrapper = mount(BillingManager, { global: { plugins: [store], directives: { tooltip: {} }, stubs: { SimpleModal: true, Tooltip: { template: '<div><slot /></div>' } } } });
    expect(wrapper.text()).toContain('AGNT Pro');
    expect(wrapper.text()).toContain('$290/year');
    vi.unstubAllGlobals();
  });
});

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

  // The badge said "Save 33%" while a year cost ten months: 16.7%.
  it('the yearly badge is the real saving, computed from the prices', () => {
    expect(yearlySavingsPercent()).toBe(17);
    for (const { monthly, yearly } of Object.values(PLAN_PRICES)) expect(1 - yearly / (monthly * 12)).toBeCloseTo(1 / 6, 5);
    // True of every plan: the smallest saving (50% and 16.7% → 17%).
    expect(yearlySavingsPercent({ a: { monthly: 10, yearly: 60 }, b: { monthly: 10, yearly: 100 } })).toBe(17);
    expect(yearlySavingsPercent({ a: { monthly: 10, yearly: 120 } })).toBe(0);
    expect(yearlySavingsPercent({})).toBe(0);
  });

  it('the badge reads the computed saving, not a typed-in number', () => {
    expect(BillingManager.computed.yearlySavings.call({})).toBe(17);
  });

  it('maps every displayed plan name to a checkout plan type', () => {
    const plans = plansFor('monthly');
    const map = Object.fromEntries(plans.map((p) => [p.name, p.planType]));
    expect(map).toEqual({ 'AGNT Pro': 'personal', 'Pro + Always-On': 'always_on', 'AGNT Team': 'business', 'Managed Operations': 'enterprise' });
  });
});
