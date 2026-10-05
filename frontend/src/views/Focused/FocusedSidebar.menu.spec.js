/**
 * Right-click on a chat in Focused's sidebar: rename, read/unread, archive,
 * delete. Reported: Focused had none of these. They run the same code as
 * Studio's chat list (services/conversationActions.js).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive, ref } from 'vue';

const outputs = [
  { id: 'c1', title: 'Quarterly plan', updated_at: '2026-10-04T10:00:00Z', last_read_at: '2026-10-04T09:00:00Z' },
  { id: 'c2', title: 'Inbox triage', updated_at: '2026-10-03T10:00:00Z', last_read_at: '2026-10-03T11:00:00Z' },
];
const state = reactive({ chat: { savedOutputId: null } });
const getters = reactive({
  'contentOutputs/visibleOutputs': outputs,
  'contentOutputs/outputs': outputs,
  'contentOutputs/subChatIdSet': new Set(),
  'chat/streamingOutputIds': new Set(),
  'chat/speakingByOutputId': {},
  'userAuth/userName': 'Nathan',
  'userAuth/userEmail': 'n@x.co',
  'userAuth/planType': 'free',
});
const store = { state, getters, commit: vi.fn(), dispatch: vi.fn(() => Promise.resolve()) };
vi.mock('@/components/UpgradeModal.vue', () => ({ default: { props: ['open'], template: '<div v-if="open" />' } }));
vi.mock('vuex', () => ({ useStore: () => store }));
const route = reactive({ query: {}, path: '/chat' });
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/composables/useMainChat.js', () => ({
  MAIN_CHAT_LABEL: 'Main chat',
  useMainChat: () => ({ mainChatId: ref('main'), isMainOpen: ref(false), isMainUnread: ref(false), isMainStreaming: ref(false) }),
}));

import FocusedSidebar from './FocusedSidebar.vue';

const nav = { prompt: vi.fn(), confirm: vi.fn(), toast: vi.fn() };
function mountSidebar() {
  return mount(FocusedSidebar, {
    props: { open: true, onChat: true },
    attachTo: document.body,
    global: { provide: { focusedNav: nav }, directives: { tooltip: {} } },
  });
}
const rightClick = async (w, index = 0) => {
  await w.findAll('.focused-recent')[index].trigger('contextmenu', { clientX: 120, clientY: 200 });
};
const item = (w, text) => w.findAll('.focused-context-menu .focused-menu-item').find((b) => b.text().includes(text));

beforeEach(() => {
  vi.clearAllMocks();
  state.chat.savedOutputId = null;
  route.query = {};
});

describe('right-click on a Focused chat', () => {
  it('opens a menu with every action, at the cursor', async () => {
    const w = mountSidebar();
    await rightClick(w);
    const menu = w.find('.focused-context-menu');
    expect(menu.exists()).toBe(true);
    expect(menu.attributes('style')).toContain('left: 120px');
    expect(menu.findAll('.focused-menu-item').map((b) => b.text())).toEqual(['Rename', 'Mark as read', 'Archive', 'Delete']);
    w.unmount();
  });

  it('a read chat offers Mark as unread', async () => {
    const w = mountSidebar();
    await rightClick(w, 1);
    expect(item(w, 'Mark as')?.text()).toBe('Mark as unread');
    await item(w, 'Mark as').trigger('click');
    expect(store.dispatch).toHaveBeenCalledWith('contentOutputs/markUnread', 'c2');
    expect(w.find('.focused-context-menu').exists()).toBe(false);
    w.unmount();
  });

  it('Rename asks for a title and saves it', async () => {
    nav.prompt.mockResolvedValueOnce('  Q4 plan  ');
    const w = mountSidebar();
    await rightClick(w);
    await item(w, 'Rename').trigger('click');
    await flushPromises();
    expect(nav.prompt).toHaveBeenCalledWith(expect.objectContaining({ title: 'Rename chat', confirmText: 'Rename' }));
    expect(store.commit).toHaveBeenCalledWith('contentOutputs/PATCH_OUTPUT', { id: 'c1', updates: { title: 'Q4 plan' } });
    expect(store.dispatch).toHaveBeenCalledWith('chat/updateConversationTitle', { outputId: 'c1', title: 'Q4 plan' });
    w.unmount();
  });

  it('Delete asks first, and leaves the chat if it was open', async () => {
    nav.confirm.mockResolvedValueOnce(true);
    state.chat.savedOutputId = 'c1';
    const w = mountSidebar();
    await rightClick(w);
    await item(w, 'Delete').trigger('click');
    await flushPromises();
    expect(nav.confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true }));
    expect(w.emitted('new-chat')).toHaveLength(1);
    expect(store.commit).toHaveBeenCalledWith('contentOutputs/REMOVE_OUTPUT', 'c1');
    expect(store.dispatch).toHaveBeenCalledWith('contentOutputs/deleteOutput', 'c1');
    w.unmount();
  });

  it('a cancelled delete does nothing', async () => {
    nav.confirm.mockResolvedValueOnce(false);
    const w = mountSidebar();
    await rightClick(w);
    await item(w, 'Delete').trigger('click');
    await flushPromises();
    expect(store.dispatch).not.toHaveBeenCalledWith('contentOutputs/deleteOutput', expect.anything());
    w.unmount();
  });

  it('Archive archives it; Escape and an outside click close the menu', async () => {
    const w = mountSidebar();
    await rightClick(w);
    await item(w, 'Archive').trigger('click');
    expect(store.dispatch).toHaveBeenCalledWith('contentOutputs/setArchived', { outputId: 'c1', archived: true });
    await rightClick(w);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(w.find('.focused-context-menu').exists()).toBe(false);
    await rightClick(w);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    expect(w.find('.focused-context-menu').exists()).toBe(false);
    w.unmount();
  });

  it('a failed action says so', async () => {
    store.dispatch.mockImplementationOnce(() => Promise.reject(new Error('500')));
    const w = mountSidebar();
    await rightClick(w);
    await item(w, 'Archive').trigger('click');
    await flushPromises();
    expect(nav.toast).toHaveBeenCalledWith("Couldn't archive that chat.");
    w.unmount();
  });
});
