/**
 * The inline browser card WATCHES; it never opens a browser, and never shows
 * a dead pane.
 *
 * History: it first mounted launch=false and visible, so with no browser it sat
 * on "No browser is open yet. Waiting for one…" forever. The fix for that was
 * to launch on the live turn — which opened browsers for turns that never had a
 * page (a script, a refused navigate) and showed them empty (trace c59eb9e9,
 * 2026-10-06). The fix that holds both ways: never launch, and stay hidden
 * until there are real pixels.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h, KeepAlive, shallowRef } from 'vue';

const seen = vi.hoisted(() => ({ props: null, emit: null, setups: 0 }));

vi.mock('@/utils/chunkRecovery.js', () => ({
  lazyComponent: () => defineComponent({
    props: { launch: Boolean, highQuality: Boolean, conversationId: String },
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

// The app's screen box, as CanvasScreen renders it. Fullscreen must fill THIS,
// never the window — the top bar and sidebar live outside it.
const makeHost = () => {
  const host = document.body.appendChild(document.createElement('div'));
  host.setAttribute('data-fullscreen-host', '');
  return host;
};

const mountCard = async (extra = {}, { host = makeHost() } = {}) => {
  wrapper = mount(BrowserLiveCard, {
    props: { cardKey: `m-${Math.random()}`, order: Date.now(), ...extra },
    global: { directives: { tooltip: {} } },
    // Attached inside the host, as the chat transcript is, so a teleported
    // card is still findable in the real DOM.
    attachTo: (host || document.body).appendChild(document.createElement('div')),
  });
  await flushPromises();
};

describe('a watcher, never a launcher', () => {
  it('never opens a browser, on the live turn or any other', async () => {
    await mountCard();
    expect(seen.props.launch).toBe(false);
  });

  it('shows nothing until real pixels arrive, then shows them', async () => {
    await mountCard();
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

  it('moves the SAME live view into the screen box, and back', async () => {
    await mountCard();
    const host = document.querySelector('[data-fullscreen-host]');
    const before = seen.setups;

    await toggle(); await flushPromises();
    // A direct child of the screen box: below the top bar and beside the
    // sidebar by construction, never a window-wide layer on <body>.
    expect(card()?.parentElement).toBe(host);
    expect(card().classList.contains('is-fullscreen')).toBe(true);
    expect(card().classList.contains('is-window-fullscreen')).toBe(false);
    expect(card().getAttribute('role')).toBe('dialog');

    await toggle(); await flushPromises();
    expect(isFullscreen()).toBe(false);
    expect(card().parentElement).not.toBe(host);
    // No remount either way: a new stream view would drop the lease and the
    // page state the user was in the middle of.
    expect(seen.setups).toBe(before);
  });

  it('stays inline when its surface has no fullscreen host, never covering app chrome', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await mountCard({}, { host: null });
      const parent = card().parentElement;
      await toggle(); await flushPromises();
      expect(isFullscreen()).toBe(false);
      expect(card().parentElement).toBe(parent);
      expect(card().parentElement).not.toBe(document.body);
      expect(seen.props.highQuality).toBe(false);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('fullscreen host'));
    } finally { warning.mockRestore(); }
  });

  it('leaves on Escape even when the page has focus and swallows the key', async () => {
    await mountCard();
    await toggle(); await flushPromises();
    // The real stream canvas forwards keys with @keydown.stop, so a bubbling
    // window listener never hears them. This was the trap.
    const page = card().querySelector('.stream-stub');
    page.addEventListener('keydown', (event) => event.stopPropagation());
    page.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();
    expect(isFullscreen()).toBe(false);
  });

  it('leaves fullscreen when the user navigates away from chat (KeepAlive)', async () => {
    // Chat is cached by <KeepAlive>; deactivation does not move teleported
    // content, so a fullscreen card used to stay on top of the next screen.
    const Other = defineComponent({ render: () => h('div', { class: 'other-screen' }) });
    const current = shallowRef(BrowserLiveCard);
    const host = makeHost();
    wrapper = mount(defineComponent({
      render: () => h(KeepAlive, null, [h(current.value, { cardKey: 'k-alive', order: Date.now() })]),
    }), {
      global: { directives: { tooltip: {} } },
      attachTo: host.appendChild(document.createElement('div')),
    });
    await flushPromises();
    await toggle(); await flushPromises();
    expect(card()?.parentElement).toBe(host);

    current.value = Other; await flushPromises();
    // Nothing left covering the screen the user went to.
    expect(document.querySelector('.browser-live-card.is-fullscreen')).toBeNull();
  });

  it('asks for full-resolution frames only while fullscreen', async () => {
    await mountCard();
    expect(seen.props.highQuality).toBe(false);
    await toggle(); await flushPromises();
    expect(seen.props.highQuality).toBe(true);
    await toggle(); await flushPromises();
    expect(seen.props.highQuality).toBe(false);
  });

  it('leaves on Escape', async () => {
    await mountCard();
    await toggle(); await flushPromises();
    expect(isFullscreen()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(isFullscreen()).toBe(false);
  });

  it('shows the page even if the card was collapsed', async () => {
    await mountCard();
    card().querySelector('.live-header').click(); await flushPromises();
    expect(card().querySelector('.stream-stub')).toBeNull();
    await toggle(); await flushPromises();
    expect(card().querySelector('.stream-stub')).not.toBeNull();
  });
});

describe('focus', () => {
  it('marks the page area as keeping focus, so the chat input cannot steal typing', async () => {
    await mountCard();
    expect(wrapper.find('.live-body').attributes()).toHaveProperty('data-keeps-focus');
  });
});

describe('its own conversation', () => {
  it('asks for its conversation\'s browser', async () => {
    await mountCard({ conversationId: 'conv-7' });
    expect(seen.props.conversationId).toBe('conv-7');
  });

  it('two conversations\' cards both stream, each its own', async () => {
    const { claimLiveView, ownsLiveView } = await import('./browserLiveRegistry.js');
    // Another conversation's newer card is already on screen.
    claimLiveView('other', Date.now() + 100000, 'conv-other');
    await mountCard({ conversationId: 'conv-7' });
    expect(wrapper.find('.browser-live-card').exists()).toBe(true);
    expect(ownsLiveView('other')).toBe(true);
  });
});
