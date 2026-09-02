<template>
  <div class="artifacts-panel">
    <div class="panel-header">
      <h2 class="title">/ Outputs</h2>
      <div class="right-tabs">
        <!-- By source: every output grouped by what produced it. Annie: the
             artifacts chat. Remembered per user. -->
        <div class="ap-seg" role="tablist">
          <button role="tab" class="ap-seg-btn" :class="{ on: view === 'sources' }" @click="view = 'sources'">By source</button>
          <button role="tab" class="ap-seg-btn" :class="{ on: view === 'annie' }" @click="view = 'annie'">Annie</button>
        </div>
        <Tooltip v-if="view === 'annie'" text="Clear Chat History" width="auto" position="bottom">
          <button class="tab-button clear-chat-button" @click="handleClearChat">
            <i class="fas fa-trash"></i>
            <span class="tab-name">Clear</span>
          </button>
        </Tooltip>
      </div>
    </div>

    <div v-if="view === 'sources'" class="panel-content ap-sources">
      <OutputSources @open="openOutput" />
    </div>

    <div v-else class="panel-content">
      <!-- This panel renders its own Clear button in the header above. -->
      <UnifiedChatContainer
        :show-clear-action="false"
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
import { ref, computed, watch } from 'vue';
import { useStore } from 'vuex';
import UnifiedChatContainer from '@/views/_components/chat/UnifiedChatContainer.vue';
import OutputSources from './OutputSources.vue';
import { useArtifactChatContext } from '@/composables/chat/useArtifactChatContext.js';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

const initialArtifactSuggestions = [
  { id: 'artifact-1', text: 'Create new file', icon: '📄' },
  { id: 'artifact-2', text: 'List my files', icon: '📁' },
];

export default {
  name: 'ArtifactsPanel',
  components: { UnifiedChatContainer, SimpleModal, Tooltip, OutputSources },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();

    const VIEW_KEY = 'agnt:outputs:leftView';
    const view = ref(
      (() => {
        try {
          return localStorage.getItem(VIEW_KEY) === 'annie' ? 'annie' : 'sources';
        } catch {
          return 'sources';
        }
      })(),
    );
    watch(view, (v) => {
      try {
        localStorage.setItem(VIEW_KEY, v);
      } catch {
        // survivable
      }
    });
    // An output row: the screen decides how to open it (file → editor tab,
    // conversation → that chat). See Artifacts.vue handlePanelAction.
    const openOutput = (o) => emit('panel-action', 'open-output', o);
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
      view,
      openOutput,
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
.ap-seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 7px;
}
.ap-seg-btn {
  border: 0;
  border-radius: 5px;
  background: none;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 10.5px;
  font-weight: 500;
  padding: 3px 8px;
  cursor: pointer;
  white-space: nowrap;
}
.ap-seg-btn.on {
  color: var(--color-green);
  background: rgba(var(--green-rgb), 0.14);
}
.ap-sources {
  overflow: auto;
  padding-top: 4px;
}
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
