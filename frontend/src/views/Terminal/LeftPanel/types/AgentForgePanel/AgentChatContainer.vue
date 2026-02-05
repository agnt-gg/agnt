<template>
  <div class="agent-chat-container">
    <div class="chat-messages" ref="chatMessagesRef">
      <div v-if="formattedChatMessages.length === 0" class="empty-state">
        <i class="fas fa-robot"></i>
        <p>Hi! I'm Annie, your agent assistant. I can help you create, modify, and manage AI agents!</p>
      </div>

      <TransitionGroup name="message" tag="div" class="message-flow" v-else>
        <MessageItem
          v-for="message in formattedChatMessages"
          :key="message.id"
          :message="message"
          :status="getMessageStatus(message)"
          :runningTools="getRunningToolsForMessage(message)"
          :show-avatar="false"
          @toggle-tool="toggleToolCallExpansion"
        />
      </TransitionGroup>

      <ProcessingState v-if="isProcessing" text="Annie is working..." />
    </div>

    <div class="quick-actions-wrapper" v-if="suggestions.length > 0 && !isProcessing">
      <QuickActions :suggestions="suggestions" :is-loading="isLoadingSuggestions" @execute="executeSuggestion" />
    </div>

    <div class="chat-input-container">
      <div class="chat-input-wrapper">
        <input
          v-model="chatInput"
          @keyup.enter="sendChatMessage"
          type="text"
          placeholder="Ask about agents, create new ones, or get help..."
          class="chat-input"
          :disabled="isProcessing"
          ref="chatInputRef"
        />
        <Tooltip v-if="isSupported" :text="isListening ? 'Stop recording' : 'Start voice input'" width="auto">
          <button
            @click="toggleListening"
            :disabled="isProcessing"
            class="chat-mic-button"
            :class="{ 'is-listening': isListening }"
          >
            <i :class="isListening ? 'fas fa-stop' : 'fas fa-microphone'"></i>
          </button>
        </Tooltip>
        <button @click="sendChatMessage" :disabled="!chatInput.trim() || isProcessing" class="chat-send-button">
          <i class="fas fa-paper-plane"></i>
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, nextTick, onMounted, watch } from 'vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config.js';
import MessageItem from '@/views/Terminal/CenterPanel/screens/Chat/components/MessageItem.vue';
import ProcessingState from '@/views/Terminal/CenterPanel/screens/Chat/components/ProcessingState.vue';
import QuickActions from '@/views/Terminal/CenterPanel/screens/Chat/components/QuickActions.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { useSpeechRecognition } from '@/composables/useSpeechRecognition';

const initialSuggestions = [
  { id: 'agent-1', text: 'Create agent', icon: '🤖' },
  { id: 'agent-2', text: 'List my agents', icon: '📋' },
];

export default {
  name: 'AgentChatContainer',
  components: {
    MessageItem,
    ProcessingState,
    QuickActions,
    Tooltip,
  },
  props: {
    agentId: {
      type: String,
      default: null,
    },
    agents: {
      type: Array,
      default: () => [],
    },
    customAgents: {
      type: Array,
      default: () => [],
    },
  },
  setup(props) {
    console.log('AgentChatContainer: setup called with agentId:', props.agentId);
    const store = useStore();
    const chatMessagesRef = ref(null);
    const chatInputRef = ref(null);

    // Speech Recognition
    const { isListening, isSupported, transcript, toggleListening } = useSpeechRecognition();

    // Chat input state
    const chatInput = ref('');

    // Watch for speech recognition transcript changes
    watch(transcript, (newTranscript) => {
      if (newTranscript) {
        chatInput.value = newTranscript;
      }
    });

    // Suggestions - use store-persisted suggestions or fallback to initial
    const suggestions = computed(() => {
      const storedSuggestions = store.getters['agentChat/getSuggestions'](props.agentId);
      return storedSuggestions && storedSuggestions.length > 0 ? storedSuggestions : initialSuggestions;
    });

    let localMessageIdCounter = 0;
    const generateMessageId = () => `agent-msg-${Date.now()}-${localMessageIdCounter++}`;

    // Computed properties using the store
    const chatMessages = computed(() => {
      const messages = store.getters['agentChat/getMessages'](props.agentId);
      console.log('AgentChatContainer: chatMessages for agentId', props.agentId, ':', messages);
      return messages;
    });
    const formattedChatMessages = computed(() => {
      const messages = store.getters['agentChat/getFormattedMessages'](props.agentId);
      console.log('AgentChatContainer: formattedChatMessages for agentId', props.agentId, ':', messages);
      return messages;
    });
    const isProcessing = computed(() => store.getters['agentChat/isStreaming']);
    const isLoadingSuggestions = computed(() => store.getters['agentChat/isLoadingSuggestions']);
    const currentConversationId = computed(() => store.getters['agentChat/getConversationId'](props.agentId));

    const scrollToBottom = () => {
      nextTick(() => {
        if (chatMessagesRef.value) {
          chatMessagesRef.value.scrollTop = chatMessagesRef.value.scrollHeight;
        }
      });
    };

    const sendChatMessage = async () => {
      if (!chatInput.value.trim() || !props.agentId) return;

      const userMessage = {
        id: generateMessageId(),
        role: 'user',
        content: chatInput.value.trim(),
        timestamp: Date.now(),
      };

      store.dispatch('agentChat/addMessage', { agentId: props.agentId, message: userMessage });
      const messageToSend = chatInput.value.trim();
      chatInput.value = '';

      await processAssistantResponse(messageToSend);
    };

    const processAssistantResponse = async (userInput) => {
      store.dispatch('agentChat/setStreaming', true);
      const token = localStorage.getItem('token');

      // Log the agentId being sent
      console.log('AgentChatContainer: Sending request with agentId:', props.agentId);

      // Get current agent state from AgentForge if available
      let agentState = {
        id: props.agentId,
        agents: props.agents || [],
        customAgents: props.customAgents || [],
      };

      // Try to get the current agent form data from the page if it exists
      const agentFormData = getCurrentAgentFormData();
      if (agentFormData) {
        agentState.currentAgent = agentFormData;
      }

      console.log('AgentChatContainer: Using agentState:', agentState);

      const chatHistory = chatMessages.value
        .map((msg) => ({
          role: msg.role,
          content: msg.content,
        }))
        .filter((msg) => msg.role === 'user' || msg.role === 'assistant');

      const headers = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/orchestrator/agent-chat`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            messages: chatHistory,
            provider: store.state.aiProvider.selectedProvider,
            model: store.state.aiProvider.selectedModel,
            agentId: props.agentId,
            agentContext: {
              id: props.agentId,
            },
            agentState: agentState,
            conversationId: currentConversationId.value,
          }),
        });

        if (!response.body) {
          throw new Error('No response body from server');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const processStream = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              store.dispatch('agentChat/setStreaming', false);
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
                  handleStreamEvent(eventName, data);
                } catch (e) {
                  console.error('Error parsing stream data:', e, 'Raw data:', dataLine);
                }
              }
            }
          }
        };

        processStream();
      } catch (error) {
        console.error('Error calling agent orchestrator API:', error);
        const errorMessage = error.message || 'An unexpected error occurred.';
        const errorMsg = {
          id: generateMessageId(),
          role: 'assistant',
          content: `Sorry, I encountered an error: ${errorMessage}`,
          timestamp: Date.now(),
        };
        store.dispatch('agentChat/addMessage', { agentId: props.agentId, message: errorMsg });
        store.dispatch('agentChat/setStreaming', false);
      } finally {
        focusInput();
      }
    };

    const getCurrentAgentFormData = () => {
      // Try to get the current agent form data from the AgentForge page
      // This would need to be exposed by AgentForge through the store or events
      const agentForgeElement = document.querySelector('#agent-form');
      if (agentForgeElement) {
        const formData = {
          name: document.querySelector('#agent-name')?.value || '',
          description: document.querySelector('#agent-description')?.value || '',
          instructions: document.querySelector('#agent-instructions')?.value || '',
          // Add other fields as needed
        };
        return formData;
      }
      return null;
    };

    const handleStreamEvent = (eventName, data) => {
      switch (eventName) {
        case 'conversation_started':
          store.dispatch('agentChat/setConversationId', { agentId: props.agentId, conversationId: data.conversationId });
          break;

        case 'assistant_message':
          const assistantMessage = {
            ...data,
            role: 'assistant',
            toolCalls: [],
          };
          store.dispatch('agentChat/addMessage', { agentId: props.agentId, message: assistantMessage });
          store.dispatch('agentChat/setMessageStatus', {
            agentId: props.agentId,
            messageId: data.id,
            status: { type: 'thinking', text: 'Annie is thinking...' },
          });
          break;

        case 'content_delta':
          store.commit('agentChat/APPEND_MESSAGE_CONTENT', {
            agentId: props.agentId,
            messageId: data.assistantMessageId,
            delta: data.delta,
          });
          break;

        case 'tool_start':
          console.log('tool_start - data.toolCall:', data.toolCall);
          store.dispatch('agentChat/addToolCall', {
            agentId: props.agentId,
            messageId: data.assistantMessageId,
            toolCall: { ...data.toolCall },
          });
          store.dispatch('agentChat/setRunningTool', {
            agentId: props.agentId,
            messageId: data.assistantMessageId,
            toolCallId: data.toolCall.id,
            running: true,
          });
          store.dispatch('agentChat/setMessageStatus', {
            agentId: props.agentId,
            messageId: data.assistantMessageId,
            status: { type: 'tool', text: `Running ${data.toolCall.name || data.toolCall.function?.name || 'tool'}...` },
          });
          break;

        case 'tool_end':
          store.dispatch('agentChat/updateToolCall', {
            agentId: props.agentId,
            messageId: data.assistantMessageId,
            toolCallId: data.toolCall.id,
            toolCall: data.toolCall,
          });
          store.dispatch('agentChat/setRunningTool', {
            agentId: props.agentId,
            messageId: data.assistantMessageId,
            toolCallId: data.toolCall.id,
            running: false,
          });

          // Handle agent tool results directly here (like WorkflowChatContainer does)
          if (data.toolCall.result) {
            let toolResult = data.toolCall.result;

            // Get the stored toolCall from the message to access the tool name
            const messages = store.getters['agentChat/getMessages'](props.agentId);
            const message = messages.find((m) => m.id === data.assistantMessageId);
            const storedToolCall = message?.toolCalls?.find((tc) => tc.id === data.toolCall.id);
            const toolName = storedToolCall?.function?.name || storedToolCall?.name;

            console.log('tool_end - data.toolCall:', data.toolCall);
            console.log('tool_end - storedToolCall:', storedToolCall);
            console.log('tool_end - toolName:', toolName);
            console.log('tool_end - toolCall.result:', toolResult);

            // If the result is a string, try to parse it as JSON
            if (typeof toolResult === 'string') {
              try {
                toolResult = JSON.parse(toolResult);
                console.log('tool_end - Parsed toolResult:', toolResult);
              } catch (e) {
                console.error('Error parsing tool result:', e);
              }
            }

            // Handle generate_agent tool
            if (toolName === 'generate_agent' && toolResult && toolResult.success && toolResult.updatedAgent) {
              console.log('=== AGENT GENERATED ===');
              console.log('Agent data:', toolResult.updatedAgent);
              console.log('Dispatching agent-loaded event');

              window.dispatchEvent(
                new CustomEvent('agent-loaded', {
                  detail: toolResult.updatedAgent,
                  bubbles: true,
                  composed: true,
                })
              );
              console.log('Event dispatched');
              console.log('======================');
            }

            // Handle modify_agent tool
            if (toolName === 'modify_agent' && toolResult && toolResult.success && toolResult.updatedAgent) {
              console.log('Agent modified, dispatching event');
              window.dispatchEvent(
                new CustomEvent('agent-loaded', {
                  detail: toolResult.updatedAgent,
                  bubbles: true,
                  composed: true,
                })
              );
            }

            // Handle save_agent tool
            if (toolName === 'save_agent' && toolResult && toolResult.success) {
              window.dispatchEvent(
                new CustomEvent('agent-saved', {
                  detail: toolResult,
                })
              );
            }

            // Handle load_agent tool
            if (toolName === 'load_agent' && toolResult && toolResult.agent) {
              window.dispatchEvent(
                new CustomEvent('agent-loaded', {
                  detail: toolResult.agent,
                })
              );
            }
          }
          break;

        case 'frontend_event':
          // Handle frontend events from the consolidated agent system
          handleFrontendEvent(data.eventType, data.eventData);
          break;

        case 'final_content':
          // Don't replace content — it was already populated by content_delta events.
          // Just persist the conversations and clear the status.
          store.commit('agentChat/PERSIST_CONVERSATIONS');
          store.dispatch('agentChat/clearMessageStatus', {
            agentId: props.agentId,
            messageId: data.assistantMessageId,
          });
          updateSuggestions();
          break;

        case 'error':
          const errorMsg = {
            id: generateMessageId(),
            role: 'assistant',
            content: `An error occurred: ${data.error}`,
            timestamp: Date.now(),
          };
          store.dispatch('agentChat/addMessage', { agentId: props.agentId, message: errorMsg });
          store.dispatch('agentChat/setStreaming', false);
          break;

        case 'done':
          store.dispatch('agentChat/setStreaming', false);
          focusInput();
          break;
      }

      scrollToBottom();
    };

    const handleFrontendEvent = (eventType, eventData) => {
      console.log('AgentChatContainer: Handling frontend event', eventType, eventData);

      // Dispatch the event to the event bridge system
      window.dispatchEvent(
        new CustomEvent('chat-sse-event', {
          detail: { eventType, eventData },
        })
      );
    };

    const getMessageStatus = (message) => {
      if (!message || message.role !== 'assistant') return null;
      return store.getters['agentChat/getMessageStatus'](props.agentId, message.id);
    };

    const getRunningToolsForMessage = (message) => {
      if (!message || !message.toolCalls) return [];
      return store.getters['agentChat/getRunningToolsForMessage'](props.agentId, message.id);
    };

    const toggleToolCallExpansion = (messageId, toolCallIndex) => {
      store.dispatch('agentChat/toggleToolCallExpansion', {
        agentId: props.agentId,
        messageId,
        toolCallIndex,
      });
    };

    const executeSuggestion = (suggestion) => {
      chatInput.value = suggestion.text;
      sendChatMessage();
    };

    const updateSuggestions = async () => {
      if (isLoadingSuggestions.value || chatMessages.value.length < 2) return;

      store.dispatch('agentChat/setLoadingSuggestions', true);
      const token = localStorage.getItem('token');

      try {
        const recentHistory = chatMessages.value.slice(-10).map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

        const lastUserMessage = chatMessages.value.filter((m) => m.role === 'user').slice(-1)[0]?.content;
        const lastAssistantMessage = chatMessages.value.filter((m) => m.role === 'assistant').slice(-1)[0]?.content;

        if (!lastUserMessage || !lastAssistantMessage) {
          store.dispatch('agentChat/setLoadingSuggestions', false);
          return;
        }

        const headers = {
          'Content-Type': 'application/json',
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/orchestrator/suggestions`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            history: recentHistory,
            lastUserMessage,
            lastAssistantMessage,
            provider: store.state.aiProvider.selectedProvider,
            model: store.state.aiProvider.selectedModel,
            context: 'agent', // Specify agent context for better suggestions
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.suggestions && Array.isArray(data.suggestions)) {
            const newSuggestions = data.suggestions.slice(0, 2);
            // Save suggestions to store for persistence
            store.dispatch('agentChat/setSuggestions', {
              agentId: props.agentId,
              suggestions: newSuggestions,
            });
          }
        }
      } catch (error) {
        console.error('Error fetching AI suggestions:', error);
      } finally {
        store.dispatch('agentChat/setLoadingSuggestions', false);
      }
    };

    const clearChat = () => {
      if (props.agentId) {
        store.dispatch('agentChat/clearConversation', props.agentId);
        // Reset suggestions to initial state in store
        store.dispatch('agentChat/setSuggestions', {
          agentId: props.agentId,
          suggestions: [...initialSuggestions],
        });
      }
      focusInput();
    };

    const focusInput = () => {
      nextTick(() => {
        if (chatInputRef.value) {
          chatInputRef.value.focus();
        }
      });
    };

    // Watch for agentId changes and scroll to bottom
    watch(
      () => props.agentId,
      (newAgentId, oldAgentId) => {
        if (newAgentId && newAgentId !== oldAgentId) {
          console.log('AgentChatContainer: agentId changed from', oldAgentId, 'to', newAgentId);
          // Add a small delay to ensure the store has time to update
          setTimeout(() => {
            scrollToBottom();
          }, 100);
        }
      }
    );

    // Watch for conversation being cleared and reset suggestions
    watch(
      () => chatMessages.value.length,
      (newLength, oldLength) => {
        // If messages went from more than 1 to exactly 1, it means the conversation was cleared
        if (oldLength > 1 && newLength === 1) {
          console.log('AgentChatContainer: Conversation cleared, resetting suggestions');
          // Reset suggestions to initial state in store
          store.dispatch('agentChat/setSuggestions', {
            agentId: props.agentId,
            suggestions: [...initialSuggestions],
          });
        }
      }
    );

    onMounted(() => {
      // Initialize the conversation with welcome message if needed
      if (props.agentId) {
        store.dispatch('agentChat/initializeConversation', props.agentId);
      }
      focusInput();
      scrollToBottom();
    });

    return {
      chatMessagesRef,
      chatInputRef,
      chatMessages,
      formattedChatMessages,
      chatInput,
      isProcessing,
      suggestions,
      isLoadingSuggestions,
      sendChatMessage,
      executeSuggestion,
      toggleToolCallExpansion,
      getMessageStatus,
      getRunningToolsForMessage,
      clearChat,
      isListening,
      isSupported,
      toggleListening,
    };
  },
};
</script>

<style scoped>
.agent-chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  overflow: hidden;
  flex: 1;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 0 0 16px;
  scrollbar-width: thin;
  scrollbar-color: rgba(127, 129, 147, 0.2) transparent;
  display: flex;
  flex-direction: column;
}

.chat-messages::-webkit-scrollbar {
  width: 6px;
}

.chat-messages::-webkit-scrollbar-track {
  background: transparent;
}

.chat-messages::-webkit-scrollbar-thumb {
  background: rgba(127, 129, 147, 0.2);
  border-radius: 3px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--color-grey);
  gap: 12px;
  text-align: center;
}

.empty-state i {
  font-size: 2.5em;
  opacity: 0.5;
  color: var(--color-green);
}

.empty-state p {
  color: var(--color-light-green);
  max-width: 300px;
  line-height: 1.5;
}

.message-flow {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1 1 auto;
}

.message-enter-active {
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
}

.message-leave-active {
  transition: opacity 0.3s ease-in, transform 0.3s ease-in;
}

.message-enter-from {
  opacity: 0;
  transform: translateY(15px);
}

.message-leave-to {
  opacity: 0;
  transform: translateY(15px);
}

.quick-actions-wrapper {
  padding: 12px 0;
  border-top: 1px solid var(--terminal-border-color);
  /* background: rgba(0, 0, 0, 0.05); */
}

.quick-actions-wrapper :deep(.suggestions-bar) {
  padding: 0;
  border-top: none;
}

.chat-input-container {
  padding: 16px 0 0 2px;
  border-top: 1px solid var(--terminal-border-color);
  /* background: rgba(0, 0, 0, 0.05); */
}

.agent-editor-panel.fullscreen .chat-input-container {
  padding: 16px 0 0 0;
  background: transparent;
}

.agent-editor-panel.fullscreen .quick-actions-wrapper {
  background: transparent;
}

.chat-input-wrapper {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.chat-input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 10px 16px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 24px;
  background: rgba(0, 0, 0, 0.2);
  color: var(--color-light-green);
  font-size: var(--font-size-sm);
  transition: all 0.2s ease;
}

.chat-input:focus {
  outline: none !important;
  border-color: var(--terminal-border-color) !important;
}

.chat-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.chat-mic-button {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: var(--color-darker-2);
  color: var(--color-light-green);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
}

.chat-mic-button:hover:not(:disabled) {
  background: var(--color-darker-0);
}

.chat-mic-button.is-listening {
  background: #ff4444;
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
  min-width: 40px;
  height: 40px;
  border-radius: 20px;
  border: none;
  background: var(--color-green);
  color: var(--color-dark-navy);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex: 1 0 auto;
}

.chat-send-button:hover:not(:disabled) {
  background: rgba(25, 239, 131, 0.8);
  transform: scale(1.05);
}

.chat-send-button:disabled {
  background: rgba(25, 239, 131, 0.3);
  cursor: not-allowed;
  transform: none;
}

/* Ensure message items don't have excessive padding */
.agent-chat-container :deep(.message-wrapper) {
  max-width: 100%;
}

/* Adjust for fullscreen mode */
.agent-editor-panel.fullscreen .agent-chat-container {
  height: calc(100% - 60px); /* Account for panel header */
}
</style>
