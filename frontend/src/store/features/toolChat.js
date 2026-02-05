// Load persisted conversations from localStorage
const loadPersistedConversations = () => {
  try {
    const persisted = localStorage.getItem('toolChatConversations');
    return persisted ? JSON.parse(persisted) : {};
  } catch (error) {
    console.error('Error loading persisted tool conversations:', error);
    return {};
  }
};

// Save conversations to localStorage
const saveConversations = (conversations) => {
  try {
    // Only save conversations that have messages or are actively being used
    const filteredConversations = {};
    for (const [toolId, conversation] of Object.entries(conversations)) {
      if (conversation.messages.length > 0 || conversation.conversationId) {
        filteredConversations[toolId] = conversation;
      }
    }

    localStorage.setItem('toolChatConversations', JSON.stringify(filteredConversations));
  } catch (error) {
    console.error('Error saving tool conversations to localStorage:', error);
  }
};

export default {
  namespaced: true,
  state: {
    // Store conversations by tool ID
    conversations: loadPersistedConversations(),
    // Current active conversation ID
    activeConversationId: null,
    // Loading states
    isStreaming: false,
    isLoadingSuggestions: false,
    // Message states for tool execution tracking
    expandedToolCalls: {},
    runningToolCalls: {},
    messageStates: {},
    // Current tool state for synchronization
    currentToolState: null,
  },
  mutations: {
    SET_CONVERSATION(state, { toolId, messages }) {
      if (!state.conversations[toolId]) {
        state.conversations[toolId] = {
          messages: [],
          conversationId: null,
          lastUpdate: Date.now(),
          suggestions: [],
        };
      }
      state.conversations[toolId].messages = messages;
      state.conversations[toolId].lastUpdate = Date.now();
      saveConversations(state.conversations);
    },
    ADD_MESSAGE(state, { toolId, message }) {
      if (!state.conversations[toolId]) {
        state.conversations[toolId] = {
          messages: [],
          conversationId: null,
          lastUpdate: Date.now(),
          suggestions: [],
        };
      }
      state.conversations[toolId].messages.push(message);
      state.conversations[toolId].lastUpdate = Date.now();
      saveConversations(state.conversations);
    },
    UPDATE_MESSAGE_CONTENT(state, { toolId, messageId, content }) {
      const conversation = state.conversations[toolId];
      if (conversation) {
        const message = conversation.messages.find((m) => m.id === messageId);
        if (message) {
          message.content = content;
          saveConversations(state.conversations);
        }
      }
    },
    APPEND_MESSAGE_CONTENT(state, { toolId, messageId, delta }) {
      const conversation = state.conversations[toolId];
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
    ADD_TOOL_CALL(state, { toolId, messageId, toolCall }) {
      const conversation = state.conversations[toolId];
      if (conversation) {
        const message = conversation.messages.find((m) => m.id === messageId);
        if (message) {
          if (!message.toolCalls) {
            message.toolCalls = [];
          }
          // Avoid adding duplicates
          if (!message.toolCalls.some((tc) => tc.id === toolCall.id)) {
            message.toolCalls.push(toolCall);
            saveConversations(state.conversations);
          }
        }
      }
    },
    UPDATE_TOOL_CALL_RESULT(state, { toolId, messageId, toolCallId, result, error }) {
      const conversation = state.conversations[toolId];
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
    SET_CONVERSATION_ID(state, { toolId, conversationId }) {
      if (!state.conversations[toolId]) {
        state.conversations[toolId] = {
          messages: [],
          conversationId: null,
          lastUpdate: Date.now(),
          suggestions: [],
        };
      }
      state.conversations[toolId].conversationId = conversationId;
      saveConversations(state.conversations);
    },
    SET_CONVERSATIONS(state, conversations) {
      state.conversations = conversations;
      saveConversations(state.conversations);
    },
    CLEAR_CONVERSATION(state, toolId) {
      if (state.conversations[toolId]) {
        state.conversations[toolId].messages = [];
        state.conversations[toolId].conversationId = null;
        state.conversations[toolId].lastUpdate = Date.now();
        state.conversations[toolId].suggestions = [];
      }
      // Clear related UI states
      delete state.expandedToolCalls[toolId];
      delete state.runningToolCalls[toolId];
      delete state.messageStates[toolId];
      saveConversations(state.conversations);
    },
    SET_ACTIVE_CONVERSATION(state, toolId) {
      state.activeConversationId = toolId;
    },
    SET_STREAMING(state, isStreaming) {
      state.isStreaming = isStreaming;
    },
    SET_LOADING_SUGGESTIONS(state, isLoading) {
      state.isLoadingSuggestions = isLoading;
    },
    SET_EXPANDED_TOOL_CALLS(state, { toolId, messageId, expandedIndexes }) {
      if (!state.expandedToolCalls[toolId]) {
        state.expandedToolCalls[toolId] = {};
      }
      state.expandedToolCalls[toolId][messageId] = expandedIndexes;
    },
    SET_RUNNING_TOOL_CALLS(state, { toolId, messageId, toolCallId, isRunning }) {
      if (!state.runningToolCalls[toolId]) {
        state.runningToolCalls[toolId] = {};
      }
      const key = `${messageId}-${toolCallId}`;
      if (isRunning) {
        state.runningToolCalls[toolId][key] = true;
      } else {
        delete state.runningToolCalls[toolId][key];
      }
    },
    SET_MESSAGE_STATE(state, { toolId, messageId, messageState }) {
      if (!state.messageStates[toolId]) {
        state.messageStates[toolId] = {};
      }
      if (messageState) {
        state.messageStates[toolId][messageId] = messageState;
      } else {
        delete state.messageStates[toolId][messageId];
      }
    },
    SET_SUGGESTIONS(state, { toolId, suggestions }) {
      if (!state.conversations[toolId]) {
        state.conversations[toolId] = {
          messages: [],
          conversationId: null,
          lastUpdate: Date.now(),
          suggestions: [],
        };
      }
      state.conversations[toolId].suggestions = suggestions;
      state.conversations[toolId].lastUpdate = Date.now();
      saveConversations(state.conversations);
    },
    SET_CURRENT_TOOL_STATE(state, toolState) {
      state.currentToolState = toolState;
    },
  },
  getters: {
    getConversation: (state) => (toolId) => {
      return (
        state.conversations[toolId] || {
          messages: [],
          conversationId: null,
          lastUpdate: null,
        }
      );
    },
    getMessages: (state) => (toolId) => {
      const conversation = state.conversations[toolId];
      return conversation ? conversation.messages : [];
    },
    getConversationId: (state) => (toolId) => {
      const conversation = state.conversations[toolId];
      return conversation ? conversation.conversationId : null;
    },
    getFormattedMessages: (state) => (toolId) => {
      const conversation = state.conversations[toolId];
      if (!conversation) return [];

      return conversation.messages.map((message) => ({
        ...message,
        expandedToolCalls: state.expandedToolCalls[toolId]?.[message.id] || [],
      }));
    },
    getMessageStatus: (state) => (toolId, messageId) => {
      return state.messageStates[toolId]?.[messageId] || null;
    },
    getRunningToolsForMessage: (state) => (toolId, messageId) => {
      const runningTools = state.runningToolCalls[toolId] || {};
      return Object.keys(runningTools)
        .filter((key) => key.startsWith(`${messageId}-`))
        .map((key) => key.split('-')[1]);
    },
    isStreaming: (state) => state.isStreaming,
    isLoadingSuggestions: (state) => state.isLoadingSuggestions,
    activeConversationId: (state) => state.activeConversationId,
    getSuggestions: (state) => (toolId) => {
      const conversation = state.conversations[toolId];
      return conversation ? conversation.suggestions : [];
    },
    getCurrentToolState: (state) => state.currentToolState,
  },
  actions: {
    // Reload conversations from localStorage
    reloadConversations({ commit, state }) {
      const persistedConversations = loadPersistedConversations();
      // Merge persisted conversations with existing ones
      const mergedConversations = { ...state.conversations, ...persistedConversations };
      commit('SET_CONVERSATIONS', mergedConversations);
    },

    initializeConversation({ commit, state }, toolId) {
      if (!toolId) return;

      // Initialize conversation if it doesn't exist
      if (!state.conversations[toolId]) {
        const welcomeMessage = {
          id: `tool-welcome-${Date.now()}`,
          role: 'assistant',
          content: "Hi! I'm Annie, your tool assistant. I can help you create, modify, and test tools. What would you like to do?",
          timestamp: Date.now(),
          metadata: ['Tool Assistant', 'Version: 1.0'],
        };
        commit('SET_CONVERSATION', { toolId, messages: [welcomeMessage] });
      }
    },

    addMessage({ commit }, { toolId, message }) {
      if (!toolId || !message) return;
      commit('ADD_MESSAGE', { toolId, message });
    },

    updateMessageContent({ commit }, { toolId, messageId, content }) {
      if (!toolId || !messageId) return;
      commit('UPDATE_MESSAGE_CONTENT', { toolId, messageId, content });
    },

    addToolCall({ commit }, { toolId, messageId, toolCall }) {
      if (!toolId || !messageId || !toolCall) return;
      commit('ADD_TOOL_CALL', { toolId, messageId, toolCall });
    },

    updateToolCall({ commit }, { toolId, messageId, toolCallId, toolCall }) {
      if (!toolId || !messageId || !toolCallId) return;
      commit('UPDATE_TOOL_CALL_RESULT', { toolId, messageId, toolCallId, result: toolCall.result, error: toolCall.error });
    },

    setMessageStatus({ commit }, { toolId, messageId, status }) {
      if (!toolId || !messageId) return;
      commit('SET_MESSAGE_STATE', { toolId, messageId, messageState: status });
    },

    clearMessageStatus({ commit }, { toolId, messageId }) {
      if (!toolId || !messageId) return;
      commit('SET_MESSAGE_STATE', { toolId, messageId, messageState: null });
    },

    setRunningTool({ commit }, { toolId, messageId, toolCallId, running }) {
      if (!toolId || !messageId || !toolCallId) return;
      commit('SET_RUNNING_TOOL_CALLS', { toolId, messageId, toolCallId, isRunning: running });
    },

    setConversationId({ commit }, { toolId, conversationId }) {
      if (!toolId || !conversationId) return;
      commit('SET_CONVERSATION_ID', { toolId, conversationId });
    },

    clearConversation({ commit }, toolId) {
      if (!toolId) return;

      // Clear the conversation and reinitialize with welcome message
      const welcomeMessage = {
        id: `tool-welcome-${Date.now()}`,
        role: 'assistant',
        content: "Hi! I'm Annie, your tool assistant. I can help you create, modify, and test tools. What would you like to do?",
        timestamp: Date.now(),
        metadata: ['Tool Assistant', 'Version: 1.0'],
      };

      commit('CLEAR_CONVERSATION', toolId);
      commit('SET_CONVERSATION', { toolId, messages: [welcomeMessage] });
    },

    setStreaming({ commit }, isStreaming) {
      commit('SET_STREAMING', isStreaming);
    },

    setLoadingSuggestions({ commit }, isLoading) {
      commit('SET_LOADING_SUGGESTIONS', isLoading);
    },

    toggleToolCallExpansion({ commit, state }, { toolId, messageId, toolCallIndex }) {
      const currentExpanded = state.expandedToolCalls[toolId]?.[messageId] || [];
      const newExpanded = [...currentExpanded];
      const index = newExpanded.indexOf(toolCallIndex);

      if (index > -1) {
        newExpanded.splice(index, 1);
      } else {
        newExpanded.push(toolCallIndex);
      }

      commit('SET_EXPANDED_TOOL_CALLS', {
        toolId,
        messageId,
        expandedIndexes: newExpanded,
      });
    },

    setSuggestions({ commit }, { toolId, suggestions }) {
      if (!toolId || !suggestions) return;
      commit('SET_SUGGESTIONS', { toolId, suggestions });
    },

    updateCurrentToolState({ commit }, toolState) {
      commit('SET_CURRENT_TOOL_STATE', toolState);
    },
  },
};
