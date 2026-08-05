<template>
  <div class="tab-pane chat">
    <div class="header-bar">
      <h3 class="section-title"><i class="fas fa-comments"></i> Chat with {{ selectedAgent.name }} Agent</h3>
      <Tooltip text="Clear Chat History" width="auto">
        <button class="clear-chat-button" @click="clearAgentChat">🗑️</button>
      </Tooltip>
    </div>
    <div class="chat-container">
      <div class="chat-messages" ref="chatMessagesRef">
        <div v-if="chatMessages.length === 0" class="empty-state">
          <i class="fas fa-comments"></i>
          <p>Start a conversation with {{ selectedAgent.name }}</p>
        </div>

        <!-- Use MessageItem for rich markdown rendering -->
        <MessageItem
          v-for="message in formattedChatMessages"
          :key="message.id"
          :message="message"
          :avatar-url="selectedAgent.avatar"
          :status="getMessageStatus(message)"
          :runningTools="getRunningToolsForMessage(message)"
          :imageCache="imageCache"
          :dataCache="dataCache"
          @toggle-tool="toggleToolCallExpansion"
        />

        <ProcessingState v-if="isProcessing && chatMessages.length > 0" :text="`${selectedAgent.name} is working...`" />
      </div>
      <div class="quick-actions-wrapper" v-if="suggestions.length > 0">
        <QuickActions :suggestions="suggestions" :is-loading="isLoadingSuggestions" @execute="executeSuggestion" />
      </div>
      <div class="chat-input-container">
        <div v-if="voiceActive" class="voice-status-strip" :class="'voice-' + voiceState">
          <span class="voice-dot"></span>
          <span class="voice-status-text">
            <template v-if="voiceError">{{ voiceError }}</template>
            <template v-else-if="voiceState === 'listening' || voiceState === 'reopen'">{{ voicePartial || 'Listening…' }}</template>
            <template v-else-if="voiceState === 'thinking'">Thinking…</template>
            <template v-else-if="voiceState === 'speaking'">Speaking — talk any time to interrupt</template>
            <template v-else>Voice ready</template>
            <span v-if="voiceNatural" class="voice-engine-badge">natural</span>
          </span>
          <button type="button" class="voice-end-btn" @click="toggleVoice">End</button>
        </div>
        <div class="chat-input-wrapper">
          <input
            v-model="chatInput"
            @keyup.enter="sendChatMessage"
            type="text"
            placeholder="Type a message..."
            class="chat-input"
            :disabled="isProcessing || selectedAgent.status !== 'ACTIVE'"
          />
          <!--
            Hands-free voice. Deliberately NOT disabled while processing:
            talking over a reply is the point — it lands as a steer through the
            same path the keyboard uses. Only an offline agent disables it.
          -->
          <Tooltip :text="voiceActive ? 'End voice conversation' : 'Talk to this agent (hands-free)'" width="auto">
            <button
              @click="toggleVoice"
              :disabled="selectedAgent.status !== 'ACTIVE'"
              class="chat-voice-button"
              :class="['voice-' + voiceState, { 'voice-on': voiceActive }]"
              type="button"
              :aria-pressed="voiceActive ? 'true' : 'false'"
              aria-label="Toggle hands-free voice conversation"
            >
              <i :class="voiceActive ? 'fas fa-headset' : 'far fa-comment-dots'"></i>
            </button>
          </Tooltip>
          <button
            @click="sendChatMessage"
            :disabled="!chatInput.trim() || isProcessing || selectedAgent.status !== 'ACTIVE'"
            class="chat-send-button"
          >
            <i class="fas fa-paper-plane"></i>
          </button>
        </div>
        <div v-if="selectedAgent.status !== 'ACTIVE'" class="chat-status-message">Agent is offline. Start the agent to begin chatting.</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, computed, onMounted, onUnmounted } from 'vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config.js';
import MessageItem from '../../../../Chat/components/MessageItem.vue';
import ProcessingState from '../../../../Chat/components/ProcessingState.vue';
import QuickActions from '../../../../Chat/components/QuickActions.vue';
import { useVoiceEngines } from '@/composables/useVoiceEngines';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

const initialSuggestions = [
  { id: 'agent-sugg-1', text: 'What can you do?', icon: '🤔' },
  { id: 'agent-sugg-3', text: 'List the tools you can use', icon: '⚙️' },
  { id: 'agent-sugg-4', text: 'Tell me more about yourself', icon: '🤖' },
];

const props = defineProps({
  selectedAgent: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['add-terminal-line']);

const store = useStore();

const chatInput = ref('');
const chatMessagesRef = ref(null);

// Local UI state for tool expansion and running tools
const expandedToolCalls = ref({});
const runningToolCalls = ref({});
const messageStates = ref({});

const suggestions = ref([...initialSuggestions]);
const isLoadingSuggestions = ref(false);

// Get messages from unified chat store
const chatMessages = computed(() => store.state.chat.messages);

// Image cache and data cache from Vuex store
const imageCache = computed(() => store.state.chat.imageCache);
const dataCache = computed(() => store.state.chat.dataCache);

// Processing state from store
const isProcessing = computed(() => store.state.chat.isStreaming);

// ---- voice ------------------------------------------------------------
//
// Identical to every other chat, because it is the same code: both engines,
// the run_agnt bridge and the two-register split live in useVoiceEngines.
// This tab supplies only what differs here.

/**
 * Genuine navigation. Switching agents swaps the whole conversation under this
 * tab, so a session that survived it would keep committing into whichever
 * agent is now selected.
 */
const conversationEpoch = ref(0);
watch(() => props.selectedAgent?.id, () => { conversationEpoch.value += 1; });

/**
 * The agent's reply currently streaming, or ''.
 *
 * Agent replies arrive with role 'agent' here (they are mapped to 'assistant'
 * only in formattedChatMessages), so this matches on "not the user" rather
 * than a role literal this store never writes.
 */
const streamingAnswer = () => {
  const list = chatMessages.value || [];
  const last = list[list.length - 1];
  return last && last.role !== 'user' ? last.content || '' : '';
};

const {
  voiceActive,
  voiceState,
  voicePartial,
  voiceError,
  voiceNatural,
  toggleVoice,
} = useVoiceEngines({
  surface: 'agent',
  // eslint-disable-next-line no-use-before-define -- submit runs at commit
  // time, long after setup; sendChatMessage exists by then.
  submit: (text) => {
    chatInput.value = text;
    sendChatMessage();
  },
  streamingAnswer,
  isStreaming: isProcessing,
  epoch: conversationEpoch,
  getAgents: () => {
    const list = store.getters['agents/allAgents'];
    return Array.isArray(list) ? list.map((a) => ({ id: a.id, name: a.name })) : [];
  },
});

let localMessageIdCounter = 0;
const generateMessageId = () => `agent-msg-${Date.now()}-${localMessageIdCounter++}`;

const formattedChatMessages = computed(() => {
  return chatMessages.value.map((message) => ({
    ...message,
    // Ensure role is correct for MessageItem (it expects 'assistant' not 'agent')
    role: message.role === 'agent' ? 'assistant' : message.role,
    expandedToolCalls: expandedToolCalls.value[message.id] || [],
  }));
});

const scrollChatToBottom = () => {
  if (chatMessagesRef.value) {
    chatMessagesRef.value.scrollTop = chatMessagesRef.value.scrollHeight;
  }
};

// Stream event handler for component-specific logic
const handleStreamEvent = (eventName, data) => {
  switch (eventName) {
    case 'assistant_message':
      messageStates.value[data.id] = {
        type: 'thinking',
        text: 'Thinking...',
      };
      break;
    case 'tool_start':
      runningToolCalls.value[`${data.assistantMessageId}-${data.toolCall.id}`] = true;
      messageStates.value[data.assistantMessageId] = {
        type: 'tool',
        text: `Running ${data.toolCall.name}...`,
      };
      break;
    case 'tool_end':
      runningToolCalls.value[`${data.assistantMessageId}-${data.toolCall.id}`] = false;
      const message = chatMessages.value.find((m) => m.id === data.assistantMessageId);
      if (message) {
        const anyRunning = message.toolCalls?.some((tc) => runningToolCalls.value[`${message.id}-${tc.id}`]);
        if (!anyRunning) {
          messageStates.value[data.assistantMessageId] = {
            type: 'thinking',
            text: 'Processing results...',
          };
        }
      }
      break;
    case 'final_content':
      delete messageStates.value[data.assistantMessageId];
      updateSuggestions();
      break;
    case 'done':
      // Clear all message states when done
      Object.keys(messageStates.value).forEach((msgId) => {
        const msg = chatMessages.value.find((m) => m.id === msgId);
        if (!msg || (msg.content && msg.content.trim())) {
          delete messageStates.value[msgId];
        }
      });
      break;
  }
  nextTick(scrollChatToBottom);
};

// Initialize agent chat when component mounts or agent changes
watch(
  () => props.selectedAgent,
  (agent, oldAgent) => {
    if (agent) {
      // Reset suggestions
      suggestions.value = [...initialSuggestions];

      // Switch to this agent's chat context
      store.dispatch('chat/switchToAgentChat', {
        agentId: agent.id,
        agentName: agent.name,
        agentAvatar: agent.avatar,
      });

      // If no messages, add welcome message (store action handles this, but double-check)
      if (chatMessages.value.length === 0) {
        const welcomeMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: `Hi! I'm **${agent.name}**. ${agent.description || 'How can I help you today?'}`,
          timestamp: Date.now(),
          metadata: ['Status: Online', `Type: ${agent.category || 'Specialist'}`],
        };
        store.commit('chat/ADD_MESSAGE', welcomeMessage);
      }

      nextTick(scrollChatToBottom);
    }
  },
  { immediate: true }
);

// Register stream event callback on mount
onMounted(() => {
  store.dispatch('chat/registerStreamEventCallback', handleStreamEvent);
});

// Unregister on unmount
onUnmounted(() => {
  store.dispatch('chat/unregisterStreamEventCallback', handleStreamEvent);

  // Save current conversation before leaving
  if (props.selectedAgent?.id) {
    store.commit('chat/SAVE_AGENT_CONVERSATION', { agentId: props.selectedAgent.id });
  }
});

const sendChatMessage = async () => {
  if (!chatInput.value.trim() || !props.selectedAgent) return;

  const messageToSend = chatInput.value.trim();

  // Add user message to store
  const userMessage = {
    id: generateMessageId(),
    role: 'user',
    content: messageToSend,
    timestamp: Date.now(),
  };
  store.commit('chat/ADD_MESSAGE', userMessage);
  emit('add-terminal-line', `[Chat] You: ${userMessage.content}`);

  chatInput.value = '';
  await nextTick();
  scrollChatToBottom();

  // Get provider and model from agent config or use global defaults from store
  const provider = props.selectedAgent.provider || store.state.aiProvider.selectedProvider;
  const model = props.selectedAgent.model || store.state.aiProvider.selectedModel;

  // Use the unified store action for agent streaming
  await store.dispatch('chat/startAgentStreamingConversation', {
    agentId: props.selectedAgent.id,
    userInput: messageToSend,
    provider,
    model,
  });
};

const getMessageStatus = (message) => {
  if (!message || message.role !== 'assistant') return null;
  return messageStates.value[message.id] || null;
};

const getRunningToolsForMessage = (message) => {
  if (!message || !message.toolCalls) return [];
  return message.toolCalls.filter((tc) => runningToolCalls.value[`${message.id}-${tc.id}`]).map((tc) => tc.id);
};

const toggleToolCallExpansion = (messageId, toolCallIndex) => {
  if (!expandedToolCalls.value[messageId]) {
    expandedToolCalls.value[messageId] = [];
  }
  const index = expandedToolCalls.value[messageId].indexOf(toolCallIndex);
  if (index > -1) {
    expandedToolCalls.value[messageId].splice(index, 1);
  } else {
    expandedToolCalls.value[messageId].push(toolCallIndex);
  }
};

const executeSuggestion = (suggestion) => {
  chatInput.value = suggestion.text;
  sendChatMessage();
};

const updateSuggestions = async () => {
  if (isLoadingSuggestions.value) return;

  if (chatMessages.value.length < 2) {
    return;
  }

  isLoadingSuggestions.value = true;
  const token = localStorage.getItem('token');

  try {
    const recentHistory = chatMessages.value.slice(-10).map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    }));

    const lastUserMessage = chatMessages.value.filter((m) => m.role === 'user').slice(-1)[0]?.content;
    const lastAssistantMessage = chatMessages.value.filter((m) => m.role === 'assistant').slice(-1)[0]?.content;

    if (!lastUserMessage || !lastAssistantMessage) {
      isLoadingSuggestions.value = false;
      return;
    }

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    const response = await fetch(`${API_CONFIG.BASE_URL}/orchestrator/suggestions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        history: recentHistory,
        lastUserMessage,
        lastAssistantMessage,
        provider: store.state.aiProvider.selectedProvider,
        model: store.state.aiProvider.selectedModel,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.suggestions && Array.isArray(data.suggestions)) {
        suggestions.value = data.suggestions.slice(0, 4); // Limit to 4 suggestions
      } else {
        suggestions.value = [];
      }
    } else {
      console.error('Failed to fetch suggestions for agent chat');
      suggestions.value = [];
    }
  } catch (error) {
    console.error('Error fetching AI suggestions for agent:', error);
    suggestions.value = [];
  } finally {
    isLoadingSuggestions.value = false;
  }
};

const clearAgentChat = () => {
  if (!props.selectedAgent) return;

  // Reset local UI state
  expandedToolCalls.value = {};
  runningToolCalls.value = {};
  messageStates.value = {};
  suggestions.value = [...initialSuggestions];

  // Use store action to clear agent conversation
  store.dispatch('chat/clearAgentConversation', {
    agentId: props.selectedAgent.id,
    agentName: props.selectedAgent.name,
  });

  nextTick(scrollChatToBottom);
};
</script>

<style scoped>
.header-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--terminal-border-color);
  padding-bottom: 16px;
}

.clear-chat-button {
  background: rgba(127, 129, 147, 0.1);
  border: 1px solid rgba(127, 129, 147, 0.2);
  color: var(--color-light-med-navy);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  font-size: 1.1em;
  line-height: 1;
  padding: 8px 10px;
}

.clear-chat-button:hover {
  background: rgba(255, 107, 107, 0.2);
  border-color: rgba(255, 107, 107, 0.4);
  color: var(--text-primary);
}

/* Copied from AgentDetails.vue */
.tab-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  min-height: 0;
}
h3.section-title {
  /* color: var(--color-light-green); */
  font-size: 1em;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 0; /* Let header-bar handle this */
  margin: 0;
  border-bottom: none; /* Let header-bar handle this */
}
.section-title i {
  color: var(--color-green);
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: calc(100% - 64px);
  color: var(--color-grey);
  gap: 12px;
}
.empty-state i {
  font-size: 2em;
  opacity: 0.5;
}
/* Chat Tab Styles */
.chat-container {
  display: flex;
  flex: 1;
  flex-direction: column;
  /* min-height: 400px;
  max-height: 600px; */
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  overflow: hidden;
}
.chat-messages {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  background: var(--color-darker-0);
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--green-rgb), 0.3) transparent;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
/* REMOVED obsolete styles for message bubbles, as MessageItem now handles this */

.quick-actions-wrapper {
  padding: 12px 16px;
  border-top: 1px solid var(--terminal-border-color);
  background: var(--color-darker-0);
}

.quick-actions-wrapper :deep(.suggestions-bar) {
  padding: 0;
  border-top: none;
}

.chat-input-container {
  /* border-top: 1px solid rgba(var(--green-rgb), 0.3); */
  padding: 12px;
  background: rgba(var(--green-rgb), 0.05);
}
.chat-input-wrapper {
  display: flex;
  gap: 8px;
  align-items: center;
}
.chat-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 20px;
  background: var(--color-darker-0);
  color: var(--color-light-green);
  font-size: 0.9em;
}
.chat-input:focus {
  outline: none;
  border-color: var(--color-green);
}
/*
 * Idle matches this row's own siblings (med-navy fill, like the send button
 * beside it), not BaseScreen's — each composer's voice button speaks its own
 * row's visual language. Active states tint the circle with the brand hues,
 * same scheme as every other voice surface.
 */
.chat-voice-button {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--color-med-navy);
  color: var(--color-light-green);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
}

.chat-voice-button:hover:not(:disabled) {
  background: rgba(127, 129, 147, 0.8);
  transform: scale(1.05);
}

/* Generic active first — equal specificity, source order decides. */
.chat-voice-button.voice-on {
  background: rgba(var(--blue-rgb), 0.2);
  color: var(--color-blue);
}

.chat-voice-button.voice-listening,
.chat-voice-button.voice-reopen {
  background: rgba(var(--green-rgb), 0.2);
  color: var(--color-green);
}

.chat-voice-button.voice-thinking {
  background: rgba(var(--yellow-rgb), 0.2);
  color: var(--color-yellow);
}

.chat-voice-button.voice-speaking {
  background: rgba(var(--blue-rgb), 0.2);
  color: var(--color-blue);
}

.chat-voice-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.voice-status-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 6px;
  border-radius: 6px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  font-size: 12px;
  color: var(--text-secondary);
  min-height: 28px;
}

.voice-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-quaternary);
  flex: 0 0 auto;
}

.voice-status-strip.voice-listening .voice-dot,
.voice-status-strip.voice-reopen .voice-dot {
  background: var(--status-green-text);
}

.voice-status-strip.voice-listening .voice-dot {
  animation: voice-pulse 1.4s ease-in-out infinite;
}

.voice-status-strip.voice-thinking .voice-dot {
  background: var(--status-amber-text);
  animation: voice-pulse 0.9s ease-in-out infinite;
}

.voice-status-strip.voice-speaking .voice-dot {
  background: var(--status-blue-text);
  animation: voice-pulse 0.7s ease-in-out infinite;
}

@keyframes voice-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.voice-status-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Which engine is live — see BaseScreen for the same rule. */
.voice-engine-badge {
  flex: 0 0 auto;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: rgba(var(--blue-rgb), 0.18);
  color: var(--status-blue-text);
}

.voice-end-btn {
  flex: 0 0 auto;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  color: var(--text-secondary);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}

.voice-end-btn:hover {
  color: var(--text-primary);
  border-color: var(--border-strong);
}

@media (prefers-reduced-motion: reduce) {
  .voice-status-strip .voice-dot { animation: none; }
}

.chat-send-button {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--color-green);
  color: var(--color-dark-navy);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.chat-send-button:hover:not(:disabled) {
  background: rgba(var(--green-rgb), 0.8);
  transform: scale(1.05);
}
.chat-send-button:disabled {
  background: rgba(var(--green-rgb), 0.3);
  cursor: not-allowed;
  transform: none;
}
.chat-status-message {
  margin-top: 8px;
  color: var(--color-grey);
  font-size: 0.8em;
  text-align: center;
  font-style: italic;
}

/* Add a bit of padding to align with MessageItem's internal structure */
.chat-messages :deep(.message-wrapper) {
  padding: 0 8px;
}
</style>
