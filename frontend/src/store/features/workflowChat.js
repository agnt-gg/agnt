// Load persisted conversations from localStorage
const loadPersistedConversations = () => {
  try {
    const persisted = localStorage.getItem('workflowChatConversations');
    return persisted ? JSON.parse(persisted) : {};
  } catch (error) {
    console.error('Error loading persisted conversations:', error);
    return {};
  }
};

// Save conversations to localStorage
const saveConversations = (conversations) => {
  try {
    // Only save conversations that have messages or are actively being used
    const filteredConversations = {};
    for (const [workflowId, conversation] of Object.entries(conversations)) {
      if (conversation.messages.length > 0 || conversation.conversationId) {
        filteredConversations[workflowId] = conversation;
      }
    }

    localStorage.setItem('workflowChatConversations', JSON.stringify(filteredConversations));
  } catch (error) {
    console.error('Error saving conversations to localStorage:', error);
  }
};

export default {
  namespaced: true,
  state: {
    // Store conversations by workflow ID
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
  },
  mutations: {
    SET_CONVERSATION(state, { workflowId, messages }) {
      if (!state.conversations[workflowId]) {
        state.conversations[workflowId] = {
          messages: [],
          conversationId: null,
          lastUpdate: Date.now(),
          suggestions: [],
        };
      }
      state.conversations[workflowId].messages = messages;
      state.conversations[workflowId].lastUpdate = Date.now();
      saveConversations(state.conversations);
    },
    ADD_MESSAGE(state, { workflowId, message }) {
      if (!state.conversations[workflowId]) {
        state.conversations[workflowId] = {
          messages: [],
          conversationId: null,
          lastUpdate: Date.now(),
          suggestions: [],
        };
      }
      state.conversations[workflowId].messages.push(message);
      state.conversations[workflowId].lastUpdate = Date.now();
      saveConversations(state.conversations);
    },
    UPDATE_MESSAGE_CONTENT(state, { workflowId, messageId, content }) {
      const conversation = state.conversations[workflowId];
      if (conversation) {
        const message = conversation.messages.find((m) => m.id === messageId);
        if (message) {
          message.content = content;
          saveConversations(state.conversations);
        }
      }
    },
    APPEND_MESSAGE_CONTENT(state, { workflowId, messageId, delta }) {
      const conversation = state.conversations[workflowId];
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
    ADD_TOOL_CALL(state, { workflowId, messageId, toolCall }) {
      const conversation = state.conversations[workflowId];
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
    UPDATE_TOOL_CALL_RESULT(state, { workflowId, messageId, toolCallId, result, error }) {
      const conversation = state.conversations[workflowId];
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
    SET_CONVERSATION_ID(state, { workflowId, conversationId }) {
      if (!state.conversations[workflowId]) {
        state.conversations[workflowId] = {
          messages: [],
          conversationId: null,
          lastUpdate: Date.now(),
          suggestions: [],
        };
      }
      state.conversations[workflowId].conversationId = conversationId;
      saveConversations(state.conversations);
    },
    SET_CONVERSATIONS(state, conversations) {
      state.conversations = conversations;
      saveConversations(state.conversations);
    },
    CLEAR_CONVERSATION(state, workflowId) {
      if (state.conversations[workflowId]) {
        state.conversations[workflowId].messages = [];
        state.conversations[workflowId].conversationId = null;
        state.conversations[workflowId].lastUpdate = Date.now();
      }
      // Clear related UI states
      delete state.expandedToolCalls[workflowId];
      delete state.runningToolCalls[workflowId];
      delete state.messageStates[workflowId];
      saveConversations(state.conversations);
    },
    SET_ACTIVE_CONVERSATION(state, workflowId) {
      state.activeConversationId = workflowId;
    },
    SET_STREAMING(state, isStreaming) {
      state.isStreaming = isStreaming;
    },
    SET_LOADING_SUGGESTIONS(state, isLoading) {
      state.isLoadingSuggestions = isLoading;
    },
    SET_EXPANDED_TOOL_CALLS(state, { workflowId, messageId, expandedIndexes }) {
      if (!state.expandedToolCalls[workflowId]) {
        state.expandedToolCalls[workflowId] = {};
      }
      state.expandedToolCalls[workflowId][messageId] = expandedIndexes;
    },
    SET_RUNNING_TOOL_CALLS(state, { workflowId, messageId, toolCallId, isRunning }) {
      if (!state.runningToolCalls[workflowId]) {
        state.runningToolCalls[workflowId] = {};
      }
      const key = `${messageId}-${toolCallId}`;
      if (isRunning) {
        state.runningToolCalls[workflowId][key] = true;
      } else {
        delete state.runningToolCalls[workflowId][key];
      }
    },
    SET_MESSAGE_STATE(state, { workflowId, messageId, messageState }) {
      if (!state.messageStates[workflowId]) {
        state.messageStates[workflowId] = {};
      }
      if (messageState) {
        state.messageStates[workflowId][messageId] = messageState;
      } else {
        delete state.messageStates[workflowId][messageId];
      }
    },
    SET_SUGGESTIONS(state, { workflowId, suggestions }) {
      if (!state.conversations[workflowId]) {
        state.conversations[workflowId] = {
          messages: [],
          conversationId: null,
          lastUpdate: Date.now(),
          suggestions: [],
        };
      }
      state.conversations[workflowId].suggestions = suggestions;
      state.conversations[workflowId].lastUpdate = Date.now();
      saveConversations(state.conversations);
    },
  },
  getters: {
    getConversation: (state) => (workflowId) => {
      return (
        state.conversations[workflowId] || {
          messages: [],
          conversationId: null,
          lastUpdate: null,
        }
      );
    },
    getMessages: (state) => (workflowId) => {
      const conversation = state.conversations[workflowId];
      return conversation ? conversation.messages : [];
    },
    getConversationId: (state) => (workflowId) => {
      const conversation = state.conversations[workflowId];
      return conversation ? conversation.conversationId : null;
    },
    getFormattedMessages: (state) => (workflowId) => {
      const conversation = state.conversations[workflowId];
      if (!conversation) return [];

      return conversation.messages.map((message) => ({
        ...message,
        expandedToolCalls: state.expandedToolCalls[workflowId]?.[message.id] || [],
      }));
    },
    getMessageStatus: (state) => (workflowId, messageId) => {
      return state.messageStates[workflowId]?.[messageId] || null;
    },
    getRunningToolsForMessage: (state) => (workflowId, messageId) => {
      const runningTools = state.runningToolCalls[workflowId] || {};
      return Object.keys(runningTools)
        .filter((key) => key.startsWith(`${messageId}-`))
        .map((key) => key.split('-')[1]);
    },
    isStreaming: (state) => state.isStreaming,
    isLoadingSuggestions: (state) => state.isLoadingSuggestions,
    activeConversationId: (state) => state.activeConversationId,
    getSuggestions: (state) => (workflowId) => {
      const conversation = state.conversations[workflowId];
      return conversation ? conversation.suggestions : [];
    },
  },
  actions: {
    // Reload conversations from localStorage
    reloadConversations({ commit, state }) {
      const persistedConversations = loadPersistedConversations();
      // Merge persisted conversations with existing ones
      const mergedConversations = { ...state.conversations, ...persistedConversations };
      commit('SET_CONVERSATIONS', mergedConversations);
    },

    initializeConversation({ commit, state }, workflowId) {
      if (!workflowId) return;

      // Initialize conversation if it doesn't exist
      if (!state.conversations[workflowId]) {
        const welcomeMessage = {
          id: `wf-welcome-${Date.now()}`,
          role: 'assistant',
          content:
            "Hi! I'm Annie, your workflow assistant. I can help you build workflows, explain nodes, and answer questions about the workflow designer. What would you like to know?",
          timestamp: Date.now(),
          metadata: ['Workflow Assistant', 'Version: 1.0'],
        };
        commit('SET_CONVERSATION', { workflowId, messages: [welcomeMessage] });
      }
    },

    addMessage({ commit }, { workflowId, message }) {
      if (!workflowId || !message) return;
      commit('ADD_MESSAGE', { workflowId, message });
    },

    updateMessageContent({ commit }, { workflowId, messageId, content }) {
      if (!workflowId || !messageId) return;
      commit('UPDATE_MESSAGE_CONTENT', { workflowId, messageId, content });
    },

    addToolCall({ commit }, { workflowId, messageId, toolCall }) {
      if (!workflowId || !messageId || !toolCall) return;
      commit('ADD_TOOL_CALL', { workflowId, messageId, toolCall });
    },

    updateToolCall({ commit }, { workflowId, messageId, toolCallId, toolCall }) {
      if (!workflowId || !messageId || !toolCallId) return;
      commit('UPDATE_TOOL_CALL_RESULT', { workflowId, messageId, toolCallId, result: toolCall.result, error: toolCall.error });
    },

    setMessageStatus({ commit }, { workflowId, messageId, status }) {
      if (!workflowId || !messageId) return;
      commit('SET_MESSAGE_STATE', { workflowId, messageId, messageState: status });
    },

    clearMessageStatus({ commit }, { workflowId, messageId }) {
      if (!workflowId || !messageId) return;
      commit('SET_MESSAGE_STATE', { workflowId, messageId, messageState: null });
    },

    setRunningTool({ commit }, { workflowId, messageId, toolCallId, running }) {
      if (!workflowId || !messageId || !toolCallId) return;
      commit('SET_RUNNING_TOOL_CALLS', { workflowId, messageId, toolCallId, isRunning: running });
    },

    setConversationId({ commit }, { workflowId, conversationId }) {
      if (!workflowId || !conversationId) return;
      commit('SET_CONVERSATION_ID', { workflowId, conversationId });
    },

    clearConversation({ commit }, workflowId) {
      if (!workflowId) return;

      // Clear the conversation and reinitialize with welcome message
      const welcomeMessage = {
        id: `wf-welcome-${Date.now()}`,
        role: 'assistant',
        content:
          "Hi! I'm Annie, your workflow assistant. I can help you build workflows, explain nodes, and answer questions about the workflow designer. What would you like to know?",
        timestamp: Date.now(),
        metadata: ['Workflow Assistant', 'Version: 1.0'],
      };

      commit('CLEAR_CONVERSATION', workflowId);
      commit('SET_CONVERSATION', { workflowId, messages: [welcomeMessage] });
    },

    setStreaming({ commit }, isStreaming) {
      commit('SET_STREAMING', isStreaming);
    },

    setLoadingSuggestions({ commit }, isLoading) {
      commit('SET_LOADING_SUGGESTIONS', isLoading);
    },

    toggleToolCallExpansion({ commit, state }, { workflowId, messageId, toolCallIndex }) {
      const currentExpanded = state.expandedToolCalls[workflowId]?.[messageId] || [];
      const newExpanded = [...currentExpanded];
      const index = newExpanded.indexOf(toolCallIndex);

      if (index > -1) {
        newExpanded.splice(index, 1);
      } else {
        newExpanded.push(toolCallIndex);
      }

      commit('SET_EXPANDED_TOOL_CALLS', {
        workflowId,
        messageId,
        expandedIndexes: newExpanded,
      });
    },

    setSuggestions({ commit }, { workflowId, suggestions }) {
      if (!workflowId || !suggestions) return;
      commit('SET_SUGGESTIONS', { workflowId, suggestions });
    },
  },
};
