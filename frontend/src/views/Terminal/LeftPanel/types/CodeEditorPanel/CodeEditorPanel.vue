<template>
  <div class="code-editor-panel">
    <div class="panel-header">
      <h2 class="title">/ Code Editor</h2>
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
      <CodeChatContainer :sessionId="sessionId" />
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';
import CodeChatContainer from './CodeChatContainer.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'CodeEditorPanel',
  components: { CodeChatContainer, Tooltip },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    const sessionId = 'code-editor';

    const handleClearChat = () => {
      store.dispatch('codeChat/clearConversation', sessionId);
      emit('panel-action', 'clear-chat');
    };

    return { sessionId, handleClearChat };
  },
};
</script>

<style scoped>
.code-editor-panel {
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

.clear-chat-button:hover {
  color: rgba(255, 107, 107, 0.8) !important;
}
</style>
