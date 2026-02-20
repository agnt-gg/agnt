<template>
  <div class="workflow-editor-panel" :class="{ fullscreen: isFullScreen }">
    <!-- Add scanline overlay when in fullscreen -->
    <div v-if="isFullScreen" class="scanline-overlay"></div>

    <!-- Add the panel header with tab controls -->
    <div class="panel-header">
      <h2 class="title">/ {{ panelTitle }}</h2>
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
        <Tooltip v-if="!selectedNodeContent && !selectedEdgeContent" text="Clear Chat History" width="auto" position="bottom">
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
    <div class="panel-content" v-if="!selectedNodeContent && !selectedEdgeContent">
      <WorkflowChatContainer :key="workflowId" :workflowId="workflowId" :nodes="nodes" :edges="edges" />
    </div>
    <div v-else-if="selectedNodeContent || selectedEdgeContent">
      <template v-if="selectedNodeContent && selectedNodeContent.error">
        <div class="error-message">
          <h3>Error:</h3>
          <p>{{ selectedNodeContent.error }}</p>
        </div>
      </template>

      <!-- Parameters Tab -->
      <div v-if="activeTab === 'parameters'" class="tab-content">
        <div class="form-group">
          <label>Name</label>
          <input type="text" :value="selectedNodeContent?.text || ''" @input="updateNodeName" spellcheck="false" />
        </div>
        <div class="form-group">
          <label>Description</label>
          <p>{{ selectedNodeContent?.description || 'No description available' }}</p>
          <p v-if="selectedNodeContent?.type">
            <strong
              >Tool Docs: <a :href="`/docs/tools/${selectedNodeContent.type}`" target="_blank">{{ selectedNodeContent.type }}</a></strong
            >
          </p>
        </div>
      </div>

      <!-- Outputs Tab -->
      <div v-else-if="activeTab === 'outputs'" class="tab-content">
        <div class="form-group">
          <h3>Node Outputs</h3>
          <p>Output information will be displayed here when available.</p>
        </div>
      </div>

      <!-- Docs Tab -->
      <div v-else-if="activeTab === 'docs'" class="tab-content">
        <div class="form-group">
          <h3>Tool Documentation</h3>
          <p>{{ selectedNodeContent?.description || 'No description available' }}</p>
          <p v-if="selectedNodeContent?.type">
            <strong
              >Tool Docs: <a :href="`/docs/tools/${selectedNodeContent.type}`" target="_blank">{{ selectedNodeContent.type }}</a></strong
            >
          </p>
        </div>
      </div>

      <!-- <PanelTab
        :node-content="selectedNodeContent"
        :edge-content="selectedEdgeContent"
        :active-tab="activeTab"
        :tool-library="toolLibrary"
        :nodes="nodes"
        :node-output="selectedNodeContent ? selectedNodeContent.output : null"
        :customTools="customTools"
        :workflowId="workflowId"
        @update:nodeContent="updateNodeContent"
        @update:edgeContent="updateEdgeContent"
      /> -->
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import WorkflowChatContainer from './WorkflowChatContainer.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'WorkflowForgePanel',
  components: {
    // PanelTab,
    WorkflowChatContainer,
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
    activeFullscreenPanel: {
      type: String,
      default: null,
    },
  },
  emits: ['panel-action', 'update:nodeContent', 'update:edgeContent'],
  setup(props, { emit }) {
    console.log('WorkflowForgePanel: Received workflowId:', props.workflowId);
    const activeTab = ref('parameters');
    const isFullScreen = computed(() => props.activeFullscreenPanel === 'left');

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

    const panelTitle = computed(() => {
      if (props.selectedEdgeContent) {
        return 'Edge Parameters';
      }
      if (props.selectedNodeContent) {
        return props.selectedNodeContent.text || 'Node Properties';
      }
      return 'Workflow Canvas';
    });

    const setActiveTab = (tabName) => {
      activeTab.value = tabName;
    };

    const toggleFullScreen = () => {
      const targetState = !isFullScreen.value;
      console.log('Toggling left panel fullscreen mode to:', targetState);

      // Dispatch custom event for immediate response
      window.dispatchEvent(
        new CustomEvent('panel-fullscreen-toggle', {
          detail: { panel: 'left', isFullScreen: targetState },
        })
      );

      // Also emit for standard propagation
      emit('panel-action', 'toggle-fullscreen', { panel: 'left', isFullScreen: targetState });
    };

    const updateNodeContent = (updatedContent) => {
      emit('panel-action', 'update:nodeContent', updatedContent);
    };

    const updateEdgeContent = (updatedContent) => {
      emit('panel-action', 'update:edgeContent', updatedContent);
    };

    const updateNodeName = (event) => {
      if (props.selectedNodeContent) {
        const updatedContent = {
          ...props.selectedNodeContent,
          text: event.target.value,
        };
        emit('panel-action', 'update:nodeContent', updatedContent);
      }
    };

    const handleClearChat = () => {
      // Emit an event to clear the chat
      emit('panel-action', 'clear-chat');
    };

    onBeforeUnmount(() => {
      if (isFullScreen.value) {
        emit('panel-action', 'toggle-fullscreen', { panel: 'left', isFullScreen: false });
      }
    });

    return {
      activeTab,
      isFullScreen,
      panelTitle,
      tabs,
      visibleTabs,
      setActiveTab,
      toggleFullScreen,
      updateNodeContent,
      updateEdgeContent,
      updateNodeName,
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
  min-height: 100%;
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
  min-height: calc(100% - 40px);
  background-color: var(--color-popup);
  /* Standardized z-index layering */
  z-index: 9999; /* Left Panel expanded */
  padding: 16px;
  margin: 8px;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  overflow-y: auto;
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

.tab-content {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tab-content .form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tab-content .form-group label {
  font-weight: 600;
  color: var(--color-green);
  font-size: 0.9em;
}

.tab-content .form-group input {
  padding: 8px 12px;
  border: 1px solid rgba(18, 224, 255, 0.2);
  border-radius: 6px;
  background: rgba(18, 224, 255, 0.05);
  color: var(--color-light-green);
  font-family: var(--font-family-primary);
}

.tab-content .form-group input:focus {
  outline: none;
  border-color: var(--color-green);
  box-shadow: 0 0 0 2px rgba(18, 224, 255, 0.1);
}

.tab-content .form-group p {
  margin: 0;
  color: var(--color-light-green);
  line-height: 1.5;
}

.tab-content .form-group a {
  color: var(--color-green);
  text-decoration: none;
}

.tab-content .form-group a:hover {
  text-decoration: underline;
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

/* Hide center panel content when WorkflowForge chat is in fullscreen */
/* Force display: none to ensure it's fully hidden and doesn't overlap */
body.workflow-editor-fullscreen .designer-container,
body.workflow-editor-fullscreen .main-panel,
body.workflow-editor-fullscreen #editor-panel {
  display: none !important;
}
</style>
