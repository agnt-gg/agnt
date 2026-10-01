/**
 * The inline browser card opens a browser on the live turn, and never shows a
 * dead pane.
 *
 * It used to mount with launch=false always: whenever no browser was
 * registered (the tool failed first, the backend restarted, a separate window
 * was used) it sat on "No browser is open yet. Waiting for one…" forever.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

const seen = vi.hoisted(() => ({ props: null, emit: null, setups: 0 }));

vi.mock('@/utils/chunkRecovery.js', () => ({
  lazyComponent: () => defineComponent({
    props: { launch: Boolean },
    emits: ['page', 'showing'],
    setup(props, { emit }) {
      seen.props = props; seen.emit = emit; seen.setups += 1;
      return () => h('div', { class: 'stream-stub' });
    },
  }),
}));

const { default: BrowserLiveCard } = await import('./BrowserLiveCard.vue');
const { _resetLiveRegistry } = await import('./browserLiveRegistry.js');

let wrapper;
afterEach(() => { wrapper?.unmount(); wrapper = null; _resetLiveRegistry(); document.body.innerHTML = ''; });

// v-show writes display:none inline; read it directly (isVisible() depends on
// the element being attached to a document, which a mounted wrapper is not).
const hidden = () => /display:\s*none/.test(wrapper.find('.browser-live-card').attributes('style') || '');

const mountCard = async (live) => {
  wrapper = mount(BrowserLiveCard, {
    props: { cardKey: `m-${Math.random()}`, order: Date.now(), live },
    global: { directives: { tooltip: {} } },
    // Attached, so a teleported card is still findable in the real DOM.
    attachTo: document.body.appendChild(document.createElement('div')),
  });
  await flushPromises();
};

describe('the live turn', () => {
  it('may open a browser, and is shown straight away', async () => {
    await mountCard(true);
    expect(seen.props.launch).toBe(true);
    expect(hidden()).toBe(false);
  });
});

describe('an old message being re-read', () => {
  it('never opens a browser', async () => {
    await mountCard(false);
    expect(seen.props.launch).toBe(false);
  });

  it('shows nothing until real pixels arrive, then shows them', async () => {
    await mountCard(false);
    expect(hidden()).toBe(true);
    // Still mounted, so it can pick up a browser that opens later.
    expect(wrapper.find('.stream-stub').exists()).toBe(true);
    seen.emit('showing', true); await flushPromises();
    expect(hidden()).toBe(false);
  });
});

describe('fullscreen', () => {
  const card = () => document.body.querySelector('.browser-live-card');
  const toggle = () => card().querySelector('.live-fullscreen').click();
  const isFullscreen = () => card().classList.contains('is-fullscreen');

  it('moves the SAME live view to the whole window, and back', async () => {
    await mountCard(true);
    const before = seen.setups;

    await toggle(); await flushPromises();
    // Teleported to <body>, covering the window.
    expect(card()?.parentElement).toBe(document.body);
    expect(card().classList.contains('is-fullscreen')).toBe(true);
    expect(card().getAttribute('role')).toBe('dialog');

    await toggle(); await flushPromises();
    expect(isFullscreen()).toBe(false);
    expect(card().parentElement).not.toBe(document.body);
    // No remount either way: a new stream view would drop the lease and the
    // page state the user was in the middle of.
    expect(seen.setups).toBe(before);
  });

  it('leaves on Escape', async () => {
    await mountCard(true);
    await toggle(); await flushPromises();
    expect(isFullscreen()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(isFullscreen()).toBe(false);
  });

  it('shows the page even if the card was collapsed', async () => {
    await mountCard(true);
    card().querySelector('.live-header').click(); await flushPromises();
    expect(card().querySelector('.stream-stub')).toBeNull();
    await toggle(); await flushPromises();
    expect(card().querySelector('.stream-stub')).not.toBeNull();
  });
});

describe('focus', () => {
  it('marks the page area as keeping focus, so the chat input cannot steal typing', async () => {
    await mountCard(true);
    expect(wrapper.find('.live-body').attributes()).toHaveProperty('data-keeps-focus');
  });
});
