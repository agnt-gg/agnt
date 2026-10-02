/**
 * The Focused frame's contract with the rest of the app:
 *   - every screen under it can tell it is in Focused (provide/inject);
 *   - the page comes from the ROUTE, so any link (chat, Ctrl+K, entity chips,
 *     Back) lands on Focused's own page — never on a Studio screen it has;
 *   - only a Studio-only screen renders as borrowed Studio, with a way back;
 *   - pages navigate through one injected service, by real routes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, inject, ref, reactive } from 'vue';

const dispatch = vi.fn();
const storeState = reactive({ chat: { savedOutputTitle: '', savedOutputId: null } });
// mapState/mapActions: options-API components the pages import (UpgradeModal)
// call them at module load, even though the pages are stubbed here.
vi.mock('vuex', () => ({ useStore: () => ({ dispatch, getters: {}, state: storeState }), mapState: () => ({}), mapActions: () => ({}) }));
const push = vi.fn(() => Promise.resolve());
const route = reactive({ query: {} });
vi.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => route }));
// The onion is covered by its own specs; here it only has to exist.
const fresh = ref([]);
vi.mock('@/composables/useNavigationOnion.js', () => ({
  useNavigationOnion: () => ({ state: { get value() { return { fresh: fresh.value }; } } }),
}));

// The Main chat: a known id, and opening it only navigates (the load that
// makes it the active conversation is what the test controls).
const mainChatId = ref('main-1');
const openMainChat = vi.fn(() => Promise.resolve());
vi.mock('@/composables/useMainChat.js', () => ({
  useMainChat: () => ({ mainChatId, openMainChat, clearMainChat: vi.fn(() => Promise.resolve(false)) }),
}));

import FocusedShell from './FocusedShell.vue';

const Probe = defineComponent({
  setup() {
    const presentation = inject('uiPresentation', 'studio');
    return () => h('div', { class: 'probe' }, presentation);
  },
});
const stub = (name) => ({ name, props: ['location', 'item', 'isNew'], template: `<div class="${name}" />` });

let nav;
const NavGrabber = defineComponent({
  setup() {
    nav = inject('focusedNav');
    return () => null;
  },
});

function mountShell(screenName = 'ChatScreen', query = {}) {
  route.query = query;
  return mount(FocusedShell, {
    props: { screenName },
    slots: { default: () => [h(Probe), h(NavGrabber)] },
    global: {
      provide: { isMobile: ref(false) },
      stubs: {
        FocusedSidebar: { template: '<aside class="sidebar-stub" />' },
        FocusedLibrary: stub('FocusedLibrary'),
        FocusedPlugins: stub('FocusedPlugins'),
        FocusedScheduled: stub('FocusedScheduled'),
        FocusedMemory: stub('FocusedMemory'),
        FocusedSettings: stub('FocusedSettings'),
        SimpleModal: { template: '<div />', methods: { showModal: () => Promise.resolve(true) } },
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
    storeState.chat.savedOutputId = null;
    openMainChat.mockClear();
    localStorage.clear();
  });

  it('regression: the chat seed waits for the Main chat to be the open conversation', async () => {
    // The composer's draft is keyed by conversation and reloaded on a switch.
    // Seeding before the Main chat is active filed the text under the chat
    // being left, and the switch then replaced it: the prefix never showed.
    storeState.chat.savedOutputId = 'some-other-chat';
    const seen = vi.fn();
    window.addEventListener('agnt:ask-annie', seen);
    const w = mountShell('AgentsScreen');
    const asking = nav.ask('Create an agent that ');
    await new Promise((r) => setTimeout(r, 150));
    expect(openMainChat).toHaveBeenCalledTimes(1);
    expect(seen).not.toHaveBeenCalled();

    storeState.chat.savedOutputId = 'main-1';
    await asking;
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].detail).toEqual({ text: 'Create an agent that ', send: false });
    window.removeEventListener('agnt:ask-annie', seen);
    w.unmount();
  });

  it('seeds at once when the Main chat is already open', async () => {
    storeState.chat.savedOutputId = 'main-1';
    const seen = vi.fn();
    window.addEventListener('agnt:ask-annie', seen);
    const w = mountShell('ConnectorsScreen');
    await nav.ask('Edit the Gmail plugin to ');
    expect(seen.mock.calls[0][0].detail.text).toBe('Edit the Gmail plugin to ');
    window.removeEventListener('agnt:ask-annie', seen);
    w.unmount();
  });

  it('tells every screen under it that it is in Focused', () => {
    const w = mountShell();
    expect(w.find('.probe').text()).toBe('focused');
    w.unmount();
  });

  it('regression: opening a workflow shows Focused\u2019s editor, not Studio\u2019s Workflows page', () => {
    const w = mountShell('WorkflowForgeScreen', { id: 'w1' });
    expect(w.findComponent({ name: 'FocusedLibrary' }).props('location')).toMatchObject({ page: 'library', tab: 'workflows', item: 'w1' });
    expect(w.find('.focused-borrowed-bar').exists()).toBe(false);
    expect(w.find('.focused-screen').isVisible()).toBe(false); // Chat stays mounted underneath
    w.unmount();
  });

  it.each([
    ['AgentsScreen', { select: 'agent:a1' }, 'FocusedLibrary'],
    ['ConnectorsScreen', {}, 'FocusedPlugins'],
    ['AutonomyScreen', { section: 'schedules' }, 'FocusedScheduled'],
    ['MemoryScreen', {}, 'FocusedMemory'],
    ['SettingsScreen', {}, 'FocusedSettings'],
  ])('%s %j renders %s', (screen, query, page) => {
    const w = mountShell(screen, query);
    expect(w.findComponent({ name: page }).exists()).toBe(true);
    expect(w.find('.focused-borrowed-bar').exists()).toBe(false);
    w.unmount();
  });

  it('a Studio-only screen is borrowed, with a way back to the chat', async () => {
    const w = mountShell('TracesScreen');
    const bar = w.find('.focused-borrowed-bar');
    expect(bar.exists()).toBe(true);
    await bar.find('.focused-back').trigger('click');
    expect(push).toHaveBeenCalledWith('/chat');
    w.unmount();
  });

  it('?studio=1 shows the full Studio screen even where Focused has a page', () => {
    const w = mountShell('WorkflowForgeScreen', { id: 'w1', studio: '1' });
    expect(w.find('.focused-borrowed-bar').exists()).toBe(true);
    expect(w.findComponent({ name: 'FocusedLibrary' }).exists()).toBe(false);
    w.unmount();
  });

  it('pages navigate by real routes through the injected service', () => {
    const w = mountShell();
    nav.go({ page: 'library', tab: 'workflows', item: 'w 2' });
    expect(push).toHaveBeenLastCalledWith({ path: '/workflows', query: { select: 'workflow:w 2' } });
    nav.go({ page: 'scheduled', isNew: true });
    expect(push).toHaveBeenLastCalledWith({ path: '/autonomy', query: { section: 'schedules', new: '1' } });
    nav.studio('WorkflowForgeScreen', { workflowId: 'w3' });
    expect(push).toHaveBeenLastCalledWith({ path: '/workflow-forge', query: { id: 'w3', studio: '1' } });
    w.unmount();
  });

  it('"Open in Studio" switches the mode', async () => {
    const w = mountShell('TracesScreen');
    await w.find('.focused-borrowed-bar .focused-link').trigger('click');
    expect(dispatch).toHaveBeenCalledWith('theme/setUiMode', 'studio');
    w.unmount();
  });

  it('shows the open conversation title only on Chat', async () => {
    const w = mountShell('ChatScreen');
    expect(w.find('.focused-chat-title').exists()).toBe(false);
    storeState.chat.savedOutputTitle = 'Q3 board report';
    await w.vm.$nextTick();
    expect(w.find('.focused-chat-title').text()).toBe('Q3 board report');
    w.unmount();
    const lib = mountShell('AgentsScreen');
    expect(lib.find('.focused-chat-title').exists()).toBe(false);
    lib.unmount();
  });

  it('mounts the Jump palette and opens it with Ctrl+K; stops listening once unmounted', () => {
    const w = mountShell();
    expect(w.findComponent({ name: 'JumpPalette' }).exists()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    expect(dispatch).toHaveBeenCalledWith('shell/toggleJump');
    w.unmount();
    dispatch.mockClear();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does NOT offer Studio for an unlock left over from before Focused opened', () => {
    fresh.value = ['workflows'];
    const w = mountShell();
    expect(w.find('.focused-graduation').exists()).toBe(false);
    w.unmount();
  });

  it('offers Studio once, when something is first built while in Focused', async () => {
    const w = mountShell();
    fresh.value = ['agents'];
    await w.vm.$nextTick();
    expect(w.find('.focused-graduation').text()).toContain('Your first agent is ready.');
    await w.find('.focused-graduation .focused-link').trigger('click');
    expect(w.find('.focused-graduation').exists()).toBe(false);
    expect(localStorage.getItem('agnt:focused-graduation-asked')).toBe('true');
    w.unmount();
  });
});
