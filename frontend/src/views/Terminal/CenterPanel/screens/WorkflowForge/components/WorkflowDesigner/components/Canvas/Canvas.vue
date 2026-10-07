<template>
  <div
    id="canvas-container"
    @pointerdown="onTouchStart"
    @pointermove="onTouchMove"
    @pointerup="onTouchEnd"
    @pointercancel="onTouchEnd"
    @lostpointercapture="onTouchEnd"
    @mousedown.self.prevent="startPanning"
    @mousemove.self="handleCanvasMouseMove"
    @mouseup.self="handleCanvasMouseUp"
    @click.self="handleCanvasClick"
    @wheel.self="handleZoom"
    @dragenter.self="handleCanvasDragEnter"
    @dragover.self.prevent="handleCanvasDragOver"
    @dragleave.self="handleCanvasDragLeave"
    @drop.self="handleDrop"
  >
    <!-- The container always fills the viewport and is never transformed, so
         it carries the dot grid (infinite by construction) and catches the
         pointer anywhere the zoomed-out #canvas does not reach. `.self`: only
         those bare areas; everything over the canvas is handled there.
         (This comment lives INSIDE the root: one at template top level makes
         the component a fragment, and this.$el stops being an element.) -->
    <div
      id="canvas"
      data-tour-id="workflows.canvas"
      class="tiny-nodes"
      :class="{ 'canvas-drag-hover': isCanvasDragHover }"
      ref="canvas"
      @mousedown.prevent="startPanning"
      @dragenter="handleCanvasDragEnter"
      @dragover.prevent="handleCanvasDragOver"
      @dragleave="handleCanvasDragLeave"
      @drop="handleDrop"
      @mousemove="handleCanvasMouseMove"
      @mouseup="handleCanvasMouseUp"
      @click="handleCanvasClick"
      @wheel="handleZoom"
      @keydown="handleKeyDown"
      tabindex="0"
    >
      <!-- Canvas drag overlay for visual feedback -->
      <div v-if="isCanvasDragHover" class="canvas-drag-overlay">
        <div class="canvas-drag-message">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M21 19V5C21 3.9 20.1 3 19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19ZM8.5 13.5L11 16.51L14.5 12L19 18H5L8.5 13.5Z"
              fill="currentColor"
            />
          </svg>
          <span>Drop media files to create nodes automatically</span>
        </div>
      </div>
      <div id="grid-overlay" class="grid-overlay"></div>

      <!-- Selection rectangle -->
      <div v-if="isSelecting" class="selection-rectangle" :style="selectionRectangleStyle"></div>
      <Node
        v-for="(node, index) in nodes"
        :key="node.id || index"
        :node="node"
        :index="index"
        :gridSize="gridSize"
        :isTinyNodeMode="isTinyNodeMode"
        :nodeWidth="nodeWidth"
        :output="node.output"
        :error="node.error"
        @select-node="selectNode"
        @start-dragging="startDragging"
        @start-editing="$emit('start-editing', $event)"
        @finish-editing="(index, content) => $emit('finish-editing', index, content)"
        @update-content="$emit('update-content', $event)"
        @adjust-node-size="$emit('adjust-node-size', $event)"
        @start-connecting="startConnecting"
        @delete-node="$emit('delete-node', $event)"
        @update-node-parameter="handleUpdateNodeParameter"
        @show-notification="$emit('show-notification', $event)"
      />
      <svg class="edges">
        <Edge
          v-for="(edge, index) in edges"
          :key="edge.id || index"
          :edge="edge"
          :isAnimating="isAnimating"
          :nodeWidth="nodeWidth"
          :isSelected="edge.id === selectedEdgeId"
          :isStartTrigger="isStartNodeTrigger(edge.start.id)"
          @select-edge="selectEdge(edge.id)"
        />
      </svg>
      <svg v-if="tempEdge" class="temp-edge">
        <Edge :edge="tempEdge" :isAnimating="false" :isTemp="true" :nodeWidth="nodeWidth" />
      </svg>
    </div>
  </div>
</template>

<script>
import Node from './components/Node/Node.vue';
import Edge from './components/Edge/Edge.vue';
import { centeredView, gridLayout } from './canvasView.js';

export default {
  name: 'Canvas',
  components: { Node, Edge },
  props: {
    nodes: Array,
    edges: Array,
    gridSize: Number,
    isAnimating: Boolean,
    selectedEdgeId: {
      type: String,
      default: null,
    },
    selectedNodeIndex: {
      type: Number,
      default: null,
    },
    isTinyNodeMode: {
      type: Boolean,
      default: false,
    },
    nodeWidth: {
      type: Number,
      required: true,
    },
  },
  data() {
    return {
      draggedNodeIndex: null,
      offsetX: 0,
      offsetY: 0,
      startConnector: null,
      tempEdge: null,
      isPanning: false,
      panStartX: 0,
      panStartY: 0,
      canvasOffsetX: 0,
      canvasOffsetY: 0,
      zoomLevel: 1,
      // One floor for wheel, Fit and load-centring: a graph centred at 0.3
      // must not jump to a higher floor on the first wheel tick.
      minZoomLevel: 0.2,
      maxZoomLevel: 2,
      zoomSpeed: 0.001,
      selectedEdgeIndex: null,
      // Selection state
      isSelecting: false,
      selectionStartX: 0,
      selectionStartY: 0,
      selectionEndX: 0,
      selectionEndY: 0,
      selectedNodeIndices: new Set(),
      isDraggingMultiple: false,
      justFinishedSelection: false,
      // Media file drag state
      isCanvasDragHover: false,
      dragCounter: 0,
      touchGesture: null,
    };
  },
  computed: {
    selectionRectangleStyle() {
      if (!this.isSelecting) return {};

      const minX = Math.min(this.selectionStartX, this.selectionEndX);
      const minY = Math.min(this.selectionStartY, this.selectionEndY);
      const width = Math.abs(this.selectionEndX - this.selectionStartX);
      const height = Math.abs(this.selectionEndY - this.selectionStartY);

      return {
        position: 'absolute',
        left: `${minX}px`,
        top: `${minY}px`,
        width: `${width}px`,
        height: `${height}px`,
        border: '2px dashed var(--color-primary)',
        backgroundColor: 'rgba(var(--primary-rgb), 0.1)',
        pointerEvents: 'none',
        zIndex: 10,
      };
    },
  },
  mounted() {
    this.updateCanvasTransform();
    // The grid's alignment depends on the viewport size (the transform origin
    // is its centre), so a resize re-places it.
    if (typeof ResizeObserver !== 'undefined') {
      this._gridObserver = new ResizeObserver(() => this.updateGrid());
      this._gridObserver.observe(this.$el);
    }
  },
  beforeUnmount() {
    this._centerObserver?.disconnect();
    this._gridObserver?.disconnect();
  },
  methods: {
    /**
     * Centre the graph in the viewport. `zoom` is kept when the graph fits at
     * it; `fit` zooms to fill instead. A canvas mounted while hidden has no
     * size yet, so the request is held and applied the first time it has one.
     */
    centerGraph({ zoom = this.zoomLevel, fit = false } = {}) {
      const host = this.$el?.getBoundingClientRect?.();
      const elements = new Map([...(this.$refs.canvas?.querySelectorAll?.('.node[data-id]') || [])].map((el) => [el.dataset.id, el]));
      const boxes = this.nodes.map((node) => {
        const el = elements.get(String(node.id));
        return { x: node.x, y: node.y, width: el?.offsetWidth || this.nodeWidth, height: el?.offsetHeight || 48 };
      });
      // On a phone a whole-graph fit is unreadable; open at a legible zoom instead.
      const narrow = typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 800px)').matches;
      const view = centeredView(boxes, host, { zoom, fit, minZoom: this.minZoomLevel, readableZoom: narrow ? 0.6 : 0 });
      if (!view) {
        if (boxes.length && !(host?.width > 0)) this.deferCentering({ zoom, fit });
        return false;
      }
      this.zoomLevel = view.zoom;
      this.canvasOffsetX = view.offsetX;
      this.canvasOffsetY = view.offsetY;
      this.$emit('update:zoomLevel', view.zoom);
      this.updateCanvasTransform();
      return true;
    },
    deferCentering(request) {
      if (typeof ResizeObserver === 'undefined') return;
      this._pendingCenter = request;
      if (this._centerObserver) return;
      this._centerObserver = new ResizeObserver(() => {
        if (!this._pendingCenter || !(this.$el.getBoundingClientRect().width > 0)) return;
        const pending = this._pendingCenter;
        this._pendingCenter = null;
        this._centerObserver.disconnect();
        this._centerObserver = null;
        this.centerGraph(pending);
      });
      this._centerObserver.observe(this.$el);
    },
    isStartNodeTrigger(nodeId) {
      const node = this.nodes.find((n) => n.id === nodeId);
      return node && node.category === 'trigger';
    },
    handleDrop(e) {
      e.preventDefault();
      e.stopPropagation();

      // Reset drag state
      this.isCanvasDragHover = false;
      this.dragCounter = 0;

      const files = Array.from(e.dataTransfer.files || []);

      if (files.length > 0) {
        // Handle direct media file drops - create media nodes automatically
        console.log('🎯 Canvas handleDrop - media files detected:', files);
        this.handleMediaFileDrop(e, files);
      } else {
        // Existing tool library logic
        try {
          const data = JSON.parse(e.dataTransfer.getData('text'));
          const rect = this.$refs.canvas.getBoundingClientRect();
          const x = (e.clientX - rect.left) / this.zoomLevel;
          const y = (e.clientY - rect.top) / this.zoomLevel;
          this.$emit('create-node', data, x, y);
        } catch (error) {
          console.error('Error parsing dropped data:', error);
        }
      }
    },

    // Canvas drag event handlers for media files
    handleCanvasDragEnter(e) {
      e.preventDefault();
      e.stopPropagation();

      const files = Array.from(e.dataTransfer.files || []);
      if (files.length > 0 && files.some((file) => this.isValidMediaFile(file))) {
        this.dragCounter++;
        if (this.dragCounter === 1) {
          this.isCanvasDragHover = true;
          console.log('🎯 Canvas drag enter - showing media drop overlay');
        }
      }
    },

    handleCanvasDragOver(e) {
      e.preventDefault();
      e.stopPropagation();

      // Allow drop for media files
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length > 0 && files.some((file) => this.isValidMediaFile(file))) {
        e.dataTransfer.dropEffect = 'copy';
      }
    },

    handleCanvasDragLeave(e) {
      e.preventDefault();
      e.stopPropagation();

      this.dragCounter--;
      if (this.dragCounter <= 0) {
        this.isCanvasDragHover = false;
        this.dragCounter = 0;
        console.log('🎯 Canvas drag leave - hiding media drop overlay');
      }
    },

    // Handle media file drops
    async handleMediaFileDrop(e, files) {
      const rect = this.$refs.canvas.getBoundingClientRect();
      const baseX = (e.clientX - rect.left) / this.zoomLevel;
      const baseY = (e.clientY - rect.top) / this.zoomLevel;

      let validFiles = 0;
      let processedFiles = 0;
      const gridSize = this.gridSize || 16;

      console.log('🎯 Processing', files.length, 'dropped files');

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        console.log('📎 Processing file:', file.name, file.type, file.size);

        // Validate file type and size
        if (this.isValidMediaFile(file) && file.size <= 10 * 1024 * 1024) {
          // 10MB limit
          try {
            const blobUrl = URL.createObjectURL(file);
            const isVideo = file.type.startsWith('video/');

            console.log('🔗 Created blob URL for', file.name, ':', blobUrl);

            // Create the media node data structure with actual parameter values
            const mediaNodeData = {
              title: 'Media Preview',
              category: 'utility',
              type: 'media-preview',
              icon: 'image',
              description: 'Displays a preview of images or videos from URLs, base64 data, or streaming platforms',
              parameters: {
                mediaSource: blobUrl, // Set the actual blob URL value
                mediaType: isVideo ? 'video' : 'image', // Set the detected media type
              },
              outputs: {
                success: {
                  type: 'boolean',
                  description: 'Whether the media was successfully processed',
                },
                mediaUrl: {
                  type: 'string',
                  description: 'The processed media URL or base64 data',
                },
                mediaType: {
                  type: 'string',
                  description: "The detected media type ('image' or 'video')",
                },
              },
            };

            // Position nodes with smart spacing for multiple files
            const nodeX = Math.round((baseX + (validFiles % 3) * 320) / gridSize) * gridSize;
            const nodeY = Math.round((baseY + Math.floor(validFiles / 3) * 200) / gridSize) * gridSize;

            console.log('📍 Positioning node at:', nodeX, nodeY);

            // Create the node
            this.$emit('create-node', mediaNodeData, nodeX, nodeY);

            validFiles++;
            processedFiles++;
          } catch (error) {
            console.error('❌ Error processing file:', file.name, error);
            this.$emit('show-notification', {
              type: 'error',
              message: `Failed to process ${file.name}: ${error.message}`,
            });
          }
        } else {
          const reason =
            file.size > 10 * 1024 * 1024
              ? `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum size is 10MB.`
              : `Invalid file type: ${file.type || 'unknown'}. Please use image or video files.`;

          console.warn('❌ Invalid file:', file.name, reason);
          this.$emit('show-notification', {
            type: 'error',
            message: `${file.name}: ${reason}`,
          });
        }
      }

      if (validFiles > 0) {
        console.log('✅ Successfully created', validFiles, 'media preview nodes');
        this.$emit('show-notification', {
          type: 'success',
          message: `Created ${validFiles} media preview node${validFiles > 1 ? 's' : ''} from dropped files`,
        });
      }
    },

    // File validation helper (reused from Node.vue)
    isValidMediaFile(file) {
      const validImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp'];

      const validVideoTypes = [
        'video/mp4',
        'video/webm',
        'video/ogg',
        'video/mov',
        'video/avi',
        'video/x-msvideo',
        'video/quicktime',
        'video/x-ms-wmv',
      ];

      return validImageTypes.includes(file.type) || validVideoTypes.includes(file.type);
    },
    onTouchStart(e) {
      if (e.pointerType === 'mouse' || this.touchGesture || e.target.closest('input,textarea,select,button,a,iframe,.connector')) return;
      const nodeElement = e.target.closest('.node');
      const index = nodeElement ? this.nodes.findIndex(n => n.id === nodeElement.dataset.id) : -1;
      const node = this.nodes[index];
      this.touchGesture = { pointerId:e.pointerId, index, x:e.clientX, y:e.clientY, offsetX:this.canvasOffsetX, offsetY:this.canvasOffsetY, nodeX:node?.x, nodeY:node?.y };
      e.currentTarget.setPointerCapture?.(e.pointerId); e.preventDefault();
    },
    onTouchMove(e) {
      const g = this.touchGesture; if (!g || g.pointerId !== e.pointerId) return;
      const dx=e.clientX-g.x, dy=e.clientY-g.y;
      g.moved = g.moved || Math.abs(dx) + Math.abs(dy) > 6;
      if (g.index >= 0 && this.nodes[g.index]) { this.nodes[g.index].x=g.nodeX+dx/this.zoomLevel; this.nodes[g.index].y=g.nodeY+dy/this.zoomLevel; this.$emit('update-edges'); }
      else { this.canvasOffsetX=g.offsetX+dx; this.canvasOffsetY=g.offsetY+dy; this.updateCanvasTransform(); }
      e.preventDefault();
    },
    onTouchEnd(e) {
      const gesture = this.touchGesture;
      if (gesture?.pointerId !== e.pointerId) return;
      this.touchGesture = null;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      if (!['pointercancel', 'lostpointercapture'].includes(e.type) && gesture.index >= 0 && !gesture.moved) this.$emit('select-node', gesture.index);
    },
    mobileZoom(delta) { this.zoomLevel=Math.max(this.minZoomLevel,Math.min(2,this.zoomLevel+delta)); this.updateCanvasTransform(); },
    fitMobileGraph() {
      this.centerGraph({ fit: true });
    },
    startDragging(e, index) {
      // Deselect edge immediately when starting to drag a node
      if (this.selectedEdgeIndex !== null) {
        this.selectedEdgeIndex = null;
        this.$emit('deselect-all-edges');
      }

      if (e.target.classList.contains('connector')) return;

      // If clicking on a selected node, drag all selected nodes
      if (this.selectedNodeIndices.has(index)) {
        this.draggedNodeIndex = index;
        this.isDraggingMultiple = true;
      } else {
        // Single node drag - clear selection and select this node
        this.selectedNodeIndices.clear();
        this.selectedNodeIndices.add(index);
        this.nodes.forEach((node, i) => {
          node.isSelected = i === index;
        });
        this.$emit('select-node', index);
        this.draggedNodeIndex = index;
        this.isDraggingMultiple = false;
      }

      const nodeElement = e.target.closest('.node');
      const rect = nodeElement.getBoundingClientRect();
      const canvasRect = this.$refs.canvas.getBoundingClientRect();

      this.offsetX = (e.clientX - rect.left) / this.zoomLevel + this.canvasOffsetX / this.zoomLevel;
      this.offsetY = (e.clientY - rect.top) / this.zoomLevel + this.canvasOffsetY / this.zoomLevel;

      document.body.classList.add('no-select');
      document.addEventListener('mousemove', this.drag);
      document.addEventListener('mouseup', this.stopDragging);
      // Tell the Designer the drag started so it can pause workflow-status
      // polling (which rebuilds the nodes array and would drop drag context).
      this.$emit('node-drag-start');
    },
    drag(e) {
      if (this.draggedNodeIndex === null) return;
      const canvasRect = this.$refs.canvas.getBoundingClientRect();
      const gridSize = this.gridSize;

      const newX =
        Math.round(((e.clientX - canvasRect.left) / this.zoomLevel + this.canvasOffsetX / this.zoomLevel - this.offsetX) / gridSize) * gridSize;
      const newY =
        Math.round(((e.clientY - canvasRect.top) / this.zoomLevel + this.canvasOffsetY / this.zoomLevel - this.offsetY) / gridSize) * gridSize;

      if (this.isDraggingMultiple) {
        // Calculate delta from the dragged node's original position
        const draggedNode = this.nodes[this.draggedNodeIndex];
        const deltaX = newX - draggedNode.x;
        const deltaY = newY - draggedNode.y;

        // Move all selected nodes by the same delta
        const updatedNodes = this.nodes.map((node, index) => {
          if (this.selectedNodeIndices.has(index)) {
            return { ...node, x: node.x + deltaX, y: node.y + deltaY };
          }
          return node;
        });

        this.$emit('update:nodes', updatedNodes);
      } else {
        // Single node drag (existing logic)
        this.$emit(
          'update:nodes',
          this.nodes.map((node, index) => (index === this.draggedNodeIndex ? { ...node, x: newX, y: newY } : node))
        );
      }

      this.$emit('update-edges');
    },
    stopDragging() {
      this.draggedNodeIndex = null;
      document.body.classList.remove('no-select');
      document.removeEventListener('mousemove', this.drag);
      document.removeEventListener('mouseup', this.stopDragging);

      // Ensure the edge stays deselected after dragging
      if (this.selectedEdgeIndex !== null) {
        this.selectedEdgeIndex = null;
        this.$emit('deselect-all-edges');
      }
      // Resume workflow-status polling now that the drag is over.
      this.$emit('node-drag-end');
    },
    handleCanvasMouseMove(e) {
      if (this.isSelecting) {
        console.log('📍 handleCanvasMouseMove - updating selection');
        this.updateSelection(e);
      } else if (this.draggedNodeIndex !== null) {
        // Handled by drag method
      } else if (this.tempEdge) {
        const canvasRect = this.$refs.canvas.getBoundingClientRect();
        this.tempEdge.endX = (e.clientX - canvasRect.left) / this.zoomLevel;
        this.tempEdge.endY = (e.clientY - canvasRect.top) / this.zoomLevel;
      }
    },
    handleCanvasMouseUp(e) {
      console.log('⬆️ handleCanvasMouseUp called', {
        isSelecting: this.isSelecting,
        isPanning: this.isPanning,
        draggedNodeIndex: this.draggedNodeIndex,
      });

      // If we're in the middle of a selection, let the finishSelection method handle it
      if (this.isSelecting) {
        console.log('⬆️ handleCanvasMouseUp - isSelecting=true, returning early');
        return; // Don't process this mouseup - let finishSelection handle it
      }

      if (this.draggedNodeIndex !== null) {
        console.log('⬆️ handleCanvasMouseUp - handling dragged node');
        this.$emit('select-node', this.draggedNodeIndex);
        this.draggedNodeIndex = null;
      } else if (this.tempEdge) {
        console.log('⬆️ handleCanvasMouseUp - handling temp edge');
        const endConnector = this.findConnectorAtPosition(e.clientX, e.clientY);
        if (endConnector && this.startConnector.type !== endConnector.type && this.startConnector.nodeId !== endConnector.nodeId) {
          this.$emit('create-edge', this.startConnector, endConnector);
        } else if (this.startConnector.type === 'input') {
          const existingEdge = this.edges.find((edge) => edge.end.id === this.startConnector.nodeId);
          if (!existingEdge) {
            this.$emit('create-edge', { nodeId: null, type: 'output' }, this.startConnector);
          }
        }
        this.tempEdge = null;
      }
      this.startConnector = null;
    },
    startConnecting(e, nodeId, type) {
      e.stopPropagation();
      const rect = this.$refs.canvas.getBoundingClientRect();
      this.startConnector = { nodeId, type };

      if (type === 'input') {
        const existingEdge = this.edges.find((edge) => edge.end.id === nodeId);
        if (existingEdge) {
          this.startConnector = {
            nodeId: existingEdge.start.id,
            type: 'output',
            preservedEdgeData: {
              ...(existingEdge.if && { if: existingEdge.if }),
              ...(existingEdge.condition && { condition: existingEdge.condition }),
              ...(existingEdge.value && { value: existingEdge.value }),
              ...(existingEdge.conditions && { conditions: existingEdge.conditions }),
              ...(existingEdge.maxIterations && { maxIterations: existingEdge.maxIterations }),
            },
          };
          this.tempEdge = {
            start: { ...existingEdge.start },
            end: { id: null, type: 'input' },
            startX: existingEdge.startX,
            startY: existingEdge.startY,
            endX: (e.clientX - rect.left) / this.zoomLevel,
            endY: (e.clientY - rect.top) / this.zoomLevel,
          };
          this.$emit(
            'update:edges',
            this.edges.filter((edge) => edge !== existingEdge)
          );
        } else {
          return;
        }
      } else {
        this.tempEdge = {
          start: { id: nodeId, type },
          end: { id: null, type: 'input' },
          startX: (e.clientX - rect.left) / this.zoomLevel,
          startY: (e.clientY - rect.top) / this.zoomLevel,
          endX: (e.clientX - rect.left) / this.zoomLevel,
          endY: (e.clientY - rect.top) / this.zoomLevel,
        };
      }
    },
    findConnectorAtPosition(x, y) {
      const canvasRect = this.$refs.canvas.getBoundingClientRect();
      const adjustedX = x - canvasRect.left - this.canvasOffsetX;
      const adjustedY = y - canvasRect.top - this.canvasOffsetY;
      const connectors = this.$refs.canvas.querySelectorAll('.connector');
      for (let i = 0; i < connectors.length; i++) {
        const rect = connectors[i].getBoundingClientRect();
        const connectorX = rect.left - canvasRect.left - this.canvasOffsetX;
        const connectorY = rect.top - canvasRect.top - this.canvasOffsetY;
        if (adjustedX >= connectorX && adjustedX <= connectorX + rect.width && adjustedY >= connectorY && adjustedY <= connectorY + rect.height) {
          return {
            nodeId: connectors[i].closest('.node').getAttribute('data-id'),
            type: connectors[i].classList.contains('input') ? 'input' : 'output',
          };
        }
      }
      return null;
    },
    startPanning(e) {
      console.log('🖱️ startPanning called', { shiftKey: e.shiftKey, button: e.button, isSelecting: this.isSelecting });

      // Check for Shift key to start selection instead
      if (e.shiftKey) {
        console.log('🔄 Shift key detected - calling startSelection');
        return this.startSelection(e);
      }

      if (e.button !== 1 && e.button !== 0) return; // Only start panning on left click or middle mouse button
      console.log('🖱️ Starting panning mode');
      this.isPanning = true;
      this.panStartX = e.clientX - this.canvasOffsetX;
      this.panStartY = e.clientY - this.canvasOffsetY;
      document.addEventListener('mousemove', this.pan);
      document.addEventListener('mouseup', this.stopPanning);
      document.getElementById('grid-overlay').classList.add('grabbed');
      document.getElementById('canvas-container').classList.add('grabbed');
      document.body.classList.add('no-select'); // Add this line
      e.preventDefault(); // Add this line to prevent default browser behavior
    },
    pan(e) {
      if (!this.isPanning) return;
      const dx = e.clientX - this.panStartX;
      const dy = e.clientY - this.panStartY;
      this.canvasOffsetX = dx;
      this.canvasOffsetY = dy;
      this.updateCanvasTransform();
    },
    stopPanning() {
      this.isPanning = false;
      document.removeEventListener('mousemove', this.pan);
      document.removeEventListener('mouseup', this.stopPanning);
      document.getElementById('grid-overlay').classList.remove('grabbed');
      document.getElementById('canvas-container').classList.remove('grabbed');
      document.body.classList.remove('no-select'); // Add this line
    },
    updateGridSize(size) {
      this.gridSize = size;
      document.documentElement.style.setProperty('--grid-size', `${size}px`);
    },
    handleZoom(e) {
      // Check if the mouse is over a scrollable element within a node
      const target = e.target;
      const scrollableElement = target.closest('.markdown-preview, .code-preview, .pdf-preview, .html-preview, .audio-preview, .chart-preview');

      if (scrollableElement) {
        // Check if the element has scrollable content
        const hasVerticalScroll = scrollableElement.scrollHeight > scrollableElement.clientHeight;
        const hasHorizontalScroll = scrollableElement.scrollWidth > scrollableElement.clientWidth;

        if (hasVerticalScroll || hasHorizontalScroll) {
          // Allow the scroll event to pass through to the element
          return;
        }
      }

      // Otherwise, handle zoom
      e.preventDefault();
      const delta = e.deltaY * this.zoomSpeed;
      this.zoomLevel = Math.max(this.minZoomLevel, Math.min(this.maxZoomLevel, this.zoomLevel - delta));
      this.updateCanvasTransform();
    },
    updateCanvasTransform() {
      const canvas = this.$refs.canvas;
      if (canvas) canvas.style.transform = `translate(${this.canvasOffsetX}px, ${this.canvasOffsetY}px) scale(${this.zoomLevel})`;
      this.updateGrid();
    },
    // Every pan and zoom goes through updateCanvasTransform, so the grid
    // always moves with the canvas (canvasView.gridLayout).
    updateGrid() {
      const el = this.$el;
      if (!el?.style) return;
      const grid = gridLayout({
        width: el.clientWidth,
        height: el.clientHeight,
        offsetX: this.canvasOffsetX,
        offsetY: this.canvasOffsetY,
        zoom: this.zoomLevel,
        base: this.gridSize || 16,
      });
      el.style.setProperty('--grid-spacing', `${grid.spacing}px`);
      el.style.setProperty('--grid-dot', `${grid.dot}px`);
      el.style.setProperty('--grid-x', `${grid.x}px`);
      el.style.setProperty('--grid-y', `${grid.y}px`);
    },
    selectNode(index) {
      if (this.selectedEdgeId) {
        this.$emit('deselect-all-edges');
      }
      this.$emit('update:selectedNodeIndex', index);
    },
    selectEdge(edgeId) {
      this.$emit('select-edge', edgeId);
    },
    handleCanvasClick(e) {
      console.log('🖱️ handleCanvasClick called', {
        isSelecting: this.isSelecting,
        justFinishedSelection: this.justFinishedSelection,
      });

      // If we're in the middle of a selection, complete it instead of clearing
      if (this.isSelecting) {
        console.log('Canvas click during selection - completing selection');
        this.finishSelection();
        return;
      }

      // If we just finished a selection, don't clear it immediately
      if (this.justFinishedSelection) {
        console.log('Canvas click - just finished selection, ignoring click to preserve selection');
        return;
      }

      if (!e.target.closest('.node') && !e.target.closest('path')) {
        console.log('Canvas click - clearing selection');
        // Clear multi-node selection
        this.selectedNodeIndices.clear();
        this.nodes.forEach((node) => {
          node.isSelected = false;
        });

        this.$emit('deselect-all-nodes');
        this.$emit('deselect-all-edges');
        this.selectedEdgeIndex = null;
        if (document.activeElement) {
          document.activeElement.blur();
        }

        this.$emit('update:nodes', [...this.nodes]);
      }
    },
    handleKeyDown(event) {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        // Check if the focused element is within a node
        const focusedElement = document.activeElement;
        const node = focusedElement.closest('.node');

        // If focused on a Label node or any editable content within a node, don't proceed with deletion
        if (
          node &&
          (node.classList.contains('label-node') ||
            focusedElement.tagName === 'INPUT' ||
            focusedElement.tagName === 'TEXTAREA' ||
            focusedElement.getAttribute('contenteditable') === 'true')
        ) {
          return;
        }

        if (this.selectedEdgeId) {
          this.$emit('delete-selected-edge');
        } else if (this.selectedNodeIndex !== null) {
          this.$emit('delete-selected-node', this.selectedNodeIndex);
        }
      }
    },
    // Selection methods
    startSelection(e) {
      console.log('🎯 startSelection called', {
        clientX: e.clientX,
        clientY: e.clientY,
        shiftKey: e.shiftKey,
        currentIsSelecting: this.isSelecting,
      });

      this.isSelecting = true;
      const canvasRect = this.$refs.canvas.getBoundingClientRect();

      // Convert screen coordinates to world coordinates (same logic as tempEdge)
      this.selectionStartX = (e.clientX - canvasRect.left) / this.zoomLevel;
      this.selectionStartY = (e.clientY - canvasRect.top) / this.zoomLevel;
      this.selectionEndX = this.selectionStartX;
      this.selectionEndY = this.selectionStartY;

      console.log('🎯 startSelection - coordinates set', {
        selectionStartX: this.selectionStartX,
        selectionStartY: this.selectionStartY,
        isSelecting: this.isSelecting,
      });

      document.addEventListener('mousemove', this.updateSelection);
      document.addEventListener('mouseup', this.finishSelection);
      console.log('🎯 startSelection - event listeners added');
      e.preventDefault();
    },
    updateSelection(e) {
      console.log('📐 updateSelection called', { isSelecting: this.isSelecting });
      if (!this.isSelecting) return;
      const canvasRect = this.$refs.canvas.getBoundingClientRect();

      // Same coordinate conversion as tempEdge
      this.selectionEndX = (e.clientX - canvasRect.left) / this.zoomLevel;
      this.selectionEndY = (e.clientY - canvasRect.top) / this.zoomLevel;

      console.log('📐 updateSelection - coordinates updated', {
        selectionEndX: this.selectionEndX,
        selectionEndY: this.selectionEndY,
      });
    },
    finishSelection() {
      console.log('🏁 finishSelection called', { isSelecting: this.isSelecting });
      if (!this.isSelecting) return;

      const selectedIndices = this.getNodesInSelection();
      console.log('🏁 finishSelection - nodes in selection', { selectedIndices });

      this.selectedNodeIndices = new Set(selectedIndices);

      // Update node selection state
      this.nodes.forEach((node, index) => {
        node.isSelected = this.selectedNodeIndices.has(index);
      });

      this.isSelecting = false;

      // Set flag to prevent immediate clearing by click handler
      this.justFinishedSelection = true;
      setTimeout(() => {
        this.justFinishedSelection = false;
      }, 50); // Small delay to prevent click handler from clearing selection

      document.removeEventListener('mousemove', this.updateSelection);
      document.removeEventListener('mouseup', this.finishSelection);
      console.log('🏁 finishSelection - event listeners removed, isSelecting set to false, justFinishedSelection flag set');

      this.$emit('update:nodes', [...this.nodes]);
      console.log('🏁 finishSelection - nodes updated and emitted');
    },
    getNodesInSelection() {
      const minX = Math.min(this.selectionStartX, this.selectionEndX);
      const maxX = Math.max(this.selectionStartX, this.selectionEndX);
      const minY = Math.min(this.selectionStartY, this.selectionEndY);
      const maxY = Math.max(this.selectionStartY, this.selectionEndY);

      return this.nodes
        .map((node, index) => ({ node, index }))
        .filter(({ node }) => {
          const nodeRight = node.x + this.nodeWidth;
          const nodeBottom = node.y + 48; // nodeHeight

          return node.x < maxX && nodeRight > minX && node.y < maxY && nodeBottom > minY;
        })
        .map(({ index }) => index);
    },

    // Handle node parameter updates (e.g., from drag & drop media)
    handleUpdateNodeParameter(event) {
      const { nodeId, parameter, value, parameters } = event;

      console.log('🔧 Canvas handleUpdateNodeParameter - received:', event);

      // Find the node and update its parameters
      const updatedNodes = this.nodes.map((node) => {
        if (node.id === nodeId) {
          console.log('🔧 Canvas - found matching node, current parameters:', node.parameters);

          let updatedNode;
          if (parameters) {
            // Batch update (new format)
            updatedNode = {
              ...node,
              parameters: {
                ...node.parameters,
                ...parameters,
              },
            };
          } else {
            // Single parameter update (legacy format)
            updatedNode = {
              ...node,
              parameters: {
                ...node.parameters,
                [parameter]: value,
              },
            };
          }

          console.log('🔧 Canvas - updated node parameters:', updatedNode.parameters);
          return updatedNode;
        }
        return node;
      });

      console.log('🔧 Canvas - emitting update:nodes');
      // Emit the updated nodes
      this.$emit('update:nodes', updatedNodes);
    },
  },
  emits: [
    'update:nodes',
    'update:edges',
    'update:selectedNodeIndex',
    'select-node',
    'select-edge',
    'deselect-all-nodes',
    'deselect-all-edges',
    'create-edge',
    'update-edges',
    'create-node',
    'start-editing',
    'finish-editing',
    'adjust-node-size',
    'delete-node',
    'update-content',
    'delete-selected-edge',
    'delete-selected-node',
    'show-notification',
    'node-drag-start',
    'node-drag-end',
  ],
};
</script>

<style scoped>
#canvas-container {
  margin-left: 0;
  height: 100vh;
  overflow: hidden;
  position: relative;
  /* The dot grid, on the untransformed viewport: infinite at any pan or zoom.
     Spacing, dot size and position are set by updateGrid (gridLayout).
     --canvas-grid-dot carries the FINAL colour and alpha (_semantic.css). */
  background-image: radial-gradient(circle, var(--canvas-grid-dot) var(--grid-dot, 1px), transparent var(--grid-dot, 1px));
  background-size: var(--grid-spacing, 16px) var(--grid-spacing, 16px);
  background-position: var(--grid-x, 0px) var(--grid-y, 0px);
  cursor: grab;
}

#canvas-container.grabbed {
  cursor: grabbing;
}

#canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: transparent;
}

/* The grab surface over the canvas. It draws nothing: the dots are on
   #canvas-container, where they cannot run out. */
.grid-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: transparent;
  z-index: 0;
  width: 300%;
  height: 300%;
  transform: translate(-50%, -50%);
  cursor: grab;
}

.grid-overlay.grabbed {
  cursor: grabbing;
}

svg.edges:focus,
div#canvas:focus {
  outline: none !important;
  border: none !important;
}

/* Canvas drag and drop styling for media files */
.canvas-drag-hover {
  background: rgba(233, 61, 143, 0.05) !important;
  border: 2px dashed var(--color-primary) !important;
  border-radius: 8px;
}

.canvas-drag-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(233, 61, 143, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  pointer-events: none;
  backdrop-filter: blur(2px);
  border-radius: 8px;
}

.canvas-drag-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--color-primary);
  font-weight: 600;
  gap: 16px;
  font-size: 18px;
  text-align: center;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.canvas-drag-message svg {
  opacity: 0.8;
  filter: drop-shadow(0 2px 4px rgba(233, 61, 143, 0.3));
}

.canvas-drag-message span {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 8px;
  color: var(--text-on-fill);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}
</style>
