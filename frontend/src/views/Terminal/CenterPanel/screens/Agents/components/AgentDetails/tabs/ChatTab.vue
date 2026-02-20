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
        <div class="chat-input-wrapper">
          <input
            v-model="chatInput"
            @keyup.enter="sendChatMessage"
            type="text"
            placeholder="Type a message..."
            class="chat-input"
            :disabled="isProcessing || selectedAgent.status !== 'ACTIVE'"
          />
          <Tooltip v-if="isSupported" :text="isListening ? 'Stop recording' : 'Start voice input'" width="auto">
            <button
              @click="toggleListening"
              :disabled="isProcessing || selectedAgent.status !== 'ACTIVE'"
              class="chat-mic-button"
              :class="{ 'is-listening': isListening }"
            >
              <i :class="isListening ? 'fas fa-stop' : 'fas fa-microphone'"></i>
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
import { useSpeechRecognition } from '@/composables/useSpeechRecognition';
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

// Speech Recognition
const { isListening, isSupported, transcript, toggleListening } = useSpeechRecognition();

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

// Watch for speech recognition transcript changes
watch(transcript, (newTranscript) => {
  if (newTranscript) {
    chatInput.value = newTranscript;
  }
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
  color: var(--color-white);
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
  background: rgba(0, 0, 0, 0.1);
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
  background: rgba(0, 0, 0, 0.1);
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
  background: rgba(0, 0, 0, 0.2);
  color: var(--color-light-green);
  font-size: 0.9em;
}
.chat-input:focus {
  outline: none;
  border-color: var(--color-green);
}
.chat-mic-button {
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

.chat-mic-button:hover:not(:disabled) {
  background: rgba(127, 129, 147, 0.8);
  transform: scale(1.05);
}

.chat-mic-button.is-listening {
  background: var(--color-red);
  color: white;
  animation: pulse 1.5s ease-in-out infinite;
}

.chat-mic-button:disabled {
  background: rgba(127, 129, 147, 0.3);
  cursor: not-allowed;
  transform: none;
}

@keyframes pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(255, 68, 68, 0.7);
  }
  50% {
    box-shadow: 0 0 0 10px rgba(255, 68, 68, 0);
  }
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
