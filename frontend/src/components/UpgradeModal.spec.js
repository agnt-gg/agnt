import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import UpgradeModal from './UpgradeModal.vue';
import PlanPicker from './PlanPicker.vue';

const QUOTE = { amountDue: 7500, discount: 2500, credit: 0, promoCode: 'SAVE25', currency: 'usd', interval: 'yearly', isDowngrade: false, renewal: { amount: 10000, date: 1893456000 } };
const refused = (error, reason) => Object.assign(new Error('Request failed'), { response: { status: 400, data: { error, reason } } });

function mountModal({ planType = 'personal', interval = 'monthly', preview } = {}) {
  const actions = {
    createSubscription: vi.fn(async () => ({})),
    previewSubscriptionChange: vi.fn(preview || (async () => QUOTE)),
    updateSubscription: vi.fn(async () => ({ interval: 'yearly' })),
    fetchSubscription: vi.fn(async () => null),
  };
  const store = createStore({ modules: { userAuth: { namespaced: true, state: { planType, subscription: { planType, interval } }, actions } } });
  const wrapper = mount(UpgradeModal, { props: { open: true }, global: { plugins: [store], stubs: { teleport: true } } });
  return { wrapper, actions };
}
const choose = async (wrapper, choice) => {
  wrapper.findComponent(PlanPicker).vm.$emit('choose', choice);
  await flushPromises();
};

describe('UpgradeModal', () => {
  it('a subscriber sees the price first, and confirming makes exactly that change', async () => {
    const { wrapper, actions } = mountModal();
    await choose(wrapper, { planType: 'personal', interval: 'yearly', promoCode: 'SAVE25' });
    const request = { newPlanType: 'personal', interval: 'yearly', promoCode: 'SAVE25' };
    expect(actions.previewSubscriptionChange).toHaveBeenCalledWith(expect.anything(), request);
    expect(actions.updateSubscription).not.toHaveBeenCalled();
    expect(wrapper.find('.confirm-text').text()).toContain('You pay $75.00 today, after $25.00 off with SAVE25');
    const pay = wrapper.find('.btn-confirm');
    expect(pay.text()).toBe('Pay $75.00');

    await pay.trigger('click');
    await flushPromises();
    expect(actions.updateSubscription).toHaveBeenCalledWith(expect.anything(), request);
    expect(actions.fetchSubscription).toHaveBeenCalledWith(expect.anything(), { forceRefresh: true });
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('an upgrade that keeps monthly billing is priced without a billing period', async () => {
    const { wrapper, actions } = mountModal();
    await choose(wrapper, { planType: 'business', interval: 'monthly' });
    expect(actions.previewSubscriptionChange).toHaveBeenCalledWith(expect.anything(), { newPlanType: 'business' });
  });

  it('a refused code is said on the picker, and nothing is charged', async () => {
    const { wrapper, actions } = mountModal({
      preview: async () => {
        throw refused('That code is not valid.', 'invalid_code');
      },
    });
    await choose(wrapper, { planType: 'personal', interval: 'yearly', promoCode: 'NOPE' });
    expect(wrapper.find('.confirm-text').exists()).toBe(false);
    expect(wrapper.findComponent(PlanPicker).props('error')).toBe('That code is not valid.');
    expect(actions.updateSubscription).not.toHaveBeenCalled();
  });

  it('Back returns to the picker and charges nothing', async () => {
    const { wrapper, actions } = mountModal();
    await choose(wrapper, { planType: 'personal', interval: 'yearly' });
    await wrapper.find('.btn-back').trigger('click');
    expect(wrapper.find('.confirm-text').exists()).toBe(false);
    expect(wrapper.findComponent(PlanPicker).attributes('style') || '').not.toContain('display: none');
    expect(actions.updateSubscription).not.toHaveBeenCalled();
  });

  it('a free user goes straight to checkout', async () => {
    const { wrapper, actions } = mountModal({ planType: 'free', interval: null });
    await choose(wrapper, { planType: 'business', interval: 'yearly' });
    expect(actions.createSubscription).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ planType: 'business', interval: 'yearly' }));
    expect(actions.previewSubscriptionChange).not.toHaveBeenCalled();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('a stale free plan that is really subscribed is refreshed, and nothing is charged', async () => {
    const { wrapper, actions } = mountModal({ planType: 'free', interval: null });
    actions.createSubscription.mockRejectedValueOnce(Object.assign(new Error('Request failed'), { response: { status: 409, data: { error: 'Already subscribed.', reason: 'already_subscribed' } } }));
    await choose(wrapper, { planType: 'business', interval: 'monthly' });
    expect(actions.fetchSubscription).toHaveBeenCalledWith(expect.anything(), { forceRefresh: true });
    expect(wrapper.findComponent(PlanPicker).props('error')).toMatch(/nothing was charged/);
    expect(wrapper.emitted('close')).toBeUndefined();
  });
});
