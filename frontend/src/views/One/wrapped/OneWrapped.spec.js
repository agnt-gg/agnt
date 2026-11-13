/**
 * The year in review's door in AGNT One: a capsule in the top bar in season,
 * open() from More at any time, and a load that fails, comes back empty or
 * arrives late, each handled.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const { getYearInReview } = vi.hoisted(() => ({ getYearInReview: vi.fn() }));
vi.mock('@/services/wrappedService.js', () => ({ getYearInReview }));
vi.mock('@/services/agntFlash.js', () => ({ openExternal: vi.fn() }));
vi.mock('vuex', () => ({ useStore: () => ({ getters: { 'userAuth/userEmail': 'me@agnt.test' }, state: {} }) }));

import OneWrapped from './OneWrapped.vue';
import WrappedStory from './WrappedStory.vue';
import { seenKey } from './wrappedModel.js';
import { yearFixture } from './wrapped.fixture.js';

function mountOn(date) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(date);
  return mount(OneWrapped, { attachTo: document.body });
}
const story = (w) => w.findComponent(WrappedStory);

afterEach(() => {
  vi.useRealTimers();
  getYearInReview.mockReset();
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('OneWrapped', () => {
  it('out of season there is no capsule, and open() shows the year so far', async () => {
    getYearInReview.mockResolvedValue(yearFixture());
    const w = mountOn(new Date(2026, 10, 13, 15));
    expect(w.find('[data-testid="one-wrapped-capsule"]').exists()).toBe(false);
    w.vm.open();
    await flushPromises();
    expect(getYearInReview).toHaveBeenCalledWith(2026);
    expect(story(w).exists()).toBe(true);
    expect(story(w).find('.wr-card.is-active').attributes('data-card')).toBe('intro');
    // Out of season the capsule's "New" is not used up.
    expect(localStorage.getItem(seenKey('me@agnt.test'))).toBe(null);
    w.unmount();
  });

  it('in season the capsule says New until the year is opened, then remembers it', async () => {
    getYearInReview.mockResolvedValue(yearFixture());
    const w = mountOn(new Date(2026, 11, 5, 9));
    const capsule = w.find('[data-testid="one-wrapped-capsule"]');
    expect(capsule.text()).toContain('Your 2026, wrapped');
    expect(capsule.text()).toContain('New');
    await capsule.trigger('click');
    await flushPromises();
    expect(getYearInReview).toHaveBeenCalledWith(2026);
    expect(story(w).exists()).toBe(true);
    expect(w.find('[data-testid="one-wrapped-capsule"]').text()).not.toContain('New');
    expect(JSON.parse(localStorage.getItem(seenKey('me@agnt.test')))).toEqual([2026]);
    w.unmount();
  });

  it('in January the capsule is still last year\'s', async () => {
    getYearInReview.mockResolvedValue(yearFixture());
    const w = mountOn(new Date(2027, 0, 10, 9));
    expect(w.find('[data-testid="one-wrapped-capsule"]').text()).toContain('Your 2026, wrapped');
    await w.find('[data-testid="one-wrapped-capsule"]').trigger('click');
    await flushPromises();
    expect(getYearInReview).toHaveBeenCalledWith(2026);
    w.unmount();
  });

  it('a failed load says why, and Try again loads it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getYearInReview.mockRejectedValueOnce({ response: { data: { error: 'The ledger is busy.' } } }).mockResolvedValueOnce(yearFixture());
    const w = mountOn(new Date(2026, 10, 13));
    w.vm.open();
    await flushPromises();
    expect(story(w).find('.wr-state').text()).toContain('The ledger is busy.');
    await story(w).find('[data-action="retry"]').trigger('click');
    await flushPromises();
    expect(getYearInReview).toHaveBeenCalledTimes(2);
    expect(story(w).find('.wr-card.is-active').attributes('data-card')).toBe('intro');
    warn.mockRestore();
    w.unmount();
  });

  it('a year with too little in it says so, instead of showing zeros', async () => {
    getYearInReview.mockResolvedValue(yearFixture({ days: yearFixture().days.slice(0, 3) }));
    const w = mountOn(new Date(2026, 10, 13));
    w.vm.open();
    await flushPromises();
    expect(story(w).find('.wr-state').text()).toContain('Your 2026 is just getting started.');
    w.unmount();
  });

  it('closing removes the cards, and a load that lands after closing is dropped', async () => {
    let finish;
    getYearInReview.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const w = mountOn(new Date(2026, 10, 13));
    w.vm.open();
    await flushPromises();
    expect(story(w).find('.wr-state').text()).toContain('Counting your 2026…');
    await story(w).find('[data-action="close"]').trigger('click');
    expect(story(w).exists()).toBe(false);
    finish(yearFixture());
    await flushPromises();
    expect(story(w).exists()).toBe(false);
    w.unmount();
  });
});
