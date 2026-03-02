<template>
  <div class="widget-editor-panel" :class="{ fullscreen: isFullScreen }">
    <!-- Add scanline overlay when in fullscreen -->
    <div v-if="isFullScreen" class="scanline-overlay"></div>

    <!-- Panel header with controls -->
    <div class="panel-header">
      <h2 class="title">/ Widget Builder</h2>
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

    <!-- Chat container -->
    <div class="panel-content">
      <WidgetChatContainer :key="widgetId" :widgetId="widgetId" />
    </div>
  </div>
</template>

<script>
import { ref, computed, inject } from 'vue';
import { useStore } from 'vuex';
import WidgetChatContainer from './WidgetChatContainer.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'WidgetForgePanel',
  components: {
    WidgetChatContainer,
    Tooltip,
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const isFullScreen = ref(false);
    const store = useStore();
    const forge = inject('widgetForge');

    const widgetId = computed(() => {
      return forge?.widgetId?.value || 'widget-forge';
    });

    const toggleFullScreen = () => {
      isFullScreen.value = !isFullScreen.value;
      emit('panel-action', 'toggle-fullscreen', isFullScreen.value);

      if (isFullScreen.value) {
        document.body.classList.add('widget-editor-fullscreen');
      } else {
        document.body.classList.remove('widget-editor-fullscreen');
      }
    };

    const handleClearChat = () => {
      const widgetIdToUse = widgetId.value || 'widget-forge';
      store.dispatch('widgetChat/clearConversation', widgetIdToUse);
      emit('panel-action', 'clear-chat');
    };

    return {
      isFullScreen,
      widgetId,
      toggleFullScreen,
      handleClearChat,
    };
  },
};
</script>

<style scoped>
.widget-editor-panel {
  display: flex;
  flex-direction: column;
  background: transparent;
  border: none;
  height: 100%;
  border-radius: 0 0 8px 0;
  padding: 0;
  transition: all 0.3s ease;
  scrollbar-width: none;
  overflow: scroll;
  gap: 16px;
}

.widget-editor-panel.fullscreen {
  position: fixed;
  top: 0;
  left: 0;
  width: calc(100% - 50px);
  height: calc(100% - 50px);
  min-height: calc(100% - 50px);
  background-color: var(--color-popup);
  z-index: 9999;
  padding: 16px;
  margin: 8px;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  overflow-y: auto;
}

.widget-editor-panel.fullscreen .panel-header {
  margin-bottom: 16px;
  padding: 0 0 16px 0;
  position: relative;
  z-index: 2;
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
  align-content: center;
  align-items: center;
  user-select: none;
  padding: 0 0 12px 0;
  border-bottom: 1px solid var(--terminal-border-color-light);
  position: relative;
  z-index: 2;
}

.widget-editor-panel > *:not(.scanline-overlay) {
  position: relative;
  z-index: 2;
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
  flex-wrap: nowrap;
  align-content: center;
  justify-content: flex-end;
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

.tab-button:hover,
.tab-button.active {
  opacity: 1;
}

.tab-name {
  font-size: 0.9em;
}

.clear-chat-button:hover {
  color: rgba(255, 107, 107, 0.8) !important;
}

.clear-chat-button:hover .tab-name {
  color: rgba(255, 107, 107, 0.8);
}

.widget-editor-panel.fullscreen .scanline-overlay {
  display: none;
}
</style>

<style>
body.widget-editor-fullscreen .widgetforge-panel,
body.widget-editor-fullscreen .widget-forge-center-panel {
  z-index: 1 !important;
  pointer-events: none;
  opacity: 0;
}
</style>
