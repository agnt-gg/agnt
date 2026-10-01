/**
 * The Focused frame's contract with the rest of the app:
 *   - every screen under it can tell it is in Focused (provide/inject);
 *   - Chat is Focused's own, every other screen is borrowed Studio with a way back;
 *   - Ctrl+K opens the same Jump palette Studio has, so every screen stays
 *     reachable (jumpCatalog.spec.js proves the palette lists them all);
 *   - nothing here talks to the API (focusedDrift.spec.js).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, inject, ref, reactive } from 'vue';

const dispatch = vi.fn();
const storeState = reactive({ chat: { savedOutputTitle: '' } });
vi.mock('vuex', () => ({ useStore: () => ({ dispatch, getters: {}, state: storeState }) }));
const push = vi.fn(() => Promise.resolve());
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));
// The onion is covered by its own specs; here it only has to exist.
const fresh = ref([]);
vi.mock('@/composables/useNavigationOnion.js', () => ({
  useNavigationOnion: () => ({ state: { get value() { return { fresh: fresh.value }; } } }),
}));

import FocusedShell from './FocusedShell.vue';

const Probe = defineComponent({
  setup() {
    const presentation = inject('uiPresentation', 'studio');
    return () => h('div', { class: 'probe' }, presentation);
  },
});

function mountShell(screenName = 'ChatScreen') {
  return mount(FocusedShell, {
    props: { screenName },
    slots: { default: () => h(Probe) },
    global: {
      provide: { isMobile: ref(false) },
      stubs: {
        FocusedSidebar: { template: '<aside class="sidebar-stub" />' },
        FocusedLibrary: true,
        FocusedPlugins: true,
        FocusedScheduled: true,
        JumpPalette: { name: 'JumpPalette', template: '<div class="jump-stub" />' },
      },
      directives: { tooltip: {} },
    },
    attachTo: document.body,
  });
}

describe('FocusedShell', () => {
  beforeEach(() => {
    dispatch.mockClear();
    push.mockClear();
    fresh.value = [];
    storeState.chat.savedOutputTitle = '';
    localStorage.clear();
  });

  it('tells every screen under it that it is in Focused', () => {
    const w = mountShell();
    expect(w.find('.probe').text()).toBe('focused');
    w.unmount();
  });

  it('renders Chat bare — no borrowed bar', () => {
    const w = mountShell('ChatScreen');
    expect(w.find('.focused-borrowed-bar').exists()).toBe(false);
    w.unmount();
  });

  it('frames any other screen as borrowed Studio, with a way back', async () => {
    const w = mountShell('WorkflowForgeScreen');
    const bar = w.find('.focused-borrowed-bar');
    expect(bar.exists()).toBe(true);
    await bar.find('.focused-back').trigger('click');
    expect(w.emitted('screen-change')[0]).toEqual(['ChatScreen', {}]);
    w.unmount();
  });

  it('"Open in Studio" switches the mode and stays on the screen', async () => {
    const w = mountShell('AgentsScreen');
    await w.find('.focused-borrowed-bar .focused-link').trigger('click');
    expect(dispatch).toHaveBeenCalledWith('theme/setUiMode', 'studio');
    expect(w.emitted('screen-change')).toBeUndefined();
    w.unmount();
  });

  it('mounts the Jump palette and opens it with Ctrl+K, so every screen is one search away', () => {
    const w = mountShell();
    expect(w.findComponent({ name: 'JumpPalette' }).exists()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    expect(dispatch).toHaveBeenCalledWith('shell/toggleJump');
    w.unmount();
  });

  it('stops listening for Ctrl+K once unmounted (no leaked handler)', () => {
    const w = mountShell();
    w.unmount();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does NOT offer Studio for an unlock left over from before Focused opened', () => {
    // Regression: an account with 196 workflows had 'workflows' in the onion's
    // persisted `fresh` from Studio and was told "Your first workflow is saved".
    fresh.value = ['workflows'];
    const w = mountShell();
    expect(w.find('.focused-graduation').exists()).toBe(false);
    w.unmount();
  });

  it('offers Studio once, when something is first built while in Focused, and remembers the answer', async () => {
    fresh.value = ['workflows']; // stale, from before
    const w = mountShell();
    expect(w.find('.focused-graduation').exists()).toBe(false);
    fresh.value = ['workflows', 'agents']; // first agent, built here
    await w.vm.$nextTick();
    expect(w.find('.focused-graduation').text()).toContain('Your first agent is ready.');
    await w.find('.focused-graduation .focused-link').trigger('click');
    expect(w.find('.focused-graduation').exists()).toBe(false);
    expect(localStorage.getItem('agnt:focused-graduation-asked')).toBe('true');
    w.unmount();
    fresh.value = [];
    const w2 = mountShell();
    fresh.value = ['workflows'];
    await w2.vm.$nextTick();
    expect(w2.find('.focused-graduation').exists()).toBe(false); // asked once, ever
    w2.unmount();
  });

  it('shows the open conversation title in a slim bar, and none on a new chat', async () => {
    const w = mountShell('ChatScreen');
    expect(w.find('.focused-chat-title').exists()).toBe(false);
    storeState.chat.savedOutputTitle = 'Q3 board report';
    await w.vm.$nextTick();
    expect(w.find('.focused-chat-title').text()).toBe('Q3 board report');
    w.unmount();
    const other = mountShell('AgentsScreen');
    expect(other.find('.focused-chat-title').exists()).toBe(false); // only on Chat
    other.unmount();
  });
});
