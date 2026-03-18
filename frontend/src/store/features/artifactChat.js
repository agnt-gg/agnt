// Load persisted conversations from localStorage
const loadPersistedConversations = () => {
  try {
    const persisted = localStorage.getItem('artifactChatConversations');
    return persisted ? JSON.parse(persisted) : {};
  } catch (error) {
    console.error('Error loading persisted artifact conversations:', error);
    return {};
  }
};

// Save conversations to localStorage
const saveConversations = (conversations) => {
  try {
    const filteredConversations = {};
    for (const [sessionId, conversation] of Object.entries(conversations)) {
      if (conversation.messages.length > 0 || conversation.conversationId) {
        filteredConversations[sessionId] = conversation;
      }
    }
    localStorage.setItem('artifactChatConversations', JSON.stringify(filteredConversations));
  } catch (error) {
    console.error('Error saving artifact conversations to localStorage:', error);
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
  },
  mutations: {
    SET_CONVERSATION(state, { sessionId, messages }) {
      if (!state.conversations[sessionId]) {
        state.conversations[sessionId] = {
          messages: [],
          conversationId: null,
          lastUpdate: Date.now(),
          suggestions: [],
        };
      }
      state.conversations[sessionId].messages = messages;
      state.conversations[sessionId].lastUpdate = Date.now();
      saveConversations(state.conversations);
    },
    ADD_MESSAGE(state, { sessionId, message }) {
      if (!state.conversations[sessionId]) {
        state.conversations[sessionId] = {
          messages: [],
          conversationId: null,
          lastUpdate: Date.now(),
          suggestions: [],
        };
      }
      state.conversations[sessionId].messages.push(message);
      state.conversations[sessionId].lastUpdate = Date.now();
      saveConversations(state.conversations);
    },
    UPDATE_MESSAGE_CONTENT(state, { sessionId, messageId, content }) {
      const conversation = state.conversations[sessionId];
      if (conversation) {
        const message = conversation.messages.find((m) => m.id === messageId);
        if (message) {
          message.content = content;
          saveConversations(state.conversations);
        }
      }
    },
    APPEND_MESSAGE_CONTENT(state, { sessionId, messageId, delta }) {
      const conversation = state.conversations[sessionId];
      if (conversation) {
        const message = conversation.messages.find((m) => m.id === messageId);
        if (message) {
          message.content = (message.content || '') + delta;
          // Track content parts for interleaved rendering
          if (!message.contentParts) message.contentParts = [];
          const lastPart = message.contentParts[message.contentParts.length - 1];
          if (lastPart && lastPart.type === 'text') {
            lastPart.text += delta;
          } else {
            message.contentParts.push({ type: 'text', text: delta });
          }
        }
      }
    },
    PERSIST_CONVERSATIONS(state) {
      saveConversations(state.conversations);
    },
    ADD_TOOL_CALL(state, { sessionId, messageId, toolCall }) {
      const conversation = state.conversations[sessionId];
      if (conversation) {
        const message = conversation.messages.find((m) => m.id === messageId);
        if (message) {
          if (!message.toolCalls) {
            message.toolCalls = [];
          }
          if (!message.toolCalls.some((tc) => tc.id === toolCall.id)) {
            message.toolCalls.push(toolCall);
            // Track content parts for interleaved rendering
            if (!message.contentParts) message.contentParts = [];
            message.contentParts.push({ type: 'tool_call', toolCallId: toolCall.id });
            saveConversations(state.conversations);
          }
        }
      }
    },
    UPDATE_TOOL_CALL_RESULT(state, { sessionId, messageId, toolCallId, result, error }) {
      const conversation = state.conversations[sessionId];
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
    SET_CONVERSATION_ID(state, { sessionId, conversationId }) {
      if (!state.conversations[sessionId]) {
        state.conversations[sessionId] = {
          messages: [],
          conversationId: null,
          lastUpdate: Date.now(),
          suggestions: [],
        };
      }
      state.conversations[sessionId].conversationId = conversationId;
      saveConversations(state.conversations);
    },
    SET_CONVERSATIONS(state, conversations) {
      state.conversations = conversations;
      saveConversations(state.conversations);
    },
    CLEAR_CONVERSATION(state, sessionId) {
      if (state.conversations[sessionId]) {
        state.conversations[sessionId].messages = [];
        state.conversations[sessionId].conversationId = null;
        state.conversations[sessionId].lastUpdate = Date.now();
        state.conversations[sessionId].suggestions = [];
      }
      delete state.expandedToolCalls[sessionId];
      delete state.runningToolCalls[sessionId];
      delete state.messageStates[sessionId];
      saveConversations(state.conversations);
    },
    SET_ACTIVE_CONVERSATION(state, sessionId) {
      state.activeConversationId = sessionId;
    },
    SET_STREAMING(state, isStreaming) {
      state.isStreaming = isStreaming;
    },
    SET_LOADING_SUGGESTIONS(state, isLoading) {
      state.isLoadingSuggestions = isLoading;
    },
    SET_EXPANDED_TOOL_CALLS(state, { sessionId, messageId, expandedIndexes }) {
      if (!state.expandedToolCalls[sessionId]) {
        state.expandedToolCalls[sessionId] = {};
      }
      state.expandedToolCalls[sessionId][messageId] = expandedIndexes;
    },
    SET_RUNNING_TOOL_CALLS(state, { sessionId, messageId, toolCallId, isRunning }) {
      if (!state.runningToolCalls[sessionId]) {
        state.runningToolCalls[sessionId] = {};
      }
      const key = `${messageId}-${toolCallId}`;
      if (isRunning) {
        state.runningToolCalls[sessionId][key] = true;
      } else {
        delete state.runningToolCalls[sessionId][key];
      }
    },
    SET_MESSAGE_STATE(state, { sessionId, messageId, messageState }) {
      if (!state.messageStates[sessionId]) {
        state.messageStates[sessionId] = {};
      }
      if (messageState) {
        state.messageStates[sessionId][messageId] = messageState;
      } else {
        delete state.messageStates[sessionId][messageId];
      }
    },
    SET_SUGGESTIONS(state, { sessionId, suggestions }) {
      if (!state.conversations[sessionId]) {
        state.conversations[sessionId] = {
          messages: [],
          conversationId: null,
          lastUpdate: Date.now(),
          suggestions: [],
        };
      }
      state.conversations[sessionId].suggestions = suggestions;
      state.conversations[sessionId].lastUpdate = Date.now();
      saveConversations(state.conversations);
    },
  },
  getters: {
    getConversation: (state) => (sessionId) => {
      return (
        state.conversations[sessionId] || {
          messages: [],
          conversationId: null,
          lastUpdate: null,
        }
      );
    },
    getMessages: (state) => (sessionId) => {
      const conversation = state.conversations[sessionId];
      return conversation ? conversation.messages : [];
    },
    getConversationId: (state) => (sessionId) => {
      const conversation = state.conversations[sessionId];
      return conversation ? conversation.conversationId : null;
    },
    getFormattedMessages: (state) => (sessionId) => {
      const conversation = state.conversations[sessionId];
      if (!conversation) return [];
      return conversation.messages.map((message) => ({
        ...message,
        expandedToolCalls: state.expandedToolCalls[sessionId]?.[message.id] || [],
      }));
    },
    getMessageStatus: (state) => (sessionId, messageId) => {
      return state.messageStates[sessionId]?.[messageId] || null;
    },
    getRunningToolsForMessage: (state) => (sessionId, messageId) => {
      const runningTools = state.runningToolCalls[sessionId] || {};
      return Object.keys(runningTools)
        .filter((key) => key.startsWith(`${messageId}-`))
        .map((key) => key.split('-')[1]);
    },
    isStreaming: (state) => state.isStreaming,
    isLoadingSuggestions: (state) => state.isLoadingSuggestions,
    activeConversationId: (state) => state.activeConversationId,
    getSuggestions: (state) => (sessionId) => {
      const conversation = state.conversations[sessionId];
      return conversation ? conversation.suggestions : [];
    },
  },
  actions: {
    reloadConversations({ commit, state }) {
      const persistedConversations = loadPersistedConversations();
      const mergedConversations = { ...state.conversations, ...persistedConversations };
      commit('SET_CONVERSATIONS', mergedConversations);
    },

    initializeConversation({ commit, state }, sessionId) {
      if (!sessionId) return;
      if (!state.conversations[sessionId]) {
        const welcomeMessage = {
          id: `artifact-welcome-${Date.now()}`,
          role: 'assistant',
          content: "Hi! I'm Annie, your artifacts assistant. I can help you create, edit, and explore files in your workspace — code, documents, visualizations, and more. What would you like to work on?",
          timestamp: Date.now(),
        };
        commit('SET_CONVERSATION', { sessionId, messages: [welcomeMessage] });
      }
    },

    addMessage({ commit }, { sessionId, message }) {
      if (!sessionId || !message) return;
      commit('ADD_MESSAGE', { sessionId, message });
    },

    updateMessageContent({ commit }, { sessionId, messageId, content }) {
      if (!sessionId || !messageId) return;
      commit('UPDATE_MESSAGE_CONTENT', { sessionId, messageId, content });
    },

    addToolCall({ commit }, { sessionId, messageId, toolCall }) {
      if (!sessionId || !messageId || !toolCall) return;
      commit('ADD_TOOL_CALL', { sessionId, messageId, toolCall });
    },

    updateToolCall({ commit }, { sessionId, messageId, toolCallId, toolCall }) {
      if (!sessionId || !messageId || !toolCallId) return;
      commit('UPDATE_TOOL_CALL_RESULT', { sessionId, messageId, toolCallId, result: toolCall.result, error: toolCall.error });
    },

    setMessageStatus({ commit }, { sessionId, messageId, status }) {
      if (!sessionId || !messageId) return;
      commit('SET_MESSAGE_STATE', { sessionId, messageId, messageState: status });
    },

    clearMessageStatus({ commit }, { sessionId, messageId }) {
      if (!sessionId || !messageId) return;
      commit('SET_MESSAGE_STATE', { sessionId, messageId, messageState: null });
    },

    setRunningTool({ commit }, { sessionId, messageId, toolCallId, running }) {
      if (!sessionId || !messageId || !toolCallId) return;
      commit('SET_RUNNING_TOOL_CALLS', { sessionId, messageId, toolCallId, isRunning: running });
    },

    setConversationId({ commit }, { sessionId, conversationId }) {
      if (!sessionId || !conversationId) return;
      commit('SET_CONVERSATION_ID', { sessionId, conversationId });
    },

    clearConversation({ commit }, sessionId) {
      if (!sessionId) return;
      const welcomeMessage = {
        id: `artifact-welcome-${Date.now()}`,
        role: 'assistant',
        content: "Hi! I'm Annie, your artifacts assistant. I can help you create, edit, and explore files in your workspace — code, documents, visualizations, and more. What would you like to work on?",
        timestamp: Date.now(),
      };
      commit('CLEAR_CONVERSATION', sessionId);
      commit('SET_CONVERSATION', { sessionId, messages: [welcomeMessage] });
    },

    setStreaming({ commit }, isStreaming) {
      commit('SET_STREAMING', isStreaming);
    },

    setLoadingSuggestions({ commit }, isLoading) {
      commit('SET_LOADING_SUGGESTIONS', isLoading);
    },

    toggleToolCallExpansion({ commit, state }, { sessionId, messageId, toolCallIndex }) {
      const currentExpanded = state.expandedToolCalls[sessionId]?.[messageId] || [];
      const newExpanded = [...currentExpanded];
      const index = newExpanded.indexOf(toolCallIndex);
      if (index > -1) {
        newExpanded.splice(index, 1);
      } else {
        newExpanded.push(toolCallIndex);
      }
      commit('SET_EXPANDED_TOOL_CALLS', { sessionId, messageId, expandedIndexes: newExpanded });
    },

    setSuggestions({ commit }, { sessionId, suggestions }) {
      if (!sessionId || !suggestions) return;
      commit('SET_SUGGESTIONS', { sessionId, suggestions });
    },
  },
};
