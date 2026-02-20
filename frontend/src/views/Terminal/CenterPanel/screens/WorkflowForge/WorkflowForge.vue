<template>
  <BaseScreen
    ref="baseScreenRef"
    screenId="WorkflowForgeScreen"
    :showInput="false"
    :terminalLines="terminalLines"
    :activeLeftPanel="'WorkflowForgePanel'"
    :leftPanelProps="panelProps"
    :activeRightPanel="activeRightPanel"
    :panelProps="rightPanelProps"
    :class="{ 'fullscreen-panel': !!activeFullscreenPanel }"
    @panel-action="handlePanelAction"
    @screen-change="(screenName) => emit('screen-change', screenName)"
    @base-mounted="initializeScreen"
  >
    <template #default>
      <div class="workflow-terminal-container">
        <!-- <TerminalHeader 
          title="Workflow Designer" 
          subtitle="Design, create, and manage automation workflows."
        /> -->

        <div class="designer-container">
          <WorkflowDesignerComponent
            ref="workflowDesigner"
            @node-selected="handleNodeSelected"
            @edge-selected="handleEdgeSelected"
            @all-deselected="handleAllDeselected"
            @update:nodes="handleNodesUpdate"
            @update:edges="handleEdgesUpdate"
          />
        </div>
      </div>
    </template>
  </BaseScreen>
</template>

<script>
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { useStore } from 'vuex';
import BaseScreen from '../../BaseScreen.vue';
import WorkflowDesignerComponent from './components/WorkflowDesigner/WorkflowDesigner.vue';
import TerminalHeader from '../../../_components/TerminalHeader.vue';
import generateUUID from '@/views/_utils/generateUUID.js';

export default {
  name: 'WorkflowForgeScreen',
  components: { BaseScreen, WorkflowDesignerComponent, TerminalHeader },
  emits: ['screen-change'],
  setup(props, { emit }) {
    const store = useStore();
    const route = useRoute();
    const baseScreenRef = ref(null);
    const workflowDesigner = ref(null);
    const terminalLines = ref([]);

    // Right panel state
    const activeRightPanel = ref(null);
    const selectedNodeContent = ref(null);
    const selectedEdgeContent = ref(null);

    // New Centralized Fullscreen State
    const activeFullscreenPanel = ref(null); // 'left' | 'editor' | null

    // Wait for route to be available before setting workflowId
    const panelProps = ref({
      selectedNodeContent: null,
      selectedEdgeContent: null,
      nodes: [],
      customTools: [],
      workflowId: null, // Will be set after route is available
      activeFullscreenPanel: null,
    });

    // Right panel props for editor
    const rightPanelProps = ref({
      selectedNodeContent: null,
      selectedEdgeContent: null,
      nodes: [],
      edges: [],
      customTools: [],
      workflowId: null,
      backendTools: null, // Tools fetched from backend (includes plugins)
      activeFullscreenPanel: null,
    });

    // Event handlers for workflow designer
    const handleNodeSelected = (node) => {
      selectedNodeContent.value = node;
      // Don't clear edge content here - handled separately by WorkflowDesignerComponent
      // selectedEdgeContent.value = null;
      updatePanelProps();
    };

    const handleEdgeSelected = (edge) => {
      selectedEdgeContent.value = edge;
      // Don't clear node content here - handled separately by WorkflowDesignerComponent
      // selectedNodeContent.value = null;
      updatePanelProps();
    };

    const handleAllDeselected = () => {
      console.log('All deselected event triggered');
      selectedNodeContent.value = null;
      selectedEdgeContent.value = null;
      // DON'T call updatePanelProps - deselection doesn't need to update panels
      // The panel props will be updated on next user interaction
    };

    const handleNodesUpdate = (nodes) => {
      if (workflowDesigner.value) {
        panelProps.value.nodes = nodes;
      }
    };

    const handleEdgesUpdate = (edges) => {
      if (workflowDesigner.value) {
        // Update the designer's edges
        workflowDesigner.value.edges = edges;
        // DON'T call updatePanelProps - edges don't affect panel display
      }
    };

    // Track the initial workflowId to prevent it from changing during canvas interactions
    // IMMEDIATELY check for URL workflowId and set it as initial
    let initialWorkflowId = route.query.id || null;

    // Track last update to prevent duplicate calls
    let lastUpdateProps = null;
    const updatePanelProps = () => {
      nextTick(() => {
        if (workflowDesigner.value) {
          const designer = workflowDesigner.value;
          // ALWAYS check for URL workflowId FIRST - this is the source of truth
          const urlWorkflowId = route.query.id;

          let finalWorkflowId;

          // Priority 1: URL workflowId (highest priority)
          if (urlWorkflowId) {
            finalWorkflowId = urlWorkflowId;
            // Set this as the initial ID to prevent regeneration
            if (!initialWorkflowId) {
              initialWorkflowId = urlWorkflowId;
            }

            // Update the WorkflowDesigner's activeWorkflowId if it exists
            if (designer.activeWorkflowId !== finalWorkflowId) {
              designer.activeWorkflowId = finalWorkflowId;
            }

            // Also update the workflowId property if it exists
            if (designer.workflowId !== finalWorkflowId) {
              designer.workflowId = finalWorkflowId;
            }

            // Save to localStorage
            localStorage.setItem('activeWorkflow', finalWorkflowId);
          }
          // Priority 2: Existing initialWorkflowId
          else if (initialWorkflowId) {
            finalWorkflowId = initialWorkflowId;
          }
          // Priority 3: Get ID from WorkflowDesigner component
          else if (designer.activeWorkflowId) {
            finalWorkflowId = designer.activeWorkflowId;
            initialWorkflowId = finalWorkflowId;
          }
          // NO ID GENERATION - Only use URL, existing, or WorkflowDesigner ID
          else {
            finalWorkflowId = null;
          }

          // Create a hash of the current props to check for duplicates
          const currentPropsHash = JSON.stringify({
            workflowId: finalWorkflowId,
            selectedNode: selectedNodeContent.value?.id,
            selectedEdge: selectedEdgeContent.value?.id,
            activeFullscreenPanel: activeFullscreenPanel.value, // Include fullscreen state in hash
          });

          // Only update if props actually changed
          if (lastUpdateProps !== currentPropsHash) {
            lastUpdateProps = currentPropsHash;

            // Update left panel props (WorkflowForgePanel) - ALWAYS keep as chat view
            panelProps.value = {
              selectedNodeContent: null, // Always null to keep chat view
              selectedEdgeContent: null, // Always null to keep chat view
              nodes: designer.nodes || [],
              edges: designer.edges || [],
              customTools: designer.customTools || [],
              workflowId: finalWorkflowId,
              activeFullscreenPanel: activeFullscreenPanel.value,
            };

            // Update right panel props (editor panel)
            // Only show editor panel when a node or edge is selected
            if (selectedNodeContent.value || selectedEdgeContent.value) {
              activeRightPanel.value = 'WorkflowForgePanel'; // This should be the editor panel
              rightPanelProps.value = {
                selectedNodeContent: selectedNodeContent.value,
                selectedEdgeContent: selectedEdgeContent.value,
                nodes: designer.nodes || [],
                edges: designer.edges || [],
                customTools: designer.customTools || [],
                workflowId: finalWorkflowId,
                backendTools: designer.backendTools || null, // Include backend tools (plugins)
                activeFullscreenPanel: activeFullscreenPanel.value,
              };
            } else {
              // Hide right panel when nothing is selected
              activeRightPanel.value = null;
              rightPanelProps.value = {
                selectedNodeContent: null,
                selectedEdgeContent: null,
                nodes: [],
                edges: [],
                customTools: [],
                workflowId: null,
                backendTools: null,
              };
            }
          }
        }
      });
    };

    // Add a watcher for the workflowDesigner ref
    watch(
      () => workflowDesigner.value,
      (newVal) => {
        if (newVal) {
          console.log('Workflow designer ref updated');
          updatePanelProps();
        }
      }
    );

    // Watch for route changes to immediately set workflowId when available
    watch(
      () => route.query.id,
      (newId, oldId) => {
        // Only update if the ID actually changed
        if (newId !== oldId) {
          console.log('Route query ID changed to:', newId);
          if (newId) {
            // URL has ID - use it
            initialWorkflowId = newId;
            updatePanelProps();
          } else {
            // NO URL ID - clear the cached ID so new workflows work properly
            console.log('Clearing cached initialWorkflowId for new workflow');
            initialWorkflowId = null;
            updatePanelProps();
          }
        }
      },
      { immediate: true }
    );

    // Listen for node-selected events from the designer to keep selectedNodeContent in sync
    // This replaces the expensive deep watcher on the entire nodes array

    // Track if we've already initialized a conversation to prevent reinitialization
    let hasInitializedConversation = false;

    // Function to initialize conversation for a specific workflowId
    const initializeConversationForWorkflow = (workflowId) => {
      if (workflowId && !hasInitializedConversation) {
        console.log('WorkflowForge: Initializing conversation for workflowId:', workflowId);
        // Check if there's already a conversation for this workflowId
        const existingConversation = store.getters['workflowChat/getConversation'](workflowId);
        console.log('WorkflowForge: Existing conversation for workflowId:', workflowId, existingConversation);
        // Initialize conversation only if it doesn't exist or has no messages
        if (!existingConversation || !existingConversation.messages || existingConversation.messages.length === 0) {
          store.dispatch('workflowChat/initializeConversation', workflowId);
          console.log('WorkflowForge: Initialized new conversation for workflowId:', workflowId);
        } else {
          // Conversation already exists, mark as initialized
          console.log('WorkflowForge: Using existing conversation for workflowId:', workflowId);
        }
        hasInitializedConversation = true;
      }
    };

    // Add watcher for workflowId to initialize conversation only once when it becomes available
    watch(
      () => panelProps.value.workflowId,
      (newWorkflowId) => {
        // Only initialize if we're not loading from URL or if there's no URL ID
        const urlWorkflowId = route.query.id;
        if (newWorkflowId && !urlWorkflowId && !hasInitializedConversation) {
          initializeConversationForWorkflow(newWorkflowId);
        }
      }
    );

    // Handle panel actions
    const handlePanelAction = (action, payload) => {
      console.log('WorkflowDesigner: Handling panel action:', action, payload);

      // If closing a panel, we don't need workflowDesigner to be ready
      if (action === 'toggle-fullscreen' && payload.isFullScreen === false) {
        activeFullscreenPanel.value = null;
        document.body.classList.remove('wf-panel-fullscreen');
        document.body.classList.remove('wf-fullscreen-left');
        document.body.classList.remove('wf-fullscreen-editor');
        document.body.classList.remove('workflow-editor-fullscreen');
        document.body.classList.remove('node-editor-expanded');
        updatePanelProps();
        return;
      }

      if (!workflowDesigner.value && action !== 'toggle-fullscreen' && action !== 'clear-chat' && action !== 'edit-workflow') return;

      switch (action) {
        case 'update:nodeContent':
          workflowDesigner.value.updateNodeContent(payload);
          break;
        case 'update:edgeContent':
          workflowDesigner.value.updateEdgeContent(payload);
          break;
        case 'toggle-fullscreen':
          // PAYLOAD is { panel: 'left' | 'editor', isFullScreen: boolean }
          const { panel, isFullScreen } = payload;
          console.log(`WorkflowDesigner: Fullscreen toggle for ${panel}: ${isFullScreen}`);

          if (isFullScreen) {
            activeFullscreenPanel.value = panel;
            document.body.classList.add('wf-panel-fullscreen');
            document.body.classList.add(`wf-fullscreen-${panel}`);

            // Remove other classes just in case
            if (panel === 'left') {
              document.body.classList.remove('wf-fullscreen-editor');
              document.body.classList.remove('node-editor-expanded');
            } else {
              document.body.classList.remove('wf-fullscreen-left');
              document.body.classList.remove('workflow-editor-fullscreen');
            }
          } else {
            activeFullscreenPanel.value = null;
            document.body.classList.remove('wf-panel-fullscreen');
            document.body.classList.remove('wf-fullscreen-left');
            document.body.classList.remove('wf-fullscreen-editor');
            document.body.classList.remove('workflow-editor-fullscreen');
            document.body.classList.remove('node-editor-expanded');
          }
          updatePanelProps();
          break;
        case 'clear-chat':
          // Clear the chat for the current workflow
          console.log('Clearing chat for workflowId:', panelProps.value.workflowId);
          if (panelProps.value.workflowId) {
            store.dispatch('workflowChat/clearConversation', panelProps.value.workflowId);
          }
          break;
        case 'edit-workflow':
          // Handle edit workflow action by navigating to the workflow editor
          console.log('Editing workflow with ID:', payload);
          emit('screen-change', 'WorkflowForgeScreen', { workflowId: payload });
          break;
      }
    };

    // Track if we've already attempted to load the workflow
    let hasAttemptedLoad = false;

    // Load workflow from URL parameter
    const loadWorkflowFromUrl = async () => {
      const workflowId = route.query.id;
      if (workflowId && workflowDesigner.value && !hasAttemptedLoad) {
        hasAttemptedLoad = true;
        try {
          terminalLines.value.push(`Loading workflow ${workflowId}...`);
          console.log('Loading workflow from URL with ID:', workflowId);

          // Update the WorkflowDesigner's activeWorkflowId and workflowId before loading
          if (workflowDesigner.value.activeWorkflowId) {
            workflowDesigner.value.activeWorkflowId = workflowId;
          }
          if (workflowDesigner.value.workflowId) {
            workflowDesigner.value.workflowId = workflowId;
          }

          // Save the URL workflowId to localStorage
          localStorage.setItem('activeWorkflow', workflowId);

          // Call the loadWorkflow method from the WorkflowDesigner component
          await workflowDesigner.value.loadWorkflow(workflowId);

          terminalLines.value.push(`Workflow ${workflowId} loaded successfully.`);

          // Initialize conversation for the loaded workflow
          initializeConversationForWorkflow(workflowId);
        } catch (error) {
          console.error('Error loading workflow from URL:', error);
          terminalLines.value.push(`Error loading workflow: ${error.message}`);
        }
      }
    };

    // Watch for changes in route query parameters
    watch(
      () => route.query.id,
      (newId) => {
        if (newId && workflowDesigner.value) {
          // Reset the flags when the workflow ID changes
          hasAttemptedLoad = false;
          hasInitializedConversation = false;
          // Reload conversations from localStorage when the route changes
          store.dispatch('workflowChat/reloadConversations');
          loadWorkflowFromUrl();
        } else if (!newId && workflowDesigner.value) {
          // If there's no URL ID, ensure we have a conversation for the current workflow
          // This handles the case where we navigate from a URL workflow to a new workflow
          setTimeout(() => {
            if (panelProps.value.workflowId && !hasInitializedConversation) {
              initializeConversationForWorkflow(panelProps.value.workflowId);
            }
          }, 100);
        }
      }
    );

    // --- Initialization ---
    const initializeScreen = async () => {
      console.log('Initializing Workflow Designer Screen');
      document.body.setAttribute('data-page', 'terminal-workflow-designer');
      terminalLines.value = ['Loading Workflow Designer...'];

      // Wait for the workflow designer to be ready, then load workflow if ID is present
      await nextTick();
      if (route.query.id) {
        // Reset the flag when initializing with a workflow ID
        hasAttemptedLoad = false;
        // nextTick is sufficient - the designer ref is available after the first render
        await nextTick();
        loadWorkflowFromUrl();
      }
    };

    // --- Lifecycle Hooks ---
    // Listen for workflow-updated events
    const handleWorkflowUpdated = (event) => {
      if (workflowDesigner.value && event.detail) {
        // Update the workflow designer with the new workflow state
        workflowDesigner.value.handleWorkflowGenerator(event.detail);
        // DON'T call updatePanelProps - let the designer handle it
      }
    };

    // Listen for workflow-started events from chat
    const handleWorkflowStartedFromChat = (event) => {
      console.log('WorkflowForge: Received workflow-started-from-chat event', event.detail);
      if (workflowDesigner.value && event.detail) {
        const { workflowId, status } = event.detail;

        // Update the workflow designer's status
        if (workflowDesigner.value.activeWorkflowId === workflowId) {
          // Trigger the same actions as when starting from WorkflowEngine
          workflowDesigner.value.handleWorkflowStarted();
          // Update workflow status
          workflowDesigner.value.workflowStatus = status || 'listening';
          // Start polling for status updates
          workflowDesigner.value.pollWorkflowStatus();
        }
      }
    };

    // Listen for workflow-stopped events from chat
    const handleWorkflowStoppedFromChat = (event) => {
      console.log('WorkflowForge: Received workflow-stopped-from-chat event', event.detail);
      if (workflowDesigner.value && event.detail) {
        const { workflowId } = event.detail;

        // Update the workflow designer's status
        if (workflowDesigner.value.activeWorkflowId === workflowId) {
          // Trigger the same actions as when stopping from WorkflowEngine
          workflowDesigner.value.handleWorkflowStopped();
        }
      }
    };

    // Handle specific panel fullscreen events from children that don't use emit
    const handleCustomFullscreenToggle = (event) => {
      handlePanelAction('toggle-fullscreen', event.detail);
    };

    onMounted(() => {
      console.log('WorkflowDesigner Screen Mounted');
      // Reload conversations from localStorage when the screen is mounted
      store.dispatch('workflowChat/reloadConversations');
      window.addEventListener('workflow-updated', handleWorkflowUpdated);
      window.addEventListener('workflow-started-from-chat', handleWorkflowStartedFromChat);
      window.addEventListener('workflow-stopped-from-chat', handleWorkflowStoppedFromChat);
      window.addEventListener('panel-fullscreen-toggle', handleCustomFullscreenToggle);
    });

    onUnmounted(() => {
      console.log('WorkflowDesigner Screen Unmounted');
      document.body.removeAttribute('data-page');
      window.removeEventListener('workflow-updated', handleWorkflowUpdated);
      window.removeEventListener('workflow-started-from-chat', handleWorkflowStartedFromChat);
      window.removeEventListener('workflow-stopped-from-chat', handleWorkflowStoppedFromChat);
      window.removeEventListener('panel-fullscreen-toggle', handleCustomFullscreenToggle);
      // Clean up all possible fullscreen classes
      document.body.classList.remove('workflow-panel-fullscreen');
      document.body.classList.remove('workflow-editor-fullscreen');
      document.body.classList.remove('node-editor-expanded');
    });

    // Add isFullScreenPanel to the component state
    const isFullScreenPanel = ref(false);

    return {
      baseScreenRef,
      workflowDesigner,
      initializeScreen,
      terminalLines,
      activeRightPanel,
      panelProps,
      rightPanelProps,
      handlePanelAction,
      handleNodeSelected,
      handleEdgeSelected,
      handleAllDeselected,
      handleNodesUpdate,
      handleEdgesUpdate,
      emit,
      activeFullscreenPanel,
    };
  },
};
</script>

<style scoped>
/* Enhance fullscreen panel CSS */
:deep(.fullscreen-panel .controls-panel) {
  position: fixed !important; /* Use !important to override any other styles */
  top: 0 !important;
  left: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  z-index: 1000 !important; /* Very high z-index to ensure it's above everything */
  background-color: rgba(11, 11, 48, 0.97) !important;
  padding: 24px !important;
  overflow: auto !important;
  border: none !important;
}

.workflow-terminal-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

.designer-container {
  flex: 1;
  position: relative;
  width: 100%;
  height: calc(100% - 60px);
  /* border: 1px solid rgba(18, 224, 255, 0.1);
  border-radius: 4px; */
  overflow: hidden;
  /* background: rgb(11 12 41); */
  /* margin-top: 16px; */
}

/* Keeping these for potential reuse in other components */
.text-bright-green {
  color: var(--color-green);
  text-shadow: 0 0 5px rgba(var(--green-rgb), 0.4);
}

.font-bold {
  font-weight: bold;
}

.text-xl {
  font-size: 1.25rem;
}

.terminal-line {
  line-height: 1.3;
  margin: 0;
  margin-bottom: 4px;
}
</style>

<style>
/* --- GROUND-UP FULLSCREEN REWRITE --- */

/* Unified visibility controller */
/* Use opacity instead of display:none to allow semi-transparent background effect */
body.wf-panel-fullscreen .main-panel,
body.wf-panel-fullscreen .resize-handle,
body.wf-panel-fullscreen .header-bar,
body.wf-panel-fullscreen .designer-container,
body.wf-panel-fullscreen #sidebar-wrapper {
  opacity: 0.15;
  pointer-events: none;
  filter: blur(4px);
  transition: all 0.3s ease;
}

/* When left panel is fullscreen, hide the editor panel */
body.wf-fullscreen-left #editor-panel,
body.wf-fullscreen-left .right-panel-component {
  display: none !important;
}

/* When editor panel is fullscreen, hide the left panel */
body.wf-fullscreen-editor .left-panel,
body.wf-fullscreen-editor .left-panel-component {
  display: none !important;
}

/* High Z-index for the active fullscreen panel container */
/* This ensures the side panels (left/right) containing our components are on top */
body.wf-panel-fullscreen .left-panel-component,
body.wf-panel-fullscreen .right-panel-component {
  position: fixed !important;
  top: 8px !important;
  left: 8px !important;
  width: calc(100vw - 16px) !important;
  height: calc(100vh - 16px) !important;
  z-index: 99999 !important;
  background: var(--color-popup) !important;
  border-radius: 16px !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5) !important;
  border: 1px solid var(--terminal-border-color) !important;
}

/* Specific overrides to ensure the active panel is shown and others hidden */
body.wf-fullscreen-left .left-panel-component {
  display: flex !important;
}
body.wf-fullscreen-editor .right-panel-component {
  display: flex !important;
}

/* Ensure controls panel doesn't interfere with fixed layout */
body.wf-panel-fullscreen .controls-panel {
  z-index: 9999 !important;
  border: none !important;
}

/* --- Existing Styles Cleanup --- */
body[data-page='terminal-workflow-designer'] .node-based-tool {
  height: 100% !important;
  width: 100% !important;
  border: none !important;
  background: transparent !important;
}

body[data-page='terminal-workflow-designer'] .designer-container :deep(.canvas-state-controls) {
  top: 16px;
  right: 16px;
}

body[data-page='terminal-workflow-designer'] .canvas-state-controls {
  position: absolute;
  top: 16px;
  right: 16px;
}

body[data-page='terminal-workflow-designer'] #sidebar-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  padding-right: 16px;
  width: 304px;
}

body[data-page='terminal-workflow-designer'] #sidebar-wrapper.closed {
  width: 64px;
}

body[data-page='terminal-workflow-designer'] #sidebar.closed .close-sidebar-button {
  top: -3px;
  right: -24px;
  transform: rotate(180deg);
  color: var(--color-green);
}

body[data-page='terminal-workflow-designer'] #sidebar .close-sidebar-button {
  color: var(--color-green);
}

body[data-page='terminal-workflow-designer'] #sidebar {
  position: absolute;
  top: 16px;
  left: 16px;
  height: 100%;
  scrollbar-width: none;
}

body[data-page='terminal-workflow-designer'] .inner-sidebar {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  scrollbar-width: none;
}

body[data-page='terminal-workflow-designer'] .node-based-tool {
  border-radius: 0;
}

body[data-page='terminal-workflow-designer'] .designer-container {
  border-radius: 8px 0 0 8px;
}

body[data-page='terminal-workflow-designer'] .close-sidebar-button {
  right: -16px;
}

body.wf-panel-fullscreen {
  overflow: hidden !important;
}
</style>
