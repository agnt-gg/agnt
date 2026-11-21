/**
 * AGNT One's frame, and its contract with the rest of the app:
 *   - every screen under it can tell it is in One (provide/inject);
 *   - the page comes from the ROUTE, so any link (chat, Ctrl+K, entity chips,
 *     Back) lands on One's own page for it;
 *   - a screen with no page renders in full, with a way back to where it opened from;
 *   - pages navigate through one injected service, by real routes;
 *   - the rail shows only what the account has; one sidebar (the drawer,
 *     with the chats in it) sits beside it on every desktop page, and
 *     collapses to the rail as in Studio;
 *   - the capsule's steps reach the chat (ask) or the model picker (Settings).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  MAIN_CHAT_LABEL: 'Main chat',
  useMainChat: () => ({
    mainChatId,
    isMainOpen: ref(false),
    isMainUnread: ref(false),
    isMainStreaming: ref(false),
    openMainChat,
    clearMainChat: vi.fn(() => Promise.resolve(false)),
  }),
}));
// Studio's chat list has its own specs (OutputList.*.spec.js); here only where it sits and what it is given.
vi.mock('@/views/Terminal/LeftPanel/types/ChatPanel/components/OutputList.vue', () => ({
  default: { name: 'OutputList', props: ['variant', 'query'], template: '<div class="output-list-stub" :data-variant="variant" :data-query="query" />' },
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

// The year in review has its own specs; here only its door: open().
const { wrappedOpen } = vi.hoisted(() => ({ wrappedOpen: vi.fn() }));
vi.mock('./wrapped/OneWrapped.vue', () => ({
  default: {
    name: 'OneWrapped',
    setup(_props, { expose }) {
      expose({ open: wrappedOpen });
      return () => null;
    },
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
    // The dashboard's useful parts are Home's, so its way back is Home.
    const w = mountShell('DashboardScreen');
    const bar = w.find('.focused-borrowed-bar');
    expect(bar.exists()).toBe(true);
    expect(bar.text()).not.toMatch(/studio/i);
    expect(bar.find('.focused-back').text()).toBe('Home');
    await bar.find('.focused-back').trigger('click');
    expect(push).toHaveBeenLastCalledWith({ path: '/team', query: { view: 'home' } });
    expect(dispatch).not.toHaveBeenCalledWith('theme/setUiMode', expect.anything());
    w.unmount();
    // A screen opened from nowhere in particular goes back to the chat.
    const other = mountShell('WorkspaceScreen');
    expect(other.get('.focused-back').text()).toBe('Chat');
    await other.get('.focused-back').trigger('click');
    expect(push).toHaveBeenLastCalledWith('/chat');
    other.unmount();
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

    it('is Home, Chats, Goals, Library, Apps; Settings and your account at the bottom, every item named', () => {
      const w = mountShell();
      expect(railIds(w)).toEqual([
        'one-rail-home', 'one-rail-chats', 'one-rail-goals', 'one-rail-library', 'one-rail-apps', 'one-rail-settings', 'one-rail-me',
      ]);
      expect(w.findAll('.rail .rail-label').map((l) => l.text())).toEqual(['Home', 'Chats', 'Goals', 'Library', 'Apps', 'Settings']);
      // No More menu, no logo standing in for Home, no separate Routines.
      for (const gone of ['more', 'routines', 'inbox', 'agents']) expect(w.find(`[data-testid="one-rail-${gone}"]`).exists(), gone).toBe(false);
      expect(w.find('.rail-mark').exists()).toBe(false);
      w.unmount();
    });

    it('lights Goals for goals and repeating goals, and Home for Activity and the dashboard', () => {
      const lit = (screen, query) => {
        const w = mountShell(screen, query);
        const on = w.find('.rail .rail-btn.is-active');
        const id = on.exists() ? on.attributes('data-testid') : null;
        w.unmount();
        return id;
      };
      expect(lit('GoalsScreen')).toBe('one-rail-goals');
      expect(lit('AutonomyScreen', { section: 'schedules' })).toBe('one-rail-goals');
      expect(lit('TracesScreen')).toBe('one-rail-home');
      expect(lit('DashboardScreen')).toBe('one-rail-home');
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
      await click('goals');
      expect(push.mock.calls.at(-1)[0]).toEqual({ path: '/goals', query: {} });
      await click('settings');
      expect(push.mock.calls.at(-1)[0]).toMatchObject({ path: '/settings' });
      await click('chats');
      expect(push).toHaveBeenLastCalledWith('/chat');
      w.unmount();
    });

    it('lights the rail on every page: editors and forges are Library, Studio settings sections are Settings', () => {
      const lit = (screen, query) => {
        const w = mountShell(screen, query);
        const on = w.find('.rail .rail-btn.is-active');
        const id = on.exists() ? on.attributes('data-testid') : null;
        w.unmount();
        return id;
      };
      expect(lit('AgentsScreen', { select: 'agent:a1' })).toBe('one-rail-library');
      expect(lit('WorkflowForgeScreen', { id: 'w1' })).toBe('one-rail-library');
      expect(lit('MarketplaceScreen')).toBe('one-rail-library');
      expect(lit('SettingsScreen', { section: 'billing', studio: '1' })).toBe('one-rail-settings');
      expect(lit('MemoryScreen')).toBe('one-rail-settings');
    });

    it('a borrowed Studio screen goes back to where it was opened from, not always the chat', async () => {
      const w = mountShell('SettingsScreen', { section: 'billing', studio: '1' });
      const back = w.get('[data-testid="borrowed-back"]');
      expect(back.text()).toBe('Settings');
      expect(w.get('.focused-borrowed-title').text()).toBe('Billing');
      await back.trigger('click');
      expect(push.mock.calls.at(-1)[0]).toMatchObject({ path: '/settings' });
      w.unmount();
      const goal = mountShell('GoalsScreen', { select: 'goal:g1' });
      expect(goal.get('[data-testid="borrowed-back"]').text()).toBe('Goals');
      goal.unmount();
    });

    it('the old Library and Routines lists open their one home', () => {
      replace.mockClear();
      mountShell('AgentsScreen').unmount();
      expect(replace).toHaveBeenCalledWith({ path: '/team', query: { view: 'library' } });
      mountShell('GoalsScreen', { section: 'schedules' }).unmount();
      expect(replace).toHaveBeenLastCalledWith({ path: '/goals', query: {} });
    });

    it('your account menu holds your account, Members, Year in review, Find anything and Studio', async () => {
      const w = mountShell();
      const openMenu = () => w.find('[data-testid="one-rail-me"]').trigger('click');
      expect(w.find('[data-testid="one-rail-menu-account"]').exists()).toBe(false);
      await openMenu();
      expect(w.findAll('[data-testid="one-rail-menu-account"] [role=menuitem]').map((b) => b.text())).toEqual(['Your account', 'Members', 'Year in review', 'Find anythingCtrl K', 'Switch to StudioCtrl Shift S']);
      await w.find('[data-testid="one-rail-account"]').trigger('click');
      expect(push.mock.calls.at(-1)[0]).toMatchObject({ path: '/settings' });
      expect(w.find('[data-testid="one-rail-menu-account"]').exists()).toBe(false);
      await openMenu();
      await w.find('[data-testid="one-rail-members"]').trigger('click');
      expect(push).toHaveBeenLastCalledWith({ path: '/team', query: { view: 'members' } });
      await openMenu();
      await w.find('[data-testid="one-rail-find"]').trigger('click');
      expect(dispatch).toHaveBeenCalledWith('shell/openJump');
      w.unmount();
    });

    it('Year in review opens the year in review, without leaving the page', async () => {
      wrappedOpen.mockClear();
      const w = mountShell();
      push.mockClear();
      await w.find('[data-testid="one-rail-me"]').trigger('click');
      await w.find('[data-testid="one-rail-wrapped"]').trigger('click');
      expect(wrappedOpen).toHaveBeenCalledTimes(1);
      expect(push).not.toHaveBeenCalled();
      expect(w.find('[data-testid="one-rail-menu-account"]').exists()).toBe(false);
      w.unmount();
    });

    it('one sidebar on every desktop page: the drawer, with Studio\'s chat list in it', () => {
      for (const screen of ['ChatScreen', 'ConnectorsScreen']) {
        const w = mountShell(screen);
        const chats = w.find('.drawer [data-testid="one-chat-sidebar"] .output-list-stub');
        expect(chats.exists(), screen).toBe(true);
        expect(chats.attributes('data-variant')).toBe('drawer');
        // No second column of chats beside it, and no phone drawer on a desktop.
        expect(w.findAll('.output-list-stub')).toHaveLength(1);
        expect(w.find('.sidebar-stub').exists()).toBe(false);
        w.unmount();
      }
    });

    it('the sidebar search reaches the chats and Enter opens Find anything with it; asking is the composer\'s job', async () => {
      const w = mountShell('ConnectorsScreen');
      const input = () => w.get('[data-testid="one-sidebar-search"]');
      expect(input().attributes('placeholder')).toBe('Search');
      await input().setValue('northwind');
      expect(w.get('.output-list-stub').attributes('data-query')).toBe('northwind');
      expect(w.find('[data-testid="one-sidebar-ask"]').exists()).toBe(false);
      await input().trigger('keydown', { key: 'Enter' });
      expect(dispatch).toHaveBeenCalledWith('shell/openJump', 'northwind');
      // One search: the top bar has no second one.
      expect(w.find('.one-topbar [aria-label="Search (Ctrl K)"]').exists()).toBe(false);
      w.unmount();
    });

    it('New chat and the Main chat are in the sidebar on any page', async () => {
      const fresh = vi.fn();
      window.addEventListener('trigger-new-chat', fresh);
      const w = mountShell('ConnectorsScreen');
      await w.get('[data-testid="one-new-chat"]').trigger('click');
      await new Promise((r) => setTimeout(r, 0));
      expect(push).toHaveBeenCalledWith('/chat');
      expect(fresh).toHaveBeenCalledTimes(1);
      await w.get('[data-testid="main-chat-row"]').trigger('click');
      expect(openMainChat).toHaveBeenCalledTimes(1);
      window.removeEventListener('trigger-new-chat', fresh);
      w.unmount();
    });

    it('collapses to the rail as in Studio, remembers it, and the rail\'s arrow brings it back', async () => {
      const w = mountShell('ChatScreen');
      expect(w.find('[data-testid="one-rail-expand"]').exists()).toBe(false);
      await w.get('[data-testid="one-sidebar-collapse"]').trigger('click');
      expect(w.find('.drawer').exists()).toBe(false);
      expect(localStorage.getItem('agnt:oneSidebar:expanded')).toBe('false');
      expect(w.get('[data-testid="one-rail-expand"]').find('.fa-angle-double-right').exists()).toBe(true);
      w.unmount();

      const again = mountShell('ConnectorsScreen');
      expect(again.find('.drawer').exists()).toBe(false);
      await again.get('[data-testid="one-rail-expand"]').trigger('click');
      expect(again.find('.drawer').exists()).toBe(true);
      expect(localStorage.getItem('agnt:oneSidebar:expanded')).toBe('true');
      expect(again.find('[data-testid="one-rail-expand"]').exists()).toBe(false);
      again.unmount();
    });


    it('every page names itself; the top bar shows a trail only when there is somewhere to step back to', () => {
      const chat = mountShell('ChatScreen');
      expect(chat.find('[data-testid="mk-crumbs"]').exists()).toBe(false);
      chat.unmount();
      const run = mountShell('TracesScreen');
      expect(run.find('[data-testid="mk-crumbs"]').text()).toBe('HomeActivity');
      run.unmount();
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

  // The running offer (offer.js): a corner card, and a rail button that reopens it.
  describe('the offer', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.UTC(2026, 10, 16, 18));
    });
    afterEach(() => {
      delete storeState.userAuth;
      vi.useRealTimers();
    });

    it('a monthly plan gets the card and the rail button; closing the card keeps the button, which opens it again', async () => {
      storeState.userAuth = { planType: 'personal', subscription: { planType: 'personal', interval: 'monthly' } };
      const w = mountShell();
      await w.vm.$nextTick();
      expect(w.find('[data-testid="one-offer"]').exists()).toBe(true);
      const rail = w.find('[data-testid="one-rail-offer"]');
      expect(rail.exists()).toBe(true);
      expect(rail.attributes('aria-label')).toBe('Black Friday deal');

      await w.find('[data-testid="one-offer"] .offer-x').trigger('click');
      expect(w.find('[data-testid="one-offer"]').exists()).toBe(false);
      expect(w.find('[data-testid="one-rail-offer"]').exists()).toBe(true);

      await w.find('[data-testid="one-rail-offer"]').trigger('click');
      expect(w.find('[data-testid="one-offer"]').exists()).toBe(true);
      w.unmount();
    });

    it('a yearly plan gets neither', async () => {
      storeState.userAuth = { planType: 'personal', subscription: { planType: 'personal', interval: 'yearly' } };
      const w = mountShell();
      await w.vm.$nextTick();
      expect(w.find('[data-testid="one-offer"]').exists()).toBe(false);
      expect(w.find('[data-testid="one-rail-offer"]').exists()).toBe(false);
      w.unmount();
    });
  });
});
