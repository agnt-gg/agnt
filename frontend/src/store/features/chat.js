import { Message, ChatWindow } from '@/views/_components/base/ChatWindow';
import { API_CONFIG } from '@/tt.config.js';
import { resolveChannelEnabledTools } from '@/services/chatChannelConfig.js';
import { emitSteer, emitClearSteer } from '@/composables/useRealtimeSync.js';

// The orchestrator chat surface owns this channelKey; every send from chat.js
// resolves provider/model from Vuex (already kept in sync by the popover) and
// the enabled tool list from chatChannelConfig — same convention chatUnified
// uses for sidebar chats.
const ORCHESTRATOR_CHANNEL_KEY = 'orchestrator:default';

const MAX_TOOL_RESULT_CHARS = 2000; // Cap tool results in history to avoid huge payloads

/**
 * Build chat history with proper tool call messages.
 * Sends OpenAI-compatible format: assistant messages with tool_calls,
 * followed by role:"tool" result messages. The backend adapters handle
 * converting to provider-specific formats (Anthropic, Gemini, etc.).
 */
function buildChatHistory(messages, provider = null) {
  const result = [];
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const preserveReasoningContent = new Set(['deepseek', 'kimi', 'kimi-code', 'zai']).has(normalizedProvider);
  const validMessages = messages.filter(
    (msg) => msg && msg.role && (msg.role === 'user' || msg.role === 'assistant')
  );

  for (const msg of validMessages) {
    const reasoningContent = preserveReasoningContent
      ? (msg.reasoning_content || msg.reasoning || '').trim()
      : '';

    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      // Assistant message with tool_calls attached
      const assistantMessage = {
        role: 'assistant',
        content: msg.content || '',
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args || {}),
          },
        })),
      };
      if (reasoningContent) {
        assistantMessage.reasoning_content = reasoningContent;
      }
      result.push(assistantMessage);

      // Tool result messages
      for (const tc of msg.toolCalls) {
        if (tc.result !== undefined || tc.error) {
          let content;
          if (tc.error) {
            content = JSON.stringify({ error: tc.error });
          } else if (typeof tc.result === 'string') {
            content = tc.result;
          } else {
            content = JSON.stringify(tc.result ?? '');
          }
          if (content.length > MAX_TOOL_RESULT_CHARS) {
            content = content.substring(0, MAX_TOOL_RESULT_CHARS) + '\n[...truncated]';
          }
          result.push({ role: 'tool', tool_call_id: tc.id, content });
        }
      }
    } else {
      const historyMessage = { role: msg.role, content: msg.content || '' };
      if (msg.role === 'assistant' && reasoningContent) {
        historyMessage.reasoning_content = reasoningContent;
      }
      result.push(historyMessage);
    }
  }

  return result;
}
const MAX_IMAGE_CACHE = 50; // LRU limit for image cache
const MAX_DATA_CACHE = 50; // LRU limit for data cache
const MAX_AGENT_CONVERSATIONS = 20; // LRU limit for agent conversation cache
const MAX_CONVERSATIONS = 20; // LRU limit for concurrent conversation slots

/**
 * Build the rich completion prompt that gets injected when a goal terminates.
 * Includes verdict, per-task outputs (truncated), and a strong instruction
 * telling Annie to SUMMARIZE the work, not redo it. The trailing instruction
 * is what prevents the LLM from re-executing the goal's task itself.
 */
function buildGoalCompletionPrompt(goal, eventKind, eventData, truncate) {
  const title = goal.title || 'Goal';
  const status = goal.status || 'finished';
  const score = eventData.score != null ? Math.round(eventData.score)
    : goal.evaluation?.scores?.overall != null ? Math.round(goal.evaluation.scores.overall)
    : null;
  const passed = eventData.passed != null ? !!eventData.passed
    : goal.evaluation?.passed != null ? !!goal.evaluation.passed
    : null;
  const feedback = truncate(
    eventData.feedback || goal.evaluation?.feedback || goal.evaluation?.recommendations?.join('; ') || '',
    800,
  );
  const errorReason = eventKind === 'loop_error'
    ? truncate(eventData.error || eventData.reason || 'unknown error', 600)
    : null;

  const tasks = Array.isArray(goal.tasks) ? goal.tasks : [];
  const taskLines = tasks.map((t, i) => {
    const tStatus = t.status || 'unknown';
    const icon = tStatus === 'completed' ? '✓' : tStatus === 'failed' ? '✗' : tStatus === 'running' ? '…' : '○';
    const agent = t.agent_name || t.agentName || '';
    const agentPart = agent ? ` (agent: ${agent})` : '';
    const outputStr = t.output != null
      ? (typeof t.output === 'string' ? t.output : JSON.stringify(t.output))
      : '';
    const errStr = t.error || '';
    const tail = errStr
      ? ` — error: ${truncate(errStr, 300)}`
      : outputStr
      ? ` — output: ${truncate(outputStr, 400)}`
      : '';
    return `${i + 1}. ${icon} ${t.title || 'Task ' + (i + 1)}${agentPart} [${tStatus}]${tail}`;
  });

  // Roll up high-level tool usage if available on tasks
  const toolUseCounts = {};
  for (const t of tasks) {
    const tools = t.tools_used || t.toolsUsed || (Array.isArray(t.required_tools) ? t.required_tools : []);
    if (Array.isArray(tools)) {
      for (const tool of tools) {
        const name = typeof tool === 'string' ? tool : tool?.name;
        if (name) toolUseCounts[name] = (toolUseCounts[name] || 0) + 1;
      }
    }
  }
  const toolSummary = Object.keys(toolUseCounts).length > 0
    ? Object.entries(toolUseCounts).map(([n, c]) => `${n}×${c}`).join(', ')
    : null;

  const headerKind = eventKind === 'loop_error' ? 'GOAL ERRORED' : 'GOAL COMPLETED';
  const lines = [
    `[${headerKind}: ${title}]`,
    `Final status: ${status}${score != null ? ` · score: ${score}/100` : ''}${passed != null ? ` · ${passed ? 'PASSED' : 'NEEDS REVIEW'}` : ''}`,
    goal.description ? `Goal description: ${truncate(goal.description, 300)}` : null,
    errorReason ? `Error: ${errorReason}` : null,
    feedback ? `Verdict feedback: ${feedback}` : null,
    '',
    'Tasks executed:',
    taskLines.length > 0 ? taskLines.join('\n') : '(no task records returned by API)',
    toolSummary ? `\nTools used: ${toolSummary}` : null,
    '',
    'INSTRUCTIONS FOR ANNIE: The goal has finished executing. Read the task results above carefully and write a clear, well-structured summary for the user that explains:',
    '  • What the goal was meant to accomplish',
    '  • What each task produced (the actual outputs above)',
    '  • The final verdict and score, and why it passed or needs review',
    '  • Any concrete deliverables, artifacts, files, or links produced',
    'IMPORTANT: Do NOT re-execute or re-attempt the goal — the work is already done. Just synthesize and explain. If a task output was truncated, mention that the user can see the full output in the goal trace.',
  ].filter(Boolean);

  return lines.join('\n');
}

/**
 * Create an isolated state object for a single conversation.
 * Each conversation gets its own messages, streaming state, caches, etc.
 */
function createConversationState(conversationId) {
  return {
    conversationId,
    messages: [],
    isStreaming: false,
    isRemoteStreaming: false,
    streamAbortController: null,
    streamReader: null,
    activeAsyncTools: new Map(),
    imageCache: new Map(),
    dataCache: new Map(),
    savedOutputId: null,
    savedOutputTitle: null,
    isSaving: false,
    saveStatus: null,
    lastSaveTimestamp: null,
    autosaveDebounceTimer: null,
    agentId: null,
    agentName: null,
    agentAvatar: null,
    streamEventCallbacks: [],
    pendingSteer: '', // Per-conversation so switching chats doesn't drag a steer
  };
}

/**
 * Sync a conversation's state to the flat "mirror" properties on root state.
 * Existing components read state.messages, state.isStreaming, etc. directly,
 * so we keep those in sync with the active conversation.
 */
function syncMirror(state, conv) {
  state.messages = conv.messages;
  state.isStreaming = conv.isStreaming;
  state.isRemoteStreaming = conv.isRemoteStreaming;
  state.streamReader = conv.streamReader;
  state.streamAbortController = conv.streamAbortController;
  state.activeAsyncTools = conv.activeAsyncTools;
  state.imageCache = conv.imageCache;
  state.dataCache = conv.dataCache;
  state.savedOutputId = conv.savedOutputId;
  state.savedOutputTitle = conv.savedOutputTitle;
  state.isSaving = conv.isSaving;
  state.saveStatus = conv.saveStatus;
  state.lastSaveTimestamp = conv.lastSaveTimestamp;
  state.autosaveDebounceTimer = conv.autosaveDebounceTimer;
  state.currentAgentId = conv.agentId;
  state.currentAgentName = conv.agentName;
  state.currentAgentAvatar = conv.agentAvatar;
  state.currentConversationId = conv.conversationId;
  state.pendingSteer = conv.pendingSteer || '';
}

export default {
  namespaced: true,
  state: {
    mainChatWindow: new ChatWindow(),
    activeStreamId: null,
    isStreaming: false,
    isRemoteStreaming: false, // True when another tab is streaming (for "thinking" indicator)
    // Mid-turn steer text awaiting drain. Set when the user submits a message
    // while a turn is already streaming. Auto-fires as a new user turn when
    // the current turn ends if it was never drained at a tool-round seam.
    pendingSteer: '',
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
    // Active async tool executions (for stopping them)
    activeAsyncTools: new Map(), // Map<executionId, { toolName, messageId, toolCallId }>
    // Image cache for generated images
    imageCache: new Map(),
    // Data cache for offloaded large content (DATA_REF resolution)
    dataCache: new Map(),
    // Autosave state
    savedOutputId: null,
    savedOutputTitle: null, // Cached title to avoid re-fetching full record on autosave
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
    // Per-conversation state map for concurrent conversations
    conversations: {}, // { conversationId: ConversationState }
    activeConversationId: null, // ID of the conversation currently displayed in the UI
    savedMainConversationId: null, // Saved main conversation ID when switching to agent chat
    // Per-conversation context bindings — the full skill/goal objects attached
    // to each conversation. Persisted to backend via /api/conversations/:id/settings
    // so reloading restores the chips and the orchestrator system prompt injection.
    activeSkillByConv: {}, // { conversationId: skillObj }
    activeGoalByConv: {},  // { conversationId: goalObj }
    // /goal create flow flag: when true, the next submitted message creates a
    // new goal (POST /api/goals) and auto-attaches it instead of being chatted.
    goalCreateMode: false,
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
    SET_PENDING_STEER(state, content) {
      // Per-conversation: write to the active conversation's slot AND
      // mirror to flat state so existing UI bindings still work. Without
      // this, switching conversations would carry the steer over.
      const conv = state.conversations[state.activeConversationId];
      const prev = conv?.pendingSteer || '';
      const next = prev ? `${prev}\n${content}` : content;
      if (conv) conv.pendingSteer = next;
      state.pendingSteer = next;
    },
    CLEAR_PENDING_STEER(state) {
      const conv = state.conversations[state.activeConversationId];
      if (conv) conv.pendingSteer = '';
      state.pendingSteer = '';
    },
    SCOPED_CLEAR_PENDING_STEER(state, { conversationId }) {
      // Clear steer on a specific conversation slot — used when the SSE
      // event for a steer drain arrives and the user may have already
      // switched away to a different conversation in this tab.
      const conv = state.conversations[conversationId];
      if (conv) conv.pendingSteer = '';
      if (state.activeConversationId === conversationId) state.pendingSteer = '';
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
      } else {
        console.error('Invalid message format pushed to store:', message);
      }
    },
    SET_MESSAGES(state, messages) {
      // Batch-set all messages at once (single reactive update instead of N commits)
      state.messages = messages.filter(
        (msg) => msg && msg.role && msg.content !== undefined
      );
    },
    SET_SAVED_OUTPUT_TITLE(state, title) {
      state.savedOutputTitle = title;
    },
    REMOVE_MESSAGE(state, messageId) {
      const index = state.messages.findIndex(m => m.id === messageId);
      if (index !== -1) {
        state.messages.splice(index, 1);
      }
    },
    ADD_ACTIVE_ASYNC_TOOL(state, { executionId, toolName, messageId, toolCallId }) {
      state.activeAsyncTools.set(executionId, { toolName, messageId, toolCallId });
      state.activeAsyncTools = new Map(state.activeAsyncTools);
    },
    REMOVE_ACTIVE_ASYNC_TOOL(state, executionId) {
      state.activeAsyncTools.delete(executionId);
      state.activeAsyncTools = new Map(state.activeAsyncTools);
    },
    CLEAR_ACTIVE_ASYNC_TOOLS(state) {
      state.activeAsyncTools.clear();
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
        // Track content parts for interleaved rendering
        if (!message.contentParts) message.contentParts = [];
        const lastPart = message.contentParts[message.contentParts.length - 1];
        if (lastPart && lastPart.type === 'text') {
          lastPart.text += delta;
        } else {
          message.contentParts.push({ type: 'text', text: delta });
        }
      }
    },
    APPEND_MESSAGE_REASONING(state, { messageId, delta }) {
      const message = state.messages.find((m) => m.id === messageId);
      if (message) {
        message.reasoning = (message.reasoning || '') + delta;
        message.reasoning_content = (message.reasoning_content || '') + delta;
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
          // Track content parts for interleaved rendering
          if (!message.contentParts) message.contentParts = [];
          message.contentParts.push({ type: 'tool_call', toolCallId: toolCall.id });
        }
      }
    },
    UPDATE_TOOL_CALL_RESULT(state, { messageId, toolCallId, result, error, status }) {
      // Search by messageId first, then fall back to scanning all messages
      let message = messageId ? state.messages.find((m) => m.id === messageId) : null;

      if (!message) {
        for (const msg of state.messages) {
          if (msg.toolCalls && msg.toolCalls.some(tc => tc.id === toolCallId)) {
            message = msg;
            break;
          }
        }
      }

      if (message && message.toolCalls) {
        const toolCallIndex = message.toolCalls.findIndex((tc) => tc.id === toolCallId);
        if (toolCallIndex !== -1) {
          // Use array splice to ensure Vue reactivity triggers
          const toolCall = message.toolCalls[toolCallIndex];
          const updatedToolCall = {
            ...toolCall,
            result: result,
            error: error,
            ...(status && { status: status }),
          };
          message.toolCalls.splice(toolCallIndex, 1, updatedToolCall);
        }
      }
    },
    RESET_CHAT(state) {
      // Abort any active stream before resetting
      if (state.streamAbortController) {
        try { state.streamAbortController.abort(); } catch (e) { /* already aborted */ }
        state.streamAbortController = null;
      }
      if (state.streamReader) {
        try { state.streamReader.cancel(); } catch (e) { /* already cancelled */ }
        state.streamReader = null;
      }

      state.activeStreamId = null;
      state.isStreaming = false;
      state.isRemoteStreaming = false;
      state.currentConversationId = null;
      state.activeAsyncTools = new Map();
      state.imageCache = new Map();

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
      state.savedOutputTitle = null;
      state.lastSaveTimestamp = null;
      state.isSaving = false;
      state.saveStatus = null;
      state.autosaveDebounceTimer = null;

      // If there's an active conversation slot, reset it and re-sync the mirror
      // so state.messages and conv.messages stay the same reference.
      if (state.activeConversationId && state.conversations[state.activeConversationId]) {
        const conv = state.conversations[state.activeConversationId];
        // Abort conversation-scoped stream resources
        if (conv.streamAbortController) {
          try { conv.streamAbortController.abort(); } catch (e) { /* already aborted */ }
          conv.streamAbortController = null;
        }
        if (conv.streamReader) {
          try { conv.streamReader.cancel(); } catch (e) { /* already cancelled */ }
          conv.streamReader = null;
        }
        conv.messages.splice(0);
        conv.isStreaming = false;
        conv.isRemoteStreaming = false;
        conv.activeAsyncTools = new Map();
        conv.imageCache = new Map();
        conv.dataCache = new Map();
        conv.savedOutputId = null;
        conv.savedOutputTitle = null;
        conv.isSaving = false;
        conv.saveStatus = null;
        conv.agentId = null;
        conv.agentName = null;
        conv.agentAvatar = null;
        if (conv.autosaveDebounceTimer) {
          clearTimeout(conv.autosaveDebounceTimer);
          conv.autosaveDebounceTimer = null;
        }
        // Re-sync: state.messages points to the conv's (now-empty) array
        state.messages = conv.messages;
      } else {
        state.messages = [];
      }
    },

    /**
     * Prepare state for a new chat without aborting background streams.
     * Used by "New Chat" so existing conversations keep streaming.
     */
    PREPARE_NEW_CHAT(state) {
      // Clear global mirror state (will be overwritten by syncMirror on SET_ACTIVE_CONVERSATION)
      state.activeStreamId = null;

      // Clear ChatWindow maps for the new chat UI
      if (state.mainChatWindow) {
        state.mainChatWindow.messages.clear();
        state.mainChatWindow.threads.clear();
      }
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
      state.savedOutputTitle = null;
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

    // ============================================
    // SCOPED MUTATIONS (per-conversation)
    // ============================================

    ENSURE_CONVERSATION(state, conversationId) {
      if (!state.conversations[conversationId]) {
        // Evict oldest non-active, non-streaming conversation if at capacity
        const keys = Object.keys(state.conversations);
        if (keys.length >= MAX_CONVERSATIONS) {
          const evictable = keys
            .filter(id => id !== state.activeConversationId && !state.conversations[id].isStreaming)
            .sort((a, b) => {
              const aLast = state.conversations[a].messages.at(-1)?.timestamp || 0;
              const bLast = state.conversations[b].messages.at(-1)?.timestamp || 0;
              return aLast - bLast;
            });
          if (evictable.length > 0) {
            const victim = state.conversations[evictable[0]];
            if (victim.autosaveDebounceTimer) clearTimeout(victim.autosaveDebounceTimer);
            if (victim.streamAbortController) victim.streamAbortController.abort();
            delete state.conversations[evictable[0]];
          }
        }
        // Use spread to ensure Vue reactivity tracks the new key
        state.conversations = { ...state.conversations, [conversationId]: createConversationState(conversationId) };
      }
    },

    SET_ACTIVE_CONVERSATION(state, conversationId) {
      state.activeConversationId = conversationId;
      const conv = state.conversations[conversationId];
      if (conv) {
        syncMirror(state, conv);
      }
    },

    MIGRATE_CONVERSATION_ID(state, { oldId, newId }) {
      const conv = state.conversations[oldId];
      if (!conv) return;
      conv.conversationId = newId;
      // Replace the whole object so Vue picks up the key change
      const updated = { ...state.conversations, [newId]: conv };
      delete updated[oldId];
      state.conversations = updated;
      if (state.activeConversationId === oldId) {
        state.activeConversationId = newId;
        state.currentConversationId = newId;
      }
    },

    SCOPED_SET_STREAMING(state, { conversationId, value }) {
      const conv = state.conversations[conversationId];
      if (conv) {
        conv.isStreaming = value;
        if (state.activeConversationId === conversationId) {
          state.isStreaming = value;
        }
      }
    },

    SCOPED_SET_REMOTE_STREAMING(state, { conversationId, value }) {
      const conv = state.conversations[conversationId];
      if (conv) {
        conv.isRemoteStreaming = value;
        if (state.activeConversationId === conversationId) {
          state.isRemoteStreaming = value;
        }
      }
    },

    SCOPED_ADD_MESSAGE(state, { conversationId, message }) {
      const conv = state.conversations[conversationId];
      if (!conv) return;
      if (message && message.role && message.content !== undefined) {
        conv.messages.push(message);
      }
      // Mirror is by reference, so no extra sync needed for messages array
    },

    SCOPED_SET_MESSAGES(state, { conversationId, messages }) {
      const conv = state.conversations[conversationId];
      if (!conv) return;
      conv.messages = messages.filter(msg => msg && msg.role && msg.content !== undefined);
      if (state.activeConversationId === conversationId) {
        state.messages = conv.messages;
      }
    },

    /**
     * Remove all messages from a given message ID onward (inclusive).
     * Used for "edit and resend" — truncates conversation back to that point.
     */
    SCOPED_TRUNCATE_FROM(state, { conversationId, messageId }) {
      const conv = state.conversations[conversationId];
      if (!conv) return;
      const idx = conv.messages.findIndex(m => m.id === messageId);
      if (idx !== -1) {
        conv.messages.splice(idx);
      }
      if (state.activeConversationId === conversationId) {
        state.messages = conv.messages;
      }
    },

    SCOPED_APPEND_MESSAGE_CONTENT(state, { conversationId, messageId, delta }) {
      const conv = state.conversations[conversationId];
      if (!conv) return;
      const message = conv.messages.find(m => m.id === messageId);
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
    },

    SCOPED_APPEND_MESSAGE_REASONING(state, { conversationId, messageId, delta }) {
      const conv = state.conversations[conversationId];
      if (!conv) return;
      const message = conv.messages.find(m => m.id === messageId);
      if (message) {
        message.reasoning = (message.reasoning || '') + delta;
        message.reasoning_content = (message.reasoning_content || '') + delta;
      }
    },

    SCOPED_ADD_TOOL_CALL(state, { conversationId, messageId, toolCall }) {
      const conv = state.conversations[conversationId];
      if (!conv) return;
      const message = conv.messages.find(m => m.id === messageId);
      if (message) {
        if (!message.toolCalls) message.toolCalls = [];
        if (!message.toolCalls.some(tc => tc.id === toolCall.id)) {
          message.toolCalls.push(toolCall);
          // Track content parts for interleaved rendering
          if (!message.contentParts) message.contentParts = [];
          message.contentParts.push({ type: 'tool_call', toolCallId: toolCall.id });
        }
      }
    },

    SCOPED_UPDATE_TOOL_CALL_RESULT(state, { conversationId, messageId, toolCallId, result, error, status }) {
      const conv = state.conversations[conversationId];
      if (!conv) return;
      let message = messageId ? conv.messages.find(m => m.id === messageId) : null;
      if (!message) {
        for (const msg of conv.messages) {
          if (msg.toolCalls && msg.toolCalls.some(tc => tc.id === toolCallId)) {
            message = msg;
            break;
          }
        }
      }
      if (message && message.toolCalls) {
        const idx = message.toolCalls.findIndex(tc => tc.id === toolCallId);
        if (idx !== -1) {
          const updated = { ...message.toolCalls[idx], result, error, ...(status && { status }) };
          message.toolCalls.splice(idx, 1, updated);
        }
      }
    },

    SCOPED_REMOVE_MESSAGE(state, { conversationId, messageId }) {
      const conv = state.conversations[conversationId];
      if (!conv) return;
      const idx = conv.messages.findIndex(m => m.id === messageId);
      if (idx !== -1) conv.messages.splice(idx, 1);
    },

    SCOPED_SET_ABORT_CONTROLLER(state, { conversationId, controller }) {
      const conv = state.conversations[conversationId];
      if (conv) {
        conv.streamAbortController = controller;
        if (state.activeConversationId === conversationId) {
          state.streamAbortController = controller;
        }
      }
    },

    SCOPED_SET_STREAM_READER(state, { conversationId, reader }) {
      const conv = state.conversations[conversationId];
      if (conv) {
        conv.streamReader = reader;
        if (state.activeConversationId === conversationId) {
          state.streamReader = reader;
        }
      }
    },

    SCOPED_ADD_IMAGE_TO_CACHE(state, { conversationId, imageId, imageData, toolCallId, messageId, index }) {
      const conv = state.conversations[conversationId];
      if (!conv) return;
      if (conv.imageCache.size >= MAX_IMAGE_CACHE) {
        const oldestKey = conv.imageCache.keys().next().value;
        conv.imageCache.delete(oldestKey);
      }
      conv.imageCache.set(imageId, { data: imageData, toolCallId, messageId, index });
    },

    SCOPED_ADD_DATA_TO_CACHE(state, { conversationId, dataId, fullContent, toolCallId, messageId, size, path }) {
      const conv = state.conversations[conversationId];
      if (!conv) return;
      if (conv.dataCache.size >= MAX_DATA_CACHE) {
        const oldestKey = conv.dataCache.keys().next().value;
        conv.dataCache.delete(oldestKey);
      }
      conv.dataCache.set(dataId, { content: fullContent, toolCallId, messageId, size, path });
    },

    SCOPED_ADD_ACTIVE_ASYNC_TOOL(state, { conversationId, executionId, toolName, messageId, toolCallId }) {
      const conv = state.conversations[conversationId];
      if (conv) {
        conv.activeAsyncTools.set(executionId, { toolName, messageId, toolCallId });
        conv.activeAsyncTools = new Map(conv.activeAsyncTools);
        if (state.activeConversationId === conversationId) {
          state.activeAsyncTools = conv.activeAsyncTools;
        }
      }
    },

    SCOPED_REMOVE_ACTIVE_ASYNC_TOOL(state, { conversationId, executionId }) {
      const conv = state.conversations[conversationId];
      if (conv) {
        conv.activeAsyncTools.delete(executionId);
        conv.activeAsyncTools = new Map(conv.activeAsyncTools);
        if (state.activeConversationId === conversationId) {
          state.activeAsyncTools = conv.activeAsyncTools;
        }
      }
    },

    SCOPED_SET_SAVED_OUTPUT_ID(state, { conversationId, id }) {
      const conv = state.conversations[conversationId];
      if (conv) {
        conv.savedOutputId = id;
        if (state.activeConversationId === conversationId) state.savedOutputId = id;
      }
    },

    SCOPED_SET_SAVED_OUTPUT_TITLE(state, { conversationId, title }) {
      const conv = state.conversations[conversationId];
      if (conv) {
        conv.savedOutputTitle = title;
        if (state.activeConversationId === conversationId) state.savedOutputTitle = title;
      }
    },

    SCOPED_SET_IS_SAVING(state, { conversationId, value }) {
      const conv = state.conversations[conversationId];
      if (conv) {
        conv.isSaving = value;
        if (state.activeConversationId === conversationId) state.isSaving = value;
      }
    },

    SCOPED_SET_SAVE_STATUS(state, { conversationId, status }) {
      const conv = state.conversations[conversationId];
      if (conv) {
        conv.saveStatus = status;
        if (state.activeConversationId === conversationId) state.saveStatus = status;
      }
    },

    SCOPED_SET_AUTOSAVE_TIMER(state, { conversationId, timer }) {
      const conv = state.conversations[conversationId];
      if (conv) {
        conv.autosaveDebounceTimer = timer;
        if (state.activeConversationId === conversationId) state.autosaveDebounceTimer = timer;
      }
    },

    SCOPED_SET_AGENT(state, { conversationId, agentId, agentName, agentAvatar }) {
      const conv = state.conversations[conversationId];
      if (conv) {
        conv.agentId = agentId;
        conv.agentName = agentName || null;
        conv.agentAvatar = agentAvatar || null;
        if (state.activeConversationId === conversationId) {
          state.currentAgentId = agentId;
          state.currentAgentName = agentName || null;
          state.currentAgentAvatar = agentAvatar || null;
        }
      }
    },

    // ============================================
    // SKILL/GOAL CONTEXT (per-conversation)
    // ============================================

    SET_ACTIVE_SKILL(state, { conversationId, skill }) {
      if (!conversationId) return;
      // Reassign object so Vue tracks the key change
      if (skill) {
        state.activeSkillByConv = { ...state.activeSkillByConv, [conversationId]: skill };
      } else {
        const next = { ...state.activeSkillByConv };
        delete next[conversationId];
        state.activeSkillByConv = next;
      }
    },

    SET_ACTIVE_GOAL(state, { conversationId, goal }) {
      if (!conversationId) return;
      if (goal) {
        state.activeGoalByConv = { ...state.activeGoalByConv, [conversationId]: goal };
      } else {
        const next = { ...state.activeGoalByConv };
        delete next[conversationId];
        state.activeGoalByConv = next;
      }
    },

    SET_GOAL_CREATE_MODE(state, value) {
      state.goalCreateMode = !!value;
    },

    /**
     * On MIGRATE_CONVERSATION_ID we also need to move skill/goal bindings to
     * the new id so the chips don't disappear when the temp- id flips to a
     * server-assigned UUID at the start of streaming.
     */
    MIGRATE_CONTEXT_BINDINGS(state, { oldId, newId }) {
      if (!oldId || !newId || oldId === newId) return;
      if (state.activeSkillByConv[oldId]) {
        const skill = state.activeSkillByConv[oldId];
        const next = { ...state.activeSkillByConv };
        delete next[oldId];
        next[newId] = skill;
        state.activeSkillByConv = next;
      }
      if (state.activeGoalByConv[oldId]) {
        const goal = state.activeGoalByConv[oldId];
        const next = { ...state.activeGoalByConv };
        delete next[oldId];
        next[newId] = goal;
        state.activeGoalByConv = next;
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
    // Per-conversation "is this conv blocked by a running goal" check. The
    // truth-source for goal status is the goals/goals store (real-time
    // socket events keep it fresh) — activeGoalByConv only stores a snapshot
    // taken at attach time, so we look up the LIVE status here instead of
    // trusting the snapshot. A conversation with a goal in planning/
    // executing/paused/replanning state counts as "active" so the UI can
    // mirror the same indicator it shows for in-flight async tools.
    isConvBlockedByGoal: (state, _getters, rootState) => (convId) => {
      const bound = state.activeGoalByConv[convId];
      if (!bound?.id) return false;
      const live = (rootState?.goals?.goals || []).find((g) => g.id === bound.id);
      const status = live?.status || bound.status;
      return ['planning', 'executing', 'paused', 'replanning'].includes(status);
    },

    // Combined streaming indicator - true if THIS tab or ANOTHER tab is streaming,
    // an async tool is still running after the LLM turn finished, OR a goal
    // bound to the active conversation is currently running.
    isAnyStreaming: (state, getters) =>
      state.isStreaming ||
      state.isRemoteStreaming ||
      (state.activeAsyncTools && state.activeAsyncTools.size > 0) ||
      getters.isConvBlockedByGoal(state.activeConversationId),
    // Agent chat getters
    isAgentChat: (state) => !!state.currentAgentId,
    currentAgent: (state) => ({
      id: state.currentAgentId,
      name: state.currentAgentName,
      avatar: state.currentAgentAvatar,
    }),
    hasAgentConversation: (state) => (agentId) => !!state.agentConversations[agentId],
    // Concurrent conversation getters
    activeConversation: (state) => state.conversations[state.activeConversationId] || null,
    isAnyConversationStreaming: (state, getters) =>
      Object.values(state.conversations).some(
        (c) => c.isStreaming || (c.activeAsyncTools && c.activeAsyncTools.size > 0),
      ) ||
      Object.keys(state.activeGoalByConv).some((cid) => getters.isConvBlockedByGoal(cid)),
    streamingConversationIds: (state, getters) =>
      Object.keys(state.conversations).filter((id) => {
        const c = state.conversations[id];
        return (
          c.isStreaming ||
          (c.activeAsyncTools && c.activeAsyncTools.size > 0) ||
          getters.isConvBlockedByGoal(id)
        );
      }),
    streamingOutputIds: (state, getters) => {
      const ids = new Set();
      for (const [convId, conv] of Object.entries(state.conversations)) {
        const active =
          conv.isStreaming ||
          (conv.activeAsyncTools && conv.activeAsyncTools.size > 0) ||
          getters.isConvBlockedByGoal(convId);
        if (active && conv.savedOutputId) {
          ids.add(conv.savedOutputId);
        }
      }
      return ids;
    },
    activeSkillForConversation: (state) => (conversationId) =>
      conversationId ? state.activeSkillByConv[conversationId] || null : null,
    activeGoalForConversation: (state) => (conversationId) =>
      conversationId ? state.activeGoalByConv[conversationId] || null : null,
    currentActiveSkill: (state) =>
      state.activeConversationId ? state.activeSkillByConv[state.activeConversationId] || null : null,
    currentActiveGoal: (state) =>
      state.activeConversationId ? state.activeGoalByConv[state.activeConversationId] || null : null,
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
     * Send a mid-turn steer over the socket. Backend stashes it and drains
     * between tool rounds (appending to the last tool-result message) or, if
     * the turn ends without another tool round, the frontend's auto-fire
     * watcher sends the text as a fresh user turn.
     */
    async steerInFlight({ commit, state }, { content }) {
      const conversationId = state.currentConversationId;
      if (!conversationId) return { ok: false, error: 'no_conversation' };
      const text = (content || '').trim();
      if (!text) return { ok: false, error: 'empty' };
      const resp = await emitSteer(conversationId, text);
      if (resp?.ok) {
        commit('SET_PENDING_STEER', text);
      }
      return resp;
    },

    /**
     * Cancel a pending steer — user clicked the X on the chip before it
     * was drained at a tool-round seam OR auto-fired at turn end.
     */
    async cancelSteer({ commit, state }) {
      const conversationId = state.currentConversationId;
      // Always clear locally so the chip disappears immediately.
      commit('CLEAR_PENDING_STEER');
      if (conversationId) {
        emitClearSteer(conversationId).catch(() => {});
      }
    },

    /**
     * Start a streaming conversation that persists across screen changes.
     * Supports multiple concurrent streams — each conversation gets its own slot.
     */
    async startStreamingConversation(
      { commit, state, dispatch, rootState },
      { userInput, files = [], provider, model, reasoningValue = 'default', reasoningEnabled = false, mentionedAgent = null },
    ) {
      // Determine which conversation to stream in
      let convId = state.activeConversationId || state.currentConversationId || `temp-${Date.now()}`;

      // Per-conversation guard: only block if THIS conversation is already streaming
      // Allow concurrent streams for multi-agent @ mentions
      const existingConv = state.conversations[convId];
      if (existingConv && existingConv.isStreaming && !mentionedAgent) {
        console.warn('[Chat] This conversation is already streaming, ignoring new request');
        return;
      }

      // Ensure conversation slot exists
      commit('ENSURE_CONVERSATION', convId);
      if (!state.activeConversationId) {
        commit('SET_ACTIVE_CONVERSATION', convId);
      }

      // Track concurrent streams so isStreaming stays true until ALL finish
      const conv0 = state.conversations[convId];
      conv0._activeStreams = (conv0._activeStreams || 0) + 1;

      commit('SCOPED_SET_STREAMING', { conversationId: convId, value: true });

      // For concurrent agent streams, skip conversation_started migration after the first
      const skipMigration = !!(mentionedAgent && existingConv && existingConv.isStreaming);

      const token = localStorage.getItem('token');
      // Read messages from the conversation slot — includes tool call context
      const conv = state.conversations[convId];
      const chatHistory = buildChatHistory(conv.messages, provider);

      // Remove duplicate trailing user message if it matches what we're about to send
      const deduped = chatHistory.length > 0 &&
        chatHistory[chatHistory.length - 1].content === userInput &&
        chatHistory[chatHistory.length - 1].role === 'user'
        ? chatHistory.slice(0, -1)
        : chatHistory;

      // Create abort controller for this stream
      const abortController = new AbortController();
      commit('SCOPED_SET_ABORT_CONTROLLER', { conversationId: convId, controller: abortController });

      // Capture convId in closure so SSE events route to the right conversation
      // even if the user switches away from this conversation mid-stream
      const capturedConvId = convId;

      try {
        let body;
        const headers = {};
        const normalizedReasoningValue = typeof reasoningValue === 'string' && reasoningValue.trim()
          ? reasoningValue.trim().toLowerCase()
          : 'default';
        const derivedReasoningEnabled = normalizedReasoningValue !== 'default' &&
          normalizedReasoningValue !== 'off' &&
          normalizedReasoningValue !== 'none';
        const effectiveReasoningEnabled = reasoningEnabled || derivedReasoningEnabled;
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        // Resolve agentId from @ mention or existing conversation context
        const resolvedAgentId = mentionedAgent?.id || conv.agentId || null;

        // Resolve per-conversation skill/goal bindings (set via /skill, /goal).
        // These get sent on every turn so the orchestrator can prepend the
        // skill instructions to the system prompt and load goal context.
        // We also forward the full `instructions` text inline because
        // filesystem-discovered skills carry synthetic ids (`fs-*`) that
        // SkillModel.findById can't resolve — the backend uses the inline
        // text when provided and falls back to a DB lookup otherwise.
        const activeSkill = state.activeSkillByConv[convId] || null;
        const activeGoal = state.activeGoalByConv[convId] || null;
        const resolvedSkillId = activeSkill?.id || null;
        const resolvedGoalId = activeGoal?.id || null;
        const resolvedSkillInstructions = activeSkill?.instructions || null;
        const resolvedSkillName = activeSkill?.name || activeSkill?.slug || null;
        const resolvedSkillDescription = activeSkill?.description || null;
        const resolvedSkillAllowedTools = activeSkill?.allowed_tools || activeSkill?.allowedTools || null;

        if (activeSkill || activeGoal) {
          console.log('[Chat] Sending request with bound context:', {
            convId,
            skillId: resolvedSkillId,
            skillName: resolvedSkillName,
            skillInstructionsLen: (resolvedSkillInstructions || '').length,
            goalId: resolvedGoalId,
          });
        }

        // Use FormData if files are present, otherwise use JSON
        if (files && files.length > 0) {
          const formData = new FormData();
          formData.append('message', userInput);
          formData.append('history', JSON.stringify(deduped));
          if (conv.conversationId && !conv.conversationId.startsWith('temp-')) {
            formData.append('conversationId', conv.conversationId);
          }
          formData.append('provider', provider);
          formData.append('model', model);
          if (normalizedReasoningValue !== 'default') {
            formData.append('reasoningValue', normalizedReasoningValue);
          }
          if (effectiveReasoningEnabled) {
            formData.append('reasoningEnabled', 'true');
          }
          if (resolvedAgentId) {
            formData.append('agentId', resolvedAgentId);
          }
          if (resolvedSkillId) {
            formData.append('skillId', resolvedSkillId);
          }
          if (resolvedSkillInstructions) {
            formData.append('skillInstructions', resolvedSkillInstructions);
          }
          if (resolvedSkillName) {
            formData.append('skillName', resolvedSkillName);
          }
          if (resolvedSkillDescription) {
            formData.append('skillDescription', resolvedSkillDescription);
          }
          if (resolvedSkillAllowedTools) {
            formData.append(
              'skillAllowedTools',
              typeof resolvedSkillAllowedTools === 'string'
                ? resolvedSkillAllowedTools
                : JSON.stringify(resolvedSkillAllowedTools),
            );
          }
          if (resolvedGoalId) {
            formData.append('goalId', resolvedGoalId);
          }
          // Send enabled tools — per-channel override wins, falls back to
          // legacy global key for users who haven't configured this chat yet.
          // We send the array even when it is *empty* so the backend can
          // distinguish "user unchecked everything" (`[]`) from "user has no
          // opinion" (field absent). Without this, turning off all tools
          // silently fell through to the no-selection branch and the LLM
          // still received every tool.
          const channelTools = resolveChannelEnabledTools(ORCHESTRATOR_CHANNEL_KEY);
          if (Array.isArray(channelTools)) {
            formData.append('enabledTools', JSON.stringify(channelTools));
          }

          files.forEach((file) => {
            formData.append('files', file);
          });

          body = formData;
        } else {
          headers['Content-Type'] = 'application/json';
          // Respect the "no opinion" / "explicit zero tools" distinction the
          // backend now enforces. `resolveChannelEnabledTools` returns
          // `undefined` when the user has never configured this channel —
          // omit the key entirely in that case so the backend uses defaults.
          const channelToolsForJson = resolveChannelEnabledTools(ORCHESTRATOR_CHANNEL_KEY);
          body = JSON.stringify({
            message: userInput,
            history: deduped,
            conversationId: conv.conversationId && !conv.conversationId.startsWith('temp-') ? conv.conversationId : undefined,
            provider: provider,
            model: model,
            reasoningValue: normalizedReasoningValue !== 'default' ? normalizedReasoningValue : undefined,
            reasoningEnabled: effectiveReasoningEnabled || undefined,
            agentId: resolvedAgentId || undefined,
            skillId: resolvedSkillId || undefined,
            skillInstructions: resolvedSkillInstructions || undefined,
            skillName: resolvedSkillName || undefined,
            skillDescription: resolvedSkillDescription || undefined,
            skillAllowedTools: resolvedSkillAllowedTools || undefined,
            goalId: resolvedGoalId || undefined,
            // undefined → field omitted by JSON.stringify; array (incl. []) → preserved
            enabledTools: Array.isArray(channelToolsForJson) ? channelToolsForJson : undefined,
          });
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/orchestrator/chat`, {
          method: 'POST',
          headers: headers,
          body: body,
          signal: abortController.signal,
        });

        if (!response.ok) {
          let errorText;
          try {
            const text = await response.text();
            try {
              const json = JSON.parse(text);
              errorText = json.error || json.message || text;
            } catch {
              errorText = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
            }
          } catch {
            errorText = response.statusText || 'Unknown error';
          }
          throw new Error(`Server error (${response.status}): ${errorText}`);
        }

        if (!response.body) {
          throw new Error('No response body from server');
        }

        const reader = response.body.getReader();
        commit('SCOPED_SET_STREAM_READER', { conversationId: capturedConvId, reader });

        const decoder = new TextDecoder();
        let buffer = '';
        // Track the current conversation ID (may change on conversation_started event)
        let activeConvId = capturedConvId;

        // Process stream — returns a promise that resolves when the stream ends
        // so callers can await sequential streams (e.g. multi-agent mentions)
        const processStream = () => new Promise((resolveStream) => {
          (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                // Decrement concurrent stream counter; only clear isStreaming when all done
                const doneConv = state.conversations[activeConvId];
                if (doneConv) {
                  doneConv._activeStreams = Math.max(0, (doneConv._activeStreams || 1) - 1);
                  if (doneConv._activeStreams === 0) {
                    commit('SCOPED_SET_STREAMING', { conversationId: activeConvId, value: false });
                  }
                }
                commit('SCOPED_SET_STREAM_READER', { conversationId: activeConvId, reader: null });
                commit('SCOPED_SET_ABORT_CONTROLLER', { conversationId: activeConvId, controller: null });
                resolveStream();
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

                    // Handle conversation_started: migrate temp ID to server-assigned ID
                    // Skip migration for concurrent agent streams (first stream handles it)
                    if (eventName === 'conversation_started' && data.conversationId) {
                      if (!skipMigration) {
                        const oldId = activeConvId;
                        if (oldId !== data.conversationId) {
                          commit('MIGRATE_CONVERSATION_ID', { oldId, newId: data.conversationId });
                          commit('MIGRATE_CONTEXT_BINDINGS', { oldId, newId: data.conversationId });
                          activeConvId = data.conversationId;
                        }
                      } else {
                        // Use the current conversation ID (already migrated by first stream)
                        activeConvId = state.activeConversationId || activeConvId;
                      }
                    }

                    // Emit event to all registered callbacks.
                    // Pass activeConvId so consumers can filter events for
                    // conversations the user isn't currently viewing.
                    state.streamEventCallbacks.forEach((callback) => {
                      try {
                        callback(eventName, data, activeConvId);
                      } catch (callbackError) {
                        console.error('Error in stream event callback:', callbackError);
                      }
                    });

                    // Handle core events in store — scoped to this conversation
                    handleScopedStreamEvent({ commit, state, dispatch }, eventName, data, activeConvId);
                  } catch (e) {
                    console.error('Error parsing stream data:', e, 'Raw data:', dataLine);
                    if (eventName === 'error') {
                      handleScopedStreamEvent({ commit, state, dispatch }, 'error', {
                        error: `Stream error (unparseable response): ${dataLine?.substring(0, 200) || 'No data'}`,
                      }, activeConvId);
                    }
                  }
                }
              }
            }
          } catch (error) {
            if (error.name === 'AbortError') {
              console.log('Stream aborted by user');
            } else {
              console.error('Error processing stream:', error);
              commit('SCOPED_SET_STREAM_READER', { conversationId: activeConvId, reader: null });
              commit('SCOPED_SET_ABORT_CONTROLLER', { conversationId: activeConvId, controller: null });
            }
            // Decrement counter on error too
            const errConv = state.conversations[activeConvId];
            if (errConv) {
              errConv._activeStreams = Math.max(0, (errConv._activeStreams || 1) - 1);
              if (errConv._activeStreams === 0) {
                commit('SCOPED_SET_STREAMING', { conversationId: activeConvId, value: false });
              }
            }
            resolveStream();
          }
          })();
        });

        await processStream();
      } catch (error) {
        console.error('Error starting stream:', error);
        commit('SCOPED_SET_STREAMING', { conversationId: capturedConvId, value: false });
        commit('SCOPED_SET_STREAM_READER', { conversationId: capturedConvId, reader: null });
        commit('SCOPED_SET_ABORT_CONTROLLER', { conversationId: capturedConvId, controller: null });

        const errorMessage = error.message || 'An unexpected error occurred.';
        const errorMessageId = `msg-${Date.now()}-error`;
        commit('SCOPED_ADD_MESSAGE', {
          conversationId: capturedConvId,
          message: {
            id: errorMessageId,
            role: 'assistant',
            content: `Sorry, I encountered an error: ${errorMessage}`,
            timestamp: Date.now(),
            metadata: ['Error'],
          },
        });
      }
    },

    /**
     * Stop a streaming conversation AND all its active async tools.
     * Accepts optional conversationId; defaults to the active conversation.
     */
    async stopStreamingConversation({ commit, state }, conversationId) {
      const convId = conversationId || state.activeConversationId;
      const conv = convId ? state.conversations[convId] : null;

      // Gather abort resources from conversation slot AND global mirror (belt and suspenders)
      const abortController = (conv && conv.streamAbortController) || state.streamAbortController;
      const streamReader = (conv && conv.streamReader) || state.streamReader;
      const asyncTools = (conv && conv.activeAsyncTools) || state.activeAsyncTools;

      if (abortController) {
        abortController.abort();
        if (conv) {
          commit('SCOPED_SET_ABORT_CONTROLLER', { conversationId: convId, controller: null });
        } else {
          commit('SET_STREAM_ABORT_CONTROLLER', null);
        }
      }
      if (streamReader) {
        try {
          streamReader.cancel();
        } catch (e) {
          // Reader may already be aborted — ignore
        }
        if (conv) {
          commit('SCOPED_SET_STREAM_READER', { conversationId: convId, reader: null });
        } else {
          commit('SET_STREAM_READER', null);
        }
      }

      // Stop ALL active async tools
      const asyncToolsToStop = Array.from(asyncTools.keys());
      if (asyncToolsToStop.length > 0) {
        console.log(`[Chat] Stopping ${asyncToolsToStop.length} active async tool(s):`, asyncToolsToStop);

        const token = localStorage.getItem('token');
        const stopPromises = asyncToolsToStop.map(async (executionId) => {
          try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/async-tools/cancel/${executionId}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
            });

            if (response.ok) {
              console.log(`[Chat] Cancelled async tool: ${executionId}`);
              if (conv) {
                commit('SCOPED_REMOVE_ACTIVE_ASYNC_TOOL', { conversationId: convId, executionId });
              } else {
                commit('REMOVE_ACTIVE_ASYNC_TOOL', executionId);
              }
            } else {
              console.error(`[Chat] Failed to cancel async tool ${executionId}:`, await response.text());
            }
          } catch (error) {
            console.error(`[Chat] Error cancelling async tool ${executionId}:`, error);
          }
        });

        await Promise.all(stopPromises);
      }

      // Emit 'done' event to all callbacks to trigger cleanup.
      // Pass the stopped conversation id so scoped consumers can filter.
      state.streamEventCallbacks.forEach((callback) => {
        try {
          callback('done', {}, convId);
        } catch (callbackError) {
          console.error('Error in stream event callback during stop:', callbackError);
        }
      });

      if (conv) {
        commit('SCOPED_SET_STREAMING', { conversationId: convId, value: false });
      }
      // Always clear the global mirror so the UI stop button disappears
      state.isStreaming = false;

      // Add a system message indicating the stream was stopped
      const stoppedCount = asyncToolsToStop.length;
      const message = stoppedCount > 0
        ? `Generation stopped by user. ${stoppedCount} async tool(s) cancelled.`
        : 'Generation stopped by user.';

      const stopMsg = {
        id: `msg-${Date.now()}-stopped`,
        role: 'system',
        content: message,
        timestamp: Date.now(),
        metadata: ['User Action'],
      };

      if (conv) {
        commit('SCOPED_ADD_MESSAGE', { conversationId: convId, message: stopMsg });
      } else {
        commit('ADD_MESSAGE', stopMsg);
      }
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
     * Autosave conversation with debouncing.
     * Accepts optional conversationId to save a background conversation.
     */
    async autosaveConversation({ commit, state, dispatch, rootState }, { debounce = true, conversationId } = {}) {
      // Determine which conversation to save
      const convId = conversationId || state.activeConversationId;
      const conv = convId ? state.conversations[convId] : null;

      // Read from conversation slot if available, else fall back to global state
      const messages = conv ? conv.messages : state.messages;
      const isSaving = conv ? conv.isSaving : state.isSaving;
      const agentId = conv ? conv.agentId : state.currentAgentId;
      const agentName = conv ? conv.agentName : state.currentAgentName;
      const savedOutputId = conv ? conv.savedOutputId : state.savedOutputId;
      const savedOutputTitle = conv ? conv.savedOutputTitle : state.savedOutputTitle;
      const imageCache = conv ? conv.imageCache : state.imageCache;
      const currentConvId = conv ? conv.conversationId : state.currentConversationId;

      if (!state.autosaveEnabled || isSaving) return;
      if (agentId) return; // Don't autosave agent chats

      const meaningfulMessages = messages.filter((msg) => msg.role === 'user' || (msg.role === 'assistant' && !msg.showProviderSetup));
      if (meaningfulMessages.length === 0) return;

      // Clear existing debounce timer
      const existingTimer = conv ? conv.autosaveDebounceTimer : state.autosaveDebounceTimer;
      if (existingTimer) {
        clearTimeout(existingTimer);
        if (conv) {
          commit('SCOPED_SET_AUTOSAVE_TIMER', { conversationId: convId, timer: null });
        } else {
          commit('SET_AUTOSAVE_DEBOUNCE_TIMER', null);
        }
      }

      if (debounce) {
        const timer = setTimeout(() => {
          dispatch('autosaveConversation', { debounce: false, conversationId: convId });
        }, 3000);
        if (conv) {
          commit('SCOPED_SET_AUTOSAVE_TIMER', { conversationId: convId, timer });
        } else {
          commit('SET_AUTOSAVE_DEBOUNCE_TIMER', timer);
        }
        return;
      }

      // Perform the actual save
      if (conv) {
        commit('SCOPED_SET_IS_SAVING', { conversationId: convId, value: true });
        commit('SCOPED_SET_SAVE_STATUS', { conversationId: convId, status: 'saving' });
      } else {
        commit('SET_IS_SAVING', true);
        commit('SET_SAVE_STATUS', 'saving');
      }

      const token = localStorage.getItem('token');
      if (!token) {
        console.error('No authentication token found for autosave');
        if (conv) {
          commit('SCOPED_SET_IS_SAVING', { conversationId: convId, value: false });
          commit('SCOPED_SET_SAVE_STATUS', { conversationId: convId, status: 'error' });
        } else {
          commit('SET_IS_SAVING', false);
          commit('SET_SAVE_STATUS', 'error');
        }
        return;
      }

      try {
        // Resolve the title with this priority order so user renames are NEVER
        // overwritten by autosave's auto-generated title:
        //   1. Title currently in the contentOutputs cache (reflects renames).
        //   2. Cached savedOutputTitle on this conversation (from prior save/restore).
        //   3. Auto-generate from the first user message (only used on FIRST save).
        let conversationTitle = null;
        if (savedOutputId) {
          const cached = (rootState?.contentOutputs?.outputs || []).find((o) => o.id === savedOutputId);
          if (cached?.title) conversationTitle = cached.title;
        }
        if (!conversationTitle) conversationTitle = savedOutputTitle || null;
        if (!conversationTitle) {
          const firstUserMessage = messages.find((msg) => msg.role === 'user');
          const agentPrefix = agentId && agentName ? `[${agentName}] ` : '';
          conversationTitle = firstUserMessage
            ? agentPrefix + firstUserMessage.content.substring(0, 100) + (firstUserMessage.content.length > 100 ? '...' : '')
            : agentPrefix + 'Untitled Conversation';
        }

        const resolveImageReferences = (content) => {
          if (!content || typeof content !== 'string') return content;
          const imageRefPattern = /\{\{IMAGE_REF:([^}]+)\}\}/g;
          return content.replace(imageRefPattern, (match, imageId) => {
            const cached = imageCache.get(imageId);
            if (cached && cached.data) return cached.data;
            return match;
          });
        };

        const conversationData = {
          conversationId: currentConvId,
          title: conversationTitle,
          agentId: agentId || null,
          agentName: agentName || null,
          isAgentChat: !!agentId,
          messages: messages.map((msg) => ({
            id: msg.id,
            role: msg.role,
            content: resolveImageReferences(msg.content),
            timestamp: msg.timestamp,
            metadata: msg.metadata || [],
            toolCalls: msg.toolCalls || [],
            contentParts: msg.contentParts || [],
            reasoning: msg.reasoning || undefined,
            reasoning_content: msg.reasoning_content || undefined,
            files: msg.files || [],
            agentName: msg.agentName || undefined,
            agentIcon: msg.agentIcon || undefined,
          })),
          createdAt: messages[0]?.timestamp || Date.now(),
          updatedAt: Date.now(),
        };

        const response = await fetch(`${API_CONFIG.BASE_URL}/content-outputs/save`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            id: savedOutputId,
            content: JSON.stringify(conversationData),
            contentType: 'conversation',
            conversationId: currentConvId,
            isShareable: false,
            title: conversationTitle,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        if (conv) {
          commit('SCOPED_SET_SAVED_OUTPUT_ID', { conversationId: convId, id: result.id });
          commit('SCOPED_SET_SAVED_OUTPUT_TITLE', { conversationId: convId, title: conversationTitle });
          commit('SCOPED_SET_IS_SAVING', { conversationId: convId, value: false });
          commit('SCOPED_SET_SAVE_STATUS', { conversationId: convId, status: 'saved' });
        } else {
          commit('SET_SAVED_OUTPUT_ID', result.id);
          commit('SET_SAVED_OUTPUT_TITLE', conversationTitle);
          commit('SET_IS_SAVING', false);
          commit('SET_SAVE_STATUS', 'saved');
        }
        commit('SET_LAST_SAVE_TIMESTAMP', Date.now());

        window.dispatchEvent(new CustomEvent('conversation-saved', { detail: { id: result.id } }));

        setTimeout(() => {
          const currentStatus = conv ? conv.saveStatus : state.saveStatus;
          if (currentStatus === 'saved') {
            if (conv) {
              commit('SCOPED_SET_SAVE_STATUS', { conversationId: convId, status: null });
            } else {
              commit('SET_SAVE_STATUS', null);
            }
          }
        }, 3000);

        console.log('[Autosave] Conversation saved successfully:', result.id);
      } catch (error) {
        console.error('[Autosave] Error saving conversation:', error);
        if (conv) {
          commit('SCOPED_SET_IS_SAVING', { conversationId: convId, value: false });
          commit('SCOPED_SET_SAVE_STATUS', { conversationId: convId, status: 'error' });
        } else {
          commit('SET_IS_SAVING', false);
          commit('SET_SAVE_STATUS', 'error');
        }

        setTimeout(() => {
          const currentStatus = conv ? conv.saveStatus : state.saveStatus;
          if (currentStatus === 'error') {
            if (conv) {
              commit('SCOPED_SET_SAVE_STATUS', { conversationId: convId, status: null });
            } else {
              commit('SET_SAVE_STATUS', null);
            }
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

        // Cache the new title so autosave doesn't overwrite it
        if (state.savedOutputId === outputId) {
          commit('SET_SAVED_OUTPUT_TITLE', title);
        }
        // Also update the scoped per-conversation title
        for (const [convId, conv] of Object.entries(state.conversations)) {
          if (conv.savedOutputId === outputId) {
            commit('SCOPED_SET_SAVED_OUTPUT_TITLE', { conversationId: convId, title });
            break;
          }
        }

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
     * Switch to an agent chat context.
     * Uses per-conversation slots so agent chats persist independently.
     */
    switchToAgentChat({ commit, state, dispatch }, { agentId, agentName, agentAvatar }) {
      if (state.currentAgentId === agentId) return;

      // Save the current main conversation ID before switching to agent chat
      if (!state.currentAgentId && state.activeConversationId) {
        state.savedMainConversationId = state.activeConversationId;
      }

      // Use a stable conversation ID for each agent
      const agentConvId = `agent-${agentId}`;

      // Ensure the agent conversation slot exists
      commit('ENSURE_CONVERSATION', agentConvId);
      commit('SCOPED_SET_AGENT', { conversationId: agentConvId, agentId, agentName, agentAvatar });

      // Also save to legacy agent conversations for backward compatibility
      if (state.currentAgentId) {
        commit('SAVE_AGENT_CONVERSATION', { agentId: state.currentAgentId });
      }

      // Switch to the agent conversation
      commit('SET_ACTIVE_CONVERSATION', agentConvId);
      commit('SET_CURRENT_AGENT', { agentId, agentName, agentAvatar });

      // Load cached messages if available (backward compat with legacy cache)
      const cached = state.agentConversations[agentId];
      if (cached && state.conversations[agentConvId].messages.length === 0) {
        commit('SCOPED_SET_MESSAGES', { conversationId: agentConvId, messages: cached.messages });
      }

      // If no existing conversation, add welcome message
      if (state.conversations[agentConvId].messages.length === 0) {
        commit('SCOPED_ADD_MESSAGE', {
          conversationId: agentConvId,
          message: {
            id: `agent-welcome-${Date.now()}`,
            role: 'assistant',
            content: `Hi! I'm **${agentName}**. How can I help you today?`,
            timestamp: Date.now(),
            metadata: ['Agent Chat', `Agent: ${agentName}`],
          },
        });
      }

      console.log(`[Agent Chat] Switched to agent: ${agentName} (${agentId})`);
    },

    /**
     * Switch back to main chat (exit agent chat).
     * The agent conversation remains in the conversations map.
     */
    switchToMainChat({ commit, state }) {
      if (state.currentAgentId) {
        commit('SAVE_AGENT_CONVERSATION', { agentId: state.currentAgentId });
      }

      commit('CLEAR_CURRENT_AGENT');

      // Restore the saved main conversation, or start a fresh 'main' slot
      const mainConvId = state.savedMainConversationId || 'main';
      state.savedMainConversationId = null;
      commit('ENSURE_CONVERSATION', mainConvId);
      commit('SET_ACTIVE_CONVERSATION', mainConvId);

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
     * Start a streaming conversation with an agent.
     * Uses the agent-specific endpoint. Supports concurrent streams.
     */
    async startAgentStreamingConversation(
      { commit, state, dispatch, rootState },
      { agentId, userInput, files = [], provider, model, reasoningValue, reasoningEnabled },
    ) {
      let convId = state.activeConversationId || `agent-${agentId}-${Date.now()}`;

      const existingConv = state.conversations[convId];
      if (existingConv && existingConv.isStreaming) {
        console.warn('This conversation is already streaming, ignoring new request');
        return;
      }

      commit('ENSURE_CONVERSATION', convId);
      if (!state.activeConversationId) {
        commit('SET_ACTIVE_CONVERSATION', convId);
      }
      commit('SCOPED_SET_STREAMING', { conversationId: convId, value: true });

      const token = localStorage.getItem('token');
      const conv = state.conversations[convId];
      const chatHistory = buildChatHistory(conv.messages, provider);

      // Remove duplicate trailing user message if it matches what we're about to send
      const deduped = chatHistory.length > 0 &&
        chatHistory[chatHistory.length - 1].content === userInput &&
        chatHistory[chatHistory.length - 1].role === 'user'
        ? chatHistory.slice(0, -1)
        : chatHistory;

      const abortController = new AbortController();
      commit('SCOPED_SET_ABORT_CONTROLLER', { conversationId: convId, controller: abortController });

      const capturedConvId = convId;

      try {
        const headers = { 'Content-Type': 'application/json' };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        const normalizedReasoningValue = typeof reasoningValue === 'string' && reasoningValue.trim()
          ? reasoningValue.trim().toLowerCase()
          : (rootState.aiProvider?.reasoningValue || 'default');
        const effectiveReasoningEnabled = reasoningEnabled === true || rootState.aiProvider?.reasoningEnabled === true;

        const body = JSON.stringify({
          message: userInput,
          history: deduped,
          provider: provider,
          model: model,
          reasoningValue: normalizedReasoningValue !== 'default' ? normalizedReasoningValue : undefined,
          reasoningEnabled: effectiveReasoningEnabled || undefined,
        });

        const response = await fetch(`${API_CONFIG.BASE_URL}/agents/${agentId}/chat-stream`, {
          method: 'POST',
          headers: headers,
          body: body,
          signal: abortController.signal,
        });

        if (!response.ok) {
          let errorText;
          try {
            const text = await response.text();
            try {
              const json = JSON.parse(text);
              errorText = json.error || json.message || text;
            } catch {
              errorText = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
            }
          } catch {
            errorText = response.statusText || 'Unknown error';
          }
          throw new Error(`Server error (${response.status}): ${errorText}`);
        }

        if (!response.body) {
          throw new Error('No response body from server');
        }

        const reader = response.body.getReader();
        commit('SCOPED_SET_STREAM_READER', { conversationId: capturedConvId, reader });

        const decoder = new TextDecoder();
        let buffer = '';
        let activeConvId = capturedConvId;

        const processStream = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                commit('SCOPED_SET_STREAMING', { conversationId: activeConvId, value: false });
                commit('SCOPED_SET_STREAM_READER', { conversationId: activeConvId, reader: null });
                commit('SCOPED_SET_ABORT_CONTROLLER', { conversationId: activeConvId, controller: null });
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

                    if (eventName === 'conversation_started' && data.conversationId) {
                      const oldId = activeConvId;
                      if (oldId !== data.conversationId) {
                        commit('MIGRATE_CONVERSATION_ID', { oldId, newId: data.conversationId });
                        commit('MIGRATE_CONTEXT_BINDINGS', { oldId, newId: data.conversationId });
                        activeConvId = data.conversationId;
                      }
                    }

                    state.streamEventCallbacks.forEach((callback) => {
                      try {
                        callback(eventName, data, activeConvId);
                      } catch (callbackError) {
                        console.error('Error in stream event callback:', callbackError);
                      }
                    });

                    handleScopedStreamEvent({ commit, state, dispatch }, eventName, data, activeConvId);
                  } catch (e) {
                    console.error('Error parsing stream data:', e, 'Raw data:', dataLine);
                    if (eventName === 'error') {
                      handleScopedStreamEvent({ commit, state, dispatch }, 'error', {
                        error: `Stream error (unparseable response): ${dataLine?.substring(0, 200) || 'No data'}`,
                      }, activeConvId);
                    }
                  }
                }
              }
            }
          } catch (error) {
            if (error.name === 'AbortError') {
              console.log('Stream aborted by user');
            } else {
              console.error('Error processing stream:', error);
              commit('SCOPED_SET_STREAMING', { conversationId: activeConvId, value: false });
              commit('SCOPED_SET_STREAM_READER', { conversationId: activeConvId, reader: null });
              commit('SCOPED_SET_ABORT_CONTROLLER', { conversationId: activeConvId, controller: null });
            }
          }
        };

        processStream();
      } catch (error) {
        console.error('Error starting agent stream:', error);
        commit('SCOPED_SET_STREAMING', { conversationId: capturedConvId, value: false });
        commit('SCOPED_SET_STREAM_READER', { conversationId: capturedConvId, reader: null });
        commit('SCOPED_SET_ABORT_CONTROLLER', { conversationId: capturedConvId, controller: null });

        const errorMessage = error.message || 'An unexpected error occurred.';
        commit('SCOPED_ADD_MESSAGE', {
          conversationId: capturedConvId,
          message: {
            id: `msg-${Date.now()}-error`,
            role: 'assistant',
            content: `Sorry, I encountered an error: ${errorMessage}`,
            timestamp: Date.now(),
            metadata: ['Error'],
          },
        });
      }
    },

    /**
     * Handle real-time chat events from Socket.IO (messages from other tabs).
     * Routes events to the correct conversation slot.
     */
    handleRealtimeChatEvent({ commit, state, dispatch }, eventData) {
      const { type, conversationId, assistantMessageId } = eventData;

      const isAutonomousEvent = type && type.startsWith('autonomous_');
      const isAsyncToolEvent = type && type.startsWith('async_tool_');

      // Find which conversation this event belongs to
      let targetConvId = conversationId || state.activeConversationId;

      // Check if the target conversation is actively streaming via SSE in this tab
      const targetConv = targetConvId ? state.conversations[targetConvId] : null;
      if (targetConv && targetConv.isStreaming && !isAutonomousEvent && !isAsyncToolEvent) {
        console.log('[Realtime Chat] Ignoring Socket.IO event - conversation is streaming via SSE');
        return;
      }

      // Ensure conversation slot exists for new conversations from other tabs
      if (conversationId && (type === 'message_start' || type === 'user_message' || type === 'autonomous_message_start')) {
        commit('ENSURE_CONVERSATION', conversationId);
        targetConvId = conversationId;

        // If no conversation is active, adopt this one
        if (!state.activeConversationId) {
          commit('SET_ACTIVE_CONVERSATION', conversationId);
        }
      }

      // For non-start events, verify conversation exists
      if (targetConvId && !state.conversations[targetConvId]) {
        // Try to find the conversation by checking active conversation
        if (state.activeConversationId && state.conversations[state.activeConversationId]) {
          targetConvId = state.activeConversationId;
        } else {
          console.log('[Realtime Chat] Ignoring event for unknown conversation:', conversationId);
          return;
        }
      }

      console.log('[Realtime Chat] Processing event:', type, 'for conversation:', targetConvId);

      // Use scoped mutations when we have a conversation slot
      const useScoped = targetConvId && state.conversations[targetConvId];

      switch (type) {
        case 'user_message': {
          const userMsg = eventData.message;
          const convMessages = useScoped ? state.conversations[targetConvId].messages : state.messages;
          if (userMsg && !convMessages.find((m) => m.content === userMsg.content && m.role === 'user')) {
            const msg = {
              id: `msg-user-${Date.now()}`,
              role: 'user',
              content: userMsg.content,
              timestamp: eventData.timestamp || Date.now(),
            };
            if (useScoped) {
              commit('SCOPED_ADD_MESSAGE', { conversationId: targetConvId, message: msg });
            } else {
              commit('ADD_MESSAGE', msg);
            }
          }
          break;
        }

        case 'message_start':
          if (useScoped) {
            commit('SCOPED_SET_REMOTE_STREAMING', { conversationId: targetConvId, value: true });
            if (!state.conversations[targetConvId].messages.find((m) => m.id === assistantMessageId)) {
              commit('SCOPED_ADD_MESSAGE', {
                conversationId: targetConvId,
                message: { id: assistantMessageId, role: 'assistant', content: '', timestamp: eventData.timestamp || Date.now() },
              });
            }
          } else {
            commit('SET_REMOTE_STREAMING', true);
            if (!state.messages.find((m) => m.id === assistantMessageId)) {
              commit('ADD_MESSAGE', { id: assistantMessageId, role: 'assistant', content: '', timestamp: eventData.timestamp || Date.now() });
            }
          }
          break;

        case 'content_delta':
          if (useScoped) {
            commit('SCOPED_APPEND_MESSAGE_CONTENT', { conversationId: targetConvId, messageId: assistantMessageId, delta: eventData.delta });
          } else {
            commit('APPEND_MESSAGE_CONTENT', { messageId: assistantMessageId, delta: eventData.delta });
          }
          break;

        case 'reasoning_delta':
          if (useScoped) {
            commit('SCOPED_APPEND_MESSAGE_REASONING', { conversationId: targetConvId, messageId: assistantMessageId, delta: eventData.delta });
          } else {
            commit('APPEND_MESSAGE_REASONING', { messageId: assistantMessageId, delta: eventData.delta });
          }
          break;

        case 'tool_start':
          if (eventData.toolCall) {
            const tc = { id: eventData.toolCall.id, name: eventData.toolCall.name, args: eventData.toolCall.args, status: 'running' };
            if (useScoped) {
              commit('SCOPED_ADD_TOOL_CALL', { conversationId: targetConvId, messageId: assistantMessageId, toolCall: tc });
            } else {
              commit('ADD_TOOL_CALL', { messageId: assistantMessageId, toolCall: tc });
            }
          }
          break;

        case 'tool_end':
          if (eventData.toolCall) {
            const payload = {
              messageId: assistantMessageId,
              toolCallId: eventData.toolCall.id,
              result: eventData.toolCall.result,
              error: eventData.toolCall.error,
              status: eventData.toolCall.error ? 'error' : 'completed',
            };
            if (useScoped) {
              commit('SCOPED_UPDATE_TOOL_CALL_RESULT', { conversationId: targetConvId, ...payload });
            } else {
              commit('UPDATE_TOOL_CALL_RESULT', payload);
            }
          }
          break;

        case 'message_end':
          if (useScoped) {
            commit('SCOPED_SET_REMOTE_STREAMING', { conversationId: targetConvId, value: false });
          } else {
            commit('SET_REMOTE_STREAMING', false);
          }
          break;

        case 'autonomous_message_start': {
          console.log('[Realtime Chat] Autonomous message started');
          const convMessages = useScoped ? state.conversations[targetConvId].messages : state.messages;
          if (!convMessages.find((m) => m.id === assistantMessageId)) {
            const msg = { id: assistantMessageId, role: 'assistant', content: '', timestamp: eventData.timestamp || Date.now(), autonomous: true };
            if (useScoped) {
              commit('SCOPED_ADD_MESSAGE', { conversationId: targetConvId, message: msg });
              commit('SCOPED_SET_REMOTE_STREAMING', { conversationId: targetConvId, value: true });
            } else {
              commit('ADD_MESSAGE', msg);
              commit('SET_REMOTE_STREAMING', true);
            }
          }
          break;
        }

        case 'autonomous_content_delta':
          if (useScoped) {
            commit('SCOPED_APPEND_MESSAGE_CONTENT', { conversationId: targetConvId, messageId: assistantMessageId, delta: eventData.delta });
          } else {
            commit('APPEND_MESSAGE_CONTENT', { messageId: assistantMessageId, delta: eventData.delta });
          }
          break;

        case 'autonomous_message_end':
          if (useScoped) {
            commit('SCOPED_SET_REMOTE_STREAMING', { conversationId: targetConvId, value: false });
          } else {
            commit('SET_REMOTE_STREAMING', false);
          }
          if (eventData.isEmpty && assistantMessageId) {
            if (useScoped) {
              commit('SCOPED_REMOVE_MESSAGE', { conversationId: targetConvId, messageId: assistantMessageId });
            } else {
              commit('REMOVE_MESSAGE', assistantMessageId);
            }
          }
          // Only autosave if this conversation already has a savedOutputId.
          // Without one, autosave would create a duplicate content output.
          // The backend already persists autonomous messages via ConversationLogModel.
          if (dispatch) {
            const targetConv = targetConvId ? state.conversations[targetConvId] : null;
            if (targetConv?.savedOutputId) {
              dispatch('autosaveConversation', { debounce: true, conversationId: targetConvId });
            }
          }
          break;

        case 'async_tool_queued':
          if (eventData.executionId) {
            if (useScoped) {
              commit('SCOPED_ADD_ACTIVE_ASYNC_TOOL', {
                conversationId: targetConvId, executionId: eventData.executionId,
                toolName: eventData.functionName, messageId: assistantMessageId, toolCallId: eventData.toolCallId,
              });
            } else {
              commit('ADD_ACTIVE_ASYNC_TOOL', {
                executionId: eventData.executionId, toolName: eventData.functionName,
                messageId: assistantMessageId, toolCallId: eventData.toolCallId,
              });
            }
          }
          break;

        case 'async_tool_started':
          if (eventData.toolCallId) {
            const payload = {
              messageId: assistantMessageId, toolCallId: eventData.toolCallId,
              result: { success: true, status: 'running', executionId: eventData.executionId, message: `${eventData.functionName} is now executing...` },
              status: 'running',
            };
            if (useScoped) {
              commit('SCOPED_UPDATE_TOOL_CALL_RESULT', { conversationId: targetConvId, ...payload });
            } else {
              commit('UPDATE_TOOL_CALL_RESULT', payload);
            }
          }
          break;

        case 'async_tool_progress':
          break;

        case 'async_tool_completed':
          if (eventData.executionId) {
            if (useScoped) {
              commit('SCOPED_REMOVE_ACTIVE_ASYNC_TOOL', { conversationId: targetConvId, executionId: eventData.executionId });
            } else {
              commit('REMOVE_ACTIVE_ASYNC_TOOL', eventData.executionId);
            }
          }
          if (eventData.toolCallId) {
            const payload = {
              messageId: assistantMessageId, toolCallId: eventData.toolCallId,
              result: { success: true, status: 'completed', executionId: eventData.executionId, result: eventData.result, duration: eventData.duration },
              status: 'completed',
            };
            if (useScoped) {
              commit('SCOPED_UPDATE_TOOL_CALL_RESULT', { conversationId: targetConvId, ...payload });
            } else {
              commit('UPDATE_TOOL_CALL_RESULT', payload);
            }
          }
          break;

        case 'async_tool_failed':
          if (eventData.executionId) {
            if (useScoped) {
              commit('SCOPED_REMOVE_ACTIVE_ASYNC_TOOL', { conversationId: targetConvId, executionId: eventData.executionId });
            } else {
              commit('REMOVE_ACTIVE_ASYNC_TOOL', eventData.executionId);
            }
          }
          if (eventData.toolCallId) {
            const payload = {
              messageId: assistantMessageId, toolCallId: eventData.toolCallId,
              result: { success: false, status: 'failed', executionId: eventData.executionId, error: eventData.error },
              error: eventData.error, status: 'failed',
            };
            if (useScoped) {
              commit('SCOPED_UPDATE_TOOL_CALL_RESULT', { conversationId: targetConvId, ...payload });
            } else {
              commit('UPDATE_TOOL_CALL_RESULT', payload);
            }
          }
          break;

        default:
          console.warn('[Realtime Chat] Unknown event type:', type);
      }
    },

    // ============================================
    // SKILL/GOAL ATTACH/DETACH (per-conversation)
    // ============================================

    /**
     * Attach a skill to the current conversation. Persists to backend so
     * reloading restores the chip and the orchestrator system-prompt
     * injection picks it back up.
     */
    async attachSkill({ commit, state }, { conversationId, skill }) {
      const convId = conversationId || state.activeConversationId;
      if (!convId || !skill) return;

      commit('SET_ACTIVE_SKILL', { conversationId: convId, skill });

      // Don't persist temp- ids — they get migrated to a server UUID once the
      // first message starts streaming, and MIGRATE_CONTEXT_BINDINGS will
      // carry the chip over. We persist on the next attach/detach call.
      if (convId.startsWith('temp-')) return;

      try {
        const token = localStorage.getItem('token');
        await fetch(`${API_CONFIG.BASE_URL}/conversations/${convId}/settings`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ activeSkillId: skill.id }),
        });
      } catch (e) {
        console.warn('[Chat] Failed to persist active skill:', e);
      }
    },

    async detachSkill({ commit, state }, { conversationId } = {}) {
      const convId = conversationId || state.activeConversationId;
      if (!convId) return;

      commit('SET_ACTIVE_SKILL', { conversationId: convId, skill: null });

      if (convId.startsWith('temp-')) return;

      try {
        const token = localStorage.getItem('token');
        await fetch(`${API_CONFIG.BASE_URL}/conversations/${convId}/settings`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ activeSkillId: null }),
        });
      } catch (e) {
        console.warn('[Chat] Failed to clear active skill:', e);
      }
    },

    async attachGoal({ commit, state }, { conversationId, goal }) {
      const convId = conversationId || state.activeConversationId;
      if (!convId || !goal) return;

      commit('SET_ACTIVE_GOAL', { conversationId: convId, goal });

      if (convId.startsWith('temp-')) return;

      try {
        const token = localStorage.getItem('token');
        await fetch(`${API_CONFIG.BASE_URL}/conversations/${convId}/settings`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ activeGoalId: goal.id }),
        });
      } catch (e) {
        console.warn('[Chat] Failed to persist active goal:', e);
      }
    },

    async detachGoal({ commit, state }, { conversationId } = {}) {
      const convId = conversationId || state.activeConversationId;
      if (!convId) return;

      commit('SET_ACTIVE_GOAL', { conversationId: convId, goal: null });

      if (convId.startsWith('temp-')) return;

      try {
        const token = localStorage.getItem('token');
        await fetch(`${API_CONFIG.BASE_URL}/conversations/${convId}/settings`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ activeGoalId: null }),
        });
      } catch (e) {
        console.warn('[Chat] Failed to clear active goal:', e);
      }
    },

    /**
     * Append-only goal trace events. Whenever a Socket.IO goal:* event fires
     * (dispatched from useRealtimeSync), this action figures out which
     * conversation(s) have that goal bound and appends a tagged user message
     * so the LLM picks up the verdict/task results on the next turn — without
     * mutating any prior message (cache-friendly).
     *
     * Filter intentionally skips noisy intermediate events (task_started,
     * iteration_start/evaluate/replan/checkpoint). Defaults appended:
     *   - task_updated (status=completed | failed)
     *   - loop_completed   → verdict
     *   - loop_error       → error
     *   - updated          → terminal status marker (validated/needs_review/...)
     */
    async appendGoalEvent({ commit, state, rootState, dispatch }, { event, data }) {
      if (!event || !data) return;
      const goalId = data.goalId || data.id;
      if (!goalId) return;

      // Reverse-lookup: which conversation(s) have this goal bound?
      const targetConvIds = Object.keys(state.activeGoalByConv).filter(
        (convId) => state.activeGoalByConv[convId]?.id === goalId,
      );
      if (targetConvIds.length === 0) return;

      // Decide eventKind + truncated payloads. Truncation caps:
      //   task output: 400 chars
      //   feedback / error: 600 chars
      const truncate = (s, max) => {
        if (s == null) return '';
        const str = String(s);
        if (str.length <= max) return str;
        return str.slice(0, max) + ' [...]';
      };

      const goalTitle =
        targetConvIds[0] && state.activeGoalByConv[targetConvIds[0]]?.title;
      let eventKind = null;
      let summary = '';
      let detail = '';
      let llmTag = '';

      if (event === 'goal:task_updated') {
        const status = data.status;
        const title = data.title || `task ${(data.taskId || '').slice(0, 8)}`;
        const agent = data.agentName ? ` (agent: ${data.agentName})` : '';

        if (status === 'completed') {
          eventKind = 'task_completed';
          summary = `${title} completed${agent}`;
          detail = truncate(data.output || data.result || '', 400);
          llmTag = `[goal-event id=${goalId} kind=task_complete] task "${title}" completed${agent}${
            detail ? `: "${detail}"` : ''
          }`;
        } else if (status === 'failed') {
          eventKind = 'task_failed';
          summary = `${title} failed${agent}`;
          detail = truncate(data.error || data.output || '', 400);
          llmTag = `[goal-event id=${goalId} kind=task_failed] task "${title}" failed${
            detail ? `: ${detail}` : ''
          }`;
        } else {
          // started/running/etc. — skip to avoid context spam.
          return;
        }
      } else if (event === 'goal:loop_completed') {
        eventKind = 'verdict';
        const score = data.score != null ? Math.round(data.score) : null;
        const passed = !!data.passed;
        summary = `Verdict: score=${score ?? '?'}${passed ? ' (passed)' : ' (needs review)'}`;
        detail = truncate(data.feedback || data.evaluationFeedback || '', 600);
        // llmTag gets enriched below with the full goal trace before append
        llmTag = `[goal-event id=${goalId} kind=verdict] score=${score ?? 'unknown'} passed=${passed}${
          detail ? `. feedback: ${detail}` : ''
        }`;
      } else if (event === 'goal:loop_error') {
        eventKind = 'loop_error';
        const reason = data.error || data.reason || 'unknown error';
        summary = `Goal error: ${truncate(reason, 200)}`;
        detail = truncate(reason, 600);
        llmTag = `[goal-event id=${goalId} kind=loop_error] ${truncate(reason, 600)}`;
      } else if (event === 'goal:updated') {
        const terminal = ['validated', 'completed', 'needs_review', 'failed', 'stopped'];
        if (!terminal.includes(data.status)) return;
        eventKind = 'loop_completed';
        summary = `Goal ${data.status}`;
        detail = '';
        llmTag = `[goal-event id=${goalId} kind=finished] status=${data.status}`;
      } else {
        // Intermediate iteration events are intentionally not appended —
        // the inline GoalProgressWidget already shows them live.
        return;
      }

      const terminal = ['verdict', 'loop_completed', 'loop_error'].includes(eventKind);

      // For TERMINAL events, enrich llmTag with the full goal trace —
      // verdict + per-task outputs + tool-use summary + a strong instruction
      // telling Annie to summarize the work, NOT redo it. Without this
      // enrichment Annie sees only "score=X passed=true" and re-attempts
      // the goal because she has no idea what was already accomplished.
      if (terminal) {
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`${API_CONFIG.BASE_URL}/goals/${goalId}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (res.ok) {
            const fullData = await res.json();
            const goal = fullData.goal || fullData;
            llmTag = buildGoalCompletionPrompt(goal, eventKind, data, truncate);
          }
        } catch (e) {
          console.warn('[Chat] Failed to fetch full goal for terminal event:', e);
          // fall through to the sparse llmTag
        }
      }

      // Push to every conversation that has this goal bound. Uses role='user'
      // with a tagged content prefix so buildChatHistory's user|assistant
      // filter passes it to the LLM, but Annie can recognize it as a goal
      // event (vs. a real user turn) by the [goal-event ...] / [GOAL …] tag.
      for (const convId of targetConvIds) {
        commit('SCOPED_ADD_MESSAGE', {
          conversationId: convId,
          message: {
            id: `goal-event-${goalId}-${event}-${data.taskId || data.iteration || Date.now()}`,
            role: 'user',
            content: llmTag,
            timestamp: Date.now(),
            kind: 'goal-event',
            eventKind,
            goalId,
            goalTitle: goalTitle || undefined,
            summary,
            detail,
          },
        });
      }

      // Auto-fire Annie's response on terminal events.
      if (!terminal) return;

      const provider = rootState?.aiProvider?.selectedProvider;
      const model = rootState?.aiProvider?.selectedModel;
      if (!provider || !model) return;

      const activeConvId = state.activeConversationId;
      if (!targetConvIds.includes(activeConvId)) return;

      const conv = state.conversations[activeConvId];
      if (!conv || conv.isStreaming) return; // don't race an in-flight turn

      // Use the enriched llmTag as the userInput. startStreamingConversation
      // dedupes the trailing user message if it matches userInput, so we
      // don't double-post — the LLM sees one rich goal-trace user turn and
      // produces a summary. Defer one tick so the SCOPED_ADD_MESSAGE commit
      // has fully settled before the dispatch reads conv.messages.
      setTimeout(() => {
        dispatch('startStreamingConversation', {
          userInput: llmTag,
          provider,
          model,
        }).catch((e) => console.warn('[Chat] Goal auto-fire failed:', e));
      }, 0);
    },

    /**
     * Restore skill/goal bindings for a conversation from the backend.
     * Called when a saved conversation is opened so the chips reappear.
     */
    async loadConversationContext({ commit, rootState }, conversationId) {
      if (!conversationId || conversationId.startsWith('temp-')) return;
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_CONFIG.BASE_URL}/conversations/${conversationId}/settings`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();

        if (data.activeSkillId) {
          // Try resolving from the skills store first; fall back to API fetch.
          const cachedSkill = (rootState.skills?.skills || []).find((s) => s.id === data.activeSkillId);
          let skill = cachedSkill || null;
          if (!skill) {
            try {
              const sRes = await fetch(`${API_CONFIG.BASE_URL}/skills/${data.activeSkillId}`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
              });
              if (sRes.ok) {
                const sJson = await sRes.json();
                skill = sJson.skill || null;
              }
            } catch (e) { /* ignore */ }
          }
          if (skill) commit('SET_ACTIVE_SKILL', { conversationId, skill });
        }

        if (data.activeGoalId) {
          const cachedGoal = (rootState.goals?.goals || []).find((g) => g.id === data.activeGoalId);
          let goal = cachedGoal || null;
          if (!goal) {
            try {
              const gRes = await fetch(`${API_CONFIG.BASE_URL}/goals/${data.activeGoalId}`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
              });
              if (gRes.ok) {
                const gJson = await gRes.json();
                goal = gJson.goal || null;
              }
            } catch (e) { /* ignore */ }
          }
          if (goal) commit('SET_ACTIVE_GOAL', { conversationId, goal });
        }
      } catch (e) {
        console.warn('[Chat] Failed to load conversation context:', e);
      }
    },
  },
};

/**
 * Handle stream events scoped to a specific conversation.
 * All mutations target the conversation slot, not global state.
 */
function handleScopedStreamEvent({ commit, state, dispatch }, eventName, data, conversationId) {
  switch (eventName) {
    case 'conversation_started':
      // Migration already handled in processStream.
      // Save with debounce to avoid blocking the stream and delaying AI responses.
      // The conversation will appear in OutputList after the debounce period.
      if (dispatch) {
        dispatch('autosaveConversation', { debounce: true, conversationId });
      }
      break;
    case 'steering_applied':
      // Backend drained a queued steer at a tool-round seam — clear the
      // chip on the conversation that owns this stream (not necessarily
      // the active one — user may have switched mid-flight).
      commit('SCOPED_CLEAR_PENDING_STEER', { conversationId });
      // Surface the steer text as a real user message in the transcript
      // at the round it landed. Without this, the steer is buried inside
      // the tool-result content (Hermes pattern) and the user never sees
      // what they sent.
      if (data.content) {
        commit('SCOPED_ADD_MESSAGE', {
          conversationId,
          message: {
            id: `msg-steer-${Date.now()}`,
            role: 'user',
            content: data.content,
            timestamp: Date.now(),
            steered: true,
          },
        });
      }
      break;
    case 'assistant_message':
      commit('SCOPED_ADD_MESSAGE', { conversationId, message: data });
      break;
    case 'content_delta':
      commit('SCOPED_APPEND_MESSAGE_CONTENT', {
        conversationId,
        messageId: data.assistantMessageId,
        delta: data.delta,
      });
      break;
    case 'reasoning_delta':
      commit('SCOPED_APPEND_MESSAGE_REASONING', {
        conversationId,
        messageId: data.assistantMessageId,
        delta: data.delta,
      });
      break;
    case 'tool_start':
      commit('SCOPED_ADD_TOOL_CALL', {
        conversationId,
        messageId: data.assistantMessageId,
        toolCall: {
          id: data.toolCall.id,
          name: data.toolCall.name,
          args: data.toolCall.args,
        },
      });
      break;
    case 'tool_end':
      commit('SCOPED_UPDATE_TOOL_CALL_RESULT', {
        conversationId,
        messageId: data.assistantMessageId,
        toolCallId: data.toolCall.id,
        result: data.toolCall.result,
        error: data.toolCall.error,
      });
      break;
    case 'image_generated':
      commit('SCOPED_ADD_IMAGE_TO_CACHE', {
        conversationId,
        imageId: data.imageId,
        imageData: data.imageData,
        toolCallId: data.toolCallId,
        messageId: data.assistantMessageId,
        index: data.index,
      });
      break;
    case 'data_content':
      commit('SCOPED_ADD_DATA_TO_CACHE', {
        conversationId,
        dataId: data.dataId,
        fullContent: data.fullContent,
        toolCallId: data.toolCallId,
        messageId: data.assistantMessageId,
        size: data.size,
        path: data.path,
      });
      break;
    case 'final_content':
      console.log('[Stream] final_content received (not replacing accumulated content)', {
        messageId: data.assistantMessageId,
        contentLength: data.content?.length || 0,
      });
      break;
    case 'tools_skipped':
      commit('SCOPED_ADD_MESSAGE', {
        conversationId,
        message: {
          id: `msg-${Date.now()}-tools-skipped`,
          role: 'system',
          content: data.message || `⚠️ ${data.reason}`,
          timestamp: Date.now(),
          metadata: ['Model Limitation'],
        },
      });
      break;
    case 'error':
      commit('SCOPED_ADD_MESSAGE', {
        conversationId,
        message: {
          id: `msg-${Date.now()}-error`,
          role: 'assistant',
          content: `An error occurred: ${data.error}`,
          timestamp: Date.now(),
          metadata: ['Error'],
        },
      });
      break;
    case 'done':
      commit('SCOPED_SET_STREAMING', { conversationId, value: false });
      if (dispatch) {
        dispatch('autosaveConversation', { debounce: true, conversationId });
      }
      break;
  }
}
