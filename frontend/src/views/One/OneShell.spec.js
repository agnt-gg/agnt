/**
 * AGNT One's frame, and its contract with the rest of the app:
 *   - every screen under it can tell it is in One (provide/inject);
 *   - the page comes from the ROUTE, so any link (chat, Ctrl+K, entity chips,
 *     Back) lands on One's own page for it;
 *   - a screen with no page renders in full, with a way back to the chat;
 *   - pages navigate through one injected service, by real routes;
 *   - the rail shows only what the account has, and Chats opens the drawer;
 *   - the capsule's steps reach the chat (ask) or the model picker (Settings).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, inject, ref, reactive } from 'vue';

// Vuex's dispatch always returns a Promise.
const dispatch = vi.fn(() => Promise.resolve());
const storeState = reactive({
  chat: { savedOutputTitle: '', savedOutputId: null, activeConversationId: null, messages: [] },
  appAuth: { connectedApps: [] },
});
// mapState/mapActions: options-API components the pages import (UpgradeModal)
// call them at module load, even though the pages are stubbed here.
const getters = { 'contentOutputs/visibleOutputs': [], 'contentOutputs/outputs': [], 'contentOutputs/subChatIdSet': new Set(), 'chat/streamingOutputIds': new Set(), 'chat/speakingByOutputId': {}, 'agents/allAgents': [], 'schedules/allSchedules': [] };
vi.mock('vuex', () => ({ useStore: () => ({ dispatch, getters, state: storeState }), mapState: () => ({}), mapActions: () => ({}) }));
const push = vi.fn(() => Promise.resolve());
const replace = vi.fn(() => Promise.resolve());
const route = reactive({ query: {} });
vi.mock('vue-router', () => ({ useRouter: () => ({ push, replace }), useRoute: () => route }));

const mainChatId = ref('main-1');
const openMainChat = vi.fn(() => Promise.resolve());
vi.mock('@/composables/useMainChat.js', () => ({
  useMainChat: () => ({ mainChatId, openMainChat, clearMainChat: vi.fn(() => Promise.resolve(false)) }),
}));

// Children are replaced by MODULE: a name-based stub does not reach a
// component a <script setup> file imports directly, so the real pages (and the
// real Jump palette, with its own key listener) used to mount here.
const { page } = vi.hoisted(() => ({
  page: (name) => ({ default: { name, props: ['location', 'item', 'isNew', 'tab', 'section'], template: `<div class="${name}" />` } }),
}));
vi.mock('@/views/Focused/FocusedLibrary.vue', () => page('FocusedLibrary'));
vi.mock('@/views/Focused/FocusedConnectors.vue', () => page('FocusedConnectors'));
vi.mock('@/views/Focused/FocusedScheduled.vue', () => page('FocusedScheduled'));
vi.mock('@/views/Focused/FocusedMemory.vue', () => page('FocusedMemory'));
vi.mock('@/views/Focused/FocusedSettings.vue', () => page('FocusedSettings'));
vi.mock('@/views/Focused/FocusedMarket.vue', () => page('FocusedMarket'));
vi.mock('@/views/Focused/FocusedSidebar.vue', () => ({
  default: { name: 'FocusedSidebar', props: ['open', 'activePage', 'onChat', 'navigation'], emits: ['close', 'new-chat'], template: '<aside class="sidebar-stub" :data-navigation="String(navigation)" @click="$emit(\'close\')"><button class="stub-new-chat" @click.stop="$emit(\'new-chat\')" /></aside>' },
}));
vi.mock('@/canvas/JumpPalette.vue', () => ({ default: { name: 'JumpPalette', template: '<div class="jump-stub" />' } }));
vi.mock('@/views/_components/common/SimpleModal.vue', () => ({
  default: { name: 'SimpleModal', template: '<div />', methods: { showModal: () => Promise.resolve(true) } },
}));
// The capsule has its own spec.
vi.mock('./OneCapsule.vue', () => ({
  default: {
    name: 'OneCapsule',
    emits: ['ask', 'open-models', 'open-setup'],
    template: '<div class="capsule-stub"><button class="ask" @click="$emit(\'ask\', \'Connect my Google account\')" /><button class="models" @click="$emit(\'open-models\')" /><button class="setup" @click="$emit(\'open-setup\', \'phone\')" /></div>',
  },
}));

import OneShell from './OneShell.vue';
import { setChannelEnabledTools, resolveChannelEnabledTools } from '@/services/chatChannelConfig.js';

const Probe = defineComponent({
  setup() {
    const presentation = inject('uiPresentation', 'studio');
    return () => h('div', { class: 'probe' }, presentation);
  },
});

let nav;
const NavGrabber = defineComponent({
  setup() {
    nav = inject('focusedNav');
    return () => null;
  },
});

function mountShell(screenName = 'ChatScreen', query = {}) {
  route.query = query;
  return mount(OneShell, {
    props: { screenName },
    slots: { default: () => [h(Probe), h(NavGrabber)] },
    global: {
      provide: { isMobile: ref(false) },
      directives: { tooltip: {} },
      // Studio's chat sidebar is covered by its own specs.
      stubs: { ChatPanel: { name: 'ChatPanel', template: '<div class="chat-panel-stub" />' } },
    },
    attachTo: document.body,
  });
}

describe('OneShell', () => {
  beforeEach(() => {
    dispatch.mockClear();
    push.mockClear();
    storeState.chat.savedOutputTitle = '';
    storeState.chat.savedOutputId = null;
    storeState.chat.activeConversationId = null;
    storeState.chat.messages = [];
    storeState.appAuth.connectedApps = [];
    openMainChat.mockClear();
    localStorage.clear();
  });

  it('tells every screen under it that it is in AGNT One', () => {
    const w = mountShell();
    expect(w.find('.probe').text()).toBe('one');
    expect(w.classes()).toEqual(expect.arrayContaining(['ui-one', 'ui-focused']));
    w.unmount();
  });

  // Reported 2026-10-20: installed plugins must work by default here. AGNT
  // One has no tool selector, so a selection saved in Studio must stop
  // binding the chat while this frame is mounted.
  it('a tool selection saved in Studio does not bind the chat while this frame is mounted', () => {
    setChannelEnabledTools('orchestrator:default', ['web_search']);
    expect(resolveChannelEnabledTools('orchestrator:default')).toEqual(['web_search']);
    const w = mountShell('ChatScreen');
    expect(resolveChannelEnabledTools('orchestrator:default')).toBeUndefined();
    w.unmount();
    expect(resolveChannelEnabledTools('orchestrator:default')).toEqual(['web_search']);
  });

  // Reported in Focused: new pages were saved into the retired Main chat and vanished.
  it('regression: an ask opens a NEW chat and seeds it only once that chat is open', async () => {
    storeState.chat.savedOutputId = 'some-saved-chat';
    storeState.chat.activeConversationId = 'conv-old';
    const seen = vi.fn();
    const fresh = vi.fn();
    window.addEventListener('agnt:ask-annie', seen);
    window.addEventListener('trigger-new-chat', fresh);
    const w = mountShell('AgentsScreen');
    const asking = nav.ask('Create an agent that ');
    await new Promise((r) => setTimeout(r, 150));
    expect(openMainChat).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/chat');
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(seen).not.toHaveBeenCalled();

    storeState.chat.activeConversationId = 'temp-new';
    await asking;
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].detail).toEqual({ text: 'Create an agent that ', send: false });
    window.removeEventListener('agnt:ask-annie', seen);
    window.removeEventListener('trigger-new-chat', fresh);
    w.unmount();
  });

  it('reuses a chat that is already blank instead of replacing it', async () => {
    const seen = vi.fn();
    const fresh = vi.fn();
    window.addEventListener('agnt:ask-annie', seen);
    window.addEventListener('trigger-new-chat', fresh);
    const w = mountShell('ConnectorsScreen');
    await nav.ask('Edit the Gmail plugin to ');
    expect(fresh).not.toHaveBeenCalled();
    expect(seen.mock.calls[0][0].detail.text).toBe('Edit the Gmail plugin to ');
    window.removeEventListener('agnt:ask-annie', seen);
    window.removeEventListener('trigger-new-chat', fresh);
    w.unmount();
  });

  // 2026-10-23: workflows are built on the canvas, with Annie's chat beside it.
  it('a workflow opens on its canvas; an old Library link to one goes there too', () => {
    const forge = mountShell('WorkflowForgeScreen', { id: 'w1' });
    expect(forge.findComponent({ name: 'FocusedLibrary' }).exists()).toBe(false);
    forge.unmount();
    const old = mountShell('WorkflowsScreen', { select: 'workflow:w1' });
    expect(replace).toHaveBeenLastCalledWith({ path: '/workflow-forge', query: { id: 'w1' } });
    old.unmount();
  });

  it.each([
    ['AgentsScreen', { select: 'agent:a1' }, 'FocusedLibrary'],
    ['ConnectorsScreen', {}, 'FocusedConnectors'],
    ['AutonomyScreen', { section: 'schedules' }, 'FocusedScheduled'],
    ['MemoryScreen', {}, 'FocusedMemory'],
    ['SettingsScreen', {}, 'FocusedSettings'],
    ['MarketplaceScreen', { item: 'asset-1' }, 'FocusedMarket'],
    ['MarketplaceScreen', {}, 'FocusedMarket'],
    ['TracesScreen', {}, 'FocusedActivity'],
    ['TracesScreen', { executionId: 'agent-1' }, 'FocusedActivityDetail'],
  ])('%s %j renders %s', (screen, query, page) => {
    const w = mountShell(screen, query);
    expect(w.findComponent({ name: page }).exists()).toBe(true);
    expect(w.find('.focused-borrowed-bar').exists()).toBe(false);
    w.unmount();
  });

  it('a screen with no page renders in full, with a way back and no mode to switch to', async () => {
    const w = mountShell('DashboardScreen');
    const bar = w.find('.focused-borrowed-bar');
    expect(bar.exists()).toBe(true);
    expect(bar.text()).not.toMatch(/studio/i);
    expect(bar.find('.focused-back').text()).toContain('Back to chat');
    await bar.find('.focused-back').trigger('click');
    expect(push).toHaveBeenCalledWith('/chat');
    expect(dispatch).not.toHaveBeenCalledWith('theme/setUiMode', expect.anything());
    w.unmount();
  });

  it('?studio=1 shows the full editor even where One has a page', () => {
    const w = mountShell('WorkflowForgeScreen', { id: 'w1', studio: '1' });
    expect(w.find('.focused-borrowed-bar').exists()).toBe(true);
    expect(w.findComponent({ name: 'FocusedLibrary' }).exists()).toBe(false);
    w.unmount();
  });

  it('pages navigate by real routes through the injected service', () => {
    const w = mountShell();
    nav.go({ page: 'library', tab: 'workflows', item: 'w 2' });
    expect(push).toHaveBeenLastCalledWith({ path: '/workflow-forge', query: { id: 'w 2' } });
    nav.go({ page: 'library', tab: 'agents', item: 'a 2' });
    expect(push).toHaveBeenLastCalledWith({ path: '/agents', query: { select: 'agent:a 2' } });
    nav.go({ page: 'scheduled', isNew: true });
    expect(push).toHaveBeenLastCalledWith({ path: '/goals', query: { section: 'schedules', new: '1' } });
    nav.studio('WorkflowForgeScreen', { workflowId: 'w3' });
    expect(push).toHaveBeenLastCalledWith({ path: '/workflow-forge', query: { id: 'w3', studio: '1' } });
    w.unmount();
  });

  // Removed 2026-10-21: the top bar shows no conversation title, ever.
  it('the top bar shows no conversation title, in a running chat or anywhere else', async () => {
    storeState.chat.savedOutputTitle = 'Q3 board report';
    storeState.chat.messages = [{ role: 'assistant', content: 'Hi' }, { role: 'user', content: 'Draft it' }];
    const w = mountShell('ChatScreen');
    expect(w.find('[data-testid="one-topbar"]').exists()).toBe(true); // the capsule lives there
    expect(w.find('.one-title').exists()).toBe(false);
    expect(w.find('[data-testid="one-topbar"]').text()).not.toContain('Q3 board report');
    w.unmount();
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

  // The approved mockup's frame (projects/agnt-team-os-tasks, 2026-10-30).
  describe('the rail', () => {
    const railIds = (w) => w.findAll('.rail .rail-btn').map((b) => b.attributes('data-testid'));

    it('is Home, Chats, Routines, Library, Apps, More; Settings and you at the bottom (agents live in the Library)', () => {
      const w = mountShell();
      expect(railIds(w)).toEqual([
        'one-rail-home', 'one-rail-chats', 'one-rail-routines', 'one-rail-library', 'one-rail-apps', 'one-rail-more', 'one-rail-settings', 'one-rail-me',
      ]);
      expect(w.find('[data-testid="one-rail-inbox"]').exists()).toBe(false);
      expect(w.find('[data-testid="one-rail-agents"]').exists()).toBe(false);
      w.unmount();
    });

    it('every entry opens its real page at a linkable route', async () => {
      const w = mountShell('ConnectorsScreen');
      const click = (id) => w.find(`[data-testid="one-rail-${id}"]`).trigger('click');
      await click('home');
      expect(push).toHaveBeenLastCalledWith({ path: '/team', query: { view: 'home' } });
      await click('apps');
      expect(push.mock.calls.at(-1)[0]).toMatchObject({ path: '/plugins' }); // Apps: plugins, connectors, MCP
      await click('library');
      expect(push).toHaveBeenLastCalledWith({ path: '/team', query: { view: 'library' } });
      await click('routines');
      expect(push.mock.calls.at(-1)[0]).toEqual({ path: '/goals', query: { section: 'schedules' } });
      await click('chats');
      expect(push).toHaveBeenLastCalledWith('/chat');
      w.unmount();
    });

    it('More holds Activity, Memories, Dashboard, Goals, Members, Approvals, Find anything and Studio', async () => {
      const w = mountShell();
      expect(w.find('[data-testid="one-rail-menu-more"]').exists()).toBe(false);
      await w.find('[data-testid="one-rail-more"]').trigger('click');
      expect(w.findAll('[data-testid="one-rail-menu-more"] [role=menuitem]').map((b) => b.text())).toEqual(['Activity', 'Memories', 'Dashboard', 'Goals', 'Members', 'Approvals', 'Find anythingCtrl K', 'Switch to StudioCtrl Shift S']);
      await w.find('[data-testid="one-rail-activity"]').trigger('click');
      expect(push.mock.calls.at(-1)[0].path).toBe('/traces');
      expect(w.find('[data-testid="one-rail-menu-more"]').exists()).toBe(false);
      await w.find('[data-testid="one-rail-more"]').trigger('click');
      await w.find('[data-testid="one-rail-dashboard"]').trigger('click');
      expect(push.mock.calls.at(-1)[0].path).toBe('/dashboard');
      await w.find('[data-testid="one-rail-more"]').trigger('click');
      await w.find('[data-testid="one-rail-goals"]').trigger('click');
      expect(push.mock.calls.at(-1)[0].path).toBe('/goals');
      await w.find('[data-testid="one-rail-more"]').trigger('click');
      await w.find('[data-testid="one-rail-members"]').trigger('click');
      expect(push).toHaveBeenLastCalledWith({ path: '/team', query: { view: 'members' } });
      await w.find('[data-testid="one-rail-more"]').trigger('click');
      await w.find('[data-testid="one-rail-approvals"]').trigger('click');
      expect(push).toHaveBeenLastCalledWith({ path: '/team', query: { view: 'home' } });
      await w.find('[data-testid="one-rail-more"]').trigger('click');
      await w.find('[data-testid="one-rail-find"]').trigger('click');
      expect(dispatch).toHaveBeenCalledWith('shell/openJump');
      w.unmount();
    });

    it('the drawer is on every desktop page; the chat list is the chat page\'s own', () => {
      const chat = mountShell('ChatScreen');
      expect(chat.find('.drawer').exists()).toBe(true);
      // Studio's own chat sidebar, the same component as in Studio.
      expect(chat.find('[data-testid="one-chat-sidebar"]').findComponent({ name: 'ChatPanel' }).exists()).toBe(true);
      expect(chat.find('.sidebar-stub').exists()).toBe(false);
      chat.unmount();
      const apps = mountShell('ConnectorsScreen');
      expect(apps.find('.drawer').exists()).toBe(true);
      expect(apps.find('[data-testid="one-chat-sidebar"]').exists()).toBe(false);
      apps.unmount();
    });


    it('the top bar shows where you are', () => {
      const w = mountShell('ChatScreen');
      expect(w.find('[data-testid="mk-crumbs"]').text()).toBe('Chats with Annie');
      w.unmount();
    });
  });

  describe('the capsule', () => {
    it('a step asks Annie in the chat', async () => {
      const seen = vi.fn();
      window.addEventListener('agnt:ask-annie', seen);
      const w = mountShell();
      await w.find('.capsule-stub .ask').trigger('click');
      await new Promise((r) => setTimeout(r, 0));
      expect(seen.mock.calls[0][0].detail).toEqual({ text: 'Connect my Google account', send: false });
      window.removeEventListener('agnt:ask-annie', seen);
      w.unmount();
    });

    it('the model step opens Settings, never the chat', async () => {
      const seen = vi.fn();
      window.addEventListener('agnt:ask-annie', seen);
      const w = mountShell();
      await w.find('.capsule-stub .models').trigger('click');
      expect(push).toHaveBeenLastCalledWith({ path: '/settings', query: {} });
      expect(seen).not.toHaveBeenCalled();
      window.removeEventListener('agnt:ask-annie', seen);
      w.unmount();
    });

    // The first-run setup lives in the empty chat (OneWelcome).
    it('a setup step opens the setup at that step, in the chat, asking nothing', async () => {
      const { setupRequest, clearSetupRequest } = await import('./oneSetupRequest.js');
      const seen = vi.fn();
      window.addEventListener('agnt:ask-annie', seen);
      const w = mountShell('ConnectorsScreen');
      await w.find('.capsule-stub .setup').trigger('click');
      await new Promise((r) => setTimeout(r, 0));
      expect(setupRequest.value).toBe('phone');
      expect(push).toHaveBeenCalledWith('/chat');
      expect(seen).not.toHaveBeenCalled();
      window.removeEventListener('agnt:ask-annie', seen);
      clearSetupRequest();
      w.unmount();
    });
  });
});
