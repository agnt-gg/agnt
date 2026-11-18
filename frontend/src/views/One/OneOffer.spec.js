import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createStore } from 'vuex';
import OneOffer from './OneOffer.vue';
import { useOffer } from './useOffer.js';
import { CURRENT_OFFER } from './offer.js';

const NOW = Date.UTC(2026, 10, 16, 18, 0, 0); // Nov 16: 14 days and change before the deadline
const KEY = 'agnt:offer-dismissed:blackfriday-2026';

const storeFor = (planType, subscription) => createStore({ modules: { userAuth: { namespaced: true, state: { planType, subscription } } } });
const mountCard = (planType, subscription, props = {}) =>
  mount(OneOffer, {
    props: { offer: CURRENT_OFFER, now: NOW, ...props },
    global: { plugins: [storeFor(planType, subscription)], stubs: { UpgradeModal: true } },
  });

describe('OneOffer: the corner card', () => {
  it('says the offer, the code and when it ends', () => {
    const w = mountCard('free', { planType: 'free' });
    expect(w.find('.offer-eyebrow').text()).toBe('Black Friday');
    expect(w.find('.offer-title').text()).toBe('12 months for the price of 6');
    expect(w.find('.offer-body').text()).toBe('On yearly plans. Code BLACKFRIDAY is applied for you.');
    expect(w.find('.offer-code').text()).toBe('BLACKFRIDAY');
    expect(w.find('.offer-time').text()).toBe('Ends Mon, Nov 30 \u00b7 14 days left');
    expect(w.attributes('aria-label')).toBe('Black Friday offer');
  });

  it('the \u00d7 asks to close it', async () => {
    const w = mountCard('free', { planType: 'free' });
    await w.find('.offer-x').trigger('click');
    expect(w.emitted('dismiss')).toHaveLength(1);
  });

  it('a monthly plan opens the upgrade window on itself, annual ticked and the code filled in', async () => {
    const w = mountCard('business', { planType: 'business', interval: 'monthly' });
    const modal = () => w.findComponent({ name: 'UpgradeModal' });
    expect(modal().props('open')).toBe(false);
    await w.find('[data-testid="one-offer-cta"]').trigger('click');
    expect(modal().props()).toMatchObject({ open: true, suggest: 'business', presetYearly: true, presetCode: 'BLACKFRIDAY', note: '' });
  });

  it('a free account opens it on Pro with annual ticked, told the code is applied at checkout', async () => {
    const w = mountCard('free', { planType: 'free' });
    await w.find('[data-testid="one-offer-cta"]').trigger('click');
    expect(w.findComponent({ name: 'UpgradeModal' }).props()).toMatchObject({
      open: true,
      suggest: 'personal',
      presetYearly: true,
      note: 'BLACKFRIDAY is applied at checkout: 12 months for the price of 6.',
    });
  });

  it('the code copies with one click', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const w = mountCard('free', { planType: 'free' });
    await w.find('.offer-code').trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith('BLACKFRIDAY');
    expect(w.find('.offer-code').text()).toBe('Copied');
  });
});

describe('useOffer: who sees it, and closing it', () => {
  let state;
  const Host = defineComponent({
    setup() {
      state = useOffer();
      return () => h('div');
    },
  });
  const host = (subscription) => mount(Host, { global: { plugins: [storeFor(subscription?.planType || 'free', subscription)] } });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('opens for a plan billed monthly; closing it is kept for this offer; the rail button opens it again', async () => {
    const w = host({ planType: 'personal', interval: 'monthly' });
    expect(state.shown).toBe(true);
    expect(state.open).toBe(true);
    state.dismiss();
    expect(state.open).toBe(false);
    expect(state.shown).toBe(true);
    expect(localStorage.getItem(KEY)).toBe('1');
    state.toggle();
    expect(state.open).toBe(true);
    w.unmount();

    host({ planType: 'personal', interval: 'monthly' });
    expect(state.open).toBe(false);
    expect(state.shown).toBe(true);
  });

  it('closing an earlier offer, or the old banner, does not hide this one', () => {
    localStorage.setItem('agnt:offer-dismissed:an-older-offer', '1');
    localStorage.setItem('isPromoBannerClosed', 'true');
    host({ planType: 'free' });
    expect(state.open).toBe(true);
  });

  it('is not shown to a yearly plan, or before the plan is known', () => {
    host({ planType: 'business', interval: 'yearly' });
    expect(state.shown).toBe(false);
    expect(state.open).toBe(false);
    host(null);
    expect(state.shown).toBe(false);
  });

  it('an open window loses it when the offer ends', async () => {
    vi.setSystemTime(CURRENT_OFFER.endsAt - 30_000);
    host({ planType: 'free' });
    expect(state.open).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.shown).toBe(false);
    expect(state.open).toBe(false);
  });
});
