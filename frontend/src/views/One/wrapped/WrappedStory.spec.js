/**
 * The year in review as a story: a card at a time, each on its own clock; tap,
 * hold, keys and buttons to move; a share sheet; and honest loading, empty and
 * error states.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn() }));
vi.mock('@/services/agntFlash.js', () => ({ openExternal }));
vi.mock('./wrappedShare.js', async (importOriginal) => ({
  ...(await importOriginal()),
  saveShareImage: vi.fn(async () => 'agnt-2026-wrapped.png'),
  copyShareImage: vi.fn(async () => {}),
}));

import WrappedStory from './WrappedStory.vue';
import { copyShareImage } from './wrappedShare.js';
import { yearFixture } from './wrapped.fixture.js';

const CLOCK = { toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] };
const mountStory = (props = {}) => mount(WrappedStory, { props: { year: 2026, status: 'ready', data: yearFixture(), ...props }, attachTo: document.body });
const activeCard = (w) => w.find('.wr-card.is-active').attributes('data-card');
const press = async (w, clientX) => {
  await w.find('.wr-cards').trigger('pointerdown', { button: 0, clientX });
};
const release = () => window.dispatchEvent(new Event('pointerup'));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  openExternal.mockClear();
  document.body.innerHTML = '';
});

describe('WrappedStory', () => {
  it('opens on the first card, as a modal dialog with a progress bar per card', () => {
    const w = mountStory();
    expect(activeCard(w)).toBe('intro');
    expect(w.findAll('.wr-bar')).toHaveLength(11);
    const dialog = w.find('[role="dialog"]');
    expect(dialog.attributes('aria-modal')).toBe('true');
    expect(dialog.attributes('aria-label')).toBe('Your 2026 in AGNT');
    expect(w.find('[aria-live="polite"]').text()).toBe('1 of 11. 2026, wrapped.');
    // Only the card on screen can be read or reached.
    expect(w.findAll('.wr-card[aria-hidden="false"]')).toHaveLength(1);
    expect(w.findAll('.wr-card[inert]')).toHaveLength(10);
    w.unmount();
  });

  it('next and previous move one card, and stop at the ends', async () => {
    const w = mountStory();
    expect(w.find('[data-action="prev"]').attributes('disabled')).toBeDefined();
    await w.find('[data-action="next"]').trigger('click');
    expect(activeCard(w)).toBe('streak');
    await w.find('[data-action="prev"]').trigger('click');
    expect(activeCard(w)).toBe('intro');
    w.vm.go(99);
    await flushPromises();
    expect(activeCard(w)).toBe('summary');
    expect(w.find('[data-action="next"]').attributes('disabled')).toBeDefined();
    w.unmount();
  });

  it('arrow keys move; Escape closes', async () => {
    const w = mountStory();
    await w.find('.one-wrapped').trigger('keydown', { key: 'ArrowRight' });
    expect(activeCard(w)).toBe('streak');
    await w.find('.one-wrapped').trigger('keydown', { key: 'ArrowLeft' });
    expect(activeCard(w)).toBe('intro');
    await w.find('.one-wrapped').trigger('keydown', { key: 'Escape' });
    expect(w.emitted('close')).toHaveLength(1);
    w.unmount();
  });

  it('a tap on the right two thirds goes on; on the left third, back', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 300, bottom: 533, width: 300, height: 533, x: 0, y: 0, toJSON: () => ({}) });
    const w = mountStory();
    await press(w, 250);
    release();
    await flushPromises();
    expect(activeCard(w)).toBe('streak');
    await press(w, 60);
    release();
    await flushPromises();
    expect(activeCard(w)).toBe('intro');
    w.unmount();
  });

  it('holding pauses; letting go resumes, without moving', async () => {
    vi.useFakeTimers(CLOCK);
    const w = mountStory();
    await press(w, 250);
    vi.advanceTimersByTime(300);
    await flushPromises();
    expect(w.find('.wr-story').classes()).toContain('is-paused');
    release();
    await flushPromises();
    expect(w.find('.wr-story').classes()).not.toContain('is-paused');
    expect(activeCard(w)).toBe('intro');
    w.unmount();
  });

  it('each card keeps its own time, and the pause button stops the clock', async () => {
    vi.useFakeTimers(CLOCK);
    const w = mountStory();
    vi.advanceTimersByTime(5200);
    await flushPromises();
    expect(activeCard(w)).toBe('streak');
    await w.find('[data-action="pause"]').trigger('click');
    expect(w.find('[data-action="pause"]').attributes('aria-label')).toBe('Play');
    vi.advanceTimersByTime(20000);
    await flushPromises();
    expect(activeCard(w)).toBe('streak');
    await w.find('[data-action="pause"]').trigger('click');
    vi.advanceTimersByTime(8200);
    await flushPromises();
    expect(activeCard(w)).toBe('volume');
    w.unmount();
  });

  it('the last card waits for the reader, drops the share bar, and Watch again starts over', async () => {
    vi.useFakeTimers(CLOCK);
    const w = mountStory();
    w.vm.go(10);
    await flushPromises();
    expect(activeCard(w)).toBe('summary');
    expect(w.find('.wr-chrome-bottom').exists()).toBe(false);
    vi.advanceTimersByTime(60000);
    await flushPromises();
    expect(activeCard(w)).toBe('summary');
    await w.find('[data-action="replay"]').trigger('click');
    expect(activeCard(w)).toBe('intro');
    w.unmount();
  });

  it('Share opens the sheet over a paused story, private figures off; Done closes it', async () => {
    const w = mountStory();
    await w.find('.wr-chrome-bottom [data-action="share"]').trigger('click');
    expect(w.find('[data-testid="wrapped-share"]').exists()).toBe(true);
    expect(w.find('.wr-story').classes()).toContain('is-paused');
    const hide = w.find('[data-testid="wrapped-hide-private"]');
    expect(hide.attributes('role')).toBe('switch');
    expect(hide.attributes('aria-checked')).toBe('true');
    await w.find('[data-action="done"]').trigger('click');
    expect(w.find('[data-testid="wrapped-share"]').exists()).toBe(false);
    expect(w.find('.wr-story').classes()).not.toContain('is-paused');
    w.unmount();
  });

  it('Post to X leaves spend and goal names out unless they are turned on', async () => {
    const w = mountStory();
    await w.find('.wr-chrome-bottom [data-action="share"]').trigger('click');
    await w.find('[data-action="post"]').trigger('click');
    const first = decodeURIComponent(openExternal.mock.calls[0][0]);
    expect(first.startsWith('https://x.com/intent/post?text=')).toBe(true);
    expect(first).toContain('500-day streak');
    expect(first).toContain('59B tokens');
    expect(first).not.toContain('$');
    await w.find('[data-testid="wrapped-hide-private"]').trigger('click');
    expect(w.find('[data-testid="wrapped-hide-private"]').attributes('aria-checked')).toBe('false');
    await w.find('[data-action="post"]').trigger('click');
    expect(decodeURIComponent(openExternal.mock.calls[1][0])).toContain('$1.8K saved by caching');
    w.unmount();
  });

  it('saving and copying say what happened, including when copying is not possible', async () => {
    const w = mountStory();
    await w.find('.wr-chrome-bottom [data-action="share"]').trigger('click');
    await w.find('[data-action="save"]').trigger('click');
    await flushPromises();
    expect(w.find('.wr-sheet-status').text()).toBe('Saved agnt-2026-wrapped.png.');
    await w.find('[data-action="copy"]').trigger('click');
    await flushPromises();
    expect(w.find('.wr-sheet-status').text()).toBe('Image copied.');
    copyShareImage.mockRejectedValueOnce(new Error('Copying images is not available here. Save it instead.'));
    await w.find('[data-action="copy"]').trigger('click');
    await flushPromises();
    expect(w.find('.wr-sheet-status').text()).toBe('Copying images is not available here. Save it instead.');
    w.unmount();
  });

  it('with reduced motion, cards wait for the reader and there is nothing to pause', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    vi.useFakeTimers(CLOCK);
    const w = mountStory();
    vi.advanceTimersByTime(30000);
    await flushPromises();
    expect(activeCard(w)).toBe('intro');
    expect(w.find('[data-action="pause"]').exists()).toBe(false);
    w.unmount();
  });

  it.each([
    ['loading', '', 'Counting your 2026…'],
    ['empty', '', 'Your 2026 is just getting started.'],
    ['error', 'The server could not count this year.', 'The server could not count this year.'],
  ])('%s says what is happening, with no progress bars', (status, error, words) => {
    const w = mountStory({ status, data: null, error });
    expect(w.find('.wr-state').text()).toContain(words);
    expect(w.find('.wr-bars').exists()).toBe(false);
    expect(w.find('[data-action="pause"]').exists()).toBe(false);
    w.unmount();
  });

  it('an error offers to try again', async () => {
    const w = mountStory({ status: 'error', data: null, error: 'boom' });
    await w.find('[data-action="retry"]').trigger('click');
    expect(w.emitted('retry')).toHaveLength(1);
    w.unmount();
  });

  it('keeps focus inside: Tab from the last control returns to the first', async () => {
    const w = mountStory();
    const reachable = [...document.querySelectorAll('.one-wrapped button:not([disabled]), .one-wrapped input, .one-wrapped [tabindex="-1"]')].filter((el) => !el.closest('[inert]'));
    reachable.at(-1).focus();
    await w.find('.one-wrapped').trigger('keydown', { key: 'Tab' });
    expect(document.activeElement).toBe(reachable[0]);
    w.unmount();
  });
});
