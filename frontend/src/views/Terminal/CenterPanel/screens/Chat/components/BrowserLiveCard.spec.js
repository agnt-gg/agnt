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

const seen = vi.hoisted(() => ({ props: null, emit: null }));

vi.mock('@/utils/chunkRecovery.js', () => ({
  lazyComponent: () => defineComponent({
    props: { launch: Boolean },
    emits: ['page', 'showing'],
    setup(props, { emit }) {
      seen.props = props; seen.emit = emit;
      return () => h('div', { class: 'stream-stub' });
    },
  }),
}));

const { default: BrowserLiveCard } = await import('./BrowserLiveCard.vue');
const { _resetLiveRegistry } = await import('./browserLiveRegistry.js');

let wrapper;
afterEach(() => { wrapper?.unmount(); wrapper = null; _resetLiveRegistry(); });

// v-show writes display:none inline; read it directly (isVisible() depends on
// the element being attached to a document, which a mounted wrapper is not).
const hidden = () => /display:\s*none/.test(wrapper.find('.browser-live-card').attributes('style') || '');

const mountCard = async (live) => {
  wrapper = mount(BrowserLiveCard, { props: { cardKey: `m-${Math.random()}`, order: Date.now(), live } });
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
