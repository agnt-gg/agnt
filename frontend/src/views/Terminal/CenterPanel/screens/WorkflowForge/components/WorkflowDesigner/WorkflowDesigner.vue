<template>
  <div class="node-based-tool">
    <!-- <div class="scanline-overlay"></div> -->
    <!-- <LoadingOverlay v-if="isLoading" /> -->
    <ToolSidebar></ToolSidebar>
    <div class="canvas-state-controls">
      <div id="workflow-name">{{ workflowName }}</div>

      <WorkflowGenerator
        @workflow-generated="handleWorkflowGenerator"
        @update-active-workflow-id="updateActiveWorkflowId"
        @workflow-save-requested-silent="saveCanvasState(true, false)"
      ></WorkflowGenerator>
      <WorkflowEngine
        :edges="edges"
        :canvasRef="canvasRef"
        :workflowId="activeWorkflowId"
        :workflowStatus="workflowStatus"
        @workflow-save-requested="handleWorkflowSaveRequested"
        @animation-state-changed="updateAnimationState"
        @workflow-started="handleWorkflowStarted"
        @workflow-error="handleWorkflowError"
        @workflow-stopped="handleWorkflowStopped"
        @workflow-id-set="setActiveWorkflowId"
        @workflow-status-update="handleWorkflowStatusUpdate"
      />
      <Tooltip text="Save Workflow" width="auto" position="bottom">
        <button id="save-workflow" @click="saveCanvasState(false, false)">
          <i class="fas fa-save"></i>
        </button>
      </Tooltip>
      <WorkflowActionsMenu
        :isShareable="isShareable"
        @toggle-shareable="toggleShareable"
        @copy-url="copyShareUrl"
        @import-workflow-id="importWorkflow"
        @import-workflow-json="loadCanvasState"
        @export-workflow-json="exportWorkflow"
        @delete-workflow="deleteWorkflow"
        @cloud-sync="handleCloudSync"
      />
    </div>

    <CanvasViewControls :isTinyNodeMode="isTinyNodeMode" @toggle-tiny-node-mode="toggleTinyNodeMode" />
    <Canvas
      ref="canvas"
      :nodes="nodes"
      :edges="edges"
      :gridSize="gridSize"
      :isAnimating="isAnimating"
      :zoomLevel="zoomLevel"
      :selectedEdgeId="selectedEdgeId"
      :selectedNodeIndex="selectedNodeIndex"
      :isTinyNodeMode="isTinyNodeMode"
      :nodeWidth="nodeWidth"
      @update:nodes="nodes = $event"
      @update:edges="edges = $event"
      @update:zoomLevel="zoomLevel = $event"
      @select-node="selectNode"
      @select-edge="selectEdge"
      @deselect-all-nodes="deselectAllNodes"
      @deselect-all-edges="deselectAllEdges"
      @create-edge="createEdge"
      @update-edges="updateEdges"
      @create-node="createNode"
      @start-editing="startEditing"
      @finish-editing="finishEditing"
      @delete-node="deleteNode"
      @delete-selected-edge="deleteSelectedEdge"
      @delete-selected-node="deleteSelectedNode"
    />
    <!-- <AgentChat /> -->
  </div>
  <div id="generating-modal" class="modal" style="display: none; user-select: none">
    <div class="modal-content">
      <p>Generating Workflow, Please Wait...</p>
    </div>
  </div>
  <PopupTutorial :config="tutorialConfig" :startTutorial="startTutorial" tutorialId="workflowDesigner" @close="onTutorialClose" />
  <SimpleModal ref="modal" />
</template>

<script>
import { useRoute } from 'vue-router';
import { ref, onMounted, watch, getCurrentInstance } from 'vue';
import { useCleanup } from '@/composables/useCleanup';
import { encrypt, decrypt } from '@/views/_utils/encryption.js';
import ToolSidebar from './components/ToolSidebar/ToolSidebar.vue';
import Canvas from './components/Canvas/Canvas.vue';
import WorkflowGenerator from './components/WorkflowActions/WorkflowGenerator/WorkflowGenerator.vue';
import WorkflowEngine from './components/WorkflowActions/WorkflowEngine/WorkflowEngine.vue';
import WorkflowActionsMenu from './components/WorkflowActions/WorkflowActionsMenu/WorkflowActionsMenu.vue';
import CanvasViewControls from './components/CanvasViewControls/CanvasViewControls.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
// NOTE: Static toolLibrary import removed - now using centralized Vuex store (tools/workflowTools)
// The toolLibrary is now accessed via this.toolLibrary computed property from Vuex store
import generateUUID from '@/views/_utils/generateUUID.js';
import LoadingOverlay from '@/views/_components/utility/LoadingOverlay.vue';
import PopupTutorial from '@/views/_components/utility/PopupTutorial.vue';
import useWorkflowDesigner from './useWorkflowDesigner';
import { API_CONFIG } from '@/tt.config.js';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import AgentChat from './components/AgentChat/AgentChat.vue';

export default {
  name: 'WorkflowDesignerView',
  components: {
    ToolSidebar,
    Canvas,
    WorkflowGenerator,
    WorkflowEngine,
    WorkflowActionsMenu,
    CanvasViewControls,
    PopupTutorial,
    LoadingOverlay,
    SimpleModal,
    AgentChat,
    Tooltip,
  },
  emits: ['node-selected', 'edge-selected', 'all-deselected', 'update:nodes', 'update:edges', 'workflow-status-change'],
  data() {
    return {
      nodes: [],
      edges: [],
      isAnimating: false,
      gridSize: 16,
      nodeWidth: 288, // THIS IS 288 NORMALLY, 48 IN TINY MODE
      nodeHeight: 48,
      isTinyNodeMode: false,
      isModuleModalOpen: false,
      selectedNode: null,
      selectedNodeIndex: null,
      selectedEdge: null,
      selectedEdgeIndex: null,
      selectedEdgeId: null,
      zoomLevel: 1,
      workflowId: null,
      workflowError: null,
      activeWorkflowId: null,
      workflowStatus: null,
      nodeOutputs: {},
      nodeErrors: {},
      workflowName: 'My Workflow',
      pollingTimer: null,
      customTools: [],
      customToolsLastFetched: null,
      didPromptForNameOnce: false,
      currentNodeId: null, // Track current node to prevent unnecessary updates
    };
  },
  computed: {
    backendTools() {
      return this.$store.getters['tools/workflowTools'];
    },
    selectedNodeContent() {
      return this.selectedNode ? { ...this.selectedNode } : null;
    },
    selectedEdgeContent() {
      return this.selectedEdge ? { ...this.selectedEdge } : null;
    },
    canvasRef() {
      return this.$refs.canvas ? this.$refs.canvas.$el : null;
    },
  },
  methods: {
    async showAlert(message, options = {}) {
      await this.$refs.modal.showModal({
        message,
        showCancel: false,
        ...options,
      });
    },
    async showPrompt(title, message, defaultValue = '', options = {}) {
      const result = await this.$refs.modal.showModal({
        title,
        message,
        isPrompt: true,
        isTextArea: options.isTextArea || false,
        placeholder: defaultValue,
        defaultValue: defaultValue,
        confirmText: options.confirmText || 'Save',
        cancelText: options.cancelText || 'Cancel',
        confirmClass: options.confirmClass || 'btn-primary',
        cancelClass: options.cancelClass || 'btn-secondary',
        showCancel: options.showCancel !== undefined ? options.showCancel : true,
      });
      return result === null ? null : result || defaultValue;
    },
    async showConfirm(title, message, options = {}) {
      return await this.$refs.modal.showModal({
        title,
        message,
        confirmText: options.confirmText || 'OK',
        cancelText: options.cancelText || 'Cancel',
        confirmClass: options.confirmClass || 'btn-primary',
        cancelClass: options.cancelClass || 'btn-secondary',
        showCancel: options.showCancel !== undefined ? options.showCancel : true,
      });
    },
    async handleWorkflowSaveRequested() {
      // 1) Check if this is a brand new workflow:
      //    - no active workflow in localStorage
      //    - user hasn't already been prompted
      //    - name is blank or still the default
      const activeWorkflow = localStorage.getItem('activeWorkflow');
      const defaultName = 'My Workflow';
      const isBrandNewWorkflow = !activeWorkflow && !this.didPromptForNameOnce && (!this.workflowName || this.workflowName === defaultName);

      // 2) Prompt only if it's brand-new and not prompted before
      if (isBrandNewWorkflow) {
        const newName = await this.showPrompt('New Workflow', 'Give a name for your new workflow:', this.workflowName || defaultName);

        // If they cancel or leave it empty, exit without saving
        if (!newName) return;

        // Update the workflow name and set our flag
        this.updateWorkflowName(newName);
        this.didPromptForNameOnce = true;
      }

      // 3) Now simply call your existing save logic (no repeated prompt)
      await this.saveCanvasState(false, false);
    },
    createNode(data, x, y) {
      console.log('🔧 createNode called with data:', data);
      console.log('🔧 createNode data.parameters:', data.parameters);

      const isLabel = data.type === 'label';
      let nodeData = null;

      // Find the node data in backendTools (fetched from backend, includes plugins)
      if (this.backendTools) {
        for (const category in this.backendTools) {
          if (Array.isArray(this.backendTools[category])) {
            const foundNode = this.backendTools[category].find((node) => node.type === data.type);
            if (foundNode) {
              nodeData = foundNode;
              break;
            }
          }
        }
      }

      // If not found in backendTools, check in Vuex store workflowTools as fallback
      if (!nodeData && this.backendTools) {
        for (const category in this.backendTools) {
          if (Array.isArray(this.backendTools[category])) {
            const foundNode = this.backendTools[category].find((node) => node.type === data.type);
            if (foundNode) {
              nodeData = foundNode;
              console.log(`🔌 createNode - Found node type ${data.type} in backendTools (category: ${category})`);
              break;
            }
          }
        }
      }

      // Check if node requires PRO and user is not PRO
      if (nodeData && nodeData.requiresPro) {
        const planType = this.$store.getters['userAuth/planType'] || 'free';
        const isPro = planType !== 'free';

        console.log('🔍 WorkflowDesigner createNode - planType:', planType, 'isPro:', isPro);

        if (!isPro) {
          this.showAlert('This feature requires a PRO subscription. Please upgrade to use Webhook and Email nodes.', {
            showCancel: false,
          });
          return;
        }
      }

      // If not found in toolLibrary, check in custom tools
      if (!nodeData) {
        nodeData = this.customTools.find((tool) => tool.type === data.type);
      }

      if (!nodeData && !isLabel) {
        console.error(`Node type ${data.type} not found in toolLibrary or custom tools`);
        return;
      }

      const newNode = {
        id: generateUUID(),
        text: isLabel ? 'Text Label' : nodeData.title,
        x: Math.round((x - this.nodeWidth / 2) / this.gridSize) * this.gridSize,
        y: Math.round((y - this.nodeHeight / 2) / this.gridSize) * this.gridSize,
        isEditing: false,
        type: data.type,
        icon: isLabel ? 'text' : nodeData.icon,
        category: data.category,
        isSelected: false,
        parameters: {}, // Initialize an empty parameters object
        description: nodeData.description,
        error: null,
      };

      // Initialize parameters with default values
      // First, check if the data object itself has parameters (from drag & drop)
      if (data.parameters) {
        // Use the parameters directly from the passed data
        newNode.parameters = { ...data.parameters };
        console.log('🔧 createNode - using direct parameters from data:', newNode.parameters);
      } else if (nodeData && nodeData.parameters) {
        // Use the parameters from toolLibrary/custom tools
        for (const key in nodeData.parameters) {
          if (nodeData.category === 'custom') {
            // For custom tools
            if (typeof nodeData.parameters[key] === 'object' && nodeData.parameters[key].value !== undefined) {
              newNode.parameters[key] = {
                ...nodeData.parameters[key],
                value: nodeData.parameters[key].value,
              };
            } else {
              newNode.parameters[key] = nodeData.parameters[key];
            }
          } else {
            // For standard tools
            // Check if the parameter is already a direct value (from drag & drop) or a parameter definition
            if (typeof nodeData.parameters[key] === 'object' && nodeData.parameters[key].hasOwnProperty('type')) {
              // This is a parameter definition from toolLibrary
              newNode.parameters[key] = nodeData.parameters[key].default || '';
              if (nodeData.parameters[key].inputType === 'select') {
                newNode.parameters[key + '_options'] = nodeData.parameters[key].options;
              }
            } else {
              // This is a direct value (e.g., from drag & drop media)
              newNode.parameters[key] = nodeData.parameters[key];
            }
          }
        }
        console.log('🔧 createNode - using toolLibrary parameters:', newNode.parameters);
      }

      // Set outputs for custom tools
      if (nodeData.category === 'custom') {
        newNode.outputs = {
          generatedText: { type: 'string' },
          tokenCount: { type: 'number' },
          error: { type: 'string' },
        };
      } else {
        newNode.outputs = nodeData.outputs;
      }

      this.nodes.push(newNode);
      const newNodeIndex = this.nodes.length - 1;

      if (isLabel) {
        this.cleanup.setTimeout(() => {
          this.startEditing(newNodeIndex);
        }, 100);
      }

      return newNodeIndex;
    },
    selectNode(index) {
      this.deselectAllNodes();
      this.nodes.forEach((node, i) => {
        node.isSelected = i === index;
      });
      this.selectedNodeIndex = index;
      this.selectedNode = { ...this.nodes[index] };

      // Instead of opening the floating panel, emit an event
      this.$emit('node-selected', this.selectedNodeContent);

      this.deselectAllEdges();
    },
    updateNodeContent(updatedContent) {
      if (this.selectedNodeIndex !== null) {
        this.nodes[this.selectedNodeIndex] = {
          ...this.nodes[this.selectedNodeIndex],
          text: updatedContent.text,
          type: updatedContent.type,
          description: updatedContent.description,
          parameters: { ...updatedContent.parameters },
        };
        this.selectedNode = { ...this.nodes[this.selectedNodeIndex] };
        this.$emit('update:nodes', [...this.nodes]);

        // Emit node selected event with updated content
        this.$emit('node-selected', this.selectedNodeContent);
      }
    },
    selectEdge(edgeId) {
      if (this.selectedEdgeId === edgeId) {
        this.deselectAllEdges();
      } else {
        this.selectedEdgeId = edgeId;
        this.selectedEdge = this.edges.find((e) => e.id === edgeId);

        // Instead of opening the floating panel, emit an event
        this.$emit('edge-selected', this.selectedEdgeContent);

        this.deselectAllNodes();
      }
    },
    updateEdgeContent(updatedContent) {
      if (this.selectedEdgeId) {
        const edgeIndex = this.edges.findIndex((e) => e.id === this.selectedEdgeId);
        if (edgeIndex !== -1) {
          this.edges[edgeIndex] = {
            ...this.edges[edgeIndex],
            ...updatedContent,
          };
          this.selectedEdge = { ...this.edges[edgeIndex] };
          // Force a re-render of the edges
          this.edges = [...this.edges];

          // Emit edge selected event with updated content
          this.$emit('edge-selected', this.selectedEdgeContent);
        }
      }
    },
    deselectAllNodes() {
      this.nodes.forEach((node) => {
        node.isSelected = false;
      });
      this.selectedNode = null;
      this.selectedNodeIndex = null;

      // If no edge is selected either, emit all-deselected
      if (!this.selectedEdgeId) {
        this.$emit('all-deselected');
      }
    },
    deselectAllEdges() {
      this.selectedEdgeId = null;
      this.selectedEdge = null;

      // If no node is selected either, emit all-deselected
      if (this.selectedNodeIndex === null) {
        this.$emit('all-deselected');
      }
    },
    clearSelection() {
      // Force focus with blur on next tick when click away
      this.$nextTick(() => {
        if (document.activeElement) {
          document.activeElement.blur();
        }
      });

      if (window.getSelection) {
        if (window.getSelection().empty) {
          // Chrome
          window.getSelection().empty();
        } else if (window.getSelection().removeAllRanges) {
          // Firefox
          window.getSelection().removeAllRanges();
        }
      } else if (document.selection) {
        // IE
        document.selection.empty();
      }
    },
    async deleteNode(index) {
      const confirmed = await this.showConfirm('Delete Node', 'Are you sure you want delete this node?');
      if (confirmed) {
        const nodeId = this.nodes[index].id;

        // Remove all edges connected to this node
        this.edges = this.edges.filter((edge) => edge.start.id !== nodeId && edge.end.id !== nodeId);

        // Remove the node
        this.nodes.splice(index, 1);

        // Update the edges
        this.updateEdges();

        // Close the module modal if it's open
        this.isModuleModalOpen = false;

        // Deselect all nodes
        this.deselectAllNodes();

        // Update the nodes array without forcing a complete re-render
        // This preserves component state including blob URLs
        this.$emit('update:nodes', [...this.nodes]);
      }
    },
    startEditing(index) {
      this.nodes[index].isEditing = true;
      this.deselectAllNodes();
      this.selectNode(index);
    },
    finishEditing(index, content) {
      console.log('finished editing!');
      this.nodes[index].isEditing = false;
      this.nodes[index].text = content;
      if (this.selectedNode && this.selectedNode.index === index) {
        this.selectedNode = { ...this.nodes[index] };
      }
      // this.selectNode(index);
    },
    createEdge(start, end) {
      const newEdge = {
        id: generateUUID(),
        start: { id: start.nodeId, type: start.type },
        end: { id: end.nodeId, type: end.type },
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0,
        isActive: false,
        // Restore preserved config data from re-dragged edges
        ...(start.preservedEdgeData || {}),
      };
      this.updateEdgeCoordinates(newEdge);
      this.edges.push(newEdge);
    },
    updateEdges() {
      this.edges = this.edges.filter((edge) => {
        const startNode = this.nodes.find((node) => node.id === edge.start.id);
        const endNode = this.nodes.find((node) => node.id === edge.end.id);
        return startNode && endNode;
      });

      this.edges.forEach((edge) => {
        this.updateEdgeCoordinates(edge);
      });
    },
    deleteSelectedNode(index) {
      this.deleteNode(index);
    },
    async deleteSelectedEdge() {
      if (this.selectedEdgeId) {
        const confirmed = await this.showConfirm('Delete Edge', 'Are you sure you want to delete this edge?');
        if (confirmed) {
          this.edges = this.edges.filter((edge) => edge.id !== this.selectedEdgeId);
          this.selectedEdgeId = null;
          this.selectedEdge = null;
          this.isModuleModalOpen = false;
          // Update the edges directly instead of emitting an event
          this.$nextTick(() => {
            this.updateEdges();
          });
        }
      }
    },
    updateEdgeCoordinates(edge) {
      const startNode = this.nodes.find((node) => node.id === edge.start.id);
      const endNode = this.nodes.find((node) => node.id === edge.end.id);

      // Initialize with a safe default (0) if current edge coordinates are invalid
      let sX_fallback = Number.isFinite(edge.startX) ? edge.startX : 0;
      let sY_fallback = Number.isFinite(edge.startY) ? edge.startY : 0;
      let eX_fallback = Number.isFinite(edge.endX) ? edge.endX : 0;
      let eY_fallback = Number.isFinite(edge.endY) ? edge.endY : 0;

      if (!startNode || !endNode) {
        console.warn(`UpdateEdgeCoordinates: Start or end node for edge ${edge.id} not found. Using last known/defaulted edge coordinates.`);
        edge.startX = sX_fallback;
        edge.startY = sY_fallback;
        edge.endX = eX_fallback;
        edge.endY = eY_fallback;
        return;
      }

      let startNodeX = Number(startNode.x);
      let startNodeY = Number(startNode.y);
      let endNodeX = Number(endNode.x);
      let endNodeY = Number(endNode.y);

      // Sanitize node coordinates
      if (!Number.isFinite(startNodeX)) {
        console.error(
          `UpdateEdgeCoordinates: StartNode ${startNode.id} X-coordinate is invalid/NaN (${startNode.x}). Defaulting to 0 for this edge calculation.`
        );
        startNodeX = 0;
      }
      if (!Number.isFinite(startNodeY)) {
        console.error(
          `UpdateEdgeCoordinates: StartNode ${startNode.id} Y-coordinate is invalid/NaN (${startNode.y}). Defaulting to 0 for this edge calculation.`
        );
        startNodeY = 0;
      }
      if (!Number.isFinite(endNodeX)) {
        console.error(
          `UpdateEdgeCoordinates: EndNode ${endNode.id} X-coordinate is invalid/NaN (${endNode.x}). Defaulting to 0 for this edge calculation.`
        );
        endNodeX = 0;
      }
      if (!Number.isFinite(endNodeY)) {
        console.error(
          `UpdateEdgeCoordinates: EndNode ${endNode.id} Y-coordinate is invalid/NaN (${endNode.y}). Defaulting to 0 for this edge calculation.`
        );
        endNodeY = 0;
      }

      const nodeWidth = Number.isFinite(this.nodeWidth) ? this.nodeWidth : 288;
      const nodeHeight = Number.isFinite(this.nodeHeight) ? this.nodeHeight : 48;

      let sX_calc, sY_calc, eX_calc, eY_calc;

      if (edge.start.type === 'output') {
        sX_calc = startNodeX + nodeWidth;
        sY_calc = startNodeY + nodeHeight / 2;
      } else {
        sX_calc = startNodeX;
        sY_calc = startNodeY + nodeHeight / 2;
      }

      if (edge.end.type === 'input') {
        eX_calc = endNodeX;
        eY_calc = endNodeY + nodeHeight / 2;
      } else {
        eX_calc = endNodeX + nodeWidth;
        eY_calc = endNodeY + nodeHeight / 2;
      }

      // Ensure final calculated coordinates are finite numbers, otherwise use the sanitized fallbacks
      edge.startX = Number.isFinite(sX_calc) ? sX_calc : sX_fallback;
      edge.startY = Number.isFinite(sY_calc) ? sY_calc : sY_fallback;
      edge.endX = Number.isFinite(eX_calc) ? eX_calc : eX_fallback;
      edge.endY = Number.isFinite(eY_calc) ? eY_calc : eY_fallback;
    },
    updateAnimationState(isAnimating) {
      this.isAnimating = isAnimating;
    },
    async handleWorkflowGenerator(workflowData) {
      // 1) Update the local workflowName with the AI-generated name (if it exists)
      if (workflowData && workflowData.name) {
        this.workflowName = workflowData.name;
      }

      // 2) Clear existing nodes and edges
      this.nodes = [];
      this.edges = []; // Clear edges too

      this.updateActiveWorkflowId(workflowData.id);

      // 3) Process media data - convert base64 to IndexedDB references if needed
      console.log('🔄 Loading workflow - processing media data...');
      const nodesWithProcessedMedia = await this.processWorkflowMediaData(workflowData.nodes);

      // 4) Populate new nodes
      this.nodes = nodesWithProcessedMedia.map((node) => {
        const nodeDetails = this.getNodeDetails(node.type);

        if (!nodeDetails) {
          console.error(`Node type "${node.type}" not found. Creating a placeholder error node for:`, node);
          return {
            ...node, // Spread original node data first (id, x, y, etc.)
            icon: 'fas fa-exclamation-triangle', // Error icon
            parameters: node.parameters || {}, // Preserve original params if they exist, or empty
            outputs: {}, // Always empty for error nodes to prevent crashes
            description: `Error: Node type "${node.type}" not found. Original description: ${node.description || ''}`,
            error: `Node type "${node.type}" not found. Please check toolLibrary or custom tools.`,
            isInvalid: true, // Custom flag for styling or identification
            category: node.category || 'error',
            text: node.text || `Unknown Node: ${node.type}`,
          };
        }

        const initializedOutputs = {};
        const initializedParameters = {};

        // Initialize outputs with default values
        if (nodeDetails.outputs) {
          for (const [key, value] of Object.entries(nodeDetails.outputs)) {
            initializedOutputs[key] = this.getDefaultValueForType(value.type);
          }
        }

        // Initialize parameters with existing values or default values
        if (nodeDetails.parameters) {
          for (const [key, param] of Object.entries(nodeDetails.parameters)) {
            initializedParameters[key] = this.getDefaultValueForParameter(
              param,
              node.parameters && node.parameters[key] // Check if node.parameters exists
            );
          }
        }

        // Preserve extra non-schema parameters (e.g., customWidth, customHeight from widget resize)
        if (node.parameters) {
          for (const [key, value] of Object.entries(node.parameters)) {
            if (!(key in initializedParameters)) {
              initializedParameters[key] = value;
            }
          }
        }

        return {
          ...node,
          icon: nodeDetails.icon,
          parameters: initializedParameters,
          outputs: initializedOutputs,
          description: node.description || nodeDetails.description,
          error: node.error || null, // Preserve existing error if any
        };
      });

      // Populate new edges and ensure they are new objects
      this.edges = workflowData.edges ? workflowData.edges.map((edge) => ({ ...edge })) : [];

      // IMPORTANT: Immediately update/sanitize edge coordinates after loading them
      this.updateEdges();

      // 5) Update canvas transform
      this.$nextTick(() => {
        if (this.$refs.canvas) {
          this.$refs.canvas.zoomLevel = workflowData.zoomLevel || 1;
          this.$refs.canvas.canvasOffsetX = workflowData.canvasOffsetX || 0;
          this.$refs.canvas.canvasOffsetY = workflowData.canvasOffsetY || 0;
          this.$refs.canvas.updateCanvasTransform();
        }
      });
    },
    setWorkflowId(id) {
      this.workflowId = id;
    },
    updateActiveWorkflowId(id) {
      this.activeWorkflowId = id;
      localStorage.setItem('activeWorkflow', id);
    },
    async toggleShareable() {
      if (this.isShareable) {
        // Currently shared - ask to make private
        const confirmed = await this.showConfirm(
          'Make Workflow Private',
          'Are you sure you want to make this workflow private? It will no longer be shareable.',
          {
            confirmText: 'Make Private',
            cancelText: 'Cancel',
            confirmClass: 'btn-danger',
            cancelClass: 'btn-secondary',
          }
        );

        if (!confirmed) return;

        this.isShareable = false;
        await this.saveCanvasState(true, false);
        await this.showAlert('Workflow is now private.', { showCancel: false });
      } else {
        // Currently private - make shareable
        this.isShareable = true;
        await this.saveCanvasState(false, true);
      }
    },
    async copyShareUrl() {
      const activeWorkflowId = localStorage.getItem('activeWorkflow');
      if (activeWorkflowId && this.isShareable) {
        await navigator.clipboard.writeText(activeWorkflowId);
        await this.showAlert('Workflow ID copied to clipboard!', { showCancel: false });
      }
    },
    async handleCloudSync() {
      if (this.isShareable) {
        // Currently synced - ask to disable
        const confirmed = await this.showConfirm(
          'Disable Cloud Sync',
          'Are you sure you want to disable cloud sync and make this workflow private?',
          {
            confirmText: 'Disable',
            cancelText: 'Cancel',
            confirmClass: 'btn-danger',
            cancelClass: 'btn-secondary',
          }
        );

        if (!confirmed) return;

        this.isShareable = false;
        await this.saveCanvasState(true, false);
        await this.showAlert('Workflow is now private.', { showCancel: false });
      } else {
        // Currently private - ask to enable
        const confirmed = await this.showConfirm('Enable Cloud Sync', 'Enable cloud sync to share this workflow with others?', {
          confirmText: 'Enable',
          cancelText: 'Cancel',
          confirmClass: 'btn-primary',
          cancelClass: 'btn-secondary',
        });

        if (!confirmed) return;

        this.isShareable = true;
        await this.saveCanvasState(false, true);
        await this.$refs.modal.showModal({
          title: 'Cloud Sync Enabled',
          message: 'Workflow Synced to Cloud',
          showCancel: false,
        });
      }
    },
    async saveCanvasState(silent = false, isSharing = false) {
      this.deselectAllNodes();
      this.deselectAllEdges();

      // Check and cleanup localStorage before saving
      await this.checkAndCleanupLocalStorage();

      // Get the current workflow state from localStorage
      const currentState = localStorage.getItem('canvasState');
      let currentName = 'My Workflow';

      if (currentState) {
        const parsedState = JSON.parse(currentState);
        currentName = parsedState.name || (parsedState.workflow && parsedState.workflow.name) || currentName;
      }

      let newWorkflowName = this.workflowName;
      if (!silent && !isSharing) {
        newWorkflowName = await this.showPrompt('Save Workflow', 'Enter a name for your workflow:', this.workflowName, {
          confirmText: 'Save',
          cancelText: 'Cancel',
          confirmClass: 'btn-primary',
          cancelClass: 'btn-secondary',
        });
        if (newWorkflowName === null) {
          return;
        }
      }

      const activeWorkflowId = localStorage.getItem('activeWorkflow');
      const workflowId = activeWorkflowId || generateUUID();
      this.updateWorkflowName(newWorkflowName);

      console.log('🔄 Processing workflow data for storage...');

      const baseNodes = this.nodes.map((node) => ({
        ...node,
        parameters: { ...node.parameters },
        outputs: { ...node.outputs },
      }));

      // Create localStorage version with IndexedDB references
      const nodesForLocalStorage = await this.convertBlobUrlsToStorage(baseNodes, false);

      // Create server version with full base64 data
      const nodesForServer = await this.convertBlobUrlsToStorage(baseNodes, true);

      console.log('✅ Workflow data processing complete');

      const localStorageState = {
        id: activeWorkflowId,
        name: newWorkflowName,
        nodes: nodesForLocalStorage,
        edges: this.edges,
        zoomLevel: this.zoomLevel,
        canvasOffsetX: this.$refs.canvas.canvasOffsetX,
        canvasOffsetY: this.$refs.canvas.canvasOffsetY,
        isTinyNodeMode: this.isTinyNodeMode,
        isShareable: this.isShareable,
        customTools: isSharing ? this.getCustomToolsUsedInWorkflow() : [],
      };

      const serverState = {
        ...localStorageState,
        nodes: nodesForServer,
      };

      // Try to save to localStorage with IndexedDB references
      const success = await this.safeLocalStorageSet('canvasState', JSON.stringify(localStorageState));

      if (success) {
        localStorage.setItem('activeWorkflow', workflowId);
        this.workflowId = workflowId;
        // Update Vuex store with localStorage state (IndexedDB references)
        this.$store.dispatch('canvas/updateCanvasState', localStorageState);
      } else {
        console.warn('⚠️ Failed to save to localStorage due to size constraints');
        // Still continue with server save
      }

      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        // Always save to server with full data (resolve IndexedDB references first)
        const localEndpoint = this.getEndpoint('save');
        await fetch(`${localEndpoint}/workflows/save`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ workflow: serverState }),
        });

        // Only save to the remote endpoint if isSharing is true
        if (isSharing) {
          const remoteEndpoint = this.getEndpoint('share');
          const shareResponse = await fetch(`${remoteEndpoint}/workflows/save`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ workflow: serverState }),
          });

          if (!shareResponse.ok) {
            const errorData = await shareResponse.json();
            throw new Error(errorData.error || `HTTP error! status: ${shareResponse.status}`);
          }

          const shareData = await shareResponse.json();
          const sharedId = shareData.workflowId;
          const fullUrl = `${window.location.origin}/workflow-forge?id=${sharedId}`;

          if (!silent) {
            await navigator.clipboard.writeText(fullUrl);
            await this.$refs.modal.showModal({
              title: 'Workflow shared successfully!',
              message: `Sharable link copied to clipboard: ${fullUrl}`,
              showCancel: false,
            });
          }
          console.log('Workflow shared:', sharedId || serverState.id);
        } else {
          // Not sharing; optionally show a save alert
          if (!silent) {
            await this.showAlert(`Workflow "${this.workflowName}" saved and privacy updated.`, { showCancel: false });
          }
        }
      } catch (error) {
        console.error(isSharing ? 'Error sharing workflow:' : 'Error saving workflow to database:', error);
        await this.showAlert(null, `Workflow "${this.workflowName}" failed to ${isSharing ? 'share' : 'save'}. Please try again.`, {
          showCancel: false,
        });
      }
    },
    encryptNodeParameters(parameters) {
      const encryptedParams = {};
      for (const [key, value] of Object.entries(parameters)) {
        encryptedParams[key] = encrypt(JSON.stringify(value));
      }
      return encryptedParams;
    },
    decryptNodeParameters(parameters) {
      const decryptedParams = {};
      for (const [key, value] of Object.entries(parameters)) {
        try {
          decryptedParams[key] = JSON.parse(decrypt(value));
        } catch (error) {
          console.error(`Error decrypting parameter ${key}:`, error);
          decryptedParams[key] = value; // Use the original value if decryption fails
        }
      }
      return decryptedParams;
    },
    getCustomToolsUsedInWorkflow() {
      const customToolTypes = this.nodes.filter((node) => node.category === 'custom').map((node) => node.type);

      return this.customTools.filter((tool) => customToolTypes.includes(tool.type));
    },
    async importWorkflow() {
      // Use the modal-based prompt and await its result.
      const workflowId = await this.showPrompt(
        'Import Workflow',
        'Enter the shared workflow ID to import:',
        '', // No default value
        {
          confirmText: 'Import',
          cancelText: 'Cancel',
          confirmClass: 'btn-primary',
          cancelClass: 'btn-secondary',
        }
      );

      // If workflowId is canceled, the result will be null.
      if (workflowId) {
        // Make sure workflowId is a string—not a promise—and pass it to loadWorkflow.
        await this.loadWorkflow(`shared_${workflowId}`);
      }
    },
    async exportWorkflow() {
      // Prepare the workflow data for export
      const state = {
        id: this.activeWorkflowId,
        name: this.workflowName,
        nodes: this.nodes.map((node) => ({
          ...node,
          parameters: { ...node.parameters },
          outputs: { ...node.outputs },
        })),
        edges: this.edges,
        zoomLevel: this.zoomLevel,
        canvasOffsetX: this.$refs.canvas.canvasOffsetX,
        canvasOffsetY: this.$refs.canvas.canvasOffsetY,
        isTinyNodeMode: this.isTinyNodeMode,
        isShareable: this.isShareable,
        customTools: this.getCustomToolsUsedInWorkflow(),
      };

      // Convert to JSON string
      const workflowJson = JSON.stringify(state, null, 2);

      // Create a Blob with the JSON data
      const blob = new Blob([workflowJson], {
        type: 'application/json',
      });

      // Create a download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.workflowName.replace(/\s+/g, '_')}_workflow.json`;

      // Trigger the download
      document.body.appendChild(a);
      a.click();

      // Clean up
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Show confirmation
      await this.showAlert(`Workflow "${this.workflowName}" exported successfully!`, {
        showCancel: false,
      });
    },
    async loadCanvasState() {
      // const stateString = localStorage.getItem("canvasState");
      const stateString = await this.showPrompt('Load Workflow', 'Enter the workflow JSON to load:', '', {
        isTextArea: true,
        confirmText: 'Load',
        cancelText: 'Cancel',
        confirmClass: 'btn-primary',
        cancelClass: 'btn-secondary',
      });
      if (stateString) {
        let state;
        try {
          state = JSON.parse(stateString);
        } catch (e) {
          console.error('Failed to parse workflow JSON:', e);
          await this.showAlert('Invalid Workflow JSON', 'The provided JSON could not be parsed.', { showCancel: false });
          return;
        }

        // Update the workflowName from the loaded state
        this.updateWorkflowName(state.name || 'My Workflow');

        // Update shareable status
        this.isShareable = state.isShareable || false;

        // Update isTinyNodeMode and nodeWidth based on the saved state
        this.isTinyNodeMode = state.isTinyNodeMode || false; // Ensure default if undefined
        this.nodeWidth = this.isTinyNodeMode ? 48 : 288;

        state.nodes = state.nodes.map((node) => {
          const nodeDetails = this.getNodeDetails(node.type);

          if (!nodeDetails) {
            console.error(`Node type "${node.type}" not found during loadCanvasState pre-processing. Creating placeholder:`, node);
            return {
              ...node,
              icon: 'fas fa-exclamation-triangle',
              parameters: node.parameters || {},
              outputs: {}, // Ensure outputs is an empty object
              description: `Error: Node type "${node.type}" not found. Original description: ${node.description || ''}`,
              error: `Node type "${node.type}" not found.`,
              isInvalid: true,
              category: node.category || 'error',
              text: node.text || `Unknown Node: ${node.type}`,
            };
          }

          const initializedOutputs = {};
          const initializedParameters = { ...node.parameters }; // Preserve existing parameters

          // Initialize outputs with default values
          if (nodeDetails.outputs) {
            for (const [key, value] of Object.entries(nodeDetails.outputs)) {
              initializedOutputs[key] = this.getDefaultValueForType(value.type);
            }
          }

          // Initialize new parameters with default values
          if (nodeDetails.parameters) {
            for (const [key, param] of Object.entries(nodeDetails.parameters)) {
              if (!(key in initializedParameters)) {
                initializedParameters[key] = this.getDefaultValueForParameter(param);
              }
            }
          }

          return {
            ...node,
            icon: nodeDetails.icon,
            parameters: initializedParameters,
            outputs: initializedOutputs,
            description: node.description || nodeDetails.description,
            error: node.error || null,
          };
        });

        this.handleWorkflowGenerator(state);

        // After loading the state, call toggleTinyNodeMode to adjust positions if necessary
        // Check if state.isTinyNodeMode exists before comparing
        if (state.hasOwnProperty('isTinyNodeMode') && this.isTinyNodeMode !== state.isTinyNodeMode) {
          this.$nextTick(() => {
            // this.toggleTinyNodeMode(); // This might need review if it causes issues with new placeholders
          });
        }

        this.workflowId = state.id;
        this.showAlert(`Workflow Loaded! ID: ${state.id}`, {
          showCancel: false,
        });
      }
    },
    async deleteWorkflow() {
      const activeWorkflowId = localStorage.getItem('activeWorkflow');

      if (!activeWorkflowId) {
        await this.showAlert('No active workflow to delete.', {
          showCancel: false,
        });
        return;
      }

      const confirmDelete = await this.showConfirm('Delete Workflow', `Really delete the workflow "${this.workflowName}"?`, {
        confirmText: 'Delete', // Custom text for the confirm button
        cancelText: 'Cancel', // Custom text for the cancel button
        confirmClass: 'btn-danger', // Red style for delete button
        cancelClass: 'btn-secondary', // Grey style for cancel button
      });
      if (!confirmDelete) return;

      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.BASE_URL}/workflows/${activeWorkflowId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('Workflow deleted:', data);
        await this.showAlert('Workflow deleted successfully', {
          showCancel: false,
        });

        // Clear the canvas and reset the state
        this.nodes = [];
        this.edges = [];
        this.activeWorkflowId = null;
        this.workflowName = 'My Workflow';
        localStorage.removeItem('canvasState');
        localStorage.removeItem('activeWorkflow');

        // Refresh the page and remove query parameters
        window.location.href = window.location.pathname;
      } catch (error) {
        console.error('Error deleting workflow:', error);
        await this.showAlert('Failed to delete workflow. Please try again.', {
          showCancel: false,
        });
      }
    },
    getNodeDetails(type) {
      // First, check in backendTools (fetched from backend, includes plugins)
      if (this.backendTools) {
        for (const category in this.backendTools) {
          if (Array.isArray(this.backendTools[category])) {
            const foundNode = this.backendTools[category].find((node) => node.type === type);
            if (foundNode) {
              console.log(`🔌 Found node type ${type} in backendTools (category: ${category})`);
              return foundNode;
            }
          }
        }
      }

      // If not found in toolLibrary or backendTools, check in custom tools
      const customTool = this.customTools.find((tool) => tool.type === type);
      if (customTool) {
        return customTool;
      }

      // If not found anywhere, return null or a default object
      console.warn(`Node type ${type} not found in toolLibrary, backendTools, or custom tools`);
      return null;
    },
    /**
     * Fetch workflow tools from backend (includes plugins)
     */
    async fetchCustomTools(forceRefresh = false) {
      const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
      const now = Date.now();

      // Use cached tools if available and not expired
      if (
        !forceRefresh &&
        this.customTools.length > 0 &&
        this.customToolsLastFetched &&
        now - this.customToolsLastFetched < CACHE_TTL
      ) {
        return; // Use cached tools
      }

      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.BASE_URL}/custom-tools`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (Array.isArray(data.tools)) {
          this.customTools = data.tools.map((tool) => ({
            ...tool,
            category: 'custom',
          }));
          this.customToolsLastFetched = now;
        } else {
          console.error('Received invalid data for custom tools:', data);
          this.customTools = [];
        }

        const customToolsArr = [];
        this.customTools.forEach((tool, index) => {
          customToolsArr.push({
            id: tool.id,
            title: tool.title,
            type: tool.type,
            icon: tool.icon,
          });
        });
      } catch (error) {
        console.error('Error fetching custom tools:', error);
        this.customTools = [];
      }
    },
    getDefaultValueForType(type) {
      switch (type) {
        case 'string':
          return '';
        case 'number':
        case 'integer':
          return 0;
        case 'boolean':
          return false;
        case 'array':
          return [];
        case 'object':
          return {};
        default:
          return null;
      }
    },
    getDefaultValueForParameter(param, existingValue) {
      // If the existing value is not undefined or null, return it
      if (existingValue !== undefined && existingValue !== null) {
        return existingValue;
      }

      // Otherwise, return the default value based on the parameter type
      if (param.default !== undefined) {
        return param.default;
      }

      switch (param.type) {
        case 'string':
          return '';
        case 'number':
        case 'integer':
          return 0;
        case 'boolean':
          return false;
        case 'array':
          return [];
        case 'object':
          return {};
        default:
          return null;
      }
    },
    toggleTinyNodeMode() {
      const oldWidth = this.nodeWidth;
      this.isTinyNodeMode = !this.isTinyNodeMode;
      this.nodeWidth = this.isTinyNodeMode ? 48 : 288;
      const gap = this.isTinyNodeMode ? 32 : 32; // Adjust these values as needed

      // Filter out label nodes
      const nonLabelNodes = this.nodes.filter((node) => node.type !== 'label');

      // Group non-label nodes by their x-coordinate (column)
      const columnGroups = nonLabelNodes.reduce((groups, node) => {
        const x = Math.round(node.x / this.gridSize) * this.gridSize;
        if (!groups[x]) groups[x] = [];
        groups[x].push(node);
        return groups;
      }, {});

      // Sort columns from left to right
      const sortedColumns = Object.keys(columnGroups).sort((a, b) => Number(a) - Number(b));

      // Calculate the total width change
      const widthDifference = this.nodeWidth - oldWidth;

      // Adjust node positions for each column
      sortedColumns.forEach((columnX, columnIndex) => {
        const columnNodes = columnGroups[columnX];

        columnNodes.forEach((node) => {
          if (columnIndex === 0) {
            // Keep the leftmost column fixed
            // No change to node.x
          } else {
            // Calculate the new position based on the number of columns to the left
            const newX = Number(sortedColumns[0]) + columnIndex * (this.nodeWidth + gap);
            node.x = newX;
          }
        });
      });

      // Update the nodes array, preserving label nodes' positions
      this.nodes = this.nodes.map((node) => {
        if (node.type === 'label') {
          return node; // Return label nodes unchanged
        } else {
          return nonLabelNodes.find((n) => n.id === node.id) || node;
        }
      });

      this.updateEdges();
    },
    updateNodePositions() {
      this.nodes.forEach((node) => {
        if (node.type !== 'label') {
          node.x = Math.round(node.x / this.gridSize) * this.gridSize;
          node.y = Math.round(node.y / this.gridSize) * this.gridSize;
        }
      });
      this.updateEdges();
    },
    handleWorkflowStarted() {
      // Reset all nodes and edges to inactive state
      this.nodes = this.nodes.map((node) => ({
        ...node,
        isActive: false,
        error: null,
        output: null,
      }));

      this.edges = this.edges.map((edge) => ({
        ...edge,
        isActive: false,
      }));

      // this.activeWorkflowId = localStorage.getItem('activeWorkflow');

      this.pollWorkflowStatus();
    },
    handleWorkflowError(error) {
      console.error('Workflow error:', error);
      // Update the UI to show the general workflow error
    },
    handleWorkflowStopped() {
      // Reset all nodes and edges to inactive state
      this.nodes = this.nodes.map((node) => ({
        ...node,
        isActive: false,
        error: null,
        output: null,
      }));

      this.edges = this.edges.map((edge) => ({
        ...edge,
        isActive: false,
      }));

      // Reset workflow-related states
      // this.activeWorkflowId = null;
      this.workflowStatus = 'stopped';
      this.nodeOutputs = {};
      this.nodeErrors = {};

      // Stop the animation
      this.updateAnimationState(false);
    },
    setActiveWorkflowId(id) {
      this.activeWorkflowId = id;
    },
    async pollWorkflowStatus() {
      if (!this.activeWorkflowId) {
        console.log('No active workflow ID, stopping polling');
        return;
      }

      // Check if page is visible to avoid unnecessary polling
      if (document.hidden) {
        this.pollingTimer = this.cleanup.setTimeout(() => this.pollWorkflowStatus(), 10000); // Poll every 10 seconds when hidden
        return;
      }

      try {
        const token = localStorage.getItem('token');

        // Add request timeout
        const controller = new AbortController();
        const timeoutId = this.cleanup.setTimeout(() => controller.abort(), 8000); // 8 second timeout

        const response = await fetch(`${API_CONFIG.BASE_URL}/workflows/${this.activeWorkflowId}/status`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        this.workflowStatus = data.status || 'unknown';
        this.nodeErrors = data.errors || {};
        this.nodeOutputs = data.outputs || {};

        // Emit the status change
        this.$emit('workflow-status-change', {
          id: this.activeWorkflowId,
          status: this.workflowStatus,
          isActive: data.isActive,
        });

        // Update the current active node
        const currentNodeId = data.currentNodeId;

        // Update nodes
        this.nodes = this.nodes.map((node) => ({
          ...node,
          isActive: node.id === currentNodeId,
          error: this.nodeErrors[node.id] || null,
          output: this.nodeOutputs[node.id] || null,
        }));

        // Update selectedNode if it exists and matches one of the updated nodes
        if (this.selectedNode && this.selectedNodeIndex !== null) {
          const updatedSelectedNode = this.nodes[this.selectedNodeIndex];
          if (updatedSelectedNode && updatedSelectedNode.id === this.selectedNode.id) {
            this.selectedNode = { ...updatedSelectedNode };
            // Re-emit the node-selected event with updated content
            this.$emit('node-selected', this.selectedNodeContent);
          }
        }

        // Update edges
        this.edges = this.edges.map((edge) => ({
          ...edge,
          isActive: data.activeEdges && data.activeEdges.includes(edge.id),
        }));

        // Update animation state
        this.updateAnimationState(this.workflowStatus === 'running' || this.workflowStatus === 'error' || this.workflowStatus === 'listening');

        // Adaptive polling interval based on workflow status
        let nextPollInterval = 5000; // Default 5 seconds

        if (['completed', 'failed', 'stopped'].includes(this.workflowStatus)) {
          // Stop polling for finished workflows
          console.log(`Workflow ${this.activeWorkflowId} finished with status: ${this.workflowStatus}`);
          return;
        } else if (this.workflowStatus === 'running') {
          nextPollInterval = 3000; // 3 seconds for active workflows
        } else if (this.workflowStatus === 'listening') {
          nextPollInterval = 4000; // 4 seconds for listening workflows
        } else if (this.workflowStatus === 'error') {
          nextPollInterval = 6000; // 6 seconds for error state
        }

        this.pollingTimer = this.cleanup.setTimeout(() => this.pollWorkflowStatus(), nextPollInterval);
      } catch (error) {
        if (error.name === 'AbortError') {
          console.warn(`Workflow status request timeout for ${this.activeWorkflowId}`);
        } else {
          console.error('Error polling workflow status:', error);
        }

        // Retry with exponential backoff on error
        const retryInterval = Math.min((this.pollingRetryCount || 0) * 2000 + 3000, 15000); // Max 15 seconds
        this.pollingRetryCount = (this.pollingRetryCount || 0) + 1;

        this.pollingTimer = this.cleanup.setTimeout(() => this.pollWorkflowStatus(), retryInterval);
      }
    },
    handleWorkflowStatusUpdate(data) {
      // Check if status actually changed to avoid unnecessary updates
      const statusChanged = this.workflowStatus !== (data.status || 'unknown');
      const currentNodeChanged = data.currentNodeId !== this.currentNodeId;

      this.workflowStatus = data.status || 'unknown';
      this.nodeErrors = data.errors || {};
      this.nodeOutputs = data.outputs || {};
      this.currentNodeId = data.currentNodeId;

      // Calculate if animation should be active
      const shouldBeAnimating = this.workflowStatus === 'running' || this.workflowStatus === 'error' || this.workflowStatus === 'listening';

      // Only update nodes if there's an actual change
      if (statusChanged || currentNodeChanged || Object.keys(this.nodeErrors).length > 0 || Object.keys(this.nodeOutputs).length > 0) {
        // CRITICAL: Update node properties IN-PLACE instead of recreating the array
        // This prevents Vue from re-rendering the entire canvas
        this.nodes.forEach((node) => {
          node.isActive = node.id === this.currentNodeId;
          node.error = this.nodeErrors[node.id] || null;
          node.output = this.nodeOutputs[node.id] || null;
        });

        // Update selectedNode if it exists and matches one of the updated nodes
        if (this.selectedNode && this.selectedNodeIndex !== null) {
          const updatedSelectedNode = this.nodes[this.selectedNodeIndex];
          if (updatedSelectedNode && updatedSelectedNode.id === this.selectedNode.id) {
            this.selectedNode = { ...updatedSelectedNode };
            // Re-emit the node-selected event with updated content
            this.$emit('node-selected', this.selectedNodeContent);
          }
        }

        // CRITICAL: Update edge properties IN-PLACE instead of recreating the array
        this.edges.forEach((edge) => {
          edge.isActive = data.activeEdges && data.activeEdges.includes(edge.id);
        });
      }

      // CRITICAL: Only update animation state if it actually changed
      // This prevents unnecessary updates when transitioning between active states
      if (this.isAnimating !== shouldBeAnimating) {
        this.updateAnimationState(shouldBeAnimating);
      }
    },
    updateWorkflowName(name) {
      this.workflowName = name;
    },
    stopPolling() {
      if (this.pollingTimer) {
        clearTimeout(this.pollingTimer);
        this.pollingTimer = null;
      }
    },
    // IndexedDB helper functions for media storage
    async openMediaDB() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('WorkflowMediaDB', 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains('media')) {
            db.createObjectStore('media', { keyPath: 'id' });
          }
        };
      });
    },

    async storeMediaInIndexedDB(mediaId, blob) {
      try {
        const db = await this.openMediaDB();
        const transaction = db.transaction(['media'], 'readwrite');
        const store = transaction.objectStore('media');

        await new Promise((resolve, reject) => {
          const request = store.put({ id: mediaId, blob: blob, timestamp: Date.now() });
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        });

        db.close();
        return `idb://${mediaId}`;
      } catch (error) {
        console.error('Error storing media in IndexedDB:', error);
        return null;
      }
    },

    async getMediaFromIndexedDB(mediaId) {
      try {
        const db = await this.openMediaDB();
        const transaction = db.transaction(['media'], 'readonly');
        const store = transaction.objectStore('media');

        const result = await new Promise((resolve, reject) => {
          const request = store.get(mediaId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });

        db.close();

        if (result && result.blob) {
          return URL.createObjectURL(result.blob);
        }
        return null;
      } catch (error) {
        console.error('Error retrieving media from IndexedDB:', error);
        return null;
      }
    },

    // Helper function to convert blob URL to base64 data URL (ALWAYS base64, no IndexedDB)
    async blobUrlToBase64(blobUrl) {
      try {
        console.log('🔄 CRITICAL: Converting blob URL to base64:', blobUrl);
        const response = await fetch(blobUrl);
        const blob = await response.blob();

        console.log(`📦 File size: ${(blob.size / 1024 / 1024).toFixed(2)}MB - ALWAYS converting to base64`);

        // ALWAYS convert to base64 - no size limits, no IndexedDB
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            console.log(`✅ CRITICAL: Successfully converted to base64, length: ${reader.result.length} characters`);
            console.log(`📦 Base64 starts with: ${reader.result.substring(0, 50)}`);
            resolve(reader.result);
          };
          reader.onerror = (error) => {
            console.error('❌ CRITICAL: Error converting to base64:', error);
            reject(error);
          };
          reader.readAsDataURL(blob);
        });
      } catch (error) {
        console.error('❌ CRITICAL: Error converting blob URL:', error);
        return null;
      }
    },

    // Convert blob URLs to IndexedDB references for localStorage, but keep base64 for server
    async convertBlobUrlsToStorage(nodes, forServer = false) {
      const convertedNodes = await Promise.all(
        nodes.map(async (node) => {
          const convertedParameters = { ...node.parameters };

          // Check for blob URLs in parameters and convert them
          for (const [key, value] of Object.entries(convertedParameters)) {
            if (typeof value === 'string' && value.startsWith('blob:')) {
              console.log(`🔄 Converting blob URL for node ${node.id}, parameter ${key} (forServer: ${forServer})`);

              if (forServer) {
                // For server: convert to base64
                const base64Url = await this.blobUrlToBase64(value);
                if (base64Url) {
                  convertedParameters[key] = base64Url;
                  console.log(`✅ Converted to base64 for server: node ${node.id}`);
                } else {
                  console.warn(`❌ Failed to convert blob URL for server: node ${node.id}, parameter ${key}`);
                }
              } else {
                // For localStorage: store in IndexedDB and save reference
                const mediaId = `media_${node.id}_${key}_${Date.now()}`;
                const response = await fetch(value);
                const blob = await response.blob();

                const idbReference = await this.storeMediaInIndexedDB(mediaId, blob);
                if (idbReference) {
                  convertedParameters[key] = idbReference;
                  console.log(`✅ Stored in IndexedDB for localStorage: node ${node.id} -> ${idbReference}`);
                } else {
                  // Fallback to base64 if IndexedDB fails
                  const base64Url = await this.blobUrlToBase64(value);
                  convertedParameters[key] = base64Url;
                  console.warn(`⚠️ IndexedDB failed, using base64 fallback for node ${node.id}`);
                }
              }
            }
          }

          return {
            ...node,
            parameters: convertedParameters,
          };
        })
      );

      return convertedNodes;
    },

    // Convert IndexedDB references back to base64 for server operations
    async resolveIndexedDBReferences(nodes) {
      const resolvedNodes = await Promise.all(
        nodes.map(async (node) => {
          const resolvedParameters = { ...node.parameters };

          // Check for IndexedDB references and convert them to base64
          for (const [key, value] of Object.entries(resolvedParameters)) {
            if (typeof value === 'string' && value.startsWith('idb://')) {
              const mediaId = value.replace('idb://', '');
              console.log(`🔄 Resolving IndexedDB reference: ${mediaId}`);

              try {
                const db = await this.openMediaDB();
                const transaction = db.transaction(['media'], 'readonly');
                const store = transaction.objectStore('media');

                const result = await new Promise((resolve, reject) => {
                  const request = store.get(mediaId);
                  request.onerror = () => reject(request.error);
                  request.onsuccess = () => resolve(request.result);
                });

                db.close();

                if (result && result.blob) {
                  // Convert blob to base64
                  const base64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(result.blob);
                  });

                  resolvedParameters[key] = base64;
                  console.log(`✅ Resolved IndexedDB reference to base64: ${mediaId}`);
                } else {
                  console.warn(`❌ Failed to resolve IndexedDB reference: ${mediaId}`);
                }
              } catch (error) {
                console.error(`❌ Error resolving IndexedDB reference ${mediaId}:`, error);
              }
            }
          }

          return {
            ...node,
            parameters: resolvedParameters,
          };
        })
      );

      return resolvedNodes;
    },

    // Process workflow media data - handles both base64 and IndexedDB references
    async processWorkflowMediaData(nodes) {
      // CRITICAL: Aggressively clean up ALL old IndexedDB entries before processing new workflow
      await this.cleanupAllIndexedDBEntries();

      const processedNodes = await Promise.all(
        nodes.map(async (node) => {
          const processedParameters = { ...node.parameters };

          // Check for media data in parameters
          for (const [key, value] of Object.entries(processedParameters)) {
            if (typeof value === 'string') {
              // Handle IndexedDB references - convert to blob URLs for display
              if (value.startsWith('idb://')) {
                const mediaId = value.replace('idb://', '');
                console.log(`🔄 Loading media from IndexedDB with ID: ${mediaId}`);
                const blobUrl = await this.getMediaFromIndexedDB(mediaId);
                if (blobUrl) {
                  processedParameters[key] = blobUrl;
                  console.log(`✅ Successfully loaded media from IndexedDB for node ${node.id}`);
                } else {
                  console.warn(`❌ Failed to load media from IndexedDB for node ${node.id}`);
                }
              }
              // Handle base64 data - convert to blob URL for display ONLY
              else if (value.startsWith('data:')) {
                console.log(`🔄 CRITICAL: Converting base64 to blob URL for node ${node.id}, parameter ${key}`);
                try {
                  // CRITICAL: Clean up old entries for this specific node parameter first
                  await this.cleanupOldMediaForNodeParameter(node.id, key);

                  // Convert base64 to blob
                  const response = await fetch(value);
                  const blob = await response.blob();

                  // Create blob URL for display ONLY - don't store in IndexedDB yet
                  const blobUrl = URL.createObjectURL(blob);

                  // CRITICAL: Use blob URL directly - it will be converted to IndexedDB on save
                  processedParameters[key] = blobUrl;
                  console.log(`✅ CRITICAL: Converted base64 to blob URL for display: node ${node.id} -> ${blobUrl}`);
                } catch (error) {
                  console.error(`❌ Error processing base64 for node ${node.id}:`, error);
                  // Keep original base64 on error
                  processedParameters[key] = value;
                }
              }
            }
          }

          return {
            ...node,
            parameters: processedParameters,
          };
        })
      );

      return processedNodes;
    },

    // CRITICAL: Clean up ALL IndexedDB entries to prevent memory accumulation
    async cleanupAllIndexedDBEntries() {
      try {
        const db = await this.openMediaDB();
        const transaction = db.transaction(['media'], 'readwrite');
        const store = transaction.objectStore('media');

        // Get all keys
        const allKeys = await new Promise((resolve, reject) => {
          const request = store.getAllKeys();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });

        // Delete ALL entries - fresh start for each workflow load
        let cleanedCount = 0;
        for (const key of allKeys) {
          await new Promise((resolve, reject) => {
            const deleteRequest = store.delete(key);
            deleteRequest.onerror = () => reject(deleteRequest.error);
            deleteRequest.onsuccess = () => resolve();
          });
          cleanedCount++;
        }

        db.close();

        if (cleanedCount > 0) {
          console.log(`🧹 CRITICAL: Cleaned up ALL ${cleanedCount} IndexedDB entries before loading workflow`);
        }
      } catch (error) {
        console.error('❌ Error cleaning up IndexedDB entries:', error);
      }
    },

    // CRITICAL: Clean up old IndexedDB entries to prevent memory accumulation (legacy method)
    async cleanupOldIndexedDBEntries() {
      try {
        const db = await this.openMediaDB();
        const transaction = db.transaction(['media'], 'readwrite');
        const store = transaction.objectStore('media');

        // Get all entries
        const allEntries = await new Promise((resolve, reject) => {
          const request = store.getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });

        // Clean up entries older than 1 hour
        const cutoffTime = Date.now() - 60 * 60 * 1000; // 1 hour ago
        let cleanedCount = 0;

        for (const entry of allEntries) {
          if (entry.timestamp < cutoffTime) {
            await new Promise((resolve, reject) => {
              const deleteRequest = store.delete(entry.id);
              deleteRequest.onerror = () => reject(deleteRequest.error);
              deleteRequest.onsuccess = () => resolve();
            });
            cleanedCount++;
          }
        }

        db.close();

        if (cleanedCount > 0) {
          console.log(`🧹 Cleaned up ${cleanedCount} old IndexedDB entries`);
        }
      } catch (error) {
        console.error('❌ Error cleaning up old IndexedDB entries:', error);
      }
    },

    // CRITICAL: Clean up old media for specific node parameter
    async cleanupOldMediaForNodeParameter(nodeId, paramKey) {
      try {
        const db = await this.openMediaDB();
        const transaction = db.transaction(['media'], 'readwrite');
        const store = transaction.objectStore('media');

        // Get all keys to find entries for this specific node parameter
        const allKeys = await new Promise((resolve, reject) => {
          const request = store.getAllKeys();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });

        // Find and delete entries that belong to this specific node parameter
        const nodeParamPrefix = `media_node_${nodeId}_param_${paramKey}_`;
        const keysToDelete = allKeys.filter((key) => key.startsWith(nodeParamPrefix));

        // Delete each old entry
        for (const key of keysToDelete) {
          await new Promise((resolve, reject) => {
            const deleteRequest = store.delete(key);
            deleteRequest.onerror = () => reject(deleteRequest.error);
            deleteRequest.onsuccess = () => resolve();
          });
        }

        db.close();

        if (keysToDelete.length > 0) {
          console.log(`🧹 Cleaned up ${keysToDelete.length} old entries for node ${nodeId}, parameter ${paramKey}`);
        }
      } catch (error) {
        console.error(`❌ Error cleaning up old media for node ${nodeId}, parameter ${paramKey}:`, error);
      }
    },

    // Load media from IndexedDB when needed
    async loadMediaFromStorage(nodes) {
      const loadedNodes = await Promise.all(
        nodes.map(async (node) => {
          const loadedParameters = { ...node.parameters };

          // Check for IndexedDB references and convert them back to blob URLs
          for (const [key, value] of Object.entries(loadedParameters)) {
            if (typeof value === 'string' && value.startsWith('idb://')) {
              const mediaId = value.replace('idb://', '');
              console.log(`🔄 Loading media from IndexedDB with ID: ${mediaId}`);
              const blobUrl = await this.getMediaFromIndexedDB(mediaId);
              if (blobUrl) {
                loadedParameters[key] = blobUrl;
                console.log(`✅ Successfully loaded media from IndexedDB for node ${node.id}`);
              } else {
                console.warn(`❌ Failed to load media from IndexedDB for node ${node.id}`);
              }
            }
          }

          return {
            ...node,
            parameters: loadedParameters,
          };
        })
      );

      return loadedNodes;
    },

    // localStorage cleanup and size monitoring
    async checkAndCleanupLocalStorage() {
      try {
        // Calculate current localStorage usage
        let totalSize = 0;
        const items = {};

        for (let key in localStorage) {
          if (localStorage.hasOwnProperty(key)) {
            const value = localStorage.getItem(key);
            const size = value ? value.length : 0;
            totalSize += size;
            items[key] = { size, value: value ? value.substring(0, 100) + '...' : '' };
          }
        }

        const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);
        console.log('🧹 localStorage usage:', totalSizeMB, 'MB');

        // If localStorage is getting large (over 8MB), clean it up
        if (totalSize > 8 * 1024 * 1024) {
          console.log('🧹 localStorage cleanup needed - size:', totalSizeMB, 'MB');

          // Keep only essential items
          const essentialKeys = ['token', 'userId', 'activeWorkflow', 'canvasState'];
          const itemsToRemove = [];

          for (let key in localStorage) {
            if (localStorage.hasOwnProperty(key) && !essentialKeys.includes(key)) {
              itemsToRemove.push(key);
            }
          }

          // Remove non-essential items
          itemsToRemove.forEach((key) => {
            console.log('🧹 Removing localStorage item:', key);
            localStorage.removeItem(key);
          });

          // If still too large, compress canvasState by removing old base64 data
          const canvasState = localStorage.getItem('canvasState');
          if (canvasState && canvasState.length > 2 * 1024 * 1024) {
            try {
              const workflow = JSON.parse(canvasState);
              if (workflow.nodes) {
                // Remove base64 data from old nodes to free up space
                workflow.nodes = workflow.nodes.map((node) => ({
                  ...node,
                  parameters: this.compressNodeParameters(node.parameters),
                }));

                const compressedState = JSON.stringify(workflow);
                localStorage.setItem('canvasState', compressedState);
                console.log(
                  '🧹 Compressed workflow state from',
                  (canvasState.length / 1024 / 1024).toFixed(2),
                  'MB to',
                  (compressedState.length / 1024 / 1024).toFixed(2),
                  'MB'
                );
              }
            } catch (error) {
              console.warn('Error compressing canvas state:', error);
            }
          }

          // Recalculate size after cleanup
          let newTotalSize = 0;
          for (let key in localStorage) {
            if (localStorage.hasOwnProperty(key)) {
              const value = localStorage.getItem(key);
              newTotalSize += value ? value.length : 0;
            }
          }

          console.log('🧹 localStorage cleanup complete - new size:', (newTotalSize / 1024 / 1024).toFixed(2), 'MB');
        }
      } catch (error) {
        console.warn('Error checking localStorage size:', error);
      }
    },

    // Helper method to compress node parameters by removing large base64 data
    compressNodeParameters(parameters) {
      const compressed = {};
      for (const [key, value] of Object.entries(parameters)) {
        if (typeof value === 'string' && value.startsWith('data:') && value.length > 100000) {
          // Replace large base64 with a placeholder to free up space
          compressed[key] = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ...'; // Placeholder
          console.log('🧹 Compressed parameter', key, 'from', (value.length / 1024).toFixed(1), 'KB to placeholder');
        } else {
          compressed[key] = value;
        }
      }
      return compressed;
    },

    // Safe localStorage setter with size management
    async safeLocalStorageSet(key, value) {
      try {
        const sizeInMB = (value.length / 1024 / 1024).toFixed(2);
        console.log(`💾 Attempting to save ${key} to localStorage (${sizeInMB}MB)`);

        // Check if the value is too large for localStorage (typically 5-10MB limit)
        if (value.length > 5 * 1024 * 1024) {
          console.warn(`⚠️ Data too large for localStorage (${sizeInMB}MB). Attempting compression...`);

          // Try to compress the data further
          try {
            const parsedValue = JSON.parse(value);
            if (parsedValue.nodes) {
              parsedValue.nodes = parsedValue.nodes.map((node) => ({
                ...node,
                parameters: this.compressNodeParameters(node.parameters),
              }));

              const compressedValue = JSON.stringify(parsedValue);
              const compressedSizeInMB = (compressedValue.length / 1024 / 1024).toFixed(2);
              console.log(`🗜️ Compressed from ${sizeInMB}MB to ${compressedSizeInMB}MB`);

              if (compressedValue.length <= 5 * 1024 * 1024) {
                localStorage.setItem(key, compressedValue);
                console.log(`✅ Successfully saved compressed ${key} to localStorage`);
                return true;
              }
            }
          } catch (compressionError) {
            console.warn('Failed to compress data:', compressionError);
          }

          console.warn(`❌ Data still too large after compression. Skipping localStorage save.`);
          return false;
        }

        localStorage.setItem(key, value);
        console.log(`✅ Successfully saved ${key} to localStorage (${sizeInMB}MB)`);
        return true;
      } catch (error) {
        if (error.name === 'QuotaExceededError') {
          console.warn(`💾 localStorage quota exceeded for ${key}. Attempting cleanup...`);

          // Try cleanup and retry once
          await this.checkAndCleanupLocalStorage();

          try {
            localStorage.setItem(key, value);
            console.log(`✅ Successfully saved ${key} to localStorage after cleanup`);
            return true;
          } catch (retryError) {
            console.error(`❌ Failed to save ${key} to localStorage even after cleanup:`, retryError);
            return false;
          }
        } else {
          console.error(`❌ Error saving ${key} to localStorage:`, error);
          return false;
        }
      }
    },

    // Convert base64 data to IndexedDB references for localStorage storage
    async convertBase64ToIndexedDB(nodes) {
      const convertedNodes = await Promise.all(
        nodes.map(async (node) => {
          const convertedParameters = { ...node.parameters };

          // Check for base64 data in parameters and convert to IndexedDB references
          for (const [key, value] of Object.entries(convertedParameters)) {
            if (typeof value === 'string' && value.startsWith('data:')) {
              console.log(`🔄 Converting base64 to IndexedDB for node ${node.id}, parameter ${key}`);

              try {
                // Convert base64 to blob
                const response = await fetch(value);
                const blob = await response.blob();

                // Store in IndexedDB
                const mediaId = `media_${node.id}_${key}_${Date.now()}`;
                const idbReference = await this.storeMediaInIndexedDB(mediaId, blob);

                if (idbReference) {
                  convertedParameters[key] = idbReference;
                  console.log(`✅ Converted base64 to IndexedDB reference: node ${node.id} -> ${idbReference}`);
                } else {
                  // Keep original base64 if IndexedDB fails
                  console.warn(`⚠️ IndexedDB storage failed, keeping base64 for node ${node.id}, parameter ${key}`);
                }
              } catch (error) {
                console.error(`❌ Error converting base64 to IndexedDB for node ${node.id}:`, error);
                // Keep original base64 on error
              }
            }
          }

          return {
            ...node,
            parameters: convertedParameters,
          };
        })
      );

      return convertedNodes;
    },

    // Create compressed version of nodes for localStorage
    async createCompressedNodes(nodes) {
      return nodes.map((node) => {
        const compressedParameters = {};

        // Compress parameters for localStorage storage
        for (const [key, value] of Object.entries(node.parameters)) {
          if (typeof value === 'string' && value.startsWith('data:')) {
            // For base64 data, create a much smaller placeholder for localStorage
            if (value.length > 50000) {
              // 50KB threshold
              compressedParameters[key] = `data:placeholder/compressed;base64,${btoa(`COMPRESSED_MEDIA_${key}_${node.id}`)}`;
              console.log(`🗜️ Compressed parameter ${key} for localStorage (${(value.length / 1024).toFixed(1)}KB → placeholder)`);
            } else {
              compressedParameters[key] = value;
            }
          } else {
            compressedParameters[key] = value;
          }
        }

        return {
          ...node,
          parameters: compressedParameters,
        };
      });
    },
  },
  setup() {
    const route = useRoute();
    const cleanup = useCleanup();
    const handleWorkflowGeneratorRef = ref(null);
    const pollWorkflowStatusRef = ref(null);
    const activeWorkflowId = ref(null);
    const workflowName = ref('My Workflow');
    const customTools = ref([]);
    const customToolsLastFetched = ref(null);
    const CUSTOM_TOOLS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    const isShareable = ref(false);
    const isLoading = ref(true);
    const { proxy } = getCurrentInstance();

    // Expose properties for the Terminal WorkflowDesigner component
    const nodes = ref([]);
    const edges = ref([]);
    const selectedNodeContent = ref(null);
    const selectedEdgeContent = ref(null);

    const getEndpoint = (operation) => {
      const localEndpoint = `${API_CONFIG.BASE_URL}`;
      const publicEndpoint = `${API_CONFIG.REMOTE_URL}`;

      switch (operation) {
        case 'import':
        case 'share':
          return publicEndpoint;
        case 'save':
        case 'load':
        case 'delete':
          return localEndpoint;
        default:
          console.warn(`Unknown operation: ${operation}. Using local endpoint.`);
          return localEndpoint;
      }
    };

    const updateWorkflowName = (name) => {
      workflowName.value = name;
    };

    const loadWorkflow = async (id) => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          console.error('No authentication token found');
          return;
        }

        await fetchCustomTools();

        const isImporting = id.startsWith('shared_');
        const endpoint = getEndpoint(isImporting ? 'import' : 'load');
        const workflowId = isImporting ? id.substring(7) : id;
        const url = `${endpoint}${isImporting ? '/workflows' : '/workflows'}/${workflowId}`;

        const response = await fetch(url, {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!response.ok) {
          if (response.status === 403) {
            throw new Error("This workflow is not shared or you don't have permission to access it.");
          }
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (handleWorkflowGeneratorRef.value) {
          const isOwner = data.user_id === getUserIdFromToken(token);

          if (!isOwner && !data.workflow.isShareable) {
            throw new Error('This workflow is not shared.');
          }

          // If importing or not the owner, generate a new ID and set isShareable to false
          const newWorkflowId = isImporting || !isOwner ? generateUUID() : workflowId;
          const workflowIsShareable = isImporting ? false : isOwner ? data.workflow.isShareable : false;

          // Handle custom tools
          if (data.workflow.customTools && data.workflow.customTools.length > 0) {
            // Merge the workflow's custom tools with the user's custom tools
            const mergedCustomTools = [...customTools.value];
            data.workflow.customTools.forEach((tool) => {
              if (!mergedCustomTools.some((t) => t.type === tool.type)) {
                mergedCustomTools.push(tool);
              }
            });
            customTools.value = mergedCustomTools;
          }

          handleWorkflowGeneratorRef.value(data.workflow);

          if (data.workflow.name) {
            updateWorkflowName(data.workflow.name);
          }

          // Update localStorage with the loaded workflow using safe storage
          const baseNodes = data.workflow.nodes.map((node) => ({
            ...node,
            parameters: { ...node.parameters },
            outputs: { ...node.outputs },
          }));

          // Convert base64 data to IndexedDB references for localStorage storage
          const nodesForLocalStorage = await proxy.convertBase64ToIndexedDB(baseNodes);

          const stateToSave = {
            id: newWorkflowId,
            name: data.workflow.name,
            nodes: nodesForLocalStorage,
            edges: data.workflow.edges,
            zoomLevel: data.workflow.zoomLevel || 1,
            canvasOffsetX: data.workflow.canvasOffsetX || 0,
            canvasOffsetY: data.workflow.canvasOffsetY || 0,
            isTinyNodeMode: data.workflow.isTinyNodeMode || false,
            isShareable: workflowIsShareable,
          };

          // Use safe localStorage setter
          const success = await proxy.safeLocalStorageSet('canvasState', JSON.stringify(stateToSave));
          if (success) {
            localStorage.setItem('activeWorkflow', newWorkflowId);
          } else {
            console.warn('⚠️ Failed to save loaded workflow to localStorage due to size constraints');
            // Still set the active workflow ID
            localStorage.setItem('activeWorkflow', newWorkflowId);
          }
          activeWorkflowId.value = newWorkflowId;
          isShareable.value = workflowIsShareable;

          // Update Vuex store with the loaded workflow state
          if (proxy && proxy.$store) {
            proxy.$store.dispatch('canvas/updateCanvasState', stateToSave);
          }

          if (pollWorkflowStatusRef.value) {
            pollWorkflowStatusRef.value();
          }

          // If importing or not the owner, show a message to the user
          if (isImporting || !isOwner) {
            await proxy.showAlert('A new copy of the workflow has been created for you.', { showCancel: false });
          }
        } else {
          console.error('handleWorkflowGenerator is not available');
        }
      } catch (error) {
        console.error('Error loading workflow:', error);
        await proxy.showAlert(error.message || 'Failed to load workflow. Please try again.', { showCancel: false });
      }
    };

    const fetchCustomTools = async (forceRefresh = false) => {
      // Use cached tools if available and not expired
      const now = Date.now();
      if (
        !forceRefresh &&
        customTools.value.length > 0 &&
        customToolsLastFetched.value &&
        now - customToolsLastFetched.value < CUSTOM_TOOLS_CACHE_TTL
      ) {
        return; // Use cached tools
      }

      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.BASE_URL}/custom-tools`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (Array.isArray(data.tools)) {
          customTools.value = data.tools.map((tool) => ({
            ...tool,
            category: 'custom',
          }));
          customToolsLastFetched.value = now;
        } else {
          console.error('Received invalid data for custom tools:', data);
          customTools.value = [];
        }
      } catch (error) {
        console.error('Error fetching custom tools:', error);
        customTools.value = [];
      }
    };

    // Track if workflow has already been loaded to prevent duplicates
    let hasLoadedWorkflow = false;

    const loadWorkflowFromUrl = () => {
      const workflowId = route.query.id;
      if (workflowId && !hasLoadedWorkflow) {
        // console.log("Loading workflow from URL with ID:", workflowId);
        hasLoadedWorkflow = true;
        loadWorkflow(workflowId);
      } else {
        return;
      }
    };

    const getUserIdFromToken = (token) => {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.userId;
      } catch (error) {
        console.error('Error decoding token:', error);
        return null;
      }
    };

    const { tutorialConfig, startTutorial, onTutorialClose, initializeWorkflowDesigner } = useWorkflowDesigner();

    onMounted(() => {
      initializeWorkflowDesigner();
    });

    onMounted(async () => {
      document.body.setAttribute('data-page', 'workflow-designer');

      // Always check URL first - this is the source of truth
      const urlWorkflowId = route.query.id;

      if (urlWorkflowId) {
        // When loading from URL, use the URL ID as the definitive ID
        activeWorkflowId.value = urlWorkflowId;
        // Don't clear localStorage - let the loadWorkflowFromUrl handle it
      } else {
        // NO URL ID - Clear old workflow data and generate new ID
        console.log('WorkflowDesigner: No URL ID found, clearing old workflow and generating new ID');
        localStorage.removeItem('activeWorkflow');
        localStorage.removeItem('canvasState');

        // Clear Vuex canvas state to prevent old workflow data from persisting
        if (proxy && proxy.$store) {
          proxy.$store.dispatch('canvas/clearCanvasState');
        }

        // Generate new ID for new workflow
        const newWorkflowId = generateUUID();
        activeWorkflowId.value = newWorkflowId;
        localStorage.setItem('activeWorkflow', newWorkflowId);
        console.log('WorkflowDesigner: Generated new workflowId:', newWorkflowId);
      }

      // Load workflow if ID param is set in URL - this will override any generated ID
      loadWorkflowFromUrl();

      await fetchCustomTools();

      cleanup.setTimeout(() => {
        isLoading.value = false;
      }, 500);
    });

    // Update the nodes array watcher
    watch(
      () => nodes.value,
      (newNodes) => {
        // Use $emit to notify the parent component that nodes have been updated
        proxy.$emit('update:nodes', newNodes);
      },
      { deep: true }
    );

    // Update the edges array watcher
    watch(
      () => edges.value,
      (newEdges) => {
        // Use $emit to notify the parent component that edges have been updated
        proxy.$emit('update:edges', newEdges);
      },
      { deep: true }
    );

    // Add watchers for selectedNodeContent and selectedEdgeContent to emit events
    watch(
      () => proxy.selectedNodeContent,
      (newValue) => {
        if (newValue) {
          proxy.$emit('node-selected', newValue);
        }
      }
    );

    watch(
      () => proxy.selectedEdgeContent,
      (newValue) => {
        if (newValue) {
          proxy.$emit('edge-selected', newValue);
        }
      }
    );

    return {
      tutorialConfig,
      startTutorial,
      onTutorialClose,
      loadWorkflow,
      handleWorkflowGeneratorRef,
      pollWorkflowStatusRef,
      activeWorkflowId,
      workflowName,
      updateWorkflowName,
      customTools,
      fetchCustomTools,
      isShareable,
      getEndpoint,
      isLoading,
      nodes, // Expose nodes
      edges, // Expose edges
      selectedNodeContent, // Expose selectedNodeContent
      selectedEdgeContent, // Expose selectedEdgeContent
      cleanup, // Expose cleanup
    };
  },
  async mounted() {
    // Assign the handleWorkflowGenerator method to the ref
    this.handleWorkflowGeneratorRef = this.handleWorkflowGenerator;
    // Assign the pollWorkflowStatus method to the ref
    this.pollWorkflowStatusRef = this.pollWorkflowStatus;

    // Set up watchers to update the exposed refs when data changes
    this.$watch('selectedNodeContent', (newVal) => {
      // This ensures the nodeSelected event gets emitted properly
      this.$emit('node-selected', newVal);
    });

    this.$watch('selectedEdgeContent', (newVal) => {
      // This ensures the edgeSelected event gets emitted properly
      this.$emit('edge-selected', newVal);
    });
  },
  beforeUnmount() {
    this.stopPolling();
    if (this.socket) {
      this.socket.disconnect();
    }
  },
};
</script>

<style scoped>
/* GLOBAL SHARED STYLES FOR THIS PAGE HERE */
body {
  font-family: Arial, sans-serif;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

.hide {
  display: none;
}

.no-select {
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
}

.capitalize {
  text-transform: capitalize;
}

/* Styles copied from TerminalLayout.vue */
.node-based-tool {
  position: relative; /* Ensure positioning context for overlay */
  height: 100vh; /* Ensure it fills the viewport */
  width: 100vw; /* Ensure it fills the viewport */
  box-sizing: border-box; /* Include padding/border in size */
  overflow: hidden; /* Prevent content spill */
}

/* body.cyberpunk .node-based-tool {
  background-color: #0b0b30f7;
  border: 2px solid rgba(18, 224, 255, 0.1);
  box-shadow: 0 0 15px rgba(18, 224, 255, 0.1), inset 0 0 10px rgba(0, 0, 0, 0.25);
} */

.scanline-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(to bottom, rgba(36, 32, 32, 0.25) 50%, rgba(0, 0, 0, 0.5) 50%);
  background-size: 100% 4px;
  z-index: 0;
  pointer-events: none;
  border-radius: inherit;
  opacity: 0.5;
}

/* Ensure other elements are above the overlay */
.canvas-state-controls,
ToolSidebar, /* Assuming ToolSidebar component renders a root element */
Canvas, /* Assuming Canvas component renders a root element */
EditorPanel {
  /* Assuming EditorPanel component renders a root element */
  position: relative; /* Or absolute/fixed as needed */
  z-index: 2; /* Above scanline overlay */
}

.canvas-state-controls {
  position: fixed;
  display: flex;
  top: 16px;
  right: 16px;
  /* z-index: 9; */
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: center;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}

body.cyberpunk .canvas-state-controls {
  top: 16px;
  right: 16px;
}

.canvas-state-controls button {
  padding: 10px;
  border: 1px solid rgba(17, 27, 117, 0.25);
  background: transparent;
  color: var(--Dark-Navy, #01052a);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  align-content: center;
  transition: background-color 0.3s ease;
  cursor: pointer;
  opacity: 0.85;
}

.canvas-state-controls button:hover {
  cursor: pointer !important;
  opacity: 0.6;
}

.canvas-state-controls i {
  font-size: 16px;
  cursor: pointer !important;
}

div#workflow-name {
  margin-right: 16px;
  font-size: var(--font-size-sm);
  opacity: 0.5;
}

body.dark div#workflow-name {
  color: var(--color-med-navy);
}

/* button#workflow-magic-button {
    color: var(--color-pink);
    border-color: var(--color-pink);
}

body.dark button#workflow-magic-button {
    color: var(--color-green);
    border-color: var(--color-green);
} */
</style>

<style>
header {
  display: none !important;
}

body[data-page='workflow-designer'].cyberpunk {
  height: 100vh;
  width: 100vw;
}

body[data-page='workflow-designer'].cyberpunk .node-based-tool {
  height: 100%;
  width: 100%;
}

body[data-page='workflow-designer'].cyberpunk div#app {
  padding: 16px;
  width: calc(100% - 32px);
  height: calc(100% - 32px);
}
</style>
