/**
 * OutputList inside AGNT One's sidebar (variant="drawer"): the sidebar draws the
 * header, the Main chat row and the search box, so the list shows only the
 * chats and filters by what is typed in the sidebar. Studio's panel keeps all
 * three of its own.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { reactive, ref } from 'vue';
import { vViewportClamp } from '@/directives/viewportClamp.js';

const route = reactive({ query: {} });
vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ push: vi.fn(() => Promise.resolve()), replace: vi.fn(() => Promise.resolve()) }),
}));

import OutputList from './OutputList.vue';

const ROWS = [
  { id: 'o1', title: 'Northwind renewal: draft the email', content_type: 'conversation', group_id: 'g1', updated_at: '2026-11-15T10:00:00Z', created_at: '2026-11-15T09:00:00Z' },
  { id: 'o2', title: 'Weekly competitor report', content_type: 'conversation', group_id: null, updated_at: '2026-11-14T10:00:00Z', created_at: '2026-11-14T09:00:00Z' },
  { id: 'o3', title: 'Northwind QBR deck outline', content_type: 'conversation', group_id: 'g1', updated_at: '2026-11-13T10:00:00Z', created_at: '2026-11-13T09:00:00Z' },
];
const NORTHWIND = ['Northwind QBR deck outline', 'Northwind renewal: draft the email'];

function makeStore() {
  return createStore({
    state: { chat: { savedOutputId: null } },
    getters: {
      'contentOutputs/outputs': () => ROWS,
      'contentOutputs/visibleOutputs': () => ROWS,
      'contentOutputs/archivedOutputs': () => [],
      'contentOutputs/totalCount': () => ROWS.length,
      'contentOutputs/hasMore': () => false,
      'contentOutputs/hasLoadedAll': () => true,
      'contentOutputs/isFetching': () => false,
      'contentOutputs/mainChatId': () => 'main-1',
      'contentOutputs/mainChatOutput': () => null,
      'contentOutputs/unreadOutputIdSet': () => new Set(),
      'contentOutputs/subChatIdSet': () => new Set(),
      'contentOutputs/triageRail': () => [],
      'chat/streamingOutputIds': () => new Set(),
      'chat/speakingByOutputId': () => ({}),
      'groups/groups': () => [{ id: 'g1', name: 'Northwind', parent_id: null }],
      'groups/groupTree': () => [{ id: 'g1', name: 'Northwind', parent_id: null, children: [] }],
    },
  });
}

const mountList = (props = {}) => mount(OutputList, {
  props,
  global: {
    plugins: [makeStore()],
    provide: { playSound: () => {}, isMobile: ref(false) },
    // Registered app-wide in main.js.
    directives: { tooltip: {}, 'viewport-clamp': vViewportClamp },
    stubs: { ConversationMetaLine: true, SimpleModal: true, Tooltip: { template: '<span><slot /></span>' } },
  },
});
const titles = (wrapper) => wrapper.findAll('.output-item .output-preview').map((el) => el.text()).sort();

describe('OutputList in AGNT One\'s sidebar (variant="drawer")', () => {
  beforeEach(() => localStorage.clear());

  it('leaves the header, the Main chat row and the search box to the sidebar', () => {
    const w = mountList({ variant: 'drawer' });
    expect(w.classes()).toContain('is-drawer');
    expect(w.find('.panel-header').exists()).toBe(false);
    expect(w.find('[data-testid="main-chat-row"]').exists()).toBe(false);
    expect(w.find('input.search-input').exists()).toBe(false);
    // With no section title above it, the first tab names the list.
    expect(w.find('.view-seg-btn').text()).toBe('Chats');
    w.unmount();
  });

  it('Studio\'s panel keeps its own header, Main chat row and search box', () => {
    const w = mountList();
    expect(w.classes()).not.toContain('is-drawer');
    expect(w.find('.panel-header').text()).toContain('/ Saved Chats');
    expect(w.find('[data-testid="main-chat-row"]').exists()).toBe(true);
    expect(w.find('input.search-input').exists()).toBe(true);
    expect(w.find('.view-seg-btn').text()).toBe('All');
    w.unmount();
  });

  it('filters by what is typed in the sidebar, and says when nothing matches', async () => {
    localStorage.setItem('agnt:savedChats:view', 'all');
    const w = mountList({ variant: 'drawer' });
    expect(titles(w)).toEqual([...ROWS.map((r) => r.title)].sort());
    await w.setProps({ query: '  northwind ' });
    expect(titles(w)).toEqual(NORTHWIND);
    await w.setProps({ query: 'nothing like this' });
    expect(titles(w)).toEqual([]);
    expect(w.text()).toContain('No chats match.');
    w.unmount();
  });

  it('in Groups, a search lists every match flat rather than inside folded groups', async () => {
    localStorage.setItem('agnt:savedChats:view', 'groups');
    const w = mountList({ variant: 'drawer' });
    // Folded by default: the Northwind chats are not on screen until the group opens.
    expect(w.findAll('.group-header').length).toBe(2); // Northwind + Ungrouped
    expect(titles(w)).toEqual(['Weekly competitor report']);
    await w.setProps({ query: 'northwind' });
    expect(w.find('.group-header').exists()).toBe(false);
    expect(titles(w)).toEqual(NORTHWIND);
    // The tab the user chose stays chosen.
    expect(w.find('.view-seg-btn.on').text()).toContain('Groups');
    await w.setProps({ query: '' });
    expect(w.findAll('.group-header').length).toBe(2);
    w.unmount();
  });
});

// A chat's ⋯ menu opens beside its button and a group's menu at the pointer;
// opened from the bottom rows they ran off the window. jsdom lays nothing out,
// so the button, the pointer and the menu get the boxes a browser would give
// them in its 1024×768 window; the menu's box follows its style, translate included.
describe('the chat and group menus stay inside the window', () => {
  const MENU = { width: 200, height: 300 };
  const box = ({ top, left, width, height }) => ({ top, left, width, height, x: left, y: top, right: left + width, bottom: top + height });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 300)); // the clamp's own settle time
  const openMenu = () => document.body.querySelector('.action-menu');
  // Unmounted after each test, pass or fail: a menu is teleported into <body>,
  // so one left behind would be found by the next test.
  const lists = [];
  const mountMenuList = (props) => { const w = mountList(props); lists.push(w); return w; };
  let rects;

  beforeEach(() => {
    localStorage.clear();
    const layout = Element.prototype.getBoundingClientRect;
    rects = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.classList?.contains('action-menu-btn')) return box({ top: 700, left: 250, width: 24, height: 24 });
      if (this.classList?.contains('action-menu')) {
        const [dx, dy] = (this.style.translate || '0 0').split(/\s+/).map((v) => parseFloat(v) || 0);
        return box({ top: parseFloat(this.style.top) + (dy || 0), left: parseFloat(this.style.left) + (dx || 0), ...MENU });
      }
      return layout.call(this);
    });
  });
  afterEach(() => {
    while (lists.length) lists.pop().unmount();
    rects.mockRestore();
  });

  for (const variant of ['drawer', 'panel']) {
    it(`${variant}: a chat's menu opened from a bottom row is pulled up inside the window, beside its button`, async () => {
      localStorage.setItem('agnt:savedChats:view', 'all');
      const w = mountMenuList({ variant });
      await w.find('.output-item:not(.main-chat-item) .action-menu-btn').trigger('click');
      const menu = openMenu();
      expect(menu, 'the menu opened').not.toBeNull();
      // Beside the button (its right edge + 8px), at the button's top...
      expect(menu.style.top).toBe('700px');
      expect(menu.style.left).toBe('282px');
      await settle();
      // ...then lifted just enough: its bottom 8px above the window's (768 - 8 - 1000).
      expect(menu.style.translate).toBe('0px -240px');
      expect(menu.getBoundingClientRect().bottom).toBe(768 - 8);
      lists.pop().unmount();
      expect(openMenu(), 'closed with the list').toBeNull();
    });
  }

  it('a group\'s menu, opened at a pointer near the bottom, is pulled up inside the window', async () => {
    localStorage.setItem('agnt:savedChats:view', 'groups');
    const w = mountMenuList({ variant: 'drawer' });
    await w.find('.group-header').trigger('contextmenu', { clientX: 300, clientY: 740 });
    const menu = openMenu();
    expect(menu.textContent).toContain('Edit Group');
    await settle();
    expect(menu.style.translate).toBe('0px -280px');
    expect(menu.getBoundingClientRect().bottom).toBe(768 - 8);
  });

  it('a menu that fits is left exactly where it opened', async () => {
    rects.mockImplementation(function () {
      if (this.classList?.contains('action-menu-btn')) return box({ top: 120, left: 250, width: 24, height: 24 });
      if (this.classList?.contains('action-menu')) return box({ top: parseFloat(this.style.top), left: parseFloat(this.style.left), ...MENU });
      return box({ top: 0, left: 0, width: 0, height: 0 });
    });
    localStorage.setItem('agnt:savedChats:view', 'all');
    const w = mountMenuList({ variant: 'drawer' });
    await w.find('.output-item .action-menu-btn').trigger('click');
    await settle();
    expect(openMenu().style.top).toBe('120px');
    expect(openMenu().style.translate).toBe('');
  });
});
