<template>
  <div class="workflow-editor-panel" :class="{ fullscreen: isFullScreen }">
    <!-- Add scanline overlay when in fullscreen -->
    <div v-if="isFullScreen" class="scanline-overlay"></div>

    <!-- Add the panel header with tab controls -->
    <div class="panel-header">
      <div class="left-tabs">
        <h2 class="title">/ {{ panelTitle }}</h2>
        <Tooltip :text="isFullScreen ? 'Contract Panel' : 'Expand Panel'" width="auto">
          <button class="tab-button" :class="{ active: isFullScreen }" @click="toggleFullScreen">
            <i :class="isFullScreen ? 'fas fa-compress' : 'fas fa-expand'"></i>
          </button>
        </Tooltip>
      </div>
      <div class="right-tabs">
        <!-- Show Parameters/Outputs tabs only when a node is selected -->
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
        <!-- Show clear chat button only when in chat view (no node selected) -->
        <Tooltip v-if="!selectedNodeContent && !selectedEdgeContent" text="Clear Chat History" width="auto">
          <button class="tab-button clear-chat-button" @click="handleClearChat">
            <i class="fas fa-trash"></i>
            <span class="tab-name">Clear</span>
          </button>
        </Tooltip>
      </div>
    </div>

    <!-- Show chat when nothing is selected -->
    <div class="panel-content" v-if="!selectedNodeContent && !selectedEdgeContent">
      <WorkflowChatContainer :key="workflowId" :workflowId="workflowId" :nodes="nodes" :edges="edges" />

      <!-- Resources Section -->
      <div style="margin-top: 24px; padding: 0 16px">
        <ResourcesSection />
      </div>
    </div>
    <div v-else-if="selectedNodeContent || selectedEdgeContent">
      <template v-if="selectedNodeContent && selectedNodeContent.error">
        <div class="error-message">
          <h3>Error:</h3>
          <p>{{ selectedNodeContent.error }}</p>
        </div>
      </template>

      <PanelTab
        :node-content="selectedNodeContent"
        :edge-content="selectedEdgeContent"
        :active-tab="activeTab"
        :tool-library="toolLibrary"
        :backend-tools="backendTools"
        :nodes="nodes"
        :node-output="selectedNodeContent ? selectedNodeContent.output : null"
        :customTools="customTools"
        :workflowId="workflowId"
        @update:nodeContent="updateNodeContent"
        @update:edgeContent="updateEdgeContent"
      />
    </div>
  </div>
</template>

<script>
import { ref, computed, watch } from 'vue';
import PanelTab from '@/views/Terminal/CenterPanel/screens/WorkflowForge/components/WorkflowDesigner/components/EditorPanel/components/PanelTab.vue';
import WorkflowChatContainer from './_WorkflowChatContainer.vue';
import ResourcesSection from '@/views/_components/common/ResourcesSection.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
// NOTE: toolLibrary is now fetched from backend via Vuex store (tools/fetchWorkflowTools)
// The backendTools prop passed from parent contains the workflow tools

export default {
  name: 'WorkflowForgePanel',
  components: {
    PanelTab,
    WorkflowChatContainer,
    ResourcesSection,
    Tooltip,
  },
  props: {
    selectedNodeContent: {
      type: Object,
      default: null,
    },
    selectedEdgeContent: {
      type: Object,
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
    customTools: {
      type: Array,
      default: () => [],
    },
    workflowId: {
      type: String,
      default: null,
    },
    backendTools: {
      type: Object,
      default: null,
    },
    activeFullscreenPanel: {
      type: String,
      default: null,
    },
  },
  emits: ['panel-action', 'update:nodeContent', 'update:edgeContent'],
  setup(props, { emit }) {
    console.log('WorkflowForgePanel: Received workflowId:', props.workflowId);
    const activeTab = ref('parameters');
    const isFullScreen = computed(() => props.activeFullscreenPanel === 'editor');

    // Add watcher for debugging selectedNodeContent changes
    watch(
      () => props.selectedNodeContent,
      (newContent) => {
        console.log('WorkflowForgePanel: selectedNodeContent changed:', newContent);
        if (newContent && newContent.error) {
          console.log('WorkflowForgePanel: Node has error:', newContent.error);
        }
      },
      { deep: true }
    );

    // Add watcher for debugging workflowId changes
    watch(
      () => props.workflowId,
      (newId, oldId) => {
        console.log('WorkflowForgePanel: workflowId changed from', oldId, 'to', newId);
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
      {
        name: 'docs',
        icon: 'fas fa-file-alt',
        title: 'Docs',
      },
    ];

    const visibleTabs = computed(() => {
      // Only show tabs when a node or edge is selected
      if (props.selectedNodeContent || props.selectedEdgeContent) {
        if (props.selectedEdgeContent) {
          // For edges, only show parameters tab
          return tabs.filter((tab) => tab.name === 'parameters');
        }
        // For nodes, show all tabs (parameters and outputs)
        return tabs;
      }
      // When in chat view (no selection), show no tabs
      return [];
    });

    // Watch for selection changes to always start with parameters tab
    // Only reset when selecting a NEW node/edge, not when content updates
    let lastSelectedNodeId = null;
    let lastSelectedEdgeId = null;

    watch(
      () => props.selectedNodeContent,
      (newNodeContent, oldNodeContent) => {
        if (newNodeContent && (!oldNodeContent || newNodeContent.id !== lastSelectedNodeId)) {
          activeTab.value = 'parameters';
          lastSelectedNodeId = newNodeContent.id;
        }
      }
    );

    watch(
      () => props.selectedEdgeContent,
      (newEdgeContent, oldEdgeContent) => {
        if (newEdgeContent && (!oldEdgeContent || newEdgeContent.id !== lastSelectedEdgeId)) {
          activeTab.value = 'parameters';
          lastSelectedEdgeId = newEdgeContent.id;
        }
      }
    );

    // Watch for changes in visibleTabs to ensure activeTab is always valid
    watch(
      () => visibleTabs.value,
      (newVisibleTabs) => {
        // If current activeTab is not in the new visible tabs, switch to the first available tab
        if (newVisibleTabs.length > 0 && !newVisibleTabs.some((tab) => tab.name === activeTab.value)) {
          activeTab.value = newVisibleTabs[0].name;
        }
      },
      { immediate: true } // Run immediately to validate initial state
    );

    const panelTitle = computed(() => {
      if (props.selectedEdgeContent) {
        return 'Edge Parameters';
      }
      if (props.selectedNodeContent) {
        return props.selectedNodeContent.text || 'Node Properties';
      }
      return 'Workflow Assistant';
    });

    const setActiveTab = (tabName) => {
      activeTab.value = tabName;
    };

    const toggleFullScreen = () => {
      const targetState = !isFullScreen.value;
      console.log('Toggling editor (right panel) fullscreen mode to:', targetState);

      // Dispatch custom event for immediate response
      window.dispatchEvent(
        new CustomEvent('panel-fullscreen-toggle', {
          detail: { panel: 'editor', isFullScreen: targetState },
        })
      );

      emit('panel-action', 'toggle-fullscreen', { panel: 'editor', isFullScreen: targetState });
    };

    const updateNodeContent = (updatedContent) => {
      emit('panel-action', 'update:nodeContent', updatedContent);
    };

    const updateEdgeContent = (updatedContent) => {
      emit('panel-action', 'update:edgeContent', updatedContent);
    };

    const handleClearChat = () => {
      // Emit an event to clear the chat
      emit('panel-action', 'clear-chat');
    };

    // Use backendTools prop as the tool library (passed from parent, fetched from Vuex)
    const toolLibrary = computed(
      () =>
        props.backendTools || {
          triggers: [],
          actions: [],
          utilities: [],
          widgets: [],
          controls: [],
          custom: [],
        }
    );

    return {
      activeTab,
      isFullScreen,
      panelTitle,
      toolLibrary,
      tabs,
      visibleTabs,
      setActiveTab,
      toggleFullScreen,
      updateNodeContent,
      updateEdgeContent,
      handleClearChat,
    };
  },
};
</script>

<style scoped>
.workflow-editor-panel {
  display: flex;
  flex-direction: column;
  background: transparent;
  border: none;
  min-height: calc(100% - 34px);
  height: fit-content;
  border-radius: 0 0 8px 0;
  padding: 0;
  transition: all 0.3s ease;
  scrollbar-width: none;
  overflow: scroll;
  gap: 16px;
}

/* Add fullscreen styles */
.workflow-editor-panel.fullscreen {
  position: fixed;
  top: 0;
  left: 0;
  width: calc(100% - 50px);
  height: calc(100% - 50px);
  min-height: calc(100% - 50px);
  background-color: var(--color-popup);
  z-index: 1000;
  padding: 16px;
  margin: 8px;
  border-radius: 16px;
  box-shadow: none;
  overflow-y: auto;
  opacity: 0.9;
}

.workflow-editor-panel.fullscreen .panel-header {
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
  min-height: 0;
}

.panel-header {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  flex-wrap: nowrap;
  align-content: flex-start;
  align-items: flex-start;
  user-select: none;
  padding: 0 0 16px 0;
  border-bottom: 1px solid var(--terminal-border-color);
  position: relative;
  z-index: 2; /* Make sure header is above the scanline */
  gap: 8px;
}

/* Make sure all content is above scanline overlay */
.workflow-editor-panel > *:not(.scanline-overlay) {
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
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding-top: 6px;
}

.left-tabs {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--terminal-border-color);
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
body.workflow-editor-fullscreen {
  overflow: hidden; /* Prevent scrolling of the main page when in fullscreen */
}

/* Add scanline overlay styles */
.workflow-editor-panel.fullscreen .scanline-overlay {
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

/* Responsive styles for 1200px screens (MacBook Air) */
/* Stack title and tabs vertically for better readability */
@media (max-width: 1400px) {
  .panel-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .panel-header .title {
    width: 100%;
  }

  .right-tabs {
    width: 100%;
    justify-content: flex-start;
    gap: 12px;
  }
}
</style>

<style>
.workflow-editor-panel .outputs-wrapper .form-group {
  gap: 8px;
}
</style>
