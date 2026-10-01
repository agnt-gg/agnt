/**
 * The Main chat in the sidebar store: pinned (so never an item in a list),
 * fetched and cleared through the server, and the sub-chats it started
 * marked as such.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createStore } from 'vuex';
import contentOutputs from './contentOutputs.js';
import chat from './chat.js';
import { recentConversations } from '@/views/Focused/focusedModel.js';

const MAIN = { id: 'out-main', title: 'Main chat', content_type: 'conversation', conversation_id: 'conv-main', created_at: '2026-10-01 10:00:00', updated_at: '2026-10-01 10:00:00', last_read_at: '2026-10-01 09:59:59' };
const OTHER = { id: 'out-a', title: 'A chat', content_type: 'conversation', created_at: '2026-10-01 09:00:00', updated_at: '2026-10-01 09:00:00' };
const TASK = { id: 'out-task', title: 'Pricing research', content_type: 'conversation', created_at: '2026-10-01 11:00:00', updated_at: '2026-10-01 11:00:00' };

const makeStore = () => createStore({ modules: { contentOutputs } });

function respondWith(body, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
}

beforeEach(() => {
  localStorage.setItem('token', 'test-token');
});

describe('the Main chat in the sidebar store', () => {
  it('fetchMainChat names the Main chat, adds its row, and loads sub-chat links', async () => {
    const store = makeStore();
    store.commit('contentOutputs/SET_OUTPUTS', { outputs: [OTHER, TASK], totalCount: 2 });
    respondWith({ main: MAIN, subChats: [{ id: 'out-task', parentId: 'out-main' }] });

    const main = await store.dispatch('contentOutputs/fetchMainChat');

    expect(global.fetch.mock.calls[0][0]).toMatch(/\/content-outputs\/main-chat$/);
    expect(main.id).toBe('out-main');
    expect(store.getters['contentOutputs/mainChatId']).toBe('out-main');
    expect(store.getters['contentOutputs/mainChatOutput'].title).toBe('Main chat');
    expect([...store.getters['contentOutputs/subChatIdSet']]).toEqual(['out-task']);
  });

  it('keeps the Main chat out of every list, but not out of unread', async () => {
    const store = makeStore();
    store.commit('contentOutputs/SET_OUTPUTS', { outputs: [OTHER, TASK], totalCount: 2 });
    respondWith({ main: { ...MAIN, updated_at: '2026-10-01 12:00:00' }, subChats: [] });
    await store.dispatch('contentOutputs/fetchMainChat');

    const visible = store.getters['contentOutputs/visibleOutputs'].map((o) => o.id);
    expect(visible).not.toContain('out-main');
    expect(visible).toEqual(expect.arrayContaining(['out-a', 'out-task']));
    // A report landing in the Main chat must still light its dot.
    expect(store.getters['contentOutputs/unreadOutputIdSet'].has('out-main')).toBe(true);
  });

  it('resolves null and changes nothing when the server cannot be reached', async () => {
    const store = makeStore();
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await store.dispatch('contentOutputs/fetchMainChat')).toBe(null);
    expect(store.getters['contentOutputs/mainChatId']).toBe(null);
  });

  it('clearMainChat posts the clear and adopts the returned row', async () => {
    const store = makeStore();
    respondWith({ main: MAIN, subChats: [] });
    await store.dispatch('contentOutputs/fetchMainChat');

    respondWith({ main: { ...MAIN, conversation_id: 'conv-fresh' } });
    await store.dispatch('contentOutputs/clearMainChat');

    expect(global.fetch.mock.calls[0][0]).toMatch(/\/content-outputs\/main-chat\/clear$/);
    expect(global.fetch.mock.calls[0][1].method).toBe('POST');
    expect(store.getters['contentOutputs/mainChatOutput'].conversation_id).toBe('conv-fresh');
  });

  it('a sub-chat announced live is marked without a refetch', () => {
    const store = makeStore();
    store.commit('contentOutputs/ADD_SUB_CHAT', { id: 'out-new', parentId: 'out-main' });
    store.commit('contentOutputs/ADD_SUB_CHAT', { id: 'out-orphan', parentId: null });
    expect(store.getters['contentOutputs/subChatIdSet']).toEqual(new Set(['out-new', 'out-orphan']));
  });
});

describe('detachSavedOutput', () => {
  it('empties and unlinks every cached slot of a row, so it reloads instead of resaving', () => {
    const store = createStore({ modules: { chat } });
    store.commit('chat/ENSURE_CONVERSATION', 'conv-main');
    store.commit('chat/SCOPED_SET_MESSAGES', { conversationId: 'conv-main', messages: [{ id: 'm1', role: 'user', content: 'old' }] });
    store.commit('chat/SCOPED_SET_SAVED_OUTPUT_ID', { conversationId: 'conv-main', id: 'out-main' });
    store.commit('chat/ENSURE_CONVERSATION', 'conv-other');
    store.commit('chat/SCOPED_SET_SAVED_OUTPUT_ID', { conversationId: 'conv-other', id: 'out-a' });

    store.dispatch('chat/detachSavedOutput', 'out-main');

    expect(store.state.chat.conversations['conv-main'].savedOutputId).toBe(null);
    expect(store.state.chat.conversations['conv-main'].messages).toEqual([]);
    expect(store.state.chat.conversations['conv-other'].savedOutputId).toBe('out-a');
  });
});

describe('Focused recents', () => {
  it('marks the tasks the Main chat started', () => {
    const rows = recentConversations([OTHER, TASK], '', 60, new Set(['out-task']));
    expect(rows.find((r) => r.id === 'out-task').sub).toBe(true);
    expect(rows.find((r) => r.id === 'out-a').sub).toBe(false);
    // Callers that pass no set get no marks.
    expect(recentConversations([TASK]).every((r) => r.sub === false)).toBe(true);
  });
});
