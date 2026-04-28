<template>
  <div class="artifacts-panel">
    <div class="panel-header">
      <h2 class="title">/ Artifacts</h2>
      <div class="right-tabs">
        <Tooltip text="Clear Chat History" width="auto" position="bottom">
          <button class="tab-button clear-chat-button" @click="handleClearChat">
            <i class="fas fa-trash"></i>
            <span class="tab-name">Clear</span>
          </button>
        </Tooltip>
      </div>
    </div>

    <div class="panel-content">
      <UnifiedChatContainer
        :channel-key="chatChannelKey"
        :chat-type="chatChatType"
        :page-context="chatPageContext"
        :page-state="chatPageState"
        :on-frontend-event="chatOnFrontendEvent"
        welcome-message="Hi! I'm Annie, your artifacts assistant. I can help you create, edit, and explore files — code, docs, charts, and more!"
        empty-icon="fas fa-cube"
        placeholder="Ask about code, create files..."
        :initial-suggestions="initialArtifactSuggestions"
        suggestions-context-label="artifact"
      />
    </div>
    <SimpleModal ref="confirmModal" />
  </div>
</template>

<script>
import { ref, computed } from 'vue';
import { useStore } from 'vuex';
import UnifiedChatContainer from '@/views/_components/chat/UnifiedChatContainer.vue';
import { useArtifactChatContext } from '@/composables/chat/useArtifactChatContext.js';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

const initialArtifactSuggestions = [
  { id: 'artifact-1', text: 'Create new file', icon: '📄' },
  { id: 'artifact-2', text: 'List my files', icon: '📁' },
];

export default {
  name: 'ArtifactsPanel',
  components: { UnifiedChatContainer, SimpleModal, Tooltip },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    const sessionId = 'artifacts';
    const {
      channelKey: chatChannelKey,
      chatType: chatChatType,
      pageContext: chatPageContext,
      pageState: chatPageState,
      onFrontendEvent: chatOnFrontendEvent,
    } = useArtifactChatContext({ sessionId });

    const confirmModal = ref(null);
    const handleClearChat = async () => {
      const confirmed = await confirmModal.value?.showModal({
        title: 'Clear Chat?',
        message: 'This will permanently delete the conversation history for this chat.',
        confirmText: 'Clear',
        confirmClass: 'btn-danger',
      });
      if (!confirmed) return;
      store.dispatch('chatUnified/clearConversation', {
        channelKey: chatChannelKey.value,
        welcomeMessage: {
          id: `artifact-welcome-${Date.now()}`,
          role: 'assistant',
          content:
            "Hi! I'm Annie, your artifacts assistant. I can help you create, edit, and explore files in your workspace — code, documents, visualizations, and more. What would you like to work on?",
          timestamp: Date.now(),
        },
      });
      emit('panel-action', 'clear-chat');
    };

    return {
      chatChannelKey,
      chatChatType,
      chatPageContext,
      chatPageState,
      chatOnFrontendEvent,
      handleClearChat,
      confirmModal,
      initialArtifactSuggestions,
    };
  },
};
</script>

<style scoped>
.artifacts-panel {
  display: flex;
  flex-direction: column;
  background: transparent;
  border: none;
  height: 100%;
  padding: 0;
  gap: 16px;
  overflow: hidden;
}

.panel-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  flex-wrap: nowrap;
  align-items: center;
  user-select: none;
  padding: 0 0 12px 0;
  border-bottom: 1px solid var(--terminal-border-color-light);
}

.panel-header .title {
  color: var(--color-green);
  font-family: var(--font-family-primary);
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0.48px;
  margin: 0;
}

.right-tabs {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16px;
}

.tab-button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  opacity: 0.5;
  transition: opacity 0.3s ease;
  color: var(--color-green);
  display: flex;
  align-items: center;
  gap: 6px;
}

.tab-button:hover {
  opacity: 1;
}

.tab-name {
  font-size: 0.9em;
}

/* Clear-chat is a destructive action — always red, not green like other tabs. */
.clear-chat-button,
.clear-chat-button .tab-name {
  color: var(--color-red, #ff6b6b);
}
.clear-chat-button:hover,
.clear-chat-button:hover .tab-name {
  color: var(--color-red, #ff6b6b);
}
</style>
