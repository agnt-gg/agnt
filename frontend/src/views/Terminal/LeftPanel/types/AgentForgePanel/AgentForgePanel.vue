<template>
  <div class="agent-editor-panel" :class="{ fullscreen: isFullScreen }">
    <!-- Add scanline overlay when in fullscreen -->
    <div v-if="isFullScreen" class="scanline-overlay"></div>

    <!-- Add the panel header with tab controls -->
    <div class="panel-header">
      <h2 class="title">/ {{ panelTitle }}</h2>
      <div class="right-tabs">
        <!-- Show Parameters/Outputs tabs only when an agent element is selected -->
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
        <Tooltip v-if="!selectedAgentContent && !selectedParameterContent" text="Clear Chat History" width="auto">
          <button
            class="tab-button clear-chat-button"
            @click="handleClearChat"
          >
            <i class="fas fa-trash"></i>
            <span class="tab-name">Clear</span>
          </button>
        </Tooltip>
        <Tooltip :text="isFullScreen ? 'Contract Panel' : 'Expand Panel'" width="auto">
          <button
            class="tab-button"
            :class="{ active: isFullScreen }"
            @click="toggleFullScreen"
          >
            <i :class="isFullScreen ? 'fas fa-compress' : 'fas fa-expand'"></i>
          </button>
        </Tooltip>
      </div>
    </div>

    <!-- Show chat when nothing is selected -->
    <div class="panel-content" v-if="!selectedAgentContent && !selectedParameterContent">
      <AgentChatContainer :key="'agent-chat'" :agentId="'agent-chat'" :agents="agents" :customAgents="customAgents" />
    </div>
    <div v-else-if="selectedAgentContent || selectedParameterContent">
      <template v-if="selectedAgentContent && selectedAgentContent.error">
        <div class="error-message">
          <h3>Error:</h3>
          <p>{{ selectedAgentContent.error }}</p>
        </div>
      </template>

      <!-- <PanelTab
        :node-content="selectedAgentContent"
        :edge-content="selectedParameterContent"
        :active-tab="activeTab"
        :agent-library="agentLibrary"
        :nodes="agents"
        :node-output="selectedAgentContent ? selectedAgentContent.output : null"
        :customAgents="customAgents"
        :agentId="agentId"
        @update:nodeContent="updateAgentContent"
        @update:edgeContent="updateParameterContent"
      /> -->
    </div>
  </div>
</template>

<script>
import { ref, computed, watch } from 'vue';
import { useStore } from 'vuex';
// import PanelTab from '@/views/AgentDesigner/components/EditorPanel/components/PanelTab.vue';
import AgentChatContainer from './AgentChatContainer.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'AgentForgePanel',
  components: {
    // PanelTab,
    AgentChatContainer,
    Tooltip,
  },
  props: {
    selectedAgentContent: {
      type: Object,
      default: null,
    },
    selectedParameterContent: {
      type: Object,
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
    agentId: {
      type: String,
      default: null,
    },
  },
  emits: ['panel-action', 'update:agentContent', 'update:parameterContent', 'testAgent', 'saveAgent', 'closeDetails'],
  setup(props, { emit }) {
    console.log('AgentForgePanel: Received agentId:', props.agentId);
    const activeTab = ref('parameters');
    const isFullScreen = ref(false);
    const store = useStore();

    // Add watcher for debugging selectedAgentContent changes
    watch(
      () => props.selectedAgentContent,
      (newContent) => {
        console.log('AgentForgePanel: selectedAgentContent changed:', newContent);
        if (newContent && newContent.error) {
          console.log('AgentForgePanel: Agent has error:', newContent.error);
        }
      },
      { deep: true }
    );

    // Add watcher for debugging agentId changes
    watch(
      () => props.agentId,
      (newId, oldId) => {
        console.log('AgentForgePanel: agentId changed from', oldId, 'to', newId);
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
      // Only show tabs when an agent or parameter is selected
      if (props.selectedAgentContent || props.selectedParameterContent) {
        if (props.selectedParameterContent) {
          // For parameters, only show parameters tab
          return tabs.filter((tab) => tab.name === 'parameters');
        }
        // For agents, show all tabs (parameters and outputs)
        return tabs;
      }
      // When in chat view (no selection), show no tabs
      return [];
    });

    const panelTitle = computed(() => {
      if (props.selectedParameterContent) {
        return 'Parameter Settings';
      }
      if (props.selectedAgentContent) {
        return props.selectedAgentContent.title || 'Agent Properties';
      }
      return 'Agent Builder';
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
        document.body.classList.add('agent-editor-fullscreen');
      } else {
        document.body.classList.remove('agent-editor-fullscreen');
      }
    };

    const updateAgentContent = (updatedContent) => {
      emit('panel-action', 'update:agentContent', updatedContent);
    };

    const updateParameterContent = (updatedContent) => {
      emit('panel-action', 'update:parameterContent', updatedContent);
    };

    const handleClearChat = () => {
      // Clear the chat directly using the store
      // Always use 'agent-chat' for agent management mode
      store.dispatch('agentChat/clearConversation', 'agent-chat');

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
      updateAgentContent,
      updateParameterContent,
      handleClearChat,
    };
  },
};
</script>

<style scoped>
.agent-editor-panel {
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
.agent-editor-panel.fullscreen {
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

.agent-editor-panel.fullscreen .panel-header {
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
.agent-editor-panel > *:not(.scanline-overlay) {
  position: relative;
  z-index: 2;
}

.panel-header .title {
  color: var(--color-green);
  font-family: 'League Spartan', sans-serif;
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
body.agent-editor-fullscreen {
  overflow: hidden; /* Prevent scrolling of the main page when in fullscreen */
}

/* Add scanline overlay styles */
.agent-editor-panel.fullscreen .scanline-overlay {
  display: none;
}

.form-group.output-value p {
  scrollbar-width: thin;
}

.error-message {
  color: #fe4e4e;
  margin-bottom: 16px;
}

.error-message h3 {
  margin: 0 0 8px 0;
  color: #fe4e4e;
}

.parameter-wrapper h3.label {
  font-size: var(--font-size-sm);
}

.error-message p {
  margin-top: 8px;
  color: #fe4e4e;
  font-family: monospace;
  padding: 3px 8px;
  border: 1px solid #fe4e4e;
  border-radius: 8px;
  background: rgba(254, 78, 78, 0.1);
  overflow-wrap: anywhere;
}
</style>

<style>
.agent-editor-panel .outputs-wrapper .form-group {
  gap: 8px;
}

/* Global styles to hide center panel content when AgentForge chat is in fullscreen */
body.agent-editor-fullscreen .agentforge-content,
body.agent-editor-fullscreen .agentforge-panel {
  z-index: 1 !important;
  pointer-events: none;
  opacity: 0;
}
</style>
