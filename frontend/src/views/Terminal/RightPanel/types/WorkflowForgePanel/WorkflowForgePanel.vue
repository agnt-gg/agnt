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
      </div>
    </div>

    <!-- Nothing selected: THIS WORKFLOW. Annie's chat lives in the left panel
         (LeftPanel/types/WorkflowForgePanel); this slot used to repeat it or,
         worse, fall back to the Chat screen's panel. Now it is the graph as a
         list — click a step to select it on the canvas — plus the last runs. -->
    <div class="panel-content wf-summary" v-if="!selectedNodeContent && !selectedEdgeContent">
      <div class="wf-sum-sec">
        <div class="wf-sum-hd">Steps <span class="wf-sum-ln"></span><span class="wf-sum-n">{{ nodes.length }}</span></div>
        <div v-if="!nodes.length" class="wf-sum-empty">Drag a tool from the palette, or ask Annie on the left what this workflow should do.</div>
        <div v-else class="wf-steps">
          <div class="wf-spine"></div>
          <button v-for="(n, i) in orderedNodes" :key="n.id" type="button" class="wf-step" :class="'is-' + (n.category || 'action')" @click="$emit('panel-action', 'select-node', n.id)">
            <span class="wf-step-ty">{{ i + 1 }} · {{ n.category || n.type }}</span>
            <span class="wf-step-nm">{{ n.text || n.title || n.type }}</span>
          </button>
        </div>
      </div>
      <div class="wf-sum-sec">
        <div class="wf-sum-hd">Last runs <span class="wf-sum-ln"></span><span class="wf-sum-n">{{ lastRuns.length }}</span></div>
        <div v-if="!lastRuns.length" class="wf-sum-empty">No runs yet. ▶ in the toolbar runs it once.</div>
        <button v-for="r in lastRuns" :key="r.id" type="button" class="wf-run" @click="$emit('panel-action', 'navigate', { screen: 'TracesScreen', opts: { selectedExecutionId: r.id } })">
          <span class="wf-run-st" :class="'st-' + String(r.status || '').toLowerCase()">{{ r.status }}</span>
          <span class="wf-run-when">{{ relTime(r.started_at || r.startTime || r.created_at) }}</span>
        </button>
      </div>
      <div class="wf-sum-sec">
        <div class="wf-sum-hd">Inspector <span class="wf-sum-ln"></span></div>
        <div class="wf-sum-empty">Click a node for its Parameters · Outputs · Docs, or an edge for its conditions. Esc comes back here.</div>
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
import { useStore } from 'vuex';
import PanelTab from '@/views/Terminal/CenterPanel/screens/WorkflowForge/components/WorkflowDesigner/components/EditorPanel/components/PanelTab.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'WorkflowForgePanel',
  components: {
    PanelTab,
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
    const store = useStore();
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

    const nodeLabelById = (id) => {
      const n = (props.nodes || []).find((x) => x.id === id);
      return n ? n.text || n.title || n.type || id : id;
    };

    const panelTitle = computed(() => {
      if (props.selectedEdgeContent) {
        // Name both ends: "Timer Trigger → AI LLM Call", not "Edge Parameters".
        const e = props.selectedEdgeContent;
        const from = e.source || e.from || e.start || e.sourceId;
        const to = e.target || e.to || e.end || e.targetId;
        return from && to ? `${nodeLabelById(from)} → ${nodeLabelById(to)}` : 'Edge conditions';
      }
      if (props.selectedNodeContent) {
        return props.selectedNodeContent.text || 'Node Properties';
      }
      return 'This workflow';
    });

    // Summary data for the nothing-selected state.
    const orderedNodes = computed(() => {
      const list = [...(props.nodes || [])];
      // Triggers first, then by canvas position (top-left to bottom-right).
      return list.sort((a, b) => {
        const ta = a.category === 'trigger' ? 0 : 1;
        const tb = b.category === 'trigger' ? 0 : 1;
        if (ta !== tb) return ta - tb;
        return (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0);
      });
    });
    const lastRuns = computed(() => {
      if (!props.workflowId) return [];
      const get = store.getters['executionHistory/getExecutionsByWorkflowId'];
      return (get ? get(props.workflowId) : []).slice(0, 5);
    });
    const relTime = (d) => {
      if (!d) return '';
      const diff = (Date.now() - new Date(d).getTime()) / 1000;
      if (!Number.isFinite(diff)) return '';
      if (diff < 60) return 'just now';
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      return `${Math.floor(diff / 86400)}d ago`;
    };

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
      orderedNodes,
      lastRuns,
      relTime,
    };
  },
};
</script>

<style scoped>
/* ── This workflow (nothing selected) ── */
.wf-summary {
  padding: 12px 12px 16px;
  overflow: auto;
}
.wf-sum-sec {
  margin-bottom: 16px;
}
.wf-sum-hd {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 9.5px;
  letter-spacing: 0.17em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin-bottom: 8px;
}
.wf-sum-ln {
  flex: 1;
  height: 1px;
  background: var(--terminal-border-color);
}
.wf-sum-n {
  font-size: 10px;
  letter-spacing: 0;
}
.wf-sum-empty {
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-muted);
}
.wf-steps {
  position: relative;
  padding-left: 26px;
}
.wf-spine {
  position: absolute;
  left: 10px;
  top: 12px;
  bottom: 18px;
  width: 2px;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--color-green), rgba(18, 224, 255, 0.55));
}
.wf-step {
  position: relative;
  display: block;
  width: 100%;
  text-align: left;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--terminal-border-color);
  border-radius: 10px;
  padding: 6px 10px;
  margin-bottom: 8px;
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
}
.wf-step:hover {
  border-color: rgba(var(--green-rgb), 0.45);
}
.wf-step::before {
  content: '';
  position: absolute;
  left: -21px;
  top: 12px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--color-background);
  border: 2px solid var(--color-blue, #12e0ff);
}
.wf-step.is-trigger::before {
  border-color: var(--color-green);
  background: var(--color-green);
}
.wf-step.is-control::before,
.wf-step.is-utility::before {
  border-color: var(--color-yellow, #ffd700);
}
.wf-step-ty {
  display: block;
  font-size: 8.5px;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
.wf-step-nm {
  display: block;
  font-size: 12.5px;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.wf-run {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 0;
  border: 0;
  border-bottom: 1px solid var(--terminal-border-color);
  background: none;
  color: var(--color-text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.wf-run:last-child {
  border-bottom: 0;
}
.wf-run-st {
  font-size: 9px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  padding: 0 7px;
  height: 18px;
  line-height: 18px;
  border-radius: 4px;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
}
.wf-run-st.st-completed,
.wf-run-st.st-success {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.3);
}
.wf-run-st.st-failed,
.wf-run-st.st-error {
  color: #ff8a8a;
  border-color: rgba(254, 78, 78, 0.3);
}
.wf-run-st.st-running {
  color: var(--color-blue, #12e0ff);
  border-color: rgba(18, 224, 255, 0.3);
}
.wf-run-when {
  margin-left: auto;
  font-size: 10px;
  color: var(--color-text-muted);
}

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
  color: var(--color-red) !important;
}

.clear-chat-button:hover .tab-name {
  color: var(--color-red);
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
