// Load persisted conversations from localStorage
const loadPersistedConversations = () => {
  try {
    const persisted = localStorage.getItem('widgetChatConversations');
    return persisted ? JSON.parse(persisted) : {};
  } catch (error) {
    console.error('Error loading persisted widget conversations:', error);
    return {};
  }
};

// Save conversations to localStorage
const saveConversations = (conversations) => {
  try {
    const filteredConversations = {};
    for (const [widgetId, conversation] of Object.entries(conversations)) {
      if (conversation.messages.length > 0 || conversation.conversationId) {
        filteredConversations[widgetId] = conversation;
      }
    }

    localStorage.setItem('widgetChatConversations', JSON.stringify(filteredConversations));
  } catch (error) {
    console.error('Error saving widget conversations to localStorage:', error);
  }
};

export default {
  namespaced: true,
  state: {
    conversations: loadPersistedConversations(),
    activeConversationId: null,
    isStreaming: false,
    isLoadingSuggestions: false,
    expandedToolCalls: {},
    runningToolCalls: {},
    messageStates: {},
    currentWidgetState: null,
  },
  mutations: {
    SET_CONVERSATION(state, { widgetId, messages }) {
      if (!state.conversations[widgetId]) {
        state.conversations[widgetId] = {
          messages: [],
          conversationId: null,
          lastUpdate: Date.now(),
          suggestions: [],
        };
      }
      state.conversations[widgetId].messages = messages;
      state.conversations[widgetId].lastUpdate = Date.now();
      saveConversations(state.conversations);
    },
    ADD_MESSAGE(state, { widgetId, message }) {
      if (!state.conversations[widgetId]) {
        state.conversations[widgetId] = {
          messages: [],
          conversationId: null,
          lastUpdate: Date.now(),
          suggestions: [],
        };
      }
      state.conversations[widgetId].messages.push(message);
      state.conversations[widgetId].lastUpdate = Date.now();
      saveConversations(state.conversations);
    },
    UPDATE_MESSAGE_CONTENT(state, { widgetId, messageId, content }) {
      const conversation = state.conversations[widgetId];
      if (conversation) {
        const message = conversation.messages.find((m) => m.id === messageId);
        if (message) {
          message.content = content;
          saveConversations(state.conversations);
        }
      }
    },
    APPEND_MESSAGE_CONTENT(state, { widgetId, messageId, delta }) {
      const conversation = state.conversations[widgetId];
      if (conversation) {
        const message = conversation.messages.find((m) => m.id === messageId);
        if (message) {
          message.content = (message.content || '') + delta;
        }
      }
    },
    PERSIST_CONVERSATIONS(state) {
      saveConversations(state.conversations);
    },
    ADD_TOOL_CALL(state, { widgetId, messageId, toolCall }) {
      const conversation = state.conversations[widgetId];
      if (conversation) {
        const message = conversation.messages.find((m) => m.id === messageId);
        if (message) {
          if (!message.toolCalls) {
            message.toolCalls = [];
          }
          if (!message.toolCalls.some((tc) => tc.id === toolCall.id)) {
            message.toolCalls.push(toolCall);
            saveConversations(state.conversations);
          }
        }
      }
    },
    UPDATE_TOOL_CALL_RESULT(state, { widgetId, messageId, toolCallId, result, error }) {
      const conversation = state.conversations[widgetId];
      if (conversation) {
        const message = conversation.messages.find((m) => m.id === messageId);
        if (message && message.toolCalls) {
          const toolCall = message.toolCalls.find((tc) => tc.id === toolCallId);
          if (toolCall) {
            toolCall.result = result;
            toolCall.error = error;
            saveConversations(state.conversations);
          }
        }
      }
    },
    SET_CONVERSATION_ID(state, { widgetId, conversationId }) {
      if (!state.conversations[widgetId]) {
        state.conversations[widgetId] = {
          messages: [],
          conversationId: null,
          lastUpdate: Date.now(),
          suggestions: [],
        };
      }
      state.conversations[widgetId].conversationId = conversationId;
      saveConversations(state.conversations);
    },
    SET_CONVERSATIONS(state, conversations) {
      state.conversations = conversations;
      saveConversations(state.conversations);
    },
    CLEAR_CONVERSATION(state, widgetId) {
      if (state.conversations[widgetId]) {
        state.conversations[widgetId].messages = [];
        state.conversations[widgetId].conversationId = null;
        state.conversations[widgetId].lastUpdate = Date.now();
        state.conversations[widgetId].suggestions = [];
      }
      delete state.expandedToolCalls[widgetId];
      delete state.runningToolCalls[widgetId];
      delete state.messageStates[widgetId];
      saveConversations(state.conversations);
    },
    MIGRATE_CONVERSATION(state, { fromId, toId }) {
      if (state.conversations[fromId]) {
        state.conversations[toId] = state.conversations[fromId];
        delete state.conversations[fromId];
      }
      if (state.expandedToolCalls[fromId]) {
        state.expandedToolCalls[toId] = state.expandedToolCalls[fromId];
        delete state.expandedToolCalls[fromId];
      }
      if (state.runningToolCalls[fromId]) {
        state.runningToolCalls[toId] = state.runningToolCalls[fromId];
        delete state.runningToolCalls[fromId];
      }
      if (state.messageStates[fromId]) {
        state.messageStates[toId] = state.messageStates[fromId];
        delete state.messageStates[fromId];
      }
      saveConversations(state.conversations);
    },
    SET_ACTIVE_CONVERSATION(state, widgetId) {
      state.activeConversationId = widgetId;
    },
    SET_STREAMING(state, isStreaming) {
      state.isStreaming = isStreaming;
    },
    SET_LOADING_SUGGESTIONS(state, isLoading) {
      state.isLoadingSuggestions = isLoading;
    },
    SET_EXPANDED_TOOL_CALLS(state, { widgetId, messageId, expandedIndexes }) {
      if (!state.expandedToolCalls[widgetId]) {
        state.expandedToolCalls[widgetId] = {};
      }
      state.expandedToolCalls[widgetId][messageId] = expandedIndexes;
    },
    SET_RUNNING_TOOL_CALLS(state, { widgetId, messageId, toolCallId, isRunning }) {
      if (!state.runningToolCalls[widgetId]) {
        state.runningToolCalls[widgetId] = {};
      }
      const key = `${messageId}-${toolCallId}`;
      if (isRunning) {
        state.runningToolCalls[widgetId][key] = true;
      } else {
        delete state.runningToolCalls[widgetId][key];
      }
    },
    SET_MESSAGE_STATE(state, { widgetId, messageId, messageState }) {
      if (!state.messageStates[widgetId]) {
        state.messageStates[widgetId] = {};
      }
      if (messageState) {
        state.messageStates[widgetId][messageId] = messageState;
      } else {
        delete state.messageStates[widgetId][messageId];
      }
    },
    SET_SUGGESTIONS(state, { widgetId, suggestions }) {
      if (!state.conversations[widgetId]) {
        state.conversations[widgetId] = {
          messages: [],
          conversationId: null,
          lastUpdate: Date.now(),
          suggestions: [],
        };
      }
      state.conversations[widgetId].suggestions = suggestions;
      state.conversations[widgetId].lastUpdate = Date.now();
      saveConversations(state.conversations);
    },
    SET_CURRENT_WIDGET_STATE(state, widgetState) {
      state.currentWidgetState = widgetState;
    },
  },
  getters: {
    getConversation: (state) => (widgetId) => {
      return (
        state.conversations[widgetId] || {
          messages: [],
          conversationId: null,
          lastUpdate: null,
        }
      );
    },
    getMessages: (state) => (widgetId) => {
      const conversation = state.conversations[widgetId];
      return conversation ? conversation.messages : [];
    },
    getConversationId: (state) => (widgetId) => {
      const conversation = state.conversations[widgetId];
      return conversation ? conversation.conversationId : null;
    },
    getFormattedMessages: (state) => (widgetId) => {
      const conversation = state.conversations[widgetId];
      if (!conversation) return [];

      return conversation.messages.map((message) => ({
        ...message,
        expandedToolCalls: state.expandedToolCalls[widgetId]?.[message.id] || [],
      }));
    },
    getMessageStatus: (state) => (widgetId, messageId) => {
      return state.messageStates[widgetId]?.[messageId] || null;
    },
    getRunningToolsForMessage: (state) => (widgetId, messageId) => {
      const runningTools = state.runningToolCalls[widgetId] || {};
      return Object.keys(runningTools)
        .filter((key) => key.startsWith(`${messageId}-`))
        .map((key) => key.split('-')[1]);
    },
    isStreaming: (state) => state.isStreaming,
    isLoadingSuggestions: (state) => state.isLoadingSuggestions,
    activeConversationId: (state) => state.activeConversationId,
    getSuggestions: (state) => (widgetId) => {
      const conversation = state.conversations[widgetId];
      return conversation ? conversation.suggestions : [];
    },
    getCurrentWidgetState: (state) => state.currentWidgetState,
  },
  actions: {
    reloadConversations({ commit, state }) {
      const persistedConversations = loadPersistedConversations();
      const mergedConversations = { ...state.conversations, ...persistedConversations };
      commit('SET_CONVERSATIONS', mergedConversations);
    },

    initializeConversation({ commit, state }, widgetId) {
      if (!widgetId) return;

      if (!state.conversations[widgetId]) {
        const welcomeMessage = {
          id: `widget-welcome-${Date.now()}`,
          role: 'assistant',
          content: "Hi! I'm Annie, your widget assistant. I can help you create, modify, and configure widgets. What would you like to build?",
          timestamp: Date.now(),
          metadata: ['Widget Assistant', 'Version: 1.0'],
        };
        commit('SET_CONVERSATION', { widgetId, messages: [welcomeMessage] });
      }
    },

    addMessage({ commit }, { widgetId, message }) {
      if (!widgetId || !message) return;
      commit('ADD_MESSAGE', { widgetId, message });
    },

    updateMessageContent({ commit }, { widgetId, messageId, content }) {
      if (!widgetId || !messageId) return;
      commit('UPDATE_MESSAGE_CONTENT', { widgetId, messageId, content });
    },

    addToolCall({ commit }, { widgetId, messageId, toolCall }) {
      if (!widgetId || !messageId || !toolCall) return;
      commit('ADD_TOOL_CALL', { widgetId, messageId, toolCall });
    },

    updateToolCall({ commit }, { widgetId, messageId, toolCallId, toolCall }) {
      if (!widgetId || !messageId || !toolCallId) return;
      commit('UPDATE_TOOL_CALL_RESULT', { widgetId, messageId, toolCallId, result: toolCall.result, error: toolCall.error });
    },

    setMessageStatus({ commit }, { widgetId, messageId, status }) {
      if (!widgetId || !messageId) return;
      commit('SET_MESSAGE_STATE', { widgetId, messageId, messageState: status });
    },

    clearMessageStatus({ commit }, { widgetId, messageId }) {
      if (!widgetId || !messageId) return;
      commit('SET_MESSAGE_STATE', { widgetId, messageId, messageState: null });
    },

    setRunningTool({ commit }, { widgetId, messageId, toolCallId, running }) {
      if (!widgetId || !messageId || !toolCallId) return;
      commit('SET_RUNNING_TOOL_CALLS', { widgetId, messageId, toolCallId, isRunning: running });
    },

    setConversationId({ commit }, { widgetId, conversationId }) {
      if (!widgetId || !conversationId) return;
      commit('SET_CONVERSATION_ID', { widgetId, conversationId });
    },

    clearConversation({ commit }, widgetId) {
      if (!widgetId) return;

      const welcomeMessage = {
        id: `widget-welcome-${Date.now()}`,
        role: 'assistant',
        content: "Hi! I'm Annie, your widget assistant. I can help you create, modify, and configure widgets. What would you like to build?",
        timestamp: Date.now(),
        metadata: ['Widget Assistant', 'Version: 1.0'],
      };

      commit('CLEAR_CONVERSATION', widgetId);
      commit('SET_CONVERSATION', { widgetId, messages: [welcomeMessage] });
    },

    setStreaming({ commit }, isStreaming) {
      commit('SET_STREAMING', isStreaming);
    },

    setLoadingSuggestions({ commit }, isLoading) {
      commit('SET_LOADING_SUGGESTIONS', isLoading);
    },

    toggleToolCallExpansion({ commit, state }, { widgetId, messageId, toolCallIndex }) {
      const currentExpanded = state.expandedToolCalls[widgetId]?.[messageId] || [];
      const newExpanded = [...currentExpanded];
      const index = newExpanded.indexOf(toolCallIndex);

      if (index > -1) {
        newExpanded.splice(index, 1);
      } else {
        newExpanded.push(toolCallIndex);
      }

      commit('SET_EXPANDED_TOOL_CALLS', {
        widgetId,
        messageId,
        expandedIndexes: newExpanded,
      });
    },

    setSuggestions({ commit }, { widgetId, suggestions }) {
      if (!widgetId || !suggestions) return;
      commit('SET_SUGGESTIONS', { widgetId, suggestions });
    },

    updateCurrentWidgetState({ commit }, widgetState) {
      commit('SET_CURRENT_WIDGET_STATE', widgetState);
    },
  },
};
