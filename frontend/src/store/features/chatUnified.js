// chatUnified.js — single Vuex module that holds conversations for every Annie
// chat surface keyed by channelKey ('artifact:<id>', 'agent:<id>', 'workflow:<id>',
// 'tool:<id>', 'widget:<id>'). The orchestrator's rich Chat.vue continues to use
// the legacy `chat` module; this module powers all five per-page panels.

import { streamChat, toChatHistory } from '@/services/chatService.js';
import { resolveChannelProviderModel, resolveChannelEnabledTools } from '@/services/chatChannelConfig.js';

const STORAGE_KEY = 'unifiedChatConversations';
const LEGACY_KEYS = {
  agent: 'agentChatConversations',
  workflow: 'workflowChatConversations',
  tool: 'toolChatConversations',
  widget: 'widgetChatConversations',
  artifact: 'artifactChatConversations',
};

const splitChannelKey = (channelKey) => {
  if (!channelKey || typeof channelKey !== 'string') return { type: '', id: '' };
  const colonAt = channelKey.indexOf(':');
  if (colonAt === -1) return { type: channelKey, id: '' };
  return { type: channelKey.slice(0, colonAt), id: channelKey.slice(colonAt + 1) };
};

const blankConversation = () => ({
  messages: [],
  conversationId: null,
  lastUpdate: Date.now(),
  suggestions: [],
});

const loadPersisted = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('[chatUnified] Failed to load persisted conversations:', e);
    return {};
  }
};

const persistConversations = (conversations) => {
  try {
    const filtered = {};
    for (const [key, conv] of Object.entries(conversations)) {
      if (!conv) continue;
      if ((conv.messages && conv.messages.length > 0) || conv.conversationId) {
        filtered[key] = conv;
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.error('[chatUnified] Failed to persist conversations:', e);
  }
};

/**
 * One-time read-only migration from a legacy per-page localStorage key.
 * The legacy key is left in place as a rollback safety net.
 */
const migrateLegacyChannel = (state, channelKey) => {
  if (state._migrated[channelKey]) return;
  const { type, id } = splitChannelKey(channelKey);
  const legacyKey = LEGACY_KEYS[type];
  if (!legacyKey || !id) {
    state._migrated[channelKey] = true;
    return;
  }
  try {
    const raw = localStorage.getItem(legacyKey);
    if (!raw) {
      state._migrated[channelKey] = true;
      return;
    }
    const allLegacy = JSON.parse(raw);
    const legacyConv = allLegacy?.[id];
    if (legacyConv && (legacyConv.messages?.length > 0 || legacyConv.conversationId)) {
      state.conversations[channelKey] = {
        messages: legacyConv.messages || [],
        conversationId: legacyConv.conversationId || null,
        lastUpdate: legacyConv.lastUpdate || Date.now(),
        suggestions: legacyConv.suggestions || [],
      };
      persistConversations(state.conversations);
    }
  } catch (e) {
    console.warn(`[chatUnified] Failed to migrate legacy channel "${channelKey}" from "${legacyKey}":`, e);
  } finally {
    state._migrated[channelKey] = true;
  }
};

const ensureChannel = (state, channelKey) => {
  if (!state.conversations[channelKey]) {
    state.conversations[channelKey] = blankConversation();
  }
};

const generateMessageId = (() => {
  let counter = 0;
  return (channelKey) => `${(channelKey || 'chat').replace(':', '-')}-msg-${Date.now()}-${counter++}`;
})();

export default {
  namespaced: true,
  state: {
    conversations: loadPersisted(),
    streamingChannels: {},          // channelKey → boolean
    loadingSuggestionsChannels: {}, // channelKey → boolean
    expandedToolCalls: {},          // channelKey → { messageId: number[] }
    runningToolCalls: {},           // channelKey → { 'msgId-toolCallId': true }
    messageStates: {},              // channelKey → { messageId: status }
    abortControllers: {},           // channelKey → AbortController
    _migrated: {},                  // channelKey → boolean
  },

  mutations: {
    SET_CONVERSATION(state, { channelKey, conversation }) {
      state.conversations[channelKey] = { ...blankConversation(), ...conversation };
      persistConversations(state.conversations);
    },
    INITIALIZE_CHANNEL(state, { channelKey, welcomeMessage }) {
      migrateLegacyChannel(state, channelKey);
      if (!state.conversations[channelKey]) {
        state.conversations[channelKey] = blankConversation();
        if (welcomeMessage) {
          state.conversations[channelKey].messages = [welcomeMessage];
        }
        persistConversations(state.conversations);
      }
    },
    ADD_MESSAGE(state, { channelKey, message }) {
      ensureChannel(state, channelKey);
      state.conversations[channelKey].messages.push(message);
      state.conversations[channelKey].lastUpdate = Date.now();
      persistConversations(state.conversations);
    },
    UPDATE_MESSAGE_CONTENT(state, { channelKey, messageId, content }) {
      const conv = state.conversations[channelKey];
      if (!conv) return;
      const message = conv.messages.find((m) => m.id === messageId);
      if (message) {
        message.content = content;
        persistConversations(state.conversations);
      }
    },
    APPEND_MESSAGE_CONTENT(state, { channelKey, messageId, delta }) {
      const conv = state.conversations[channelKey];
      if (!conv) return;
      const message = conv.messages.find((m) => m.id === messageId);
      if (!message) return;
      message.content = (message.content || '') + delta;
      if (!message.contentParts) message.contentParts = [];
      const lastPart = message.contentParts[message.contentParts.length - 1];
      if (lastPart && lastPart.type === 'text') {
        lastPart.text += delta;
      } else {
        message.contentParts.push({ type: 'text', text: delta });
      }
    },
    ADD_TOOL_CALL(state, { channelKey, messageId, toolCall }) {
      const conv = state.conversations[channelKey];
      if (!conv) return;
      const message = conv.messages.find((m) => m.id === messageId);
      if (!message) return;
      if (!message.toolCalls) message.toolCalls = [];
      if (message.toolCalls.some((tc) => tc.id === toolCall.id)) return;
      message.toolCalls.push(toolCall);
      if (!message.contentParts) message.contentParts = [];
      message.contentParts.push({ type: 'tool_call', toolCallId: toolCall.id });
      persistConversations(state.conversations);
    },
    UPDATE_TOOL_CALL_RESULT(state, { channelKey, messageId, toolCallId, result, error }) {
      const conv = state.conversations[channelKey];
      if (!conv) return;
      const message = conv.messages.find((m) => m.id === messageId);
      if (!message || !message.toolCalls) return;
      const toolCall = message.toolCalls.find((tc) => tc.id === toolCallId);
      if (!toolCall) return;
      toolCall.result = result;
      toolCall.error = error;
      persistConversations(state.conversations);
    },
    SET_CONVERSATION_ID(state, { channelKey, conversationId }) {
      ensureChannel(state, channelKey);
      state.conversations[channelKey].conversationId = conversationId;
      persistConversations(state.conversations);
    },
    SET_SUGGESTIONS(state, { channelKey, suggestions }) {
      ensureChannel(state, channelKey);
      state.conversations[channelKey].suggestions = suggestions || [];
      state.conversations[channelKey].lastUpdate = Date.now();
      persistConversations(state.conversations);
    },
    CLEAR_CONVERSATION(state, { channelKey, welcomeMessage }) {
      if (state.conversations[channelKey]) {
        state.conversations[channelKey].messages = welcomeMessage ? [welcomeMessage] : [];
        state.conversations[channelKey].conversationId = null;
        state.conversations[channelKey].suggestions = [];
        state.conversations[channelKey].lastUpdate = Date.now();
      } else if (welcomeMessage) {
        state.conversations[channelKey] = { ...blankConversation(), messages: [welcomeMessage] };
      }
      delete state.expandedToolCalls[channelKey];
      delete state.runningToolCalls[channelKey];
      delete state.messageStates[channelKey];
      persistConversations(state.conversations);
    },
    SET_STREAMING(state, { channelKey, isStreaming }) {
      if (isStreaming) state.streamingChannels[channelKey] = true;
      else delete state.streamingChannels[channelKey];
    },
    SET_LOADING_SUGGESTIONS(state, { channelKey, isLoading }) {
      if (isLoading) state.loadingSuggestionsChannels[channelKey] = true;
      else delete state.loadingSuggestionsChannels[channelKey];
    },
    SET_EXPANDED_TOOL_CALLS(state, { channelKey, messageId, expandedIndexes }) {
      if (!state.expandedToolCalls[channelKey]) state.expandedToolCalls[channelKey] = {};
      state.expandedToolCalls[channelKey][messageId] = expandedIndexes;
    },
    SET_RUNNING_TOOL(state, { channelKey, messageId, toolCallId, running }) {
      if (!state.runningToolCalls[channelKey]) state.runningToolCalls[channelKey] = {};
      const key = `${messageId}-${toolCallId}`;
      if (running) state.runningToolCalls[channelKey][key] = true;
      else delete state.runningToolCalls[channelKey][key];
    },
    SET_MESSAGE_STATE(state, { channelKey, messageId, status }) {
      if (!state.messageStates[channelKey]) state.messageStates[channelKey] = {};
      if (status) state.messageStates[channelKey][messageId] = status;
      else delete state.messageStates[channelKey][messageId];
    },
    TRUNCATE_FROM(state, { channelKey, messageId }) {
      const conv = state.conversations[channelKey];
      if (!conv) return;
      const idx = conv.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;
      conv.messages = conv.messages.slice(0, idx);
      conv.lastUpdate = Date.now();
      persistConversations(state.conversations);
    },
    MIGRATE_CHANNEL_KEY(state, { fromChannelKey, toChannelKey }) {
      if (fromChannelKey === toChannelKey) return;
      if (state.conversations[fromChannelKey]) {
        state.conversations[toChannelKey] = state.conversations[fromChannelKey];
        delete state.conversations[fromChannelKey];
      }
      for (const map of [state.expandedToolCalls, state.runningToolCalls, state.messageStates]) {
        if (map[fromChannelKey]) {
          map[toChannelKey] = map[fromChannelKey];
          delete map[fromChannelKey];
        }
      }
      persistConversations(state.conversations);
    },
    REGISTER_ABORT_CONTROLLER(state, { channelKey, controller }) {
      state.abortControllers[channelKey] = controller;
    },
    CLEAR_ABORT_CONTROLLER(state, { channelKey }) {
      delete state.abortControllers[channelKey];
    },
    PERSIST_CONVERSATIONS(state) {
      persistConversations(state.conversations);
    },
  },

  getters: {
    getConversation: (state) => (channelKey) =>
      state.conversations[channelKey] || blankConversation(),
    getMessages: (state) => (channelKey) =>
      state.conversations[channelKey]?.messages || [],
    getFormattedMessages: (state) => (channelKey) => {
      const conv = state.conversations[channelKey];
      if (!conv) return [];
      const expanded = state.expandedToolCalls[channelKey] || {};
      return conv.messages.map((message) => ({
        ...message,
        expandedToolCalls: expanded[message.id] || [],
      }));
    },
    getConversationId: (state) => (channelKey) =>
      state.conversations[channelKey]?.conversationId || null,
    getSuggestions: (state) => (channelKey) =>
      state.conversations[channelKey]?.suggestions || [],
    isStreaming: (state) => (channelKey) => !!state.streamingChannels[channelKey],
    isLoadingSuggestions: (state) => (channelKey) =>
      !!state.loadingSuggestionsChannels[channelKey],
    getMessageStatus: (state) => (channelKey, messageId) =>
      state.messageStates[channelKey]?.[messageId] || null,
    getRunningToolsForMessage: (state) => (channelKey, messageId) => {
      const map = state.runningToolCalls[channelKey] || {};
      return Object.keys(map)
        .filter((k) => k.startsWith(`${messageId}-`))
        .map((k) => k.split('-').slice(1).join('-'));
    },
  },

  actions: {
    initializeChannel({ commit }, { channelKey, welcomeMessage = null }) {
      if (!channelKey) return;
      commit('INITIALIZE_CHANNEL', { channelKey, welcomeMessage });
    },

    clearConversation({ commit }, { channelKey, welcomeMessage = null }) {
      if (!channelKey) return;
      commit('CLEAR_CONVERSATION', { channelKey, welcomeMessage });
    },

    addMessage({ commit }, { channelKey, message }) {
      if (!channelKey || !message) return;
      commit('ADD_MESSAGE', { channelKey, message });
    },

    setSuggestions({ commit }, { channelKey, suggestions }) {
      if (!channelKey) return;
      commit('SET_SUGGESTIONS', { channelKey, suggestions });
    },

    toggleToolCallExpansion({ commit, state }, { channelKey, messageId, toolCallIndex }) {
      const current = state.expandedToolCalls[channelKey]?.[messageId] || [];
      const next = [...current];
      const idx = next.indexOf(toolCallIndex);
      if (idx > -1) next.splice(idx, 1);
      else next.push(toolCallIndex);
      commit('SET_EXPANDED_TOOL_CALLS', { channelKey, messageId, expandedIndexes: next });
    },

    /**
     * Send a user message and stream the assistant response.
     *
     * @param {object} payload
     * @param {string} payload.channelKey
     * @param {string} payload.chatType
     * @param {string} payload.content     The user's message text
     * @param {object} [payload.pageContext]
     * @param {object} [payload.pageState]
     * @param {string} [payload.provider]  Defaults to store.state.aiProvider.selectedProvider
     * @param {string} [payload.model]     Defaults to store.state.aiProvider.selectedModel
     * @param {Array<object>} [payload.onFrontendEvents] Side-effect callbacks for tool-result frontend events
     */
    async sendMessage({ commit, dispatch, state, rootState }, payload) {
      const {
        channelKey,
        chatType,
        content,
        pageContext = {},
        pageState = {},
        provider,
        model,
        onFrontendEvent,
      } = payload;

      if (!channelKey || !chatType || !content || !content.trim()) return;
      if (state.streamingChannels[channelKey]) return;

      const userMessage = {
        id: generateMessageId(channelKey),
        role: 'user',
        content: content.trim(),
        timestamp: Date.now(),
      };
      commit('ADD_MESSAGE', { channelKey, message: userMessage });

      const conv = state.conversations[channelKey];
      const history = toChatHistory(conv?.messages || []);

      const controller = new AbortController();
      commit('REGISTER_ABORT_CONTROLLER', { channelKey, controller });
      commit('SET_STREAMING', { channelKey, isStreaming: true });

      // Per-channel provider/model/tools take precedence over the global
      // Vuex aiProvider state, so each chat surface (orchestrator, every
      // saved-agent chat, every workflow/tool/widget/artifact chat) carries
      // its own remembered config. See chatChannelConfig.js.
      const channelPM = resolveChannelProviderModel(channelKey, rootState.aiProvider);
      const resolvedProvider = provider || channelPM.provider;
      const resolvedModel = model || channelPM.model;
      const resolvedEnabledTools = resolveChannelEnabledTools(channelKey);

      try {
        await streamChat({
          chatType,
          messages: history,
          provider: resolvedProvider,
          model: resolvedModel,
          conversationId: state.conversations[channelKey]?.conversationId || null,
          pageContext,
          pageState,
          enabledTools: resolvedEnabledTools,
          signal: controller.signal,
          onEvent: (eventName, data) => handleStreamEvent({ commit, channelKey, eventName, data, onFrontendEvent }),
        });
      } catch (error) {
        if (error?.name === 'AbortError') {
          // user-initiated stop — silent
        } else {
          console.error('[chatUnified] sendMessage error:', error);
          commit('ADD_MESSAGE', {
            channelKey,
            message: {
              id: generateMessageId(channelKey),
              role: 'assistant',
              content: `Sorry, I encountered an error: ${error.message || 'unknown error'}`,
              timestamp: Date.now(),
            },
          });
        }
      } finally {
        commit('SET_STREAMING', { channelKey, isStreaming: false });
        commit('CLEAR_ABORT_CONTROLLER', { channelKey });
      }
    },

    /**
     * Edit a previous user message: truncate everything from that message onward,
     * then resend with the new content. Mirrors Chat.vue's handleEditMessage.
     */
    async editMessage({ commit, dispatch, state }, payload) {
      const {
        channelKey,
        chatType,
        messageId,
        newContent,
        pageContext = {},
        pageState = {},
        provider,
        model,
        onFrontendEvent,
      } = payload;
      if (!channelKey || !messageId || !newContent || !newContent.trim()) return;
      if (state.streamingChannels[channelKey]) return;

      commit('TRUNCATE_FROM', { channelKey, messageId });

      await dispatch('sendMessage', {
        channelKey,
        chatType,
        content: newContent,
        pageContext,
        pageState,
        provider,
        model,
        onFrontendEvent,
      });
    },

    stopStream({ commit, state }, { channelKey }) {
      const ctrl = state.abortControllers[channelKey];
      if (ctrl) {
        try { ctrl.abort(); } catch (e) { /* ignore */ }
      }
      commit('CLEAR_ABORT_CONTROLLER', { channelKey });
      commit('SET_STREAMING', { channelKey, isStreaming: false });
    },

    /**
     * Optionally fetch contextual suggestions from /orchestrator/suggestions.
     */
    async fetchSuggestions({ commit, state, rootState }, { channelKey, chatType, contextLabel }) {
      if (state.loadingSuggestionsChannels[channelKey]) return;
      const conv = state.conversations[channelKey];
      const messages = conv?.messages || [];
      if (messages.length < 2) return;

      const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content;
      const lastAssistantMessage = [...messages].reverse().find((m) => m.role === 'assistant')?.content;
      if (!lastUserMessage || !lastAssistantMessage) return;

      commit('SET_LOADING_SUGGESTIONS', { channelKey, isLoading: true });
      try {
        const { API_CONFIG } = await import('@/tt.config.js');
        const token = localStorage.getItem('token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const recentHistory = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
        const channelPM = resolveChannelProviderModel(channelKey, rootState.aiProvider);
        const response = await fetch(`${API_CONFIG.BASE_URL}/orchestrator/suggestions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            history: recentHistory,
            lastUserMessage,
            lastAssistantMessage,
            provider: channelPM.provider,
            model: channelPM.model,
            context: contextLabel || chatType,
          }),
        });
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data?.suggestions)) {
            commit('SET_SUGGESTIONS', { channelKey, suggestions: data.suggestions.slice(0, 2) });
          }
        }
      } catch (e) {
        console.error('[chatUnified] fetchSuggestions error:', e);
      } finally {
        commit('SET_LOADING_SUGGESTIONS', { channelKey, isLoading: false });
      }
    },
  },
};

/**
 * Translate raw SSE events from chatService into store mutations.
 */
function handleStreamEvent({ commit, channelKey, eventName, data, onFrontendEvent }) {
  switch (eventName) {
    case 'conversation_started':
      commit('SET_CONVERSATION_ID', { channelKey, conversationId: data.conversationId });
      break;

    case 'assistant_message': {
      const assistantMessage = { ...data, role: 'assistant', toolCalls: [] };
      commit('ADD_MESSAGE', { channelKey, message: assistantMessage });
      commit('SET_MESSAGE_STATE', {
        channelKey,
        messageId: data.id,
        status: { type: 'thinking', text: 'Annie is thinking...' },
      });
      break;
    }

    case 'content_delta':
      commit('APPEND_MESSAGE_CONTENT', {
        channelKey,
        messageId: data.assistantMessageId,
        delta: data.delta,
      });
      break;

    case 'tool_start':
      commit('ADD_TOOL_CALL', {
        channelKey,
        messageId: data.assistantMessageId,
        toolCall: { ...data.toolCall },
      });
      commit('SET_RUNNING_TOOL', {
        channelKey,
        messageId: data.assistantMessageId,
        toolCallId: data.toolCall.id,
        running: true,
      });
      commit('SET_MESSAGE_STATE', {
        channelKey,
        messageId: data.assistantMessageId,
        status: { type: 'tool', text: `Running ${data.toolCall.name}...` },
      });
      break;

    case 'tool_end': {
      commit('UPDATE_TOOL_CALL_RESULT', {
        channelKey,
        messageId: data.assistantMessageId,
        toolCallId: data.toolCall.id,
        result: data.toolCall.result,
        error: data.toolCall.error,
      });
      commit('SET_RUNNING_TOOL', {
        channelKey,
        messageId: data.assistantMessageId,
        toolCallId: data.toolCall.id,
        running: false,
      });
      // Forward tool-result frontend events for caller-side side effects (file_written, widget-saved, etc.)
      let toolResult = data.toolCall.result;
      if (typeof toolResult === 'string') {
        try { toolResult = JSON.parse(toolResult); } catch { /* not JSON */ }
      }
      if (toolResult?.frontendEvents && typeof onFrontendEvent === 'function') {
        for (const evt of toolResult.frontendEvents) {
          try { onFrontendEvent(evt.type, evt.data, data.toolCall); } catch (e) {
            console.error('[chatUnified] onFrontendEvent threw:', e);
          }
        }
      }
      if (typeof onFrontendEvent === 'function') {
        try { onFrontendEvent('tool-completed', { toolCall: data.toolCall }, data.toolCall); } catch (e) { /* noop */ }
      }
      break;
    }

    case 'frontend_event':
      if (typeof onFrontendEvent === 'function') {
        try { onFrontendEvent(data.eventType, data.eventData); } catch (e) {
          console.error('[chatUnified] onFrontendEvent threw:', e);
        }
      }
      break;

    case 'final_content':
      commit('PERSIST_CONVERSATIONS');
      commit('SET_MESSAGE_STATE', {
        channelKey,
        messageId: data.assistantMessageId,
        status: null,
      });
      break;

    case 'image_generated':
    case 'data_content':
    case 'data_offloaded':
    case 'context_status':
      // Backend-only / observability events; nothing to do in the unified store.
      break;

    case 'error': {
      const errorMessageId = `${channelKey.replace(':', '-')}-err-${Date.now()}`;
      commit('ADD_MESSAGE', {
        channelKey,
        message: {
          id: errorMessageId,
          role: 'assistant',
          content: `An error occurred: ${data.error || data.message || 'unknown error'}`,
          timestamp: Date.now(),
        },
      });
      commit('SET_STREAMING', { channelKey, isStreaming: false });
      break;
    }

    case 'done':
      commit('SET_STREAMING', { channelKey, isStreaming: false });
      break;

    default:
      // Unrecognized event — log at debug level only.
      // console.debug(`[chatUnified] Unhandled SSE event: ${eventName}`);
      break;
  }
}
