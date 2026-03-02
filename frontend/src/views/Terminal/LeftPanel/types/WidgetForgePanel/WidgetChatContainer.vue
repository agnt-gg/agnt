<template>
  <div class="widget-chat-container">
    <div class="chat-messages" ref="chatMessagesRef">
      <div v-if="formattedChatMessages.length === 0" class="empty-state">
        <i class="fas fa-puzzle-piece"></i>
        <p>Hi! I'm Annie, your widget assistant. I can help you create, modify, and configure widgets!</p>
      </div>

      <TransitionGroup name="message" tag="div" class="message-flow" v-else>
        <MessageItem
          v-for="message in formattedChatMessages"
          :key="message.id"
          :message="message"
          :status="getMessageStatus(message)"
          :runningTools="getRunningToolsForMessage(message)"
          :show-avatar="false"
          compact
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
          placeholder="Ask about widgets, create new ones, or get help..."
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
import { ref, computed, nextTick, onMounted, watch, inject } from 'vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config.js';
import MessageItem from '@/views/Terminal/CenterPanel/screens/Chat/components/MessageItem.vue';
import ProcessingState from '@/views/Terminal/CenterPanel/screens/Chat/components/ProcessingState.vue';
import QuickActions from '@/views/Terminal/CenterPanel/screens/Chat/components/QuickActions.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { useSpeechRecognition } from '@/composables/useSpeechRecognition';

const initialSuggestions = [
  { id: 'widget-1', text: 'Create a new widget', icon: '🧩' },
  { id: 'widget-2', text: 'Help me with HTML widgets', icon: '📦' },
];

export default {
  name: 'WidgetChatContainer',
  components: {
    MessageItem,
    ProcessingState,
    QuickActions,
    Tooltip,
  },
  props: {
    widgetId: {
      type: String,
      default: null,
    },
  },
  setup(props) {
    const store = useStore();
    const forge = inject('widgetForge', null);
    const chatMessagesRef = ref(null);
    const chatInputRef = ref(null);

    // Speech Recognition
    const { isListening, isSupported, transcript, toggleListening } = useSpeechRecognition();

    const chatInput = ref('');

    watch(transcript, (newTranscript) => {
      if (newTranscript) {
        chatInput.value = newTranscript;
      }
    });

    const suggestions = computed(() => {
      const storedSuggestions = store.getters['widgetChat/getSuggestions'](props.widgetId);
      return storedSuggestions && storedSuggestions.length > 0 ? storedSuggestions : initialSuggestions;
    });

    let localMessageIdCounter = 0;
    const generateMessageId = () => `widget-msg-${Date.now()}-${localMessageIdCounter++}`;

    const chatMessages = computed(() => store.getters['widgetChat/getMessages'](props.widgetId));
    const formattedChatMessages = computed(() => store.getters['widgetChat/getFormattedMessages'](props.widgetId));
    const isProcessing = computed(() => store.getters['widgetChat/isStreaming']);
    const isLoadingSuggestions = computed(() => store.getters['widgetChat/isLoadingSuggestions']);
    const currentConversationId = computed(() => store.getters['widgetChat/getConversationId'](props.widgetId));

    const scrollToBottom = () => {
      nextTick(() => {
        if (chatMessagesRef.value) {
          chatMessagesRef.value.scrollTop = chatMessagesRef.value.scrollHeight;
        }
      });
    };

    const sendChatMessage = async () => {
      if (!chatInput.value.trim() || !props.widgetId) return;

      const userMessage = {
        id: generateMessageId(),
        role: 'user',
        content: chatInput.value.trim(),
        timestamp: Date.now(),
      };

      store.dispatch('widgetChat/addMessage', { widgetId: props.widgetId, message: userMessage });
      const messageToSend = chatInput.value.trim();
      chatInput.value = '';

      await processAssistantResponse(messageToSend);
    };

    const processAssistantResponse = async (userInput) => {
      store.dispatch('widgetChat/setStreaming', true);
      const token = localStorage.getItem('token');

      let widgetState = {
        id: props.widgetId,
      };

      // Include full widget form data so the LLM has context of the current widget
      if (forge && forge.form) {
        widgetState = {
          ...widgetState,
          name: forge.form.name || '',
          description: forge.form.description || '',
          icon: forge.form.icon || '',
          category: forge.form.category || '',
          widget_type: forge.form.widget_type || 'html',
          source_code: forge.form.source_code || '',
          config: forge.form.config || {},
          default_size: forge.form.default_size || { cols: 4, rows: 3 },
          min_size: forge.form.min_size || { cols: 2, rows: 2 },
        };
      }

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
        const response = await fetch(`${API_CONFIG.BASE_URL}/orchestrator/widget-chat`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            messages: chatHistory,
            provider: store.state.aiProvider.selectedProvider,
            model: store.state.aiProvider.selectedModel,
            widgetId: props.widgetId,
            widgetContext: {
              id: props.widgetId,
            },
            widgetState: widgetState,
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
              store.dispatch('widgetChat/setStreaming', false);
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
        console.error('Error calling widget orchestrator API:', error);
        const errorMessage = error.message || 'An unexpected error occurred.';
        const errorMsg = {
          id: generateMessageId(),
          role: 'assistant',
          content: `Sorry, I encountered an error: ${errorMessage}`,
          timestamp: Date.now(),
        };
        store.dispatch('widgetChat/addMessage', { widgetId: props.widgetId, message: errorMsg });
        store.dispatch('widgetChat/setStreaming', false);
      } finally {
        focusInput();
      }
    };

    const handleStreamEvent = (eventName, data) => {
      switch (eventName) {
        case 'conversation_started':
          store.dispatch('widgetChat/setConversationId', { widgetId: props.widgetId, conversationId: data.conversationId });
          break;

        case 'assistant_message':
          const assistantMessage = {
            ...data,
            role: 'assistant',
            toolCalls: [],
          };
          store.dispatch('widgetChat/addMessage', { widgetId: props.widgetId, message: assistantMessage });
          store.dispatch('widgetChat/setMessageStatus', {
            widgetId: props.widgetId,
            messageId: data.id,
            status: { type: 'thinking', text: 'Annie is thinking...' },
          });
          break;

        case 'content_delta':
          store.commit('widgetChat/APPEND_MESSAGE_CONTENT', {
            widgetId: props.widgetId,
            messageId: data.assistantMessageId,
            delta: data.delta,
          });
          break;

        case 'tool_start':
          store.dispatch('widgetChat/addToolCall', {
            widgetId: props.widgetId,
            messageId: data.assistantMessageId,
            toolCall: { ...data.toolCall },
          });
          store.dispatch('widgetChat/setRunningTool', {
            widgetId: props.widgetId,
            messageId: data.assistantMessageId,
            toolCallId: data.toolCall.id,
            running: true,
          });
          store.dispatch('widgetChat/setMessageStatus', {
            widgetId: props.widgetId,
            messageId: data.assistantMessageId,
            status: { type: 'tool', text: `Running ${data.toolCall.name}...` },
          });
          break;

        case 'tool_end':
          store.dispatch('widgetChat/updateToolCall', {
            widgetId: props.widgetId,
            messageId: data.assistantMessageId,
            toolCallId: data.toolCall.id,
            toolCall: data.toolCall,
          });
          store.dispatch('widgetChat/setRunningTool', {
            widgetId: props.widgetId,
            messageId: data.assistantMessageId,
            toolCallId: data.toolCall.id,
            running: false,
          });

          const messages = store.getters['widgetChat/getMessages'](props.widgetId);
          const message = messages.find((m) => m.id === data.assistantMessageId);
          const storedToolCall = message?.toolCalls?.find((tc) => tc.id === data.toolCall.id);

          const enhancedToolCall = {
            ...data.toolCall,
            name: storedToolCall?.function?.name || storedToolCall?.name || data.toolCall.name,
          };

          handleToolAction(enhancedToolCall);
          break;

        case 'frontend_event':
          handleFrontendEvent(data.eventType, data.eventData);
          break;

        case 'final_content':
          store.commit('widgetChat/PERSIST_CONVERSATIONS');
          store.dispatch('widgetChat/clearMessageStatus', {
            widgetId: props.widgetId,
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
          store.dispatch('widgetChat/addMessage', { widgetId: props.widgetId, message: errorMsg });
          store.dispatch('widgetChat/setStreaming', false);
          break;

        case 'done':
          store.dispatch('widgetChat/setStreaming', false);
          focusInput();
          break;
      }

      scrollToBottom();
    };

    const handleFrontendEvent = (eventType, eventData) => {
      window.dispatchEvent(
        new CustomEvent('chat-sse-event', {
          detail: { eventType, eventData },
        })
      );
    };

    const handleToolAction = (toolCall) => {
      if (toolCall.result) {
        let toolResult = toolCall.result;
        if (typeof toolResult === 'string') {
          try {
            toolResult = JSON.parse(toolResult);
          } catch (e) {
            console.error('Error parsing tool result:', e);
          }
        }

        const widgetTools = ['edit_widget_code', 'generate_widget', 'update_widget_config'];
        if (widgetTools.includes(toolCall.name) && toolResult.success && toolResult.frontendEvents) {
          toolResult.frontendEvents.forEach((event) => {
            handleFrontendEvent(event.type, event.data);
          });
          return;
        }

        if (toolCall.name === 'save_widget' && toolResult.success) {
          window.dispatchEvent(
            new CustomEvent('widget-saved', {
              detail: toolResult,
            })
          );
        }

        if (toolCall.name === 'load_widget' && toolResult.success) {
          window.dispatchEvent(
            new CustomEvent('widget-loaded', {
              detail: toolResult.widgetData,
            })
          );
        }
      }
    };

    const getMessageStatus = (message) => {
      if (!message || message.role !== 'assistant') return null;
      return store.getters['widgetChat/getMessageStatus'](props.widgetId, message.id);
    };

    const getRunningToolsForMessage = (message) => {
      if (!message || !message.toolCalls) return [];
      return store.getters['widgetChat/getRunningToolsForMessage'](props.widgetId, message.id);
    };

    const toggleToolCallExpansion = (messageId, toolCallIndex) => {
      store.dispatch('widgetChat/toggleToolCallExpansion', {
        widgetId: props.widgetId,
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

      store.dispatch('widgetChat/setLoadingSuggestions', true);
      const token = localStorage.getItem('token');

      try {
        const recentHistory = chatMessages.value.slice(-10).map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

        const lastUserMessage = chatMessages.value.filter((m) => m.role === 'user').slice(-1)[0]?.content;
        const lastAssistantMessage = chatMessages.value.filter((m) => m.role === 'assistant').slice(-1)[0]?.content;

        if (!lastUserMessage || !lastAssistantMessage) {
          store.dispatch('widgetChat/setLoadingSuggestions', false);
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
            context: 'widget',
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.suggestions && Array.isArray(data.suggestions)) {
            const newSuggestions = data.suggestions.slice(0, 2);
            store.dispatch('widgetChat/setSuggestions', {
              widgetId: props.widgetId,
              suggestions: newSuggestions,
            });
          }
        }
      } catch (error) {
        console.error('Error fetching AI suggestions:', error);
      } finally {
        store.dispatch('widgetChat/setLoadingSuggestions', false);
      }
    };

    const clearChat = () => {
      if (props.widgetId) {
        store.dispatch('widgetChat/clearConversation', props.widgetId);
        store.dispatch('widgetChat/setSuggestions', {
          widgetId: props.widgetId,
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

    watch(
      () => props.widgetId,
      (newWidgetId, oldWidgetId) => {
        if (newWidgetId && newWidgetId !== oldWidgetId) {
          setTimeout(() => {
            scrollToBottom();
          }, 100);
        }
      }
    );

    watch(
      () => chatMessages.value.length,
      (newLength, oldLength) => {
        if (oldLength > 1 && newLength === 1) {
          store.dispatch('widgetChat/setSuggestions', {
            widgetId: props.widgetId,
            suggestions: [...initialSuggestions],
          });
        }
      }
    );

    onMounted(() => {
      if (props.widgetId) {
        store.dispatch('widgetChat/initializeConversation', props.widgetId);
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
.widget-chat-container {
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
  scrollbar-width: none;
  display: flex;
  flex-direction: column;
}

.chat-messages::-webkit-scrollbar {
  display: none;
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
}

.quick-actions-wrapper :deep(.suggestions-bar) {
  padding: 0;
  border-top: none;
}

.chat-input-container {
  padding: 16px 0 0 2px;
  border-top: 1px solid var(--terminal-border-color);
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
  background: rgba(var(--green-rgb), 0.8);
  transform: scale(1.05);
}

.chat-send-button:disabled {
  background: rgba(var(--green-rgb), 0.3);
  cursor: not-allowed;
  transform: none;
}

.widget-chat-container :deep(.message-wrapper) {
  max-width: 100%;
}
</style>
