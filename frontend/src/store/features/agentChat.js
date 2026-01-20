// Load persisted conversations from localStorage
const loadPersistedConversations = () => {
  try {
    const persisted = localStorage.getItem('agentChatConversations');
    return persisted ? JSON.parse(persisted) : {};
  } catch (error) {
    console.error('Error loading persisted agent conversations:', error);
    return {};
  }
};

// Save conversations to localStorage
const saveConversations = (conversations) => {
  try {
    // Only save conversations that have messages or are actively being used
    const filteredConversations = {};
    for (const [agentId, conversation] of Object.entries(conversations)) {
      if (conversation.messages.length > 0 || conversation.conversationId) {
        filteredConversations[agentId] = conversation;
      }
    }

    localStorage.setItem('agentChatConversations', JSON.stringify(filteredConversations));
  } catch (error) {
    console.error('Error saving agent conversations to localStorage:', error);
  }
};

export default {
  namespaced: true,
  state: {
    // Store conversations by agent ID
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
    // Current agent state for synchronization
    currentAgentState: null,
  },
  mutations: {
    SET_CONVERSATION(state, { agentId, messages }) {
      if (!state.conversations[agentId]) {
        state.conversations[agentId] = {
          messages: [],
          conversationId: null,
          lastUpdate: Date.now(),
          suggestions: [],
        };
      }
      state.conversations[agentId].messages = messages;
      state.conversations[agentId].lastUpdate = Date.now();
      saveConversations(state.conversations);
    },
    ADD_MESSAGE(state, { agentId, message }) {
      if (!state.conversations[agentId]) {
        state.conversations[agentId] = {
          messages: [],
          conversationId: null,
          lastUpdate: Date.now(),
          suggestions: [],
        };
      }
      state.conversations[agentId].messages.push(message);
      state.conversations[agentId].lastUpdate = Date.now();
      saveConversations(state.conversations);
    },
    UPDATE_MESSAGE_CONTENT(state, { agentId, messageId, content }) {
      const conversation = state.conversations[agentId];
      if (conversation) {
        const message = conversation.messages.find((m) => m.id === messageId);
        if (message) {
          message.content = content;
          saveConversations(state.conversations);
        }
      }
    },
    APPEND_MESSAGE_CONTENT(state, { agentId, messageId, delta }) {
      const conversation = state.conversations[agentId];
      if (conversation) {
        const message = conversation.messages.find((m) => m.id === messageId);
        if (message) {
          message.content = (message.content || '') + delta;
          // Don't save on every delta to avoid performance issues
          // saveConversations will be called on final_content
        }
      }
    },
    ADD_TOOL_CALL(state, { agentId, messageId, toolCall }) {
      const conversation = state.conversations[agentId];
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
    UPDATE_TOOL_CALL_RESULT(state, { agentId, messageId, toolCallId, result, error }) {
      const conversation = state.conversations[agentId];
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
    SET_CONVERSATION_ID(state, { agentId, conversationId }) {
      if (!state.conversations[agentId]) {
        state.conversations[agentId] = {
          messages: [],
          conversationId: null,
          lastUpdate: Date.now(),
          suggestions: [],
        };
      }
      state.conversations[agentId].conversationId = conversationId;
      saveConversations(state.conversations);
    },
    SET_CONVERSATIONS(state, conversations) {
      state.conversations = conversations;
      saveConversations(state.conversations);
    },
    CLEAR_CONVERSATION(state, agentId) {
      if (state.conversations[agentId]) {
        state.conversations[agentId].messages = [];
        state.conversations[agentId].conversationId = null;
        state.conversations[agentId].lastUpdate = Date.now();
      }
      // Clear related UI states
      delete state.expandedToolCalls[agentId];
      delete state.runningToolCalls[agentId];
      delete state.messageStates[agentId];
      saveConversations(state.conversations);
    },
    SET_ACTIVE_CONVERSATION(state, agentId) {
      state.activeConversationId = agentId;
    },
    SET_STREAMING(state, isStreaming) {
      state.isStreaming = isStreaming;
    },
    SET_LOADING_SUGGESTIONS(state, isLoading) {
      state.isLoadingSuggestions = isLoading;
    },
    SET_EXPANDED_TOOL_CALLS(state, { agentId, messageId, expandedIndexes }) {
      if (!state.expandedToolCalls[agentId]) {
        state.expandedToolCalls[agentId] = {};
      }
      state.expandedToolCalls[agentId][messageId] = expandedIndexes;
    },
    SET_RUNNING_TOOL_CALLS(state, { agentId, messageId, toolCallId, isRunning }) {
      if (!state.runningToolCalls[agentId]) {
        state.runningToolCalls[agentId] = {};
      }
      const key = `${messageId}-${toolCallId}`;
      if (isRunning) {
        state.runningToolCalls[agentId][key] = true;
      } else {
        delete state.runningToolCalls[agentId][key];
      }
    },
    SET_MESSAGE_STATE(state, { agentId, messageId, messageState }) {
      if (!state.messageStates[agentId]) {
        state.messageStates[agentId] = {};
      }
      if (messageState) {
        state.messageStates[agentId][messageId] = messageState;
      } else {
        delete state.messageStates[agentId][messageId];
      }
    },
    SET_SUGGESTIONS(state, { agentId, suggestions }) {
      if (!state.conversations[agentId]) {
        state.conversations[agentId] = {
          messages: [],
          conversationId: null,
          lastUpdate: Date.now(),
          suggestions: [],
        };
      }
      state.conversations[agentId].suggestions = suggestions;
      state.conversations[agentId].lastUpdate = Date.now();
      saveConversations(state.conversations);
    },
    SET_CURRENT_AGENT_STATE(state, agentState) {
      state.currentAgentState = agentState;
    },
  },
  getters: {
    getConversation: (state) => (agentId) => {
      return (
        state.conversations[agentId] || {
          messages: [],
          conversationId: null,
          lastUpdate: null,
        }
      );
    },
    getMessages: (state) => (agentId) => {
      const conversation = state.conversations[agentId];
      return conversation ? conversation.messages : [];
    },
    getConversationId: (state) => (agentId) => {
      const conversation = state.conversations[agentId];
      return conversation ? conversation.conversationId : null;
    },
    getFormattedMessages: (state) => (agentId) => {
      const conversation = state.conversations[agentId];
      if (!conversation) return [];

      return conversation.messages.map((message) => ({
        ...message,
        expandedToolCalls: state.expandedToolCalls[agentId]?.[message.id] || [],
      }));
    },
    getMessageStatus: (state) => (agentId, messageId) => {
      return state.messageStates[agentId]?.[messageId] || null;
    },
    getRunningToolsForMessage: (state) => (agentId, messageId) => {
      const runningTools = state.runningToolCalls[agentId] || {};
      return Object.keys(runningTools)
        .filter((key) => key.startsWith(`${messageId}-`))
        .map((key) => key.split('-')[1]);
    },
    isStreaming: (state) => state.isStreaming,
    isLoadingSuggestions: (state) => state.isLoadingSuggestions,
    activeConversationId: (state) => state.activeConversationId,
    getSuggestions: (state) => (agentId) => {
      const conversation = state.conversations[agentId];
      return conversation ? conversation.suggestions : [];
    },
    getCurrentAgentState: (state) => state.currentAgentState,
  },
  actions: {
    // Reload conversations from localStorage
    reloadConversations({ commit, state }) {
      const persistedConversations = loadPersistedConversations();
      // Merge persisted conversations with existing ones
      const mergedConversations = { ...state.conversations, ...persistedConversations };
      commit('SET_CONVERSATIONS', mergedConversations);
    },

    initializeConversation({ commit, state }, agentId) {
      if (!agentId) return;

      // Initialize conversation if it doesn't exist
      if (!state.conversations[agentId]) {
        const welcomeMessage = {
          id: `agent-welcome-${Date.now()}`,
          role: 'assistant',
          content: "Hi! I'm Annie, your agent assistant. I can help you create, modify, and manage AI agents. What would you like to do?",
          timestamp: Date.now(),
          metadata: ['Agent Assistant', 'Version: 1.0'],
        };
        commit('SET_CONVERSATION', { agentId, messages: [welcomeMessage] });
      }
    },

    addMessage({ commit }, { agentId, message }) {
      if (!agentId || !message) return;
      commit('ADD_MESSAGE', { agentId, message });
    },

    updateMessageContent({ commit }, { agentId, messageId, content }) {
      if (!agentId || !messageId) return;
      commit('UPDATE_MESSAGE_CONTENT', { agentId, messageId, content });
    },

    addToolCall({ commit }, { agentId, messageId, toolCall }) {
      if (!agentId || !messageId || !toolCall) return;
      commit('ADD_TOOL_CALL', { agentId, messageId, toolCall });
    },

    updateToolCall({ commit }, { agentId, messageId, toolCallId, toolCall }) {
      if (!agentId || !messageId || !toolCallId) return;
      commit('UPDATE_TOOL_CALL_RESULT', { agentId, messageId, toolCallId, result: toolCall.result, error: toolCall.error });
    },

    setMessageStatus({ commit }, { agentId, messageId, status }) {
      if (!agentId || !messageId) return;
      commit('SET_MESSAGE_STATE', { agentId, messageId, messageState: status });
    },

    clearMessageStatus({ commit }, { agentId, messageId }) {
      if (!agentId || !messageId) return;
      commit('SET_MESSAGE_STATE', { agentId, messageId, messageState: null });
    },

    setRunningTool({ commit }, { agentId, messageId, toolCallId, running }) {
      if (!agentId || !messageId || !toolCallId) return;
      commit('SET_RUNNING_TOOL_CALLS', { agentId, messageId, toolCallId, isRunning: running });
    },

    setConversationId({ commit }, { agentId, conversationId }) {
      if (!agentId || !conversationId) return;
      commit('SET_CONVERSATION_ID', { agentId, conversationId });
    },

    clearConversation({ commit }, agentId) {
      if (!agentId) return;

      // Clear the conversation and reinitialize with welcome message
      const welcomeMessage = {
        id: `agent-welcome-${Date.now()}`,
        role: 'assistant',
        content: "Hi! I'm Annie, your agent assistant. I can help you create, modify, and manage AI agents. What would you like to do?",
        timestamp: Date.now(),
        metadata: ['Agent Assistant', 'Version: 1.0'],
      };

      commit('CLEAR_CONVERSATION', agentId);
      commit('SET_CONVERSATION', { agentId, messages: [welcomeMessage] });
    },

    setStreaming({ commit }, isStreaming) {
      commit('SET_STREAMING', isStreaming);
    },

    setLoadingSuggestions({ commit }, isLoading) {
      commit('SET_LOADING_SUGGESTIONS', isLoading);
    },

    toggleToolCallExpansion({ commit, state }, { agentId, messageId, toolCallIndex }) {
      const currentExpanded = state.expandedToolCalls[agentId]?.[messageId] || [];
      const newExpanded = [...currentExpanded];
      const index = newExpanded.indexOf(toolCallIndex);

      if (index > -1) {
        newExpanded.splice(index, 1);
      } else {
        newExpanded.push(toolCallIndex);
      }

      commit('SET_EXPANDED_TOOL_CALLS', {
        agentId,
        messageId,
        expandedIndexes: newExpanded,
      });
    },

    setSuggestions({ commit }, { agentId, suggestions }) {
      if (!agentId || !suggestions) return;
      commit('SET_SUGGESTIONS', { agentId, suggestions });
    },

    updateCurrentAgentState({ commit }, agentState) {
      commit('SET_CURRENT_AGENT_STATE', agentState);
    },
  },
};
