import { Message, ChatWindow } from '@/views/_components/base/ChatWindow';
import { API_CONFIG } from '@/tt.config.js';

const MAX_MESSAGES = 100; // Limit messages to prevent memory leaks
const MAX_IMAGE_CACHE = 50; // LRU limit for image cache
const MAX_DATA_CACHE = 50; // LRU limit for data cache
const MAX_AGENT_CONVERSATIONS = 20; // LRU limit for agent conversation cache

export default {
  namespaced: true,
  state: {
    mainChatWindow: new ChatWindow(),
    activeStreamId: null,
    isStreaming: false,
    isRemoteStreaming: false, // True when another tab is streaming (for "thinking" indicator)
    messageCount: 0,
    messages: [],
    page: null,
    // Stream processing state
    activeStream: null,
    streamReader: null,
    streamAbortController: null,
    currentConversationId: null,
    // Event callbacks for stream events
    streamEventCallbacks: [],
    // Image cache for generated images
    imageCache: new Map(),
    // Data cache for offloaded large content (DATA_REF resolution)
    dataCache: new Map(),
    // Autosave state
    savedOutputId: null,
    lastSaveTimestamp: null,
    isSaving: false,
    autosaveEnabled: true,
    saveStatus: null, // 'saving', 'saved', 'error'
    autosaveDebounceTimer: null,
    // Agent chat support - unified with main chat
    currentAgentId: null, // ID of agent being chatted with (null for main chat)
    currentAgentName: null, // Name of agent for display
    currentAgentAvatar: null, // Avatar URL for agent
    // Agent conversation cache - stores conversations per agent for quick switching
    agentConversations: {}, // { agentId: { messages: [], conversationId: null, savedOutputId: null } }
  },
  mutations: {
    SET_PAGE(state, page) {
      state.page = page;
    },
    SET_STREAMING(state, value) {
      state.isStreaming = value;
    },
    SET_REMOTE_STREAMING(state, value) {
      state.isRemoteStreaming = value;
    },
    SET_ACTIVE_STREAM(state, value) {
      state.activeStreamId = value;
    },
    SET_STREAM_READER(state, reader) {
      state.streamReader = reader;
    },
    SET_STREAM_ABORT_CONTROLLER(state, controller) {
      state.streamAbortController = controller;
    },
    SET_CONVERSATION_ID(state, id) {
      state.currentConversationId = id;
    },
    ADD_STREAM_EVENT_CALLBACK(state, callback) {
      state.streamEventCallbacks.push(callback);
    },
    REMOVE_STREAM_EVENT_CALLBACK(state, callback) {
      const index = state.streamEventCallbacks.indexOf(callback);
      if (index > -1) {
        state.streamEventCallbacks.splice(index, 1);
      }
    },
    CLEAR_STREAM_EVENT_CALLBACKS(state) {
      state.streamEventCallbacks = [];
    },
    ADD_MESSAGE(state, message) {
      if (message && message.role && message.content !== undefined) {
        state.messages.push(message);

        // Prevent memory leak by limiting message history
        if (state.messages.length > MAX_MESSAGES) {
          state.messages.splice(0, state.messages.length - MAX_MESSAGES);
        }
      } else {
        console.error('Invalid message format pushed to store:', message);
      }
    },
    REMOVE_MESSAGE(state, messageId) {
      const index = state.messages.findIndex(m => m.id === messageId);
      if (index !== -1) {
        state.messages.splice(index, 1);
      }
    },
    UPDATE_MESSAGE_CONTENT(state, { messageId, content }) {
      const message = state.messages.find((m) => m.id === messageId);
      if (message) {
        message.content = content;
      }
    },
    APPEND_MESSAGE_CONTENT(state, { messageId, delta }) {
      const message = state.messages.find((m) => m.id === messageId);
      if (message) {
        message.content = (message.content || '') + delta;
      }
    },
    ADD_TOOL_CALL(state, { messageId, toolCall }) {
      const message = state.messages.find((m) => m.id === messageId);
      if (message) {
        if (!message.toolCalls) {
          message.toolCalls = [];
        }
        // Avoid adding duplicates
        if (!message.toolCalls.some((tc) => tc.id === toolCall.id)) {
          message.toolCalls.push(toolCall);
        }
      }
    },
    UPDATE_TOOL_CALL_RESULT(state, { messageId, toolCallId, result, error, status }) {
      console.log('🔧 UPDATE_TOOL_CALL_RESULT called:', { messageId, toolCallId, result, error, status });

      // If messageId is provided, search that specific message
      let message = messageId ? state.messages.find((m) => m.id === messageId) : null;

      // If no messageId or message not found, search all messages for the toolCallId
      if (!message) {
        console.log('🔧 No messageId or message not found, searching all messages for toolCallId:', toolCallId);
        for (const msg of state.messages) {
          if (msg.toolCalls && msg.toolCalls.some(tc => tc.id === toolCallId)) {
            message = msg;
            console.log('🔧 Found message with toolCallId:', msg.id);
            break;
          }
        }
      }

      console.log('🔧 Found message:', message ? message.id : 'NOT FOUND');
      if (message && message.toolCalls) {
        console.log('🔧 Message has', message.toolCalls.length, 'tool calls');
        const toolCall = message.toolCalls.find((tc) => tc.id === toolCallId);
        console.log('🔧 Found toolCall:', toolCall ? toolCall.name : 'NOT FOUND');
        if (toolCall) {
          toolCall.result = result;
          toolCall.error = error;
          if (status) {
            toolCall.status = status;
          }
          console.log('✅ Updated toolCall.result to:', toolCall.result);
        }
      }
    },
    RESET_CHAT(state) {
      state.activeStreamId = null;
      state.isStreaming = false;
      state.isRemoteStreaming = false;
      state.messages = [];
      state.currentConversationId = null;
      state.imageCache.clear();

      // Clear current agent context to prevent stale agent names in outputs
      state.currentAgentId = null;
      state.currentAgentName = null;
      state.currentAgentAvatar = null;

      // Clear ChatWindow maps to prevent memory leaks
      if (state.mainChatWindow) {
        state.mainChatWindow.messages.clear();
        state.mainChatWindow.threads.clear();
      }

      // Clear autosave state
      if (state.autosaveDebounceTimer) {
        clearTimeout(state.autosaveDebounceTimer);
      }
      state.savedOutputId = null;
      state.lastSaveTimestamp = null;
      state.isSaving = false;
      state.saveStatus = null;
      state.autosaveDebounceTimer = null;
    },
    ADD_IMAGE_TO_CACHE(state, { imageId, imageData, toolCallId, messageId, index }) {
      // LRU eviction - remove oldest entries if cache is full
      if (state.imageCache.size >= MAX_IMAGE_CACHE) {
        const oldestKey = state.imageCache.keys().next().value;
        state.imageCache.delete(oldestKey);
      }
      state.imageCache.set(imageId, {
        data: imageData,
        toolCallId: toolCallId,
        messageId: messageId,
        index: index,
      });
    },
    ADD_DATA_TO_CACHE(state, { dataId, fullContent, toolCallId, messageId, size, path }) {
      // LRU eviction - remove oldest entries if cache is full
      if (state.dataCache.size >= MAX_DATA_CACHE) {
        const oldestKey = state.dataCache.keys().next().value;
        state.dataCache.delete(oldestKey);
      }
      state.dataCache.set(dataId, {
        content: fullContent,
        toolCallId: toolCallId,
        messageId: messageId,
        size: size,
        path: path,
      });
    },
    RECEIVE_MESSAGE(state, { id, sender, content, timestamp }) {
      const message = new Message(id, sender, content, timestamp);
      state.mainChatWindow.receiveMessage(message);

      // Prevent memory leak by limiting ChatWindow message history
      if (state.mainChatWindow.messages.size > MAX_MESSAGES) {
        const oldestKey = state.mainChatWindow.messages.keys().next().value;
        state.mainChatWindow.messages.delete(oldestKey);
      }
    },
    CREATE_THREAD(state, messageId) {
      state.mainChatWindow.createThread(messageId);
    },
    ADD_MESSAGE_TO_THREAD(state, { threadId, id, sender, content, timestamp }) {
      const message = new Message(id, sender, content, timestamp);
      state.mainChatWindow.threads.get(threadId)?.addMessage(message);
    },
    INCREMENT_MESSAGE_COUNT(state) {
      state.messageCount += 1;
    },
    SET_SAVED_OUTPUT_ID(state, id) {
      state.savedOutputId = id;
    },
    SET_LAST_SAVE_TIMESTAMP(state, timestamp) {
      state.lastSaveTimestamp = timestamp;
    },
    SET_IS_SAVING(state, value) {
      state.isSaving = value;
    },
    SET_SAVE_STATUS(state, status) {
      state.saveStatus = status;
    },
    SET_AUTOSAVE_ENABLED(state, value) {
      state.autosaveEnabled = value;
    },
    SET_AUTOSAVE_DEBOUNCE_TIMER(state, timer) {
      state.autosaveDebounceTimer = timer;
    },
    CLEAR_AUTOSAVE_STATE(state) {
      state.savedOutputId = null;
      state.lastSaveTimestamp = null;
      state.isSaving = false;
      state.saveStatus = null;
      if (state.autosaveDebounceTimer) {
        clearTimeout(state.autosaveDebounceTimer);
        state.autosaveDebounceTimer = null;
      }
    },
    // Agent chat mutations
    SET_CURRENT_AGENT(state, { agentId, agentName, agentAvatar }) {
      state.currentAgentId = agentId;
      state.currentAgentName = agentName || null;
      state.currentAgentAvatar = agentAvatar || null;
    },
    CLEAR_CURRENT_AGENT(state) {
      state.currentAgentId = null;
      state.currentAgentName = null;
      state.currentAgentAvatar = null;
    },
    SAVE_AGENT_CONVERSATION(state, { agentId }) {
      // Save current conversation state to agent cache before switching
      if (agentId && state.messages.length > 0) {
        // LRU eviction - remove oldest agent conversation if cache is full
        const conversationKeys = Object.keys(state.agentConversations);
        if (conversationKeys.length >= MAX_AGENT_CONVERSATIONS) {
          // Remove the oldest (first) conversation
          delete state.agentConversations[conversationKeys[0]];
        }
        state.agentConversations[agentId] = {
          messages: [...state.messages],
          conversationId: state.currentConversationId,
          savedOutputId: state.savedOutputId,
          imageCache: new Map(state.imageCache),
          dataCache: new Map(state.dataCache),
        };
      }
    },
    LOAD_AGENT_CONVERSATION(state, { agentId }) {
      // Load conversation from agent cache
      const cached = state.agentConversations[agentId];
      if (cached) {
        state.messages = [...cached.messages];
        state.currentConversationId = cached.conversationId;
        state.savedOutputId = cached.savedOutputId;
        if (cached.imageCache) {
          state.imageCache = new Map(cached.imageCache);
        }
        if (cached.dataCache) {
          state.dataCache = new Map(cached.dataCache);
        }
      } else {
        // No cached conversation - start fresh
        state.messages = [];
        state.currentConversationId = null;
        state.savedOutputId = null;
        state.imageCache.clear();
        state.dataCache.clear();
      }
    },
    CLEAR_AGENT_CONVERSATION(state, { agentId }) {
      if (agentId && state.agentConversations[agentId]) {
        delete state.agentConversations[agentId];
      }
    },
  },
  getters: {
    formattedMessages(state) {
      if (!Array.isArray(state.messages)) {
        console.warn('chat.messages is not an array:', state.messages);
        return [];
      }
      return state.messages.map((message) => {
        if (!message || typeof message.role !== 'string' || typeof message.content !== 'string') {
          console.warn('Skipping malformed message in getter:', message);
          return '[Malformed Message]';
        }
        if (message.role === 'user') {
          return `> ${String(message.content)}`;
        } else if (message.role === 'assistant') {
          return `Annie: ${String(message.content)}`;
        } else {
          return `${message.role}: ${String(message.content)}`;
        }
      });
    },
    // Combined streaming indicator - true if THIS tab or ANOTHER tab is streaming
    isAnyStreaming: (state) => state.isStreaming || state.isRemoteStreaming,
    // Agent chat getters
    isAgentChat: (state) => !!state.currentAgentId,
    currentAgent: (state) => ({
      id: state.currentAgentId,
      name: state.currentAgentName,
      avatar: state.currentAgentAvatar,
    }),
    hasAgentConversation: (state) => (agentId) => !!state.agentConversations[agentId],
  },
  actions: {
    receiveNewMessage({ commit }, messageData) {
      commit('RECEIVE_MESSAGE', messageData);
    },
    createThreadFromMessage({ commit }, messageId) {
      commit('CREATE_THREAD', messageId);
    },
    addMessageToThread({ commit }, messageData) {
      commit('ADD_MESSAGE_TO_THREAD', messageData);
    },
    incrementMessageCount({ commit }) {
      commit('INCREMENT_MESSAGE_COUNT');
    },

    /**
     * Start a streaming conversation that persists across screen changes
     */
    async startStreamingConversation({ commit, state, dispatch, rootState }, { userInput, files = [], provider, model }) {
      // If already streaming, don't start another
      if (state.isStreaming) {
        console.warn('Already streaming, ignoring new request');
        return;
      }

      commit('SET_STREAMING', true);

      const token = localStorage.getItem('token');
      const chatHistory = state.messages
        .filter((msg) => msg && msg.role && (msg.role === 'user' || msg.role === 'assistant'))
        .map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

      // Create abort controller for this stream
      const abortController = new AbortController();
      commit('SET_STREAM_ABORT_CONTROLLER', abortController);

      try {
        let body;
        const headers = {};
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        // Use FormData if files are present, otherwise use JSON
        if (files && files.length > 0) {
          const formData = new FormData();
          formData.append('message', userInput);
          formData.append(
            'history',
            JSON.stringify(
              chatHistory.length > 0 &&
                chatHistory[chatHistory.length - 1].content === userInput &&
                chatHistory[chatHistory.length - 1].role === 'user'
                ? chatHistory.slice(0, -1)
                : chatHistory
            )
          );
          if (state.currentConversationId) {
            formData.append('conversationId', state.currentConversationId);
          }
          formData.append('provider', provider);
          formData.append('model', model);

          // Append all files
          files.forEach((file) => {
            formData.append('files', file);
          });

          body = formData;
          // Don't set Content-Type - browser will set it with boundary
        } else {
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify({
            message: userInput,
            history:
              chatHistory.length > 0 &&
              chatHistory[chatHistory.length - 1].content === userInput &&
              chatHistory[chatHistory.length - 1].role === 'user'
                ? chatHistory.slice(0, -1)
                : chatHistory,
            conversationId: state.currentConversationId,
            provider: provider,
            model: model,
          });
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/orchestrator/chat`, {
          method: 'POST',
          headers: headers,
          body: body,
          signal: abortController.signal,
        });

        if (!response.body) {
          throw new Error('No response body from server');
        }

        const reader = response.body.getReader();
        commit('SET_STREAM_READER', reader);

        const decoder = new TextDecoder();
        let buffer = '';

        // Process stream in background - continues even if component unmounts
        const processStream = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                commit('SET_STREAMING', false);
                commit('SET_STREAM_READER', null);
                commit('SET_STREAM_ABORT_CONTROLLER', null);
                break;
              }

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('event: ')) {
                  const eventLine = line.substring(7);
                  const dataLine = eventLine.substring(eventLine.indexOf('\n') + 6);
                  const eventName = eventLine.split('\n')[0].trim();

                  try {
                    const data = JSON.parse(dataLine);

                    // Emit event to all registered callbacks
                    state.streamEventCallbacks.forEach((callback) => {
                      try {
                        callback(eventName, data);
                      } catch (callbackError) {
                        console.error('Error in stream event callback:', callbackError);
                      }
                    });

                    // Handle core events in store
                    handleStreamEventInStore({ commit, state, dispatch }, eventName, data);
                  } catch (e) {
                    console.error('Error parsing stream data:', e, 'Raw data:', dataLine);
                  }
                }
              }
            }
          } catch (error) {
            if (error.name === 'AbortError') {
              console.log('Stream aborted by user');
            } else {
              console.error('Error processing stream:', error);
              commit('SET_STREAMING', false);
              commit('SET_STREAM_READER', null);
              commit('SET_STREAM_ABORT_CONTROLLER', null);
            }
          }
        };

        // Start processing stream in background
        processStream();
      } catch (error) {
        console.error('Error starting stream:', error);
        commit('SET_STREAMING', false);
        commit('SET_STREAM_READER', null);
        commit('SET_STREAM_ABORT_CONTROLLER', null);

        const errorMessage = error.message || 'An unexpected error occurred.';
        const errorMessageId = `msg-${Date.now()}-error`;
        commit('ADD_MESSAGE', {
          id: errorMessageId,
          role: 'assistant',
          content: `Sorry, I encountered an error: ${errorMessage}`,
          timestamp: Date.now(),
          metadata: ['Error'],
        });
      }
    },

    /**
     * Stop the current streaming conversation
     */
    stopStreamingConversation({ commit, state }) {
      if (state.streamAbortController) {
        state.streamAbortController.abort();
        commit('SET_STREAM_ABORT_CONTROLLER', null);
      }
      if (state.streamReader) {
        state.streamReader.cancel();
        commit('SET_STREAM_READER', null);
      }

      // Emit 'done' event to all callbacks to trigger cleanup
      state.streamEventCallbacks.forEach((callback) => {
        try {
          callback('done', {});
        } catch (callbackError) {
          console.error('Error in stream event callback during stop:', callbackError);
        }
      });

      commit('SET_STREAMING', false);

      // Add a system message indicating the stream was stopped
      commit('ADD_MESSAGE', {
        id: `msg-${Date.now()}-stopped`,
        role: 'system',
        content: 'Generation stopped by user.',
        timestamp: Date.now(),
        metadata: ['User Action'],
      });
    },

    /**
     * Register a callback for stream events
     */
    registerStreamEventCallback({ commit }, callback) {
      commit('ADD_STREAM_EVENT_CALLBACK', callback);
    },

    /**
     * Unregister a callback for stream events
     */
    unregisterStreamEventCallback({ commit }, callback) {
      commit('REMOVE_STREAM_EVENT_CALLBACK', callback);
    },

    /**
     * Autosave conversation with debouncing
     */
    async autosaveConversation({ commit, state, dispatch }, { debounce = true } = {}) {
      // Don't autosave if disabled or already saving
      if (!state.autosaveEnabled || state.isSaving) {
        return;
      }

      // Don't autosave empty conversations or setup messages
      const meaningfulMessages = state.messages.filter((msg) => msg.role === 'user' || (msg.role === 'assistant' && !msg.showProviderSetup));
      if (meaningfulMessages.length === 0) {
        return;
      }

      // Clear existing debounce timer
      if (state.autosaveDebounceTimer) {
        clearTimeout(state.autosaveDebounceTimer);
        commit('SET_AUTOSAVE_DEBOUNCE_TIMER', null);
      }

      // If debouncing, set a timer
      if (debounce) {
        const timer = setTimeout(() => {
          dispatch('autosaveConversation', { debounce: false });
        }, 3000); // 3 second debounce
        commit('SET_AUTOSAVE_DEBOUNCE_TIMER', timer);
        return;
      }

      // Perform the actual save
      commit('SET_IS_SAVING', true);
      commit('SET_SAVE_STATUS', 'saving');

      const token = localStorage.getItem('token');
      if (!token) {
        console.error('No authentication token found for autosave');
        commit('SET_IS_SAVING', false);
        commit('SET_SAVE_STATUS', 'error');
        return;
      }

      try {
        // If updating an existing conversation, fetch the current title to preserve it
        let conversationTitle = null;
        if (state.savedOutputId) {
          try {
            const existingResponse = await fetch(`${API_CONFIG.BASE_URL}/content-outputs/${state.savedOutputId}`, {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            });
            if (existingResponse.ok) {
              const existingData = await existingResponse.json();
              // Preserve the existing title
              conversationTitle = existingData.title;
            } else if (existingResponse.status === 404) {
              // Conversation was deleted - clear the savedOutputId and treat as new
              console.warn('[Autosave] Saved conversation was deleted (404), creating new conversation');
              commit('SET_SAVED_OUTPUT_ID', null);
            }
          } catch (error) {
            console.warn('[Autosave] Could not fetch existing title, will generate new one:', error);
          }
        }

        // Only generate a new title if we don't have one (new conversation or fetch failed)
        if (!conversationTitle) {
          const firstUserMessage = state.messages.find((msg) => msg.role === 'user');
          // Include agent name in title if this is an agent chat
          const agentPrefix = state.currentAgentId && state.currentAgentName ? `[${state.currentAgentName}] ` : '';
          conversationTitle = firstUserMessage
            ? agentPrefix + firstUserMessage.content.substring(0, 100) + (firstUserMessage.content.length > 100 ? '...' : '')
            : agentPrefix + 'Untitled Conversation';
        }

        // Helper function to resolve image references in content
        const resolveImageReferences = (content) => {
          if (!content || typeof content !== 'string') return content;

          const imageRefPattern = /\{\{IMAGE_REF:([^}]+)\}\}/g;
          return content.replace(imageRefPattern, (match, imageId) => {
            const cached = state.imageCache.get(imageId);
            if (cached && cached.data) {
              return cached.data;
            }
            return match;
          });
        };

        const conversationData = {
          conversationId: state.currentConversationId,
          title: conversationTitle,
          // Include agent metadata if this is an agent chat
          agentId: state.currentAgentId || null,
          agentName: state.currentAgentName || null,
          isAgentChat: !!state.currentAgentId,
          messages: state.messages.map((msg) => ({
            id: msg.id,
            role: msg.role,
            content: resolveImageReferences(msg.content),
            timestamp: msg.timestamp,
            metadata: msg.metadata || [],
            toolCalls: msg.toolCalls || [],
            files: msg.files || [],
          })),
          createdAt: state.messages[0]?.timestamp || Date.now(),
          updatedAt: Date.now(),
        };

        const response = await fetch(`${API_CONFIG.BASE_URL}/content-outputs/save`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            id: state.savedOutputId, // Use existing ID if available for updates
            content: JSON.stringify(conversationData),
            contentType: 'conversation',
            conversationId: state.currentConversationId,
            isShareable: false,
            title: conversationTitle, // Use preserved or generated title
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        // Store the output ID for future updates
        commit('SET_SAVED_OUTPUT_ID', result.id);
        commit('SET_LAST_SAVE_TIMESTAMP', Date.now());
        commit('SET_IS_SAVING', false);
        commit('SET_SAVE_STATUS', 'saved');

        // Dispatch event to notify OutputList to refresh
        window.dispatchEvent(new CustomEvent('conversation-saved', { detail: { id: result.id } }));

        // Clear 'saved' status after 3 seconds
        setTimeout(() => {
          if (state.saveStatus === 'saved') {
            commit('SET_SAVE_STATUS', null);
          }
        }, 3000);

        console.log('[Autosave] Conversation saved successfully:', result.id);
      } catch (error) {
        console.error('[Autosave] Error saving conversation:', error);
        commit('SET_IS_SAVING', false);
        commit('SET_SAVE_STATUS', 'error');

        // Clear error status after 5 seconds
        setTimeout(() => {
          if (state.saveStatus === 'error') {
            commit('SET_SAVE_STATUS', null);
          }
        }, 5000);
      }
    },

    /**
     * Update conversation title
     */
    async updateConversationTitle({ commit, state }, { outputId, title }) {
      const token = localStorage.getItem('token');
      if (!token) {
        console.error('No authentication token found');
        throw new Error('Not authenticated');
      }

      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/content-outputs/${outputId}/rename`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ title }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        // Dispatch event to notify OutputList to refresh
        window.dispatchEvent(new CustomEvent('conversation-renamed', { detail: { id: outputId, title } }));

        return result;
      } catch (error) {
        console.error('Error renaming conversation:', error);
        throw error;
      }
    },

    // ============================================
    // AGENT CHAT ACTIONS
    // ============================================

    /**
     * Switch to an agent chat context
     * Saves current conversation and loads agent's conversation
     */
    switchToAgentChat({ commit, state, dispatch }, { agentId, agentName, agentAvatar }) {
      // If already in this agent's chat, do nothing
      if (state.currentAgentId === agentId) {
        return;
      }

      // Save current conversation if we're in an agent chat
      if (state.currentAgentId) {
        commit('SAVE_AGENT_CONVERSATION', { agentId: state.currentAgentId });
      }

      // Set the new agent context
      commit('SET_CURRENT_AGENT', { agentId, agentName, agentAvatar });

      // Load the agent's conversation if it exists
      commit('LOAD_AGENT_CONVERSATION', { agentId });

      // If no existing conversation, add welcome message
      if (state.messages.length === 0) {
        const welcomeMessage = {
          id: `agent-welcome-${Date.now()}`,
          role: 'assistant',
          content: `Hi! I'm **${agentName}**. How can I help you today?`,
          timestamp: Date.now(),
          metadata: ['Agent Chat', `Agent: ${agentName}`],
        };
        commit('ADD_MESSAGE', welcomeMessage);
      }

      console.log(`[Agent Chat] Switched to agent: ${agentName} (${agentId})`);
    },

    /**
     * Switch back to main chat (exit agent chat)
     */
    switchToMainChat({ commit, state }) {
      // Save current agent conversation if we're in one
      if (state.currentAgentId) {
        commit('SAVE_AGENT_CONVERSATION', { agentId: state.currentAgentId });
      }

      // Clear agent context
      commit('CLEAR_CURRENT_AGENT');

      // Reset to empty state (main chat will load its own state)
      commit('RESET_CHAT');

      console.log('[Agent Chat] Switched to main chat');
    },

    /**
     * Clear an agent's conversation
     */
    clearAgentConversation({ commit, state, dispatch }, { agentId, agentName }) {
      // Clear from cache
      commit('CLEAR_AGENT_CONVERSATION', { agentId });

      // If we're currently in this agent's chat, reset and add welcome message
      if (state.currentAgentId === agentId) {
        commit('RESET_CHAT');

        const welcomeMessage = {
          id: `agent-welcome-${Date.now()}`,
          role: 'assistant',
          content: `Hi! I'm **${agentName || 'your agent'}**. How can I help you today?`,
          timestamp: Date.now(),
          metadata: ['Agent Chat', `Agent: ${agentName || 'Agent'}`],
        };
        commit('ADD_MESSAGE', welcomeMessage);
      }

      console.log(`[Agent Chat] Cleared conversation for agent: ${agentId}`);
    },

    /**
     * Start a streaming conversation with an agent
     * Uses the agent-specific endpoint
     */
    async startAgentStreamingConversation({ commit, state, dispatch, rootState }, { agentId, userInput, files = [], provider, model }) {
      // If already streaming, don't start another
      if (state.isStreaming) {
        console.warn('Already streaming, ignoring new request');
        return;
      }

      commit('SET_STREAMING', true);

      const token = localStorage.getItem('token');
      const chatHistory = state.messages
        .filter((msg) => msg && msg.role && (msg.role === 'user' || msg.role === 'assistant'))
        .map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

      // Create abort controller for this stream
      const abortController = new AbortController();
      commit('SET_STREAM_ABORT_CONTROLLER', abortController);

      try {
        const headers = {
          'Content-Type': 'application/json',
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const body = JSON.stringify({
          message: userInput,
          history:
            chatHistory.length > 0 && chatHistory[chatHistory.length - 1].content === userInput && chatHistory[chatHistory.length - 1].role === 'user'
              ? chatHistory.slice(0, -1)
              : chatHistory,
          provider: provider,
          model: model,
        });

        // Use agent-specific chat endpoint
        const response = await fetch(`${API_CONFIG.BASE_URL}/agents/${agentId}/chat-stream`, {
          method: 'POST',
          headers: headers,
          body: body,
          signal: abortController.signal,
        });

        if (!response.body) {
          throw new Error('No response body from server');
        }

        const reader = response.body.getReader();
        commit('SET_STREAM_READER', reader);

        const decoder = new TextDecoder();
        let buffer = '';

        // Process stream in background
        const processStream = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                commit('SET_STREAMING', false);
                commit('SET_STREAM_READER', null);
                commit('SET_STREAM_ABORT_CONTROLLER', null);
                break;
              }

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('event: ')) {
                  const eventLine = line.substring(7);
                  const dataLine = eventLine.substring(eventLine.indexOf('\n') + 6);
                  const eventName = eventLine.split('\n')[0].trim();

                  try {
                    const data = JSON.parse(dataLine);

                    // Emit event to all registered callbacks
                    state.streamEventCallbacks.forEach((callback) => {
                      try {
                        callback(eventName, data);
                      } catch (callbackError) {
                        console.error('Error in stream event callback:', callbackError);
                      }
                    });

                    // Handle core events in store
                    handleStreamEventInStore({ commit, state, dispatch }, eventName, data);
                  } catch (e) {
                    console.error('Error parsing stream data:', e, 'Raw data:', dataLine);
                  }
                }
              }
            }
          } catch (error) {
            if (error.name === 'AbortError') {
              console.log('Stream aborted by user');
            } else {
              console.error('Error processing stream:', error);
              commit('SET_STREAMING', false);
              commit('SET_STREAM_READER', null);
              commit('SET_STREAM_ABORT_CONTROLLER', null);
            }
          }
        };

        // Start processing stream in background
        processStream();
      } catch (error) {
        console.error('Error starting agent stream:', error);
        commit('SET_STREAMING', false);
        commit('SET_STREAM_READER', null);
        commit('SET_STREAM_ABORT_CONTROLLER', null);

        const errorMessage = error.message || 'An unexpected error occurred.';
        const errorMessageId = `msg-${Date.now()}-error`;
        commit('ADD_MESSAGE', {
          id: errorMessageId,
          role: 'assistant',
          content: `Sorry, I encountered an error: ${errorMessage}`,
          timestamp: Date.now(),
          metadata: ['Error'],
        });
      }
    },

    /**
     * Handle real-time chat events from Socket.IO (messages from other tabs)
     */
    handleRealtimeChatEvent({ commit, state, dispatch }, eventData) {
      const { type, conversationId, assistantMessageId } = eventData;

      // Skip if this tab is actively streaming - it already receives SSE events directly
      // Socket.IO events are only for OTHER tabs that need to sync
      // EXCEPTION: Autonomous messages should ALWAYS be processed (they come from background async tools)
      const isAutonomousEvent = type && type.startsWith('autonomous_');
      const isAsyncToolEvent = type && type.startsWith('async_tool_');

      if (state.isStreaming && !isAutonomousEvent && !isAsyncToolEvent) {
        console.log('[Realtime Chat] Ignoring Socket.IO event - this tab is streaming via SSE');
        return;
      }

      // Always adopt conversation ID on message_start, user_message, or autonomous_message_start
      // This ensures tabs stay synced even when switching who is the "sender"
      if (conversationId && (type === 'message_start' || type === 'user_message' || type === 'autonomous_message_start')) {
        if (state.currentConversationId !== conversationId) {
          console.log('[Realtime Chat] Syncing to conversation from other tab:', conversationId);
          commit('SET_CONVERSATION_ID', conversationId);
        }
      }

      // For other events, only handle if conversation ID matches
      if (conversationId && conversationId !== state.currentConversationId) {
        console.log('[Realtime Chat] Ignoring event for different conversation:', conversationId);
        return;
      }

      console.log('[Realtime Chat] Processing event:', type, eventData);

      switch (type) {
        case 'user_message':
          // Another tab sent a user message
          const userMsg = eventData.message;
          if (userMsg && !state.messages.find((m) => m.content === userMsg.content && m.role === 'user')) {
            commit('ADD_MESSAGE', {
              id: `msg-user-${Date.now()}`,
              role: 'user',
              content: userMsg.content,
              timestamp: eventData.timestamp || Date.now(),
            });
          }
          break;

        case 'message_start':
          // Assistant message started in another tab - show "thinking" indicator
          commit('SET_REMOTE_STREAMING', true);
          if (!state.messages.find((m) => m.id === assistantMessageId)) {
            commit('ADD_MESSAGE', {
              id: assistantMessageId,
              role: 'assistant',
              content: '',
              timestamp: eventData.timestamp || Date.now(),
            });
          }
          break;

        case 'content_delta':
          // Streaming text chunk from another tab
          commit('APPEND_MESSAGE_CONTENT', {
            messageId: assistantMessageId,
            delta: eventData.delta,
          });
          break;

        case 'tool_start':
          // Tool execution started in another tab
          if (eventData.toolCall) {
            commit('ADD_TOOL_CALL', {
              messageId: assistantMessageId,
              toolCall: {
                id: eventData.toolCall.id,
                name: eventData.toolCall.name,
                args: eventData.toolCall.args,
                status: 'running',
              },
            });
          }
          break;

        case 'tool_end':
          // Tool execution completed in another tab
          if (eventData.toolCall) {
            commit('UPDATE_TOOL_CALL_RESULT', {
              messageId: assistantMessageId,
              toolCallId: eventData.toolCall.id,
              result: eventData.toolCall.result,
              error: eventData.toolCall.error,
              status: eventData.toolCall.error ? 'error' : 'completed',
            });
          }
          break;

        case 'message_end':
          // Message completed in another tab - hide "thinking" indicator
          commit('SET_REMOTE_STREAMING', false);
          console.log('[Realtime Chat] Message completed');
          break;

        case 'autonomous_message_start':
          // AI started an autonomous message (no user trigger)
          console.log('[Realtime Chat] Autonomous message started');
          if (!state.messages.find((m) => m.id === assistantMessageId)) {
            commit('ADD_MESSAGE', {
              id: assistantMessageId,
              role: 'assistant',
              content: '', // Empty - content will stream in
              timestamp: eventData.timestamp || Date.now(),
              autonomous: true, // Flag as AI-initiated
            });
            // Set remote streaming to show thinking indicator
            commit('SET_REMOTE_STREAMING', true);
          }
          break;

        case 'autonomous_content_delta':
          // Autonomous message text chunk
          commit('APPEND_MESSAGE_CONTENT', {
            messageId: assistantMessageId,
            delta: eventData.delta,
          });
          break;

        case 'autonomous_message_end':
          // Autonomous message completed - hide thinking indicator
          commit('SET_REMOTE_STREAMING', false);
          console.log('[Realtime Chat] Autonomous message completed');

          // Remove empty autonomous messages (LLM returned no content)
          if (eventData.isEmpty && assistantMessageId) {
            console.log('[Realtime Chat] Removing empty autonomous message:', assistantMessageId);
            commit('REMOVE_MESSAGE', assistantMessageId);
          }

          // Trigger autosave after autonomous message completes
          if (dispatch) {
            dispatch('autosaveConversation', { debounce: true });
          }
          break;

        case 'async_tool_queued':
          // Async tool was queued for background execution
          console.log('[Realtime Chat] Async tool queued:', eventData.functionName);
          // Optionally show a notification in UI
          break;

        case 'async_tool_started':
          // Async tool execution started - update status to "running"
          console.log('[Realtime Chat] Async tool started:', eventData.functionName);
          if (eventData.toolCallId) {
            commit('UPDATE_TOOL_CALL_RESULT', {
              messageId: assistantMessageId,
              toolCallId: eventData.toolCallId,
              result: {
                success: true,
                status: 'running',
                executionId: eventData.executionId,
                message: `${eventData.functionName} is now executing...`,
              },
              status: 'running',
            });
          }
          break;

        case 'async_tool_progress':
          // Async tool reported progress
          console.log('[Realtime Chat] Async tool progress:', eventData.progress);
          // This will be reported via autonomous messages, so no UI action needed here
          break;

        case 'async_tool_completed':
          // Async tool completed - update status to "completed"
          console.log('[Realtime Chat] Async tool completed:', eventData.functionName);
          if (eventData.toolCallId) {
            commit('UPDATE_TOOL_CALL_RESULT', {
              messageId: assistantMessageId,
              toolCallId: eventData.toolCallId,
              result: {
                success: true,
                status: 'completed',
                executionId: eventData.executionId,
                result: eventData.result,
                duration: eventData.duration,
              },
              status: 'completed',
            });
          }
          break;

        case 'async_tool_failed':
          // Async tool failed - update status to "failed"
          console.log('[Realtime Chat] Async tool failed:', eventData.functionName, eventData.error);
          if (eventData.toolCallId) {
            commit('UPDATE_TOOL_CALL_RESULT', {
              messageId: assistantMessageId,
              toolCallId: eventData.toolCallId,
              result: {
                success: false,
                status: 'failed',
                executionId: eventData.executionId,
                error: eventData.error,
              },
              error: eventData.error,
              status: 'failed',
            });
          }
          break;

        default:
          console.warn('[Realtime Chat] Unknown event type:', type);
      }
    },
  },
};

/**
 * Handle stream events at the store level
 */
function handleStreamEventInStore({ commit, state, dispatch }, eventName, data) {
  switch (eventName) {
    case 'conversation_started':
      commit('SET_CONVERSATION_ID', data.conversationId);
      break;
    case 'assistant_message':
      commit('ADD_MESSAGE', data);
      break;
    case 'content_delta':
      commit('APPEND_MESSAGE_CONTENT', {
        messageId: data.assistantMessageId,
        delta: data.delta,
      });
      break;
    case 'tool_start':
      commit('ADD_TOOL_CALL', {
        messageId: data.assistantMessageId,
        toolCall: {
          id: data.toolCall.id,
          name: data.toolCall.name,
          args: data.toolCall.args,
        },
      });
      break;
    case 'tool_end':
      commit('UPDATE_TOOL_CALL_RESULT', {
        messageId: data.assistantMessageId,
        toolCallId: data.toolCall.id,
        result: data.toolCall.result,
        error: data.toolCall.error,
      });
      break;
    case 'image_generated':
      commit('ADD_IMAGE_TO_CACHE', {
        imageId: data.imageId,
        imageData: data.imageData,
        toolCallId: data.toolCallId,
        messageId: data.assistantMessageId,
        index: data.index,
      });
      break;
    case 'data_content':
      // Cache full content for DATA_REF resolution
      commit('ADD_DATA_TO_CACHE', {
        dataId: data.dataId,
        fullContent: data.fullContent,
        toolCallId: data.toolCallId,
        messageId: data.assistantMessageId,
        size: data.size,
        path: data.path,
      });
      break;
    case 'final_content':
      // DO NOT replace accumulated content with final_content!
      // The streamed content via content_delta is already complete and correct.
      // final_content only contains the LAST LLM response, not the full accumulated
      // content from multi-step tool conversations. Replacing would wipe out
      // all previous text from earlier in the conversation turn.
      //
      // We keep this case handler for logging/debugging purposes only.
      console.log('[Stream] final_content received (not replacing accumulated content)', {
        messageId: data.assistantMessageId,
        contentLength: data.content?.length || 0,
      });
      break;
    case 'tools_skipped':
      // Model doesn't support function calling - show info message
      commit('ADD_MESSAGE', {
        id: `msg-${Date.now()}-tools-skipped`,
        role: 'system',
        content: data.message || `⚠️ ${data.reason}`,
        timestamp: Date.now(),
        metadata: ['Model Limitation'],
      });
      break;
    case 'error':
      const errorMessageId = `msg-${Date.now()}-error`;
      commit('ADD_MESSAGE', {
        id: errorMessageId,
        role: 'assistant',
        content: `An error occurred: ${data.error}`,
        timestamp: Date.now(),
        metadata: ['Error'],
      });
      break;
    case 'done':
      commit('SET_STREAMING', false);
      // Trigger autosave after stream completes
      if (dispatch) {
        dispatch('autosaveConversation', { debounce: true });
      }
      break;
  }
}
