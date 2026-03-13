<template>
  <div class="artifact-chat-container">
    <div class="chat-messages" ref="chatMessagesRef">
      <div v-if="formattedChatMessages.length === 0" class="empty-state">
        <i class="fas fa-cube"></i>
        <p>Hi! I'm Annie, your artifacts assistant. I can help you create, edit, and explore files — code, docs, charts, and more!</p>
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

    <div class="chat-input-container">
      <div class="chat-input-wrapper">
        <input
          v-model="chatInput"
          @keyup.enter="sendChatMessage"
          type="text"
          placeholder="Ask about code, create files, or get help..."
          class="chat-input"
          :disabled="isProcessing"
          ref="chatInputRef"
        />
        <template v-if="isProcessing">
          <Tooltip text="Stop generating">
            <button @click="stopStream" class="chat-stop-button">
              <i class="fas fa-stop"></i>
            </button>
          </Tooltip>
        </template>
        <template v-else>
          <button @click="sendChatMessage" :disabled="!chatInput.trim()" class="chat-send-button">
            <i class="fas fa-paper-plane"></i>
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, nextTick, onMounted, watch, onUnmounted } from 'vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config.js';
import MessageItem from '@/views/Terminal/CenterPanel/screens/Chat/components/MessageItem.vue';
import ProcessingState from '@/views/Terminal/CenterPanel/screens/Chat/components/ProcessingState.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'ArtifactChatContainer',
  components: { MessageItem, ProcessingState, Tooltip },
  props: {
    sessionId: { type: String, default: 'artifacts' },
  },
  setup(props) {
    const store = useStore();
    const chatMessagesRef = ref(null);
    const chatInputRef = ref(null);
    const chatInput = ref('');
    let abortController = null;

    let localMessageIdCounter = 0;
    const generateMessageId = () => `artifact-msg-${Date.now()}-${localMessageIdCounter++}`;

    const chatMessages = computed(() => store.getters['artifactChat/getMessages'](props.sessionId));
    const formattedChatMessages = computed(() => store.getters['artifactChat/getFormattedMessages'](props.sessionId));
    const isProcessing = computed(() => store.getters['artifactChat/isStreaming']);
    const currentConversationId = computed(() => store.getters['artifactChat/getConversationId'](props.sessionId));

    const scrollToBottom = () => {
      nextTick(() => {
        if (chatMessagesRef.value) {
          chatMessagesRef.value.scrollTop = chatMessagesRef.value.scrollHeight;
        }
      });
    };

    // Listen for open file context updates from Artifacts screen
    const openFileContext = ref({ path: null, content: null });

    const handleOpenFileUpdate = (e) => {
      openFileContext.value = e.detail;
    };

    onMounted(() => {
      if (props.sessionId) {
        store.dispatch('artifactChat/initializeConversation', props.sessionId);
      }
      focusInput();
      scrollToBottom();
      window.addEventListener('artifacts-open-file', handleOpenFileUpdate);
    });

    onUnmounted(() => {
      window.removeEventListener('artifacts-open-file', handleOpenFileUpdate);
    });

    const sendChatMessage = async () => {
      if (!chatInput.value.trim() || !props.sessionId || isProcessing.value) return;

      const userMessage = {
        id: generateMessageId(),
        role: 'user',
        content: chatInput.value.trim(),
        timestamp: Date.now(),
      };

      store.dispatch('artifactChat/addMessage', { sessionId: props.sessionId, message: userMessage });
      const messageToSend = chatInput.value.trim();
      chatInput.value = '';

      await processAssistantResponse(messageToSend);
    };

    const stopStream = () => {
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      store.dispatch('artifactChat/setStreaming', false);
      focusInput();
    };

    const processAssistantResponse = async (userInput) => {
      store.dispatch('artifactChat/setStreaming', true);
      abortController = new AbortController();
      const token = localStorage.getItem('token');

      const chatHistory = chatMessages.value
        .map((msg) => ({ role: msg.role, content: msg.content }))
        .filter((msg) => msg.role === 'user' || msg.role === 'assistant');

      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/orchestrator/artifact-chat`, {
          method: 'POST',
          headers,
          signal: abortController.signal,
          body: JSON.stringify({
            messages: chatHistory,
            provider: store.state.aiProvider.selectedProvider,
            model: store.state.aiProvider.selectedModel,
            codeId: props.sessionId,
            codeContext: {
              openFilePath: openFileContext.value.path,
              openFileContent: openFileContext.value.content,
            },
            conversationId: currentConversationId.value,
          }),
        });

        if (!response.body) throw new Error('No response body from server');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const processStream = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              store.dispatch('artifactChat/setStreaming', false);
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
                  console.error('Error parsing stream data:', e);
                }
              }
            }
          }
        };

        processStream();
      } catch (error) {
        if (error.name === 'AbortError') {
          // User stopped the stream — not an error
          store.dispatch('artifactChat/setStreaming', false);
          return;
        }
        console.error('Error calling artifact chat API:', error);
        const errorMsg = {
          id: generateMessageId(),
          role: 'assistant',
          content: `Sorry, I encountered an error: ${error.message}`,
          timestamp: Date.now(),
        };
        store.dispatch('artifactChat/addMessage', { sessionId: props.sessionId, message: errorMsg });
        store.dispatch('artifactChat/setStreaming', false);
      } finally {
        abortController = null;
        focusInput();
      }
    };

    const handleStreamEvent = (eventName, data) => {
      switch (eventName) {
        case 'conversation_started':
          store.dispatch('artifactChat/setConversationId', { sessionId: props.sessionId, conversationId: data.conversationId });
          break;

        case 'assistant_message': {
          const assistantMessage = { ...data, role: 'assistant', toolCalls: [] };
          store.dispatch('artifactChat/addMessage', { sessionId: props.sessionId, message: assistantMessage });
          store.dispatch('artifactChat/setMessageStatus', {
            sessionId: props.sessionId,
            messageId: data.id,
            status: { type: 'thinking', text: 'Annie is thinking...' },
          });
          break;
        }

        case 'content_delta':
          store.commit('artifactChat/APPEND_MESSAGE_CONTENT', {
            sessionId: props.sessionId,
            messageId: data.assistantMessageId,
            delta: data.delta,
          });
          break;

        case 'tool_start':
          store.dispatch('artifactChat/addToolCall', {
            sessionId: props.sessionId,
            messageId: data.assistantMessageId,
            toolCall: { ...data.toolCall },
          });
          store.dispatch('artifactChat/setRunningTool', {
            sessionId: props.sessionId,
            messageId: data.assistantMessageId,
            toolCallId: data.toolCall.id,
            running: true,
          });
          store.dispatch('artifactChat/setMessageStatus', {
            sessionId: props.sessionId,
            messageId: data.assistantMessageId,
            status: { type: 'tool', text: `Running ${data.toolCall.name}...` },
          });
          break;

        case 'tool_end': {
          store.dispatch('artifactChat/updateToolCall', {
            sessionId: props.sessionId,
            messageId: data.assistantMessageId,
            toolCallId: data.toolCall.id,
            toolCall: data.toolCall,
          });
          store.dispatch('artifactChat/setRunningTool', {
            sessionId: props.sessionId,
            messageId: data.assistantMessageId,
            toolCallId: data.toolCall.id,
            running: false,
          });

          // Check for frontend events in the tool result (e.g., file_written)
          let toolResult = data.toolCall.result;
          if (typeof toolResult === 'string') {
            try { toolResult = JSON.parse(toolResult); } catch (e) { /* not JSON */ }
          }

          if (toolResult?.frontendEvents) {
            toolResult.frontendEvents.forEach((event) => {
              handleFrontendEvent(event.type, event.data);
            });
          }
          break;
        }

        case 'frontend_event':
          handleFrontendEvent(data.eventType, data.eventData);
          break;

        case 'final_content':
          store.commit('artifactChat/PERSIST_CONVERSATIONS');
          store.dispatch('artifactChat/clearMessageStatus', {
            sessionId: props.sessionId,
            messageId: data.assistantMessageId,
          });
          break;

        case 'error': {
          const errorMsg = {
            id: generateMessageId(),
            role: 'assistant',
            content: `An error occurred: ${data.error}`,
            timestamp: Date.now(),
          };
          store.dispatch('artifactChat/addMessage', { sessionId: props.sessionId, message: errorMsg });
          store.dispatch('artifactChat/setStreaming', false);
          break;
        }

        case 'done':
          store.dispatch('artifactChat/setStreaming', false);
          focusInput();
          break;
      }

      scrollToBottom();
    };

    const handleFrontendEvent = (eventType, eventData) => {
      // Dispatch file_written events so Artifacts screen can update open tabs
      if (eventType === 'file_written') {
        window.dispatchEvent(new CustomEvent('code-file-written', { detail: eventData }));
      }
    };

    const getMessageStatus = (message) => {
      if (!message || message.role !== 'assistant') return null;
      return store.getters['artifactChat/getMessageStatus'](props.sessionId, message.id);
    };

    const getRunningToolsForMessage = (message) => {
      if (!message || !message.toolCalls) return [];
      return store.getters['artifactChat/getRunningToolsForMessage'](props.sessionId, message.id);
    };

    const toggleToolCallExpansion = (messageId, toolCallIndex) => {
      store.dispatch('artifactChat/toggleToolCallExpansion', { sessionId: props.sessionId, messageId, toolCallIndex });
    };

    const focusInput = () => {
      nextTick(() => {
        if (chatInputRef.value) chatInputRef.value.focus();
      });
    };

    watch(() => props.sessionId, () => { setTimeout(scrollToBottom, 100); });

    return {
      chatMessagesRef,
      chatInputRef,
      chatInput,
      formattedChatMessages,
      isProcessing,
      sendChatMessage,
      stopStream,
      toggleToolCallExpansion,
      getMessageStatus,
      getRunningToolsForMessage,
    };
  },
};
</script>

<style scoped>
.artifact-chat-container {
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

.chat-input-container {
  padding: 16px 0 0 2px;
  border-top: 1px solid var(--terminal-border-color);
}

.chat-input-wrapper {
  display: flex;
  gap: 8px;
  align-items: center;
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
  flex-shrink: 0;
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

.chat-stop-button {
  min-width: 40px;
  height: 40px;
  border-radius: 20px;
  border: none;
  background: rgba(255, 107, 107, 0.6);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
}

.chat-stop-button:hover {
  background: rgba(255, 107, 107, 0.8);
  transform: scale(1.05);
}

.artifact-chat-container :deep(.message-wrapper) {
  max-width: 100%;
}
</style>
