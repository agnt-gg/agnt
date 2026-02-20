<template>
  <div class="workflow-chat-container">
    <div class="chat-messages" ref="chatMessagesRef">
      <div v-if="formattedChatMessages.length === 0" class="empty-state">
        <i class="fas fa-comments"></i>
        <p>Hi! I'm Annie, your workflow assistant. Ask me anything about building workflows!</p>
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
          placeholder="Ask about workflows, nodes, or get help..."
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
  { id: 'wf-1', text: 'List tools', icon: '📦' },
  { id: 'wf-2', text: 'Analyze flow', icon: '🔍' },
];

export default {
  name: 'WorkflowChatContainer',
  components: {
    MessageItem,
    ProcessingState,
    QuickActions,
    Tooltip,
  },
  props: {
    workflowId: {
      type: String,
      default: null,
    },
    nodes: {
      type: Array,
      default: () => [],
    },
    edges: {
      type: Array,
      default: () => [],
    },
  },
  setup(props) {
    console.log('WorkflowChatContainer: setup called with workflowId:', props.workflowId);
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
      const storedSuggestions = store.getters['workflowChat/getSuggestions'](props.workflowId);
      return storedSuggestions && storedSuggestions.length > 0 ? storedSuggestions : initialSuggestions;
    });

    let localMessageIdCounter = 0;
    const generateMessageId = () => `wf-msg-${Date.now()}-${localMessageIdCounter++}`;

    // Computed properties using the store
    const chatMessages = computed(() => {
      const messages = store.getters['workflowChat/getMessages'](props.workflowId);
      console.log('WorkflowChatContainer: chatMessages for workflowId', props.workflowId, ':', messages);
      return messages;
    });
    const formattedChatMessages = computed(() => {
      const messages = store.getters['workflowChat/getFormattedMessages'](props.workflowId);
      console.log('WorkflowChatContainer: formattedChatMessages for workflowId', props.workflowId, ':', messages);
      return messages;
    });
    const isProcessing = computed(() => store.getters['workflowChat/isStreaming']);
    const isLoadingSuggestions = computed(() => store.getters['workflowChat/isLoadingSuggestions']);
    const currentConversationId = computed(() => store.getters['workflowChat/getConversationId'](props.workflowId));

    const scrollToBottom = () => {
      nextTick(() => {
        if (chatMessagesRef.value) {
          chatMessagesRef.value.scrollTop = chatMessagesRef.value.scrollHeight;
        }
      });
    };

    const sendChatMessage = async () => {
      if (!chatInput.value.trim() || !props.workflowId) return;

      const userMessage = {
        id: generateMessageId(),
        role: 'user',
        content: chatInput.value.trim(),
        timestamp: Date.now(),
      };

      store.dispatch('workflowChat/addMessage', { workflowId: props.workflowId, message: userMessage });
      const messageToSend = chatInput.value.trim();
      chatInput.value = '';

      await processAssistantResponse(messageToSend);
    };

    const processAssistantResponse = async (userInput) => {
      store.dispatch('workflowChat/setStreaming', true);
      const token = localStorage.getItem('token');

      // Log the workflowId being sent
      console.log('WorkflowChatContainer: Sending request with workflowId:', props.workflowId);

      // ALWAYS prefer the full cached state when available to ensure we get ALL nodes
      // Props might only contain partial data, so we prioritize the complete cached state
      let workflowState = null;

      // First, try to get the full state from the store
      const cachedState = store.getters['canvas/canvasState'];
      if (cachedState && cachedState.id === props.workflowId) {
        console.log('WorkflowChatContainer: Using cached state that matches current workflowId');
        workflowState = cachedState;
      } else {
        // Try localStorage as fallback, but only if ID matches
        try {
          const canvasState = localStorage.getItem('canvasState');
          if (canvasState) {
            const parsedState = JSON.parse(canvasState);
            if (parsedState.id === props.workflowId) {
              console.log('WorkflowChatContainer: Using localStorage state that matches current workflowId');
              workflowState = parsedState;
            }
          }
        } catch (e) {
          console.error('Error parsing canvasState from localStorage:', e);
        }
      }

      // Only use props as a last resort if we couldn't get cached state
      if (!workflowState) {
        console.log('WorkflowChatContainer: No cached state found, using props (may be incomplete)');
        workflowState = {
          id: props.workflowId,
          nodes: props.nodes || [],
          edges: props.edges || [],
        };
      }

      console.log('WorkflowChatContainer: Using workflowState with ID:', workflowState.id, 'nodes:', workflowState.nodes?.length || 0);

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
        const response = await fetch(`${API_CONFIG.BASE_URL}/orchestrator/workflow-chat`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            messages: chatHistory,
            provider: store.state.aiProvider.selectedProvider,
            model: store.state.aiProvider.selectedModel,
            workflowId: props.workflowId,
            workflowContext: {
              id: props.workflowId,
            },
            workflowState: workflowState,
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
              store.dispatch('workflowChat/setStreaming', false);
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
        console.error('Error calling workflow orchestrator API:', error);
        const errorMessage = error.message || 'An unexpected error occurred.';
        const errorMsg = {
          id: generateMessageId(),
          role: 'assistant',
          content: `Sorry, I encountered an error: ${errorMessage}`,
          timestamp: Date.now(),
        };
        store.dispatch('workflowChat/addMessage', { workflowId: props.workflowId, message: errorMsg });
        store.dispatch('workflowChat/setStreaming', false);
      } finally {
        focusInput();
        // scrollToBottom();
      }
    };

    const handleStreamEvent = (eventName, data) => {
      switch (eventName) {
        case 'conversation_started':
          store.dispatch('workflowChat/setConversationId', { workflowId: props.workflowId, conversationId: data.conversationId });
          break;

        case 'assistant_message':
          const assistantMessage = {
            ...data,
            role: 'assistant',
            toolCalls: [],
          };
          store.dispatch('workflowChat/addMessage', { workflowId: props.workflowId, message: assistantMessage });
          store.dispatch('workflowChat/setMessageStatus', {
            workflowId: props.workflowId,
            messageId: data.id,
            status: { type: 'thinking', text: 'Annie is thinking...' },
          });
          break;

        case 'content_delta':
          store.commit('workflowChat/APPEND_MESSAGE_CONTENT', {
            workflowId: props.workflowId,
            messageId: data.assistantMessageId,
            delta: data.delta,
          });
          break;

        case 'tool_start':
          store.dispatch('workflowChat/addToolCall', {
            workflowId: props.workflowId,
            messageId: data.assistantMessageId,
            toolCall: { ...data.toolCall },
          });
          store.dispatch('workflowChat/setRunningTool', {
            workflowId: props.workflowId,
            messageId: data.assistantMessageId,
            toolCallId: data.toolCall.id,
            running: true,
          });
          store.dispatch('workflowChat/setMessageStatus', {
            workflowId: props.workflowId,
            messageId: data.assistantMessageId,
            status: { type: 'tool', text: `Running ${data.toolCall.name}...` },
          });
          break;

        case 'tool_end':
          store.dispatch('workflowChat/updateToolCall', {
            workflowId: props.workflowId,
            messageId: data.assistantMessageId,
            toolCallId: data.toolCall.id,
            toolCall: data.toolCall,
          });
          store.dispatch('workflowChat/setRunningTool', {
            workflowId: props.workflowId,
            messageId: data.assistantMessageId,
            toolCallId: data.toolCall.id,
            running: false,
          });

          // Check if the tool response contains an updated workflow or workflow started flag
          if (data.toolCall.result) {
            let toolResult = data.toolCall.result;
            // If the result is a string, try to parse it as JSON
            if (typeof toolResult === 'string') {
              try {
                toolResult = JSON.parse(toolResult);
              } catch (e) {
                console.error('Error parsing tool result:', e);
              }
            }

            // Check if this was a start_workflow tool call
            if (data.toolCall.name === 'start_workflow' && toolResult && toolResult.workflowStarted) {
              console.log('Workflow started via chat, emitting workflow-started event');
              // Emit a workflow-started event that WorkflowForge can listen to
              window.dispatchEvent(
                new CustomEvent('workflow-started-from-chat', {
                  detail: {
                    workflowId: toolResult.workflowId,
                    status: toolResult.status || 'listening',
                  },
                })
              );
            }

            // Check if this was a stop_workflow tool call
            if (data.toolCall.name === 'stop_workflow' && toolResult && toolResult.success) {
              console.log('Workflow stopped via chat, emitting workflow-stopped event');
              window.dispatchEvent(
                new CustomEvent('workflow-stopped-from-chat', {
                  detail: {
                    workflowId: toolResult.workflowId,
                  },
                })
              );
            }

            // Check if the parsed result contains an updated workflow
            if (toolResult && toolResult.updatedWorkflow) {
              // Emit an event to update the canvas with the new workflow state
              window.dispatchEvent(
                new CustomEvent('workflow-updated', {
                  detail: toolResult.updatedWorkflow,
                })
              );
            }
          }
          break;

        case 'final_content':
          // Don't replace content — it was already populated by content_delta events.
          // Just persist the conversations and clear the status.
          store.commit('workflowChat/PERSIST_CONVERSATIONS');
          store.dispatch('workflowChat/clearMessageStatus', {
            workflowId: props.workflowId,
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
          store.dispatch('workflowChat/addMessage', { workflowId: props.workflowId, message: errorMsg });
          store.dispatch('workflowChat/setStreaming', false);
          break;

        case 'done':
          store.dispatch('workflowChat/setStreaming', false);
          focusInput();
          // scrollToBottom();
          break;
      }

      // scrollToBottom();
    };

    const getMessageStatus = (message) => {
      if (!message || message.role !== 'assistant') return null;
      return store.getters['workflowChat/getMessageStatus'](props.workflowId, message.id);
    };

    const getRunningToolsForMessage = (message) => {
      if (!message || !message.toolCalls) return [];
      return store.getters['workflowChat/getRunningToolsForMessage'](props.workflowId, message.id);
    };

    const toggleToolCallExpansion = (messageId, toolCallIndex) => {
      store.dispatch('workflowChat/toggleToolCallExpansion', {
        workflowId: props.workflowId,
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

      store.dispatch('workflowChat/setLoadingSuggestions', true);
      const token = localStorage.getItem('token');

      try {
        const recentHistory = chatMessages.value.slice(-10).map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

        const lastUserMessage = chatMessages.value.filter((m) => m.role === 'user').slice(-1)[0]?.content;
        const lastAssistantMessage = chatMessages.value.filter((m) => m.role === 'assistant').slice(-1)[0]?.content;

        if (!lastUserMessage || !lastAssistantMessage) {
          store.dispatch('workflowChat/setLoadingSuggestions', false);
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
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.suggestions && Array.isArray(data.suggestions)) {
            const newSuggestions = data.suggestions.slice(0, 1);
            // Save suggestions to store for persistence
            store.dispatch('workflowChat/setSuggestions', {
              workflowId: props.workflowId,
              suggestions: newSuggestions,
            });
          }
        }
      } catch (error) {
        console.error('Error fetching AI suggestions:', error);
      } finally {
        store.dispatch('workflowChat/setLoadingSuggestions', false);
      }
    };

    const clearChat = () => {
      if (props.workflowId) {
        store.dispatch('workflowChat/clearConversation', props.workflowId);
        // Reset suggestions to initial state in store
        store.dispatch('workflowChat/setSuggestions', {
          workflowId: props.workflowId,
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

    // Watch for workflowId changes and scroll to bottom
    watch(
      () => props.workflowId,
      (newWorkflowId, oldWorkflowId) => {
        if (newWorkflowId && newWorkflowId !== oldWorkflowId) {
          console.log('WorkflowChatContainer: workflowId changed from', oldWorkflowId, 'to', newWorkflowId);
          // Add a small delay to ensure the store has time to update
          setTimeout(() => {
            // Scroll to bottom when workflowId changes to show any existing messages
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
        // (the store reinitializes with a welcome message, so length becomes 1)
        if (oldLength > 1 && newLength === 1) {
          console.log('WorkflowChatContainer: Conversation cleared, resetting suggestions');
          // Reset suggestions to initial state in store
          store.dispatch('workflowChat/setSuggestions', {
            workflowId: props.workflowId,
            suggestions: [...initialSuggestions],
          });
        }
      }
    );

    onMounted(() => {
      focusInput();
      // scrollToBottom();
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
.workflow-chat-container {
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

.workflow-editor-panel.fullscreen .chat-input-container {
  padding: 16px 0 0 0;
  background: transparent;
}

.workflow-editor-panel.fullscreen .quick-actions-wrapper {
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

/* Ensure message items don't have excessive padding */
.workflow-chat-container :deep(.message-wrapper) {
  max-width: 100%;
}

/* Adjust for fullscreen mode */
.workflow-editor-panel.fullscreen .workflow-chat-container {
  height: calc(100% - 60px); /* Account for panel header */
}
</style>
