<template>
  <div class="tool-editor-panel" :class="{ fullscreen: isFullScreen }">
    <!-- Add scanline overlay when in fullscreen -->
    <div v-if="isFullScreen" class="scanline-overlay"></div>

    <!-- Add the panel header with tab controls -->
    <div class="panel-header">
      <h2 class="title">/ {{ panelTitle }}</h2>
      <div class="right-tabs">
        <!-- Show Parameters/Outputs tabs only when a tool element is selected -->
        <button
          v-for="tab in visibleTabs"
          :key="tab.name"
          class="tab-button"
          :class="{ active: activeTab === tab.name }"
          @click="setActiveTab(tab.name)"
        >
          <i :class="tab.icon"></i>
          <span class="tab-name">{{ tab.title }}</span>
        </button>
        <!-- Show clear chat button only when in chat view (no element selected) -->
        <Tooltip v-if="!selectedToolContent && !selectedParameterContent" text="Clear Chat History" width="auto" position="bottom">
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

    <!-- Show chat when nothing is selected -->
    <div class="panel-content" v-if="!selectedToolContent && !selectedParameterContent">
      <ToolChatContainer :key="toolId || 'default'" :toolId="toolId || 'default'" :tools="tools" :customTools="customTools" />
    </div>
    <div v-else-if="selectedToolContent || selectedParameterContent">
      <template v-if="selectedToolContent && selectedToolContent.error">
        <div class="error-message">
          <h3>Error:</h3>
          <p>{{ selectedToolContent.error }}</p>
        </div>
      </template>

      <!-- <PanelTab
        :node-content="selectedToolContent"
        :edge-content="selectedParameterContent"
        :active-tab="activeTab"
        :tool-library="toolLibrary"
        :nodes="tools"
        :node-output="selectedToolContent ? selectedToolContent.output : null"
        :customTools="customTools"
        :workflowId="toolId"
        @update:nodeContent="updateToolContent"
        @update:edgeContent="updateParameterContent"
      /> -->
    </div>
  </div>
</template>

<script>
import { ref, computed, watch } from 'vue';
import { useStore } from 'vuex';
// import PanelTab from '@/views/WorkflowDesigner/components/EditorPanel/components/PanelTab.vue';
import ToolChatContainer from './ToolChatContainer.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
// NOTE: Static toolLibrary import removed - tools are passed via props from parent component

export default {
  name: 'ToolForgePanel',
  components: {
    // PanelTab,
    ToolChatContainer,
    Tooltip,
  },
  props: {
    selectedToolContent: {
      type: Object,
      default: null,
    },
    selectedParameterContent: {
      type: Object,
      default: null,
    },
    tools: {
      type: Array,
      default: () => [],
    },
    customTools: {
      type: Array,
      default: () => [],
    },
    toolId: {
      type: String,
      default: null,
    },
  },
  emits: ['panel-action', 'update:toolContent', 'update:parameterContent', 'testTool', 'saveTool', 'closeDetails'],
  setup(props, { emit }) {
    console.log('ToolForgePanel: Received toolId:', props.toolId);
    const activeTab = ref('parameters');
    const isFullScreen = ref(false);
    const store = useStore();

    // Add watcher for debugging selectedToolContent changes
    watch(
      () => props.selectedToolContent,
      (newContent) => {
        console.log('ToolForgePanel: selectedToolContent changed:', newContent);
        if (newContent && newContent.error) {
          console.log('ToolForgePanel: Tool has error:', newContent.error);
        }
      },
      { deep: true }
    );

    // Add watcher for debugging toolId changes
    watch(
      () => props.toolId,
      (newId, oldId) => {
        console.log('ToolForgePanel: toolId changed from', oldId, 'to', newId);
      }
    );

    const tabs = [
      {
        name: 'parameters',
        icon: 'fas fa-sliders-h',
        title: 'Parameters',
      },
      {
        name: 'outputs',
        icon: 'fas fa-sign-out-alt',
        title: 'Outputs',
      },
    ];

    const visibleTabs = computed(() => {
      // Only show tabs when a tool or parameter is selected
      if (props.selectedToolContent || props.selectedParameterContent) {
        if (props.selectedParameterContent) {
          // For parameters, only show parameters tab
          return tabs.filter((tab) => tab.name === 'parameters');
        }
        // For tools, show all tabs (parameters and outputs)
        return tabs;
      }
      // When in chat view (no selection), show no tabs
      return [];
    });

    const panelTitle = computed(() => {
      if (props.selectedParameterContent) {
        return 'Parameter Settings';
      }
      if (props.selectedToolContent) {
        return props.selectedToolContent.title || 'Tool Properties';
      }
      return 'Tool Forge';
    });

    const setActiveTab = (tabName) => {
      activeTab.value = tabName;
    };

    const toggleFullScreen = () => {
      console.log('Toggling fullscreen mode from:', isFullScreen.value, 'to:', !isFullScreen.value);
      isFullScreen.value = !isFullScreen.value;

      // Pass the event to the parent with the new state
      emit('panel-action', 'toggle-fullscreen', isFullScreen.value);

      // Apply a class to the document body for global styling effects if needed
      if (isFullScreen.value) {
        document.body.classList.add('tool-editor-fullscreen');
      } else {
        document.body.classList.remove('tool-editor-fullscreen');
      }
    };

    const updateToolContent = (updatedContent) => {
      emit('panel-action', 'update:toolContent', updatedContent);
    };

    const updateParameterContent = (updatedContent) => {
      emit('panel-action', 'update:parameterContent', updatedContent);
    };

    const handleClearChat = () => {
      // Clear the chat directly using the store
      const toolIdToUse = props.toolId || 'default';
      store.dispatch('toolChat/clearConversation', toolIdToUse);

      // Also emit the event for any parent handlers
      emit('panel-action', 'clear-chat');
    };

    return {
      activeTab,
      isFullScreen,
      panelTitle,
      tabs,
      visibleTabs,
      setActiveTab,
      toggleFullScreen,
      updateToolContent,
      updateParameterContent,
      handleClearChat,
    };
  },
};
</script>

<style scoped>
.tool-editor-panel {
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

/* Add fullscreen styles */
.tool-editor-panel.fullscreen {
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

.tool-editor-panel.fullscreen .panel-header {
  margin-bottom: 16px;
  padding: 0 0 16px 0;
  position: relative;
  z-index: 2; /* Make sure header is above the scanline */
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
  z-index: 2; /* Make sure header is above the scanline */
}

/* Make sure all content is above scanline overlay */
.tool-editor-panel > *:not(.scanline-overlay) {
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

/* Special styling for the clear chat button */
.clear-chat-button:hover {
  color: rgba(255, 107, 107, 0.8) !important;
}

.clear-chat-button:hover .tab-name {
  color: rgba(255, 107, 107, 0.8);
}

.no-selection-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--color-grey);
  gap: 16px;
  text-align: center;
  padding: 20px;
}

.no-selection-placeholder i {
  font-size: 2.5em;
  opacity: 0.6;
}

.no-selection-placeholder p {
  color: var(--color-light-green);
  max-width: 300px;
}

/* Add a global style for the fullscreen state */
body.tool-editor-fullscreen {
  overflow: hidden; /* Prevent scrolling of the main page when in fullscreen */
}

/* Add scanline overlay styles */
.tool-editor-panel.fullscreen .scanline-overlay {
  display: none;
}

.form-group.output-value p {
  scrollbar-width: thin;
}

.error-message {
  color: var(--color-red);
  margin-bottom: 16px;
}

.error-message h3 {
  margin: 0 0 8px 0;
  color: var(--color-red);
}

.parameter-wrapper h3.label {
  font-size: var(--font-size-sm);
}

.error-message p {
  margin-top: 8px;
  color: var(--color-red);
  font-family: var(--font-family-mono);
  padding: 3px 8px;
  border: 1px solid var(--color-red);
  border-radius: 8px;
  background: rgba(254, 78, 78, 0.1);
  overflow-wrap: anywhere;
}
</style>

<style>
.tool-editor-panel .outputs-wrapper .form-group {
  gap: 8px;
}

/* Global styles to hide center panel content when ToolForge chat is in fullscreen */
body.tool-editor-fullscreen .toolforge-panel,
body.tool-editor-fullscreen .tool-forge-center-panel {
  z-index: 1 !important;
  pointer-events: none;
  opacity: 0;
}
</style>
