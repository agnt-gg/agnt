/**
 * The meter's label opens what is on us and the invite, only ever on a click.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';

const state = reactive({ appAuth: { connectedApps: ['agnt', 'claude-code'] }, aiProvider: { customProviders: [] }, chat: { isStreaming: false, messages: [] }, userAuth: { token: 'token-1' } });
const getters = { 'userAuth/userEmail': 'maya@example.com' };
vi.mock('vuex', async (original) => ({ ...(await original()), useStore: () => ({ state, getters, dispatch: vi.fn() }) }));
const api = vi.hoisted(() => ({ fetchFlashAccount: vi.fn(), startFlashTopUp: vi.fn() }));
vi.mock('@/services/agntFlash.js', async (original) => ({ ...(await original()), ...api }));
const fetchReferralProfile = vi.fn();
vi.mock('@/services/referral/referralProgram.js', async (original) => ({ ...(await original()), fetchReferralProfile: (...a) => fetchReferralProfile(...a) }));
vi.mock('@/services/giveBack.js', async (original) => ({ ...(await original()), fetchStarCount: vi.fn(async () => 576) }));

import AgntFlashMeter from './AgntFlashMeter.vue';

const TRIAL = { source: 'agnt_trial', trial: true, includedCredits: 1_000_000, usedCredits: 180_000, remainingCredits: 820_000, balanceMicroUSD: 0, resetAt: null };
const opened = vi.fn();
let wrapper;
async function mountMeter(account = TRIAL) {
  api.fetchFlashAccount.mockResolvedValue(account);
  wrapper = mount(AgntFlashMeter, { attachTo: document.body, global: { stubs: { UpgradeModal: true, teleport: true } } });
  await flushPromises();
  return wrapper;
}
const popover = () => wrapper.find('[data-testid="on-us"]');
async function open() {
  await wrapper.find('[data-action="on-us"]').trigger('click');
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  fetchReferralProfile.mockResolvedValue({ code: 'MAYA', invited: false });
  window.electron = { openExternalUrl: opened };
});
afterEach(() => {
  wrapper?.unmount();
  delete window.electron;
});

describe('AGNT Flash meter: on us', () => {
  it('never opens by itself; its label says the trial is on us', async () => {
    await mountMeter();
    expect(popover().exists()).toBe(false);
    expect(wrapper.find('[data-action="on-us"]').text()).toBe('AGNT Flash · Free trial On us');
    expect(wrapper.find('[data-action="on-us"]').attributes('aria-expanded')).toBe('false');
  });

  it('opens on a click with how much of the trial is used, never a credit count', async () => {
    await mountMeter();
    await open();
    expect(popover().find('.on-us-kicker').text()).toBe('On us');
    expect(popover().find('[data-testid="on-us-used"]').text()).toBe("You've used about 18%");
    expect(popover().text()).not.toMatch(/\d+(\.\d+)?\s*[kMB]\b|credits left|\bleft\b/);
    expect(wrapper.find('[data-action="on-us"]').attributes('aria-expanded')).toBe('true');
  });

  it("offers the account's invite link, and shares it through the same intents as Settings", async () => {
    await mountMeter();
    await open();
    expect(popover().find('.on-us-url').text()).toBe('agnt.gg/invite/MAYA');
    await popover().find('[data-action="share-x"]').trigger('click');
    expect(opened.mock.calls[0][0]).toMatch(/^https:\/\/x\.com\/intent\/tweet\?text=I%20build%20with%20AGNT.*&url=https%3A%2F%2Fagnt\.gg%2Finvite%2FMAYA$/);
  });

  it('leaves the invite out when the account has no code yet', async () => {
    fetchReferralProfile.mockResolvedValue(null);
    await mountMeter();
    await open();
    expect(popover().find('[data-testid="on-us-invite"]').exists()).toBe(false);
    expect(popover().find('[data-action="follow-x"]').exists()).toBe(true);
  });

  it('"Referral details" closes it and asks the chat to open Settings › Referrals', async () => {
    await mountMeter();
    await open();
    await popover().find('[data-action="referrals"]').trigger('click');
    expect(wrapper.emitted('open-referrals')).toHaveLength(1);
    expect(popover().exists()).toBe(false);
  });

  it('closes on Escape, on a click elsewhere, and on its own toggle', async () => {
    await mountMeter();
    await open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(popover().exists()).toBe(false);

    await open();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await flushPromises();
    expect(popover().exists()).toBe(false);

    await open();
    await open();
    expect(popover().exists()).toBe(false);
  });

  it('a paid allowance keeps its number and is not called a gift', async () => {
    await mountMeter({ source: 'agnt_subscription', trial: false, planName: 'AGNT included allowance', includedCredits: 5_000_000, usedCredits: 1_000_000, remainingCredits: 4_000_000, balanceMicroUSD: 0, resetAt: null });
    expect(wrapper.find('[data-action="on-us"]').text()).toBe('AGNT Flash · AGNT included allowance');
    await open();
    expect(popover().find('.on-us-kicker').text()).toBe('AGNT Flash');
    expect(popover().find('[data-testid="on-us-used"]').text()).toBe('4.0M left');
  });
});
