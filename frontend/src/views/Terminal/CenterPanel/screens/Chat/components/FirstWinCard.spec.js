/**
 * The thank-you under the first finished task: a receipt, one ask, "Not now".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const fetchFlashAccount = vi.fn();
vi.mock('@/services/agntFlash.js', async (original) => ({ ...(await original()), fetchFlashAccount: (...a) => fetchFlashAccount(...a) }));
// The give-back row has its own spec.
vi.mock('@/views/_components/feature/GiveBackLinks.vue', () => ({
  default: {
    name: 'GiveBackLinks',
    props: { compact: Boolean, invite: { type: Boolean, default: true }, terms: Boolean },
    template: '<div class="give-back-stub"><slot /></div>',
  },
}));

import FirstWinCard from './FirstWinCard.vue';

let wrapper;
async function mountCard(claim) {
  wrapper = mount(FirstWinCard, { props: { claim: { messageId: 'm1', dismissed: false, ...claim } } });
  await flushPromises();
  return wrapper;
}

// A block, not an expression: a function returned from beforeEach runs as
// the test's cleanup, and mockReset() returns the mock itself.
beforeEach(() => {
  fetchFlashAccount.mockReset();
});
afterEach(() => wrapper?.unmount());

describe('FirstWinCard', () => {
  it("thanks a new account's first task, with what it ran on", async () => {
    await mountCard({ firstTask: true, ranOn: { kind: 'plan', label: 'ChatGPT' } });
    expect(wrapper.find('.first-win-line').text()).toBe('First task, done. It ran on your ChatGPT plan, at no extra charge.');
    expect(fetchFlashAccount).not.toHaveBeenCalled();
  });

  it('never calls an established account\'s task its first', async () => {
    await mountCard({ firstTask: false, ranOn: { kind: 'other', label: 'OpenAI' } });
    expect(wrapper.find('.first-win-line').text()).toBe('Done. It ran on OpenAI.');
  });

  it('on the free credits, says how much of them is used, never a count', async () => {
    fetchFlashAccount.mockResolvedValue({ trial: true, includedCredits: 1_000_000, usedCredits: 40_000, remainingCredits: 960_000 });
    await mountCard({ firstTask: true, ranOn: { kind: 'flash' } });
    expect(wrapper.find('.first-win-line').text()).toBe("First task, done. It ran on your free AGNT Flash credits, and you've used about 4% of them.");
  });

  it('still names AGNT Flash when the account cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchFlashAccount.mockRejectedValue(new Error('offline'));
    await mountCard({ firstTask: true, ranOn: { kind: 'flash' } });
    expect(wrapper.find('.first-win-line').text()).toBe('First task, done. It ran on AGNT Flash.');
    warn.mockRestore();
  });

  it('asks once, in small buttons, and "Not now" says so', async () => {
    await mountCard({ firstTask: true, ranOn: null });
    expect(wrapper.findComponent({ name: 'GiveBackLinks' }).props('compact')).toBe(true);
    expect(wrapper.find('.first-win-ask').text()).toBe('If that saved you some time, a follow or a star tells us to keep going.');
    await wrapper.find('[data-action="first-win-later"]').trigger('click');
    expect(wrapper.emitted('dismiss')).toHaveLength(1);
  });

  it('offers nothing in exchange for the ask', async () => {
    await mountCard({ firstTask: true, ranOn: { kind: 'plan', label: 'Claude' } });
    expect(wrapper.find('.first-win-ask').text()).not.toMatch(/credit|\$|free/i);
  });
});
