import { describe, it, expect } from 'vitest';
import { createStore } from 'vuex';
import { openLegacyOutputSlot } from './legacyOutputSlot.js';

// A minimal chat module with the real mutation semantics this helper relies on.
function makeStore() {
  return createStore({
    modules: {
      chat: {
        namespaced: true,
        state: () => ({
          activeConversationId: 'current',
          conversations: { current: { messages: [{ id: 'm1', role: 'user', content: 'my question' }] } },
        }),
        mutations: {
          ENSURE_CONVERSATION(state, id) {
            if (!state.conversations[id]) state.conversations[id] = { messages: [] };
          },
          SCOPED_SET_MESSAGES(state, { conversationId, messages }) {
            state.conversations[conversationId].messages = messages;
          },
          SET_ACTIVE_CONVERSATION(state, id) {
            state.activeConversationId = id;
          },
          ADD_MESSAGE(state, message) {
            state.conversations[state.activeConversationId].messages.push(message);
          },
        },
      },
    },
  });
}

describe('openLegacyOutputSlot', () => {
  it('opens the snapshot in its own slot and leaves the current conversation untouched', () => {
    const store = makeStore();
    const slot = openLegacyOutputSlot(store, {
      contentId: 'o1',
      output: { content: '<p>old math answer</p>', created_at: '2025-10-29 15:43:55' },
      messageId: 'x1',
    });
    expect(slot).toBe('saved-o1');
    expect(store.state.chat.activeConversationId).toBe('saved-o1');
    expect(store.state.chat.conversations.current.messages).toEqual([{ id: 'm1', role: 'user', content: 'my question' }]);
    expect(store.state.chat.conversations['saved-o1'].messages).toMatchObject([{ role: 'assistant', content: '<p>old math answer</p>' }]);
  });

  it('switches back on reopen instead of overwriting what was added there', () => {
    const store = makeStore();
    openLegacyOutputSlot(store, { contentId: 'o1', output: { content: 'a' }, messageId: 'x1' });
    store.commit('chat/ADD_MESSAGE', { id: 'u2', role: 'user', content: 'follow-up' });
    store.commit('chat/SET_ACTIVE_CONVERSATION', 'current');
    openLegacyOutputSlot(store, { contentId: 'o1', output: { content: 'a' }, messageId: 'x2' });
    expect(store.state.chat.activeConversationId).toBe('saved-o1');
    expect(store.state.chat.conversations['saved-o1'].messages.map((m) => m.id)).toEqual(['x1', 'u2']);
  });
});
