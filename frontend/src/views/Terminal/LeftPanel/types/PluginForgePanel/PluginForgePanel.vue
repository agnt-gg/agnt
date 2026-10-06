<!-- PluginForgePanel — the Plugin Forge chat. Widget Forge's panel, same
     chrome and the same UnifiedChatContainer; the difference is the context
     (usePluginChatContext) and the tools the backend gives a `plugin` chat.

     The Forge pane hands it messages to send (Ask to fix) through
     PLUGIN_FORGE_ASK_EVENT (see usePluginChatContext). -->
<template>
  <div class="plugin-forge-panel" :class="{ fullscreen: isFullScreen }">
    <div class="panel-header">
      <h2 class="title">/ Annie</h2>
      <div class="right-tabs">
        <Tooltip text="Clear Chat History" width="auto" position="bottom">
          <button class="tab-button clear-chat-button" @click="handleClearChat">
            <i class="fas fa-trash"></i>
            <span class="tab-name">Clear</span>
          </button>
        </Tooltip>
        <Tooltip :text="isFullScreen ? 'Contract Panel' : 'Expand Panel'" width="auto" position="bottom">
          <button class="tab-button" :class="{ active: isFullScreen }" @click="toggleFullScreen">
            <i :class="isFullScreen ? 'fas fa-compress' : 'fas fa-expand'"></i>
          </button>
        </Tooltip>
      </div>
    </div>

    <div class="panel-content">
      <!-- This panel renders its own Clear button in the header above. -->
      <UnifiedChatContainer
        ref="chatRef"
        :show-clear-action="false"
        :key="chatChannelKey"
        :channel-key="chatChannelKey"
        :chat-type="chatChatType"
        :page-context="chatPageContext"
        :page-state="chatPageState"
        :on-frontend-event="chatOnFrontendEvent"
        :welcome-message="WELCOME"
        empty-icon="fas fa-plug"
        placeholder="Describe a plugin, or ask for a change…"
        :initial-suggestions="initialSuggestions"
        suggestions-context-label="plugin"
      />
    </div>
    <SimpleModal ref="confirmModal" />
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted } from 'vue';
import { useStore } from 'vuex';
import UnifiedChatContainer from '@/views/_components/chat/UnifiedChatContainer.vue';
import { usePluginChatContext, PLUGIN_FORGE_ASK_EVENT } from '@/composables/chat/usePluginChatContext.js';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

const WELCOME =
  "Hi! I'm Annie. Tell me what your plugin should do and I'll write it, install it and test it with you. Ask me anything about the plugin as we go.";

const initialSuggestions = [
  { id: 'plugin-notion', text: 'Connect to Notion so agents can create pages and search my workspace', icon: '📝' },
  { id: 'plugin-slack', text: 'Send and read Slack messages in channels and DMs', icon: '💬' },
  { id: 'plugin-rest', text: 'Wrap a REST API as plugin tools', icon: '🔌' },
];

export default {
  name: 'PluginForgePanel',
  components: { UnifiedChatContainer, SimpleModal, Tooltip },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    const isFullScreen = ref(false);
    const chatRef = ref(null);
    const confirmModal = ref(null);

    const {
      channelKey: chatChannelKey,
      chatType: chatChatType,
      pageContext: chatPageContext,
      pageState: chatPageState,
      onFrontendEvent: chatOnFrontendEvent,
    } = usePluginChatContext();

    const toggleFullScreen = () => {
      isFullScreen.value = !isFullScreen.value;
      emit('panel-action', 'toggle-fullscreen', isFullScreen.value);
    };

    const handleClearChat = async () => {
      const confirmed = await confirmModal.value?.showModal({
        title: 'Clear Chat?',
        message: 'This deletes the conversation. The plugin draft is not affected.',
        confirmText: 'Clear',
        confirmClass: 'btn-danger',
      });
      if (!confirmed) return;
      store.dispatch('chatUnified/clearConversation', {
        channelKey: chatChannelKey.value,
        welcomeMessage: { id: `plugin-welcome-${Date.now()}`, role: 'assistant', content: WELCOME, timestamp: Date.now() },
      });
      emit('panel-action', 'clear-chat');
    };

    // Ask to fix (and anything else the Forge pane wants said) arrives here.
    const onAsk = (event) => {
      const text = typeof event?.detail?.text === 'string' ? event.detail.text.trim() : '';
      if (text) chatRef.value?.executeSuggestion?.({ text });
    };
    onMounted(() => window.addEventListener(PLUGIN_FORGE_ASK_EVENT, onAsk));
    onUnmounted(() => window.removeEventListener(PLUGIN_FORGE_ASK_EVENT, onAsk));

    return {
      WELCOME,
      initialSuggestions,
      isFullScreen,
      chatRef,
      confirmModal,
      toggleFullScreen,
      handleClearChat,
      chatChannelKey,
      chatChatType,
      chatPageContext,
      chatPageState,
      chatOnFrontendEvent,
    };
  },
};
</script>

<style scoped>
.plugin-forge-panel {
  display: flex;
  flex-direction: column;
  background: transparent;
  height: 100%;
  padding: 0;
  gap: 16px;
  overflow: hidden;
}

.plugin-forge-panel.fullscreen {
  position: fixed;
  inset: 8px;
  background-color: var(--color-popup);
  z-index: 9999;
  padding: 16px;
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
}

.panel-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  user-select: none;
  padding: 0 0 12px 0;
  border-bottom: 1px solid var(--terminal-border-color-light);
}

.panel-header .title {
  color: var(--text-green);
  font-family: var(--font-family-primary);
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0.48px;
  margin: 0;
}

.right-tabs {
  display: flex;
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
  color: var(--text-green);
  display: flex;
  align-items: center;
  gap: 6px;
}

.tab-button:hover,
.tab-button.active {
  opacity: 1;
}

.tab-name {
  font-size: 0.9em;
}

/* Clear-chat is a destructive action — always red, not green like other tabs. */
.clear-chat-button,
.clear-chat-button .tab-name {
  color: var(--color-red);
}
</style>
