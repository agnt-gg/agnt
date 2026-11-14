/**
 * Follow, star, copy an invite: plain links, nothing rewarded or checked.
 * The network edges (the referral record, GitHub's count) are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const fetchReferralProfile = vi.fn();
const fetchStarCount = vi.fn();
vi.mock('@/services/referral/referralProgram.js', async (original) => ({ ...(await original()), fetchReferralProfile: (...a) => fetchReferralProfile(...a) }));
vi.mock('@/services/giveBack.js', async (original) => ({ ...(await original()), fetchStarCount: (...a) => fetchStarCount(...a) }));
const store = { getters: { 'userAuth/userEmail': 'maya@example.com' }, state: { userAuth: { token: 'token-1' } } };
vi.mock('vuex', async (original) => ({ ...(await original()), useStore: () => store }));

import GiveBackLinks from './GiveBackLinks.vue';

const opened = vi.fn();
let wrapper;
async function mountLinks(props = {}) {
  wrapper = mount(GiveBackLinks, { props, slots: { default: '<button class="slotted">Not now</button>' } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  [fetchReferralProfile, fetchStarCount, opened].forEach((fn) => fn.mockReset());
  fetchReferralProfile.mockResolvedValue({ code: 'MAYA', invited: false });
  fetchStarCount.mockResolvedValue(576);
  window.electron = { openExternalUrl: opened };
});
afterEach(() => {
  wrapper?.unmount();
  delete window.electron;
  vi.useRealTimers();
});

describe('GiveBackLinks', () => {
  it('follows AGNT on X and stars the repository, each in the browser', async () => {
    await mountLinks();
    await wrapper.find('[data-action="follow-x"]').trigger('click');
    await wrapper.find('[data-action="star-github"]').trigger('click');
    expect(opened.mock.calls.map(([url]) => url)).toEqual(['https://x.com/intent/follow?screen_name=agnt_gg', 'https://github.com/agnt-gg/agnt']);
  });

  it("shows the star count GitHub reports, and no number when it cannot say", async () => {
    await mountLinks();
    expect(wrapper.find('[data-testid="give-back-stars"]').text()).toBe('576');
    wrapper.unmount();
    fetchStarCount.mockResolvedValue(null);
    await mountLinks();
    expect(wrapper.find('[data-testid="give-back-stars"]').exists()).toBe(false);
    expect(wrapper.find('[data-action="star-github"]').text()).toBe('Star on GitHub');
  });

  it("copies the account's own invite link and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mountLinks();
    await wrapper.find('[data-action="copy-invite"]').trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith('https://agnt.gg/invite/MAYA');
    expect(wrapper.find('[data-action="copy-invite"]').text()).toBe('Copied');
  });

  it('says when the clipboard refused', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    document.execCommand = vi.fn(() => false);
    await mountLinks();
    await wrapper.find('[data-action="copy-invite"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-action="copy-invite"]').text()).toBe("Couldn't copy");
  });

  it('offers no invite until the account has a code', async () => {
    fetchReferralProfile.mockResolvedValue(null);
    await mountLinks({ terms: true });
    expect(wrapper.find('[data-action="copy-invite"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="give-back-terms"]').exists()).toBe(false);
  });

  it('says what an invite gives and earns only where asked to', async () => {
    await mountLinks();
    expect(wrapper.find('[data-testid="give-back-terms"]').exists()).toBe(false);
    wrapper.unmount();
    await mountLinks({ terms: true });
    expect(wrapper.find('[data-testid="give-back-terms"]').text()).toBe(
      'Friends who join through your link get 30 days of AGNT Pro free. Give a month, get a month.',
    );
  });

  it('leaves the invite out where it is shown on its own, and keeps the caller\'s own button in the row', async () => {
    await mountLinks({ invite: false, compact: true });
    expect(wrapper.find('[data-action="copy-invite"]').exists()).toBe(false);
    expect(wrapper.find('[data-action="star-github"]').text()).toContain('Star');
    expect(wrapper.find('[data-action="star-github"]').text()).not.toContain('GitHub');
    expect(wrapper.find('.gbl-actions .slotted').exists()).toBe(true);
  });

  it('attaches nothing to a follow or a star', async () => {
    await mountLinks({ terms: true });
    expect(wrapper.text()).not.toMatch(/credit|\$|unlock|earn \d/i);
  });
});
