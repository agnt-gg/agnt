<template>
  <Tooltip :text="getButtonTitle" width="auto" position="bottom">
    <button id="workflow-engine-toggle" @click="toggleWorkflow" :disabled="isButtonDisabled">
      <i :class="getButtonIcon"></i>
    </button>
  </Tooltip>
</template>

<script>
import { API_CONFIG } from '@/tt.config.js';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'WorkflowEngine',
  components: {
    Tooltip,
  },
  props: {
    workflowId: {
      type: String,
      default: null,
    },
    edges: {
      type: Array,
      required: true,
    },
    canvasRef: {
      type: Object,
      default: null,
    },
    workflowStatus: {
      type: String,
      default: 'stopped',
    },
  },
  data() {
    return {
      isAnimating: false,
      animationInterval: null,
      pollInterval: null,
      pollTimeout: null,
      isPolling: false,
      localWorkflowStatus: this.workflowStatus,
      activeWorkflowId: null,
      lastStatusUpdate: null,
    };
  },
  computed: {
    // getButtonIcon() {
    //   if (this.localWorkflowStatus === "queued") {
    //     return "fas fa-hourglass-half";
    //   } else if (this.localWorkflowStatus === "stopping") {
    //     return "fas fa-spinner fa-spin";
    //   }
    //   return this.isAnimating ? "fas fa-stop-circle" : "fas fa-play-circle";
    // },
    // getButtonTitle() {
    //   if (this.localWorkflowStatus === "queued") {
    //     return "Workflow is queued";
    //   } else if (this.localWorkflowStatus === "stopping") {
    //     return "Workflow is stopping";
    //   }
    //   return this.isAnimating ? "Stop Workflow" : "Start Workflow";
    // },
    getButtonIcon() {
      if (this.localWorkflowStatus === 'queued') {
        return 'fas fa-hourglass-half';
      } else if (this.localWorkflowStatus === 'stopping') {
        return 'fas fa-spinner fa-spin';
      }
      return this.isAnimating || this.localWorkflowStatus === 'listening' ? 'fas fa-stop-circle' : 'fas fa-play-circle';
    },
    getButtonTitle() {
      if (this.localWorkflowStatus === 'queued') {
        return 'Workflow is queued';
      } else if (this.localWorkflowStatus === 'stopping') {
        return 'Workflow is stopping';
      } else if (this.localWorkflowStatus === 'listening') {
        return 'Stop Workflow (Listening)';
      }
      return this.isAnimating ? 'Deactivate Workflow' : 'Activate Workflow';
    },
    isButtonDisabled() {
      return this.localWorkflowStatus === 'queued' || this.localWorkflowStatus === 'stopping';
    },
  },
  methods: {
    async toggleWorkflow() {
      // Only start workflow if not already animating and workflow is not in listening state.
      if (!this.isAnimating && this.localWorkflowStatus !== 'listening') {
        // Check if the canvas state exists.
        let canvasState = localStorage.getItem('canvasState');
        if (!canvasState || !localStorage.getItem('activeWorkflow')) {
          // Ask the parent to trigger the save prompt. This should show a modal.
          this.$emit('workflow-save-requested');

          // Wait until canvasState appears in localStorage, or until the user cancels.
          await new Promise((resolve) => {
            const interval = setInterval(() => {
              if (localStorage.getItem('canvasState')) {
                clearInterval(interval);
                resolve();
              }
            }, 200);
          });
        }

        // Recheck canvasState. If the user canceled the save prompt, canvasState will still be null.
        canvasState = localStorage.getItem('canvasState');
        if (!canvasState) {
          // User canceled the saving prompt; abort starting the workflow without changing UI.
          return;
        }

        // Now that we have a valid canvas state, update UI state.
        this.localWorkflowStatus = 'queued';
        this.isAnimating = true;

        // Reduced delay for faster workflow start
        await new Promise((resolve) => setTimeout(resolve, 500));

        try {
          const workflowObj = JSON.parse(canvasState);
          if (!workflowObj || !workflowObj.id) {
            throw new Error('Invalid canvas state.');
          }

          // Emit the workflow ID to the parent.
          this.$emit('workflow-id-set', workflowObj.id);

          // Start workflow on the backend.
          const startResult = await this.startWorkflow(canvasState);
          localStorage.setItem('activeWorkflow', workflowObj.id);
          this.activeWorkflowId = workflowObj.id;
          this.$emit('workflow-id-set', workflowObj.id);

          // Update workflow status.
          this.localWorkflowStatus = startResult.status || 'listening';

          // Start animations and polling.
          this.startAnimation();
          this.startPolling();
          this.$emit('workflow-started');
          this.$emit('animation-state-changed', this.isAnimating);
        } catch (error) {
          console.error('Failed to send workflow:', error);
          this.isAnimating = false;
          this.localWorkflowStatus = 'stopped';
          this.$emit('animation-state-changed', this.isAnimating);
          this.$emit('workflow-error', error.message);
        }
      } else {
        // Otherwise, do the normal “stop” logic
        this.localWorkflowStatus = 'stopping';
        this.$emit('animation-state-changed', this.isAnimating);

        const workflowId = localStorage.getItem('activeWorkflow');
        const stopPromise = this.stopWorkflow(workflowId);

        // Force “stopping” for at least 2 seconds
        await new Promise((resolve) => setTimeout(resolve, 2000));

        try {
          await stopPromise;
          console.log('Workflow ID Stopped:', workflowId);

          this.stopPolling();
          this.stopAnimation();
          this.isAnimating = false;
          this.localWorkflowStatus = 'stopped';
          this.$emit('workflow-stopped');
          this.$emit('animation-state-changed', this.isAnimating);
        } catch (error) {
          console.error('Failed to stop workflow:', error);
          this.isAnimating = true;
          this.$emit('workflow-error', error.message);
        }
      }
    },
    startAnimation() {
      this.playAnimation();
      this.animationInterval = setInterval(this.playAnimation, 5000);
    },
    stopAnimation() {
      clearInterval(this.animationInterval);
      this.animationInterval = null;
      this.edges.forEach(this.stopEdgeAnimation);
    },
    playAnimation() {
      if (this.canvasRef) {
        this.edges.forEach(this.animateEdge);
      }
    },
    animateEdge(edge) {
      if (!this.canvasRef) return;
      const edgeEl = this.canvasRef.querySelector(
        `.edge[data-start="${edge.start.index}-${edge.start.type}"][data-end="${edge.end.index}-${edge.end.type}"]`
      );
      if (edgeEl) {
        const path = edgeEl.querySelector('path');
        if (path) {
          const pathLength = path.getTotalLength();
          path.style.strokeDasharray = `20 10`;
          path.style.strokeDashoffset = `${pathLength}`;
          path.style.animation = 'none';
          path.getBoundingClientRect(); // Force reflow
          path.style.animation = 'dashOffset 20s linear infinite';
        }
      }
    },
    stopEdgeAnimation(edge) {
      if (!this.canvasRef) return;
      const edgeEl = this.canvasRef.querySelector(
        `.edge[data-start="${edge.start.index}-${edge.start.type}"][data-end="${edge.end.index}-${edge.end.type}"]`
      );
      if (edgeEl) {
        const path = edgeEl.querySelector('path');
        if (path) {
          path.style.animation = 'none';
        }
      }
    },
    async startWorkflow(workflow) {
      console.log('🚀 Starting workflow with data:', workflow);
      try {
        const workflowObj = JSON.parse(workflow);
        const token = localStorage.getItem('token');
        const userId = localStorage.getItem('userId');

        workflowObj.userId = userId;

        if (!token) {
          throw new Error('No authentication token found');
        }

        // Resolve IndexedDB references to actual base64 data before sending to backend
        console.log('🔄 CRITICAL: Resolving IndexedDB references before workflow execution...');
        console.log(
          '🔍 Original workflow nodes:',
          workflowObj.nodes.map((n) => ({ id: n.id, parameters: n.parameters }))
        );

        const workflowWithResolvedMedia = await this.resolveIndexedDBReferences(workflowObj);

        console.log(
          '🔍 Resolved workflow nodes:',
          workflowWithResolvedMedia.nodes.map((n) => ({ id: n.id, parameters: n.parameters }))
        );
        console.log('✅ CRITICAL: IndexedDB references resolved for backend execution');

        // Double-check that no idb:// references remain
        const workflowString = JSON.stringify(workflowWithResolvedMedia);
        const remainingIdbRefs = workflowString.match(/idb:\/\/[a-f0-9-]+/g);
        if (remainingIdbRefs) {
          console.error('❌ CRITICAL ERROR: IndexedDB references still present after resolution:', remainingIdbRefs);
          console.error('❌ Workflow string sample:', workflowString.substring(0, 1000));
          throw new Error('Failed to resolve all IndexedDB references: ' + remainingIdbRefs.join(', '));
        }

        console.log('✅ VERIFICATION: No IndexedDB references found in resolved workflow');

        // Log the final workflow size for debugging
        const workflowSize = (workflowString.length / 1024 / 1024).toFixed(2);
        console.log(`📦 Final workflow size: ${workflowSize} MB`);

        const response = await fetch(`${API_CONFIG.BASE_URL}/workflows/${workflowObj.id}/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ workflow: workflowWithResolvedMedia }),
        });

        const data = await response.json();

        if (!response.ok) {
          console.error('❌ Backend error response:', data);
          throw new Error(data.error || `HTTP error! status: ${response.status}`);
        }

        console.log('✅ Workflow started successfully:', data);
        this.$emit('workflow-status-update', {
          status: 'running',
          isActive: true,
        });

        // Only update local status if it's not "queued"
        if (this.localWorkflowStatus !== 'queued') {
          this.localWorkflowStatus = 'running';
        }

        // Start polling immediately
        this.activeWorkflowId = workflowObj.id;
        this.startPolling();

        return data;
      } catch (error) {
        console.error('❌ CRITICAL ERROR sending workflow:', error);
        console.error('❌ Error stack:', error.stack);
        this.$emit('workflow-error', error.message);
        throw error;
      }
    },
    async stopWorkflow(workflowId) {
      const token = localStorage.getItem('token');
      const apiUrl = `${API_CONFIG.BASE_URL}/workflows/${workflowId}/stop`;

      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          credentials: 'include',
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('Workflow stopped successfully:', data);

        // Check the actual status after stopping
        const statusResponse = await fetch(`${API_CONFIG.BASE_URL}/workflows/${workflowId}/status`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        });

        const statusData = await statusResponse.json();

        this.isAnimating = statusData.isActive;
        this.$emit('workflow-stopped', workflowId);
        this.$emit('workflow-status-update', statusData);

        if (!statusData.isActive) {
          this.stopPolling();
        } else {
          console.log('Workflow is still active, continuing to poll');
          this.startPolling();
        }
      } catch (error) {
        console.error('Error stopping workflow:', error);
        this.$emit('workflow-error', error.message);
        throw error;
      }
    },
    async getWorkflow(workflowId) {
      const apiUrl = `${API_CONFIG.BASE_URL}/workflows/${workflowId}`;

      try {
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || `HTTP error! status: ${response.status}`);
        }

        console.log('Workflow retrieved successfully:', data);
        return data.workflow;
      } catch (error) {
        console.error('Error retrieving workflow:', error);
        this.$emit('workflow-error', error.message);
        throw error;
      }
    },
    async updateWorkflow(workflowId, workflow) {
      const apiUrl = `${API_CONFIG.BASE_URL}/workflows/${workflowId}`;

      try {
        const response = await fetch(apiUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ workflow: JSON.parse(workflow) }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || `HTTP error! status: ${response.status}`);
        }

        console.log('Workflow updated successfully:', data);
        this.$emit('workflow-updated', workflowId);
        return data;
      } catch (error) {
        console.error('Error updating workflow:', error);
        this.$emit('workflow-error', error.message);
        throw error;
      }
    },
    async pollWorkflowStatus() {
      if (!this.activeWorkflowId) {
        return;
      }

      if (this.isPolling) {
        console.log('Already polling, skipping');
        return;
      }

      this.isPolling = true;

      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.BASE_URL}/workflows/${this.activeWorkflowId}/status`, {
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
        console.log('Received status update:', data);

        // Only emit if the status has changed
        if (JSON.stringify(data) !== JSON.stringify(this.lastStatusUpdate)) {
          this.$emit('workflow-status-update', data);
          this.lastStatusUpdate = data;
        }

        // Continue polling if the workflow is still running, listening, or has an error
        if (data.status === 'running' || data.status === 'queued' || data.status === 'listening' || data.status === 'error' || data.isActive) {
          this.schedulePoll();
        } else {
          console.log('Workflow is no longer running, stopping polling');
          this.$emit('workflow-stopped');
          this.stopPolling();
        }
      } catch (error) {
        console.error('Error polling workflow status:', error);
        this.$emit('workflow-error', error);
        this.schedulePoll();
      } finally {
        this.isPolling = false;
      }
    },
    schedulePoll() {
      if (this.pollTimeout) {
        clearTimeout(this.pollTimeout);
      }
      this.pollTimeout = setTimeout(() => this.pollWorkflowStatus(), 5000);
    },
    startPolling() {
      this.stopPolling(); // Ensure any existing polling is stopped
      this.pollWorkflowStatus(); // Poll immediately
    },
    stopPolling() {
      if (this.pollTimeout) {
        clearTimeout(this.pollTimeout);
        this.pollTimeout = null;
      }
      this.isPolling = false;
    },

    // IndexedDB helper functions for media resolution before backend execution
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
          // Convert blob to base64 data URL for backend
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(result.blob);
          });
        }
        return null;
      } catch (error) {
        console.error('Error retrieving media from IndexedDB:', error);
        return null;
      }
    },

    // Resolve IndexedDB references in workflow to actual base64 data for backend execution
    async resolveIndexedDBReferences(workflow) {
      console.log('🔄 CRITICAL: Starting BULLETPROOF IndexedDB reference resolution...');
      console.log('🔍 Input workflow nodes:', workflow.nodes?.length || 0);

      try {
        // Convert the entire workflow to a JSON string to find ALL idb:// references
        let workflowString = JSON.stringify(workflow);
        console.log('🔍 Original workflow size:', workflowString.length, 'characters');

        // Find ALL idb:// references in the entire workflow
        const allIdbRefs = workflowString.match(/idb:\/\/[a-f0-9-]+/g) || [];
        console.log('🔍 Found IndexedDB references:', allIdbRefs);

        if (allIdbRefs.length === 0) {
          console.log('ℹ️ No IndexedDB references found in workflow');
          return workflow;
        }

        // Get unique references
        const uniqueIdbRefs = [...new Set(allIdbRefs)];
        console.log('🔄 CRITICAL: Processing', uniqueIdbRefs.length, 'unique IndexedDB references:', uniqueIdbRefs);

        // Resolve each IndexedDB reference
        for (const idbRef of uniqueIdbRefs) {
          const mediaId = idbRef.replace('idb://', '');
          console.log(`🔄 CRITICAL: Resolving IndexedDB reference: ${idbRef} (ID: ${mediaId})`);

          try {
            const base64DataUrl = await this.getMediaFromIndexedDB(mediaId);
            if (base64DataUrl) {
              // Replace ALL occurrences of this reference in the entire workflow string
              const beforeLength = workflowString.length;
              workflowString = workflowString.replaceAll(idbRef, base64DataUrl);
              const afterLength = workflowString.length;

              console.log(`✅ CRITICAL: Successfully resolved ${idbRef}`);
              console.log(`📦 Base64 data length: ${base64DataUrl.length} characters`);
              console.log(`📦 Base64 data starts with: ${base64DataUrl.substring(0, 50)}`);
              console.log(`📏 Workflow size change: ${beforeLength} -> ${afterLength} characters`);
            } else {
              console.error(`❌ CRITICAL: Failed to retrieve media from IndexedDB for ID: ${mediaId}`);
              throw new Error(`Failed to retrieve media from IndexedDB: ${mediaId}`);
            }
          } catch (mediaError) {
            console.error(`❌ CRITICAL: Error retrieving media for ${mediaId}:`, mediaError);
            throw new Error(`Failed to resolve IndexedDB reference ${mediaId}: ${mediaError.message}`);
          }
        }

        // Parse the resolved workflow back to object
        const resolvedWorkflow = JSON.parse(workflowString);
        console.log('✅ CRITICAL: Completed IndexedDB reference resolution');
        console.log('📦 Final workflow size:', workflowString.length, 'characters');

        // Final verification - check for any remaining idb:// references
        const remainingRefs = workflowString.match(/idb:\/\/[a-f0-9-]+/g);
        if (remainingRefs) {
          console.error('❌ CRITICAL: IndexedDB references still remain after resolution:', remainingRefs);
          console.error('❌ Sample of resolved workflow JSON:', workflowString.substring(0, 2000));
          throw new Error('IndexedDB resolution failed - references still present: ' + remainingRefs.join(', '));
        }

        console.log('🎯 VERIFICATION PASSED: No IndexedDB references found in resolved workflow');
        console.log('🔍 Resolved workflow nodes:', resolvedWorkflow.nodes?.length || 0);

        return resolvedWorkflow;
      } catch (error) {
        console.error('❌ CRITICAL: Error in resolveIndexedDBReferences:', error);
        throw error;
      }
    },
  },
  beforeDestroy() {
    clearInterval(this.animationInterval);
  },
  mounted() {
    // this.startPolling();
  },
  beforeUnmount() {
    this.stopPolling();
  },
  watch: {
    workflowId: {
      immediate: true,
      handler(newId) {
        this.stopPolling();
        if (newId) {
          this.startPolling();
        }
      },
    },
    workflowStatus: {
      immediate: true,
      handler(newStatus) {
        const shouldBeAnimating = newStatus === 'running' || newStatus === 'listening' || newStatus === 'error';
        this.localWorkflowStatus = newStatus;
        if (this.isAnimating !== shouldBeAnimating) {
          this.isAnimating = shouldBeAnimating;
          this.$emit('animation-state-changed', this.isAnimating);
        }
      },
    },
  },
};
</script>

<style scoped>
#workflow-engine-toggle {
  /* position: fixed;
    top: 8px;
    right: 180px; */
  z-index: 1000;
  padding: 10px;
  border: 1px solid rgba(1, 5, 42, 0.25);
  background: transparent;
  color: var(--Dark-Navy, #01052a);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.3s ease;
  cursor: pointer;
  opacity: 1;
}

#workflow-engine-toggle:hover {
  cursor: pointer !important;
  opacity: 0.6;
}

#workflow-engine-toggle i {
  font-size: 16px;
  cursor: pointer !important;
}

#workflow-engine-toggle:disabled i {
  /* cursor: not-allowed !important; */
  user-select: none;
  opacity: 0.5;
}
#workflow-engine-toggle:disabled {
  /* cursor: not-allowed !important; */
  user-select: none;
  opacity: 0.5;
}
#workflow-engine-toggle:disabled:hover {
  opacity: 0.5;
}
</style>
