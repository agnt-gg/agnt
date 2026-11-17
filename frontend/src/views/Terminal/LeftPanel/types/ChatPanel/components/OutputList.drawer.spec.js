/**
 * OutputList inside AGNT One's sidebar (variant="drawer"): the sidebar draws the
 * header, the Main chat row and the search box, so the list shows only the
 * chats and filters by what is typed in the sidebar. Studio's panel keeps all
 * three of its own.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { reactive, ref } from 'vue';

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
    directives: { tooltip: {} },
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
