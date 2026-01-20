<template>
  <div class="ui-panel runs-panel">
    <!-- Selected Execution Details -->
    <div v-if="selectedExecution" class="panel-section selected-execution-section">
      <div class="selected-execution-header">
        <h2>Execution Details</h2>
        <div class="header-actions">
          <Tooltip text="Copy Details" width="auto">
            <button @click="copyExecutionDetails" class="copy-btn">
              <i v-if="!showCopiedMessage" class="fas fa-copy"></i>
              <span v-if="showCopiedMessage">Copied!</span>
            </button>
          </Tooltip>
          <Tooltip text="Close Panel" width="auto">
            <button @click="closePanel" class="close-btn">
              <i class="fas fa-times"></i>
            </button>
          </Tooltip>
        </div>
      </div>

      <div class="selected-execution-content">
        <div class="detail-section">
          <h4>Basic Information</h4>
          <div class="detail-grid">
            <div class="detail-item">
              <label>Run:</label>
              <span>{{ selectedExecution.workflowName || 'Unnamed Workflow' }}</span>
            </div>
            <div class="detail-item">
              <label>Status:</label>
              <span :class="['status-badge', selectedExecution.status.toLowerCase()]">
                <i :class="getStatusIcon(selectedExecution.status)"></i>
                {{ selectedExecution.status }}
              </span>
            </div>
            <div class="detail-item">
              <label>Start Time:</label>
              <span>{{ formatDate(selectedExecution.startTime) }}</span>
            </div>
            <div class="detail-item">
              <label>End Time:</label>
              <span>{{ selectedExecution.endTime ? formatDate(selectedExecution.endTime) : 'Still running' }}</span>
            </div>
            <div class="detail-item">
              <label>Duration:</label>
              <span>{{ calculateDuration(selectedExecution) }}</span>
            </div>
            <div class="detail-item">
              <label>Credits Used:</label>
              <span>{{ selectedExecution.creditsUsed || 0 }}</span>
            </div>
          </div>
        </div>

        <!-- Workflow Actions (only for workflow-type runs) -->
        <div v-if="!selectedExecution.isGoalExecution && selectedExecution.workflowId" class="detail-section workflow-actions-section">
          <h4>Workflow Actions</h4>
          <div class="workflow-actions">
            <button @click="handleEditWorkflow" class="action-button edit">
              <i class="fas fa-edit"></i>
              Edit Workflow
            </button>
          </div>
        </div>

        <!-- Agent Execution: Show Agent Info and Tool Calls -->
        <div v-if="selectedExecution.isAgentExecution" class="detail-section agent-details-section">
          <h4>Agent Information</h4>
          <div class="detail-grid">
            <div v-if="selectedExecution.provider" class="detail-item">
              <label>Provider:</label>
              <span>{{ selectedExecution.provider }}</span>
            </div>
            <div v-if="selectedExecution.model" class="detail-item">
              <label>Model:</label>
              <span>{{ selectedExecution.model }}</span>
            </div>
          </div>

          <!-- Initial Prompt -->
          <div v-if="selectedExecution.initialPrompt" class="agent-prompt-section">
            <div class="io-header" @click="toggleNodeSection('agent-prompt', 'input')">
              <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded('agent-prompt', 'input') }"></i>
              <span>Initial Prompt</span>
            </div>
            <div v-show="isNodeSectionExpanded('agent-prompt', 'input')" class="io-content">
              <pre class="io-data">{{ selectedExecution.initialPrompt }}</pre>
            </div>
          </div>

          <!-- Final Response -->
          <div v-if="selectedExecution.finalResponse" class="agent-response-section">
            <div class="io-header" @click="toggleNodeSection('agent-response', 'output')">
              <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded('agent-response', 'output') }"></i>
              <span>Final Response</span>
            </div>
            <div v-show="isNodeSectionExpanded('agent-response', 'output')" class="io-content">
              <pre class="io-data">{{ selectedExecution.finalResponse }}</pre>
            </div>
          </div>
        </div>

        <!-- Agent Execution: Show Tool Executions -->
        <div
          v-if="selectedExecution.isAgentExecution && selectedExecution.nodeExecutions && selectedExecution.nodeExecutions.length > 0"
          class="detail-section"
        >
          <h4>Tool Executions ({{ selectedExecution.nodeExecutions.length }})</h4>
          <div class="execution-chain">
            <div v-for="(toolExec, index) in selectedExecution.nodeExecutions" :key="toolExec.id" class="chain-node">
              <div class="chain-step">
                <div class="step-number">{{ index + 1 }}</div>
                <div class="step-connector" v-if="index < selectedExecution.nodeExecutions.length - 1"></div>
              </div>

              <div class="node-card tool-exec-card" :class="{ 'has-error': toolExec.error }">
                <div class="node-header">
                  <div class="node-info">
                    <span class="node-id">
                      <i class="fas fa-wrench"></i>
                      {{ toolExec.name }}
                    </span>
                    <span class="node-type">{{ toolExec.node_id?.substring(0, 8) || 'tool' }}</span>
                  </div>
                  <span :class="['node-status', (toolExec.status || 'completed').toLowerCase()]">
                    <i :class="getStatusIcon(toolExec.status || 'completed')"></i>
                    {{ toolExec.status || 'completed' }}
                  </span>
                </div>

                <div class="node-timing">
                  <span v-if="toolExec.start_time">Started: {{ formatTime(toolExec.start_time) }}</span>
                  <span v-if="toolExec.end_time">Ended: {{ formatTime(toolExec.end_time) }}</span>
                  <span v-if="toolExec.credits_used">Credits: {{ toolExec.credits_used }}</span>
                </div>

                <!-- Input Section -->
                <div v-if="toolExec.input" class="node-io-section">
                  <div class="io-header" @click="toggleNodeSection(toolExec.id, 'input')">
                    <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(toolExec.id, 'input') }"></i>
                    <span>Input</span>
                    <span class="io-size">({{ getDataSize(toolExec.input) }})</span>
                  </div>
                  <div v-show="isNodeSectionExpanded(toolExec.id, 'input')" class="io-content">
                    <pre class="io-data">{{ formatJSON(toolExec.input) }}</pre>
                  </div>
                </div>

                <!-- Output Section -->
                <div v-if="toolExec.output" class="node-io-section">
                  <div class="io-header" @click="toggleNodeSection(toolExec.id, 'output')">
                    <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(toolExec.id, 'output') }"></i>
                    <span>Output</span>
                    <span class="io-size">({{ getDataSize(toolExec.output) }})</span>
                  </div>
                  <div v-show="isNodeSectionExpanded(toolExec.id, 'output')" class="io-content">
                    <pre class="io-data">{{ formatJSON(toolExec.output) }}</pre>
                  </div>
                </div>

                <!-- Error Section -->
                <div v-if="toolExec.error" class="node-io-section error-section">
                  <div class="io-header" @click="toggleNodeSection(toolExec.id, 'error')">
                    <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(toolExec.id, 'error') }"></i>
                    <span>Error</span>
                  </div>
                  <div v-show="isNodeSectionExpanded(toolExec.id, 'error')" class="io-content">
                    <pre class="error-data">{{ toolExec.error }}</pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Goal Execution: Show Tasks -->
        <div v-else-if="selectedExecution.isGoalExecution && selectedExecution.nodeExecutions" class="detail-section">
          <h4>Tasks ({{ selectedExecution.nodeExecutions.length }})</h4>
          <div class="execution-chain">
            <div v-for="(task, index) in selectedExecution.nodeExecutions" :key="task.id" class="chain-node">
              <div class="node-card task-card" :class="task.status.toLowerCase()">
                <div class="node-header">
                  <div class="node-info">
                    <span class="node-id">{{ task.title || 'Untitled Task' }}</span>
                    <span class="node-type">Task {{ index + 1 }}</span>
                  </div>
                  <span :class="['node-status', task.status.toLowerCase()]">
                    <i :class="getStatusIcon(task.status)"></i>
                    {{ task.status }}
                  </span>
                </div>

                <!-- Agent Assignment -->
                <div v-if="task.agent_name" class="task-agent-info">
                  <i class="fas fa-robot"></i>
                  <span class="agent-label">Agent:</span>
                  <span class="agent-name">{{ task.agent_name }}</span>
                </div>

                <!-- Task Description -->
                <div v-if="task.description" class="task-description">
                  {{ task.description }}
                </div>

                <!-- Task Timing -->
                <div class="node-timing">
                  <span v-if="task.started_at">Started: {{ formatTime(task.started_at) }}</span>
                  <span v-if="task.completed_at">Completed: {{ formatTime(task.completed_at) }}</span>
                  <span v-if="task.progress !== undefined">Progress: {{ task.progress }}%</span>
                </div>

                <!-- Executed Tools (from output) -->
                <div v-if="getExecutedTools(task).length > 0" class="task-tools executed-tools">
                  <div class="tools-header">
                    <i class="fas fa-check-circle"></i>
                    <span>Tools Executed:</span>
                  </div>
                  <div class="tools-list">
                    <span v-for="(toolExec, idx) in getExecutedTools(task)" :key="idx" class="tool-badge executed">
                      <i class="fas fa-play-circle"></i>
                      {{ toolExec.name }}
                    </span>
                  </div>
                </div>

                <!-- Input Section -->
                <div v-if="task.input" class="node-io-section">
                  <div class="io-header" @click="toggleNodeSection(task.id, 'input')">
                    <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(task.id, 'input') }"></i>
                    <span>Input</span>
                    <span class="io-size">({{ getDataSize(task.input) }})</span>
                  </div>
                  <div v-show="isNodeSectionExpanded(task.id, 'input')" class="io-content">
                    <pre class="io-data">{{ formatJSON(task.input) }}</pre>
                  </div>
                </div>

                <!-- Output Section -->
                <div v-if="task.output" class="node-io-section">
                  <div class="io-header" @click="toggleNodeSection(task.id, 'output')">
                    <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(task.id, 'output') }"></i>
                    <span>Output</span>
                    <span class="io-size">({{ getDataSize(task.output) }})</span>
                  </div>
                  <div v-show="isNodeSectionExpanded(task.id, 'output')" class="io-content">
                    <pre class="io-data">{{ formatJSON(task.output) }}</pre>
                  </div>
                </div>

                <!-- Error Section -->
                <div v-if="task.error" class="node-io-section error-section">
                  <div class="io-header" @click="toggleNodeSection(task.id, 'error')">
                    <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(task.id, 'error') }"></i>
                    <span>Error</span>
                  </div>
                  <div v-show="isNodeSectionExpanded(task.id, 'error')" class="io-content">
                    <pre class="error-data">{{ task.error }}</pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Workflow Execution: Show Nodes -->
        <div v-else-if="selectedExecution.nodeExecutions && selectedExecution.nodeExecutions.length > 0" class="detail-section">
          <h4>Execution Chain ({{ getUniqueNodeExecutions(selectedExecution.nodeExecutions).length }} nodes)</h4>
          <div class="execution-chain">
            <div
              v-for="(nodeExecution, index) in getUniqueNodeExecutions(selectedExecution.nodeExecutions)"
              :key="nodeExecution.id"
              class="chain-node"
            >
              <div class="chain-step">
                <div class="step-number">{{ index + 1 }}</div>
                <div class="step-connector" v-if="index < selectedExecution.nodeExecutions.length - 1"></div>
              </div>

              <div class="node-card" :class="{ 'has-error': nodeExecution.error }">
                <div class="node-header">
                  <div class="node-info">
                    <span class="node-id">{{ getNodeType(nodeExecution) }}</span>
                    <span class="node-type">{{ nodeExecution.node_id.substring(0, 8) }}</span>
                  </div>
                  <span :class="['node-status', nodeExecution.status.toLowerCase()]">
                    <i :class="getStatusIcon(nodeExecution.status)"></i>
                    {{ nodeExecution.status }}
                  </span>
                </div>

                <div class="node-timing">
                  <span>Duration: {{ calculateNodeDuration(nodeExecution) }}</span>
                  <span>Credits: {{ nodeExecution.credits_used || 0 }}</span>
                  <span v-if="nodeExecution.start_time">Started: {{ formatTime(nodeExecution.start_time) }}</span>
                </div>

                <!-- Input Section -->
                <div v-if="nodeExecution.input" class="node-io-section">
                  <div class="io-header" @click="toggleNodeSection(nodeExecution.id, 'input')">
                    <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(nodeExecution.id, 'input') }"></i>
                    <span>Input</span>
                    <span class="io-size">({{ getDataSize(nodeExecution.input) }})</span>
                  </div>
                  <div v-show="isNodeSectionExpanded(nodeExecution.id, 'input')" class="io-content">
                    <pre class="io-data">{{ formatJSON(nodeExecution.input) }}</pre>
                  </div>
                </div>

                <!-- Output Section -->
                <div v-if="nodeExecution.output" class="node-io-section">
                  <div class="io-header" @click="toggleNodeSection(nodeExecution.id, 'output')">
                    <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(nodeExecution.id, 'output') }"></i>
                    <span>Output</span>
                    <span class="io-size">({{ getDataSize(nodeExecution.output) }})</span>
                  </div>
                  <div v-show="isNodeSectionExpanded(nodeExecution.id, 'output')" class="io-content">
                    <pre class="io-data">{{ formatJSON(nodeExecution.output) }}</pre>
                  </div>
                </div>

                <!-- Error Section -->
                <div v-if="nodeExecution.error" class="node-io-section error-section">
                  <div class="io-header" @click="toggleNodeSection(nodeExecution.id, 'error')">
                    <i class="fas fa-chevron-right" :class="{ rotated: isNodeSectionExpanded(nodeExecution.id, 'error') }"></i>
                    <span>Error</span>
                  </div>
                  <div v-show="isNodeSectionExpanded(nodeExecution.id, 'error')" class="io-content">
                    <pre class="error-data">{{ nodeExecution.error }}</pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="selectedExecution.log" class="detail-section">
          <h4>Execution Log</h4>
          <pre class="execution-log">{{ getFilteredExecutionLog() }}</pre>
        </div>
      </div>
    </div>

    <!-- Default content when no execution selected -->
    <div v-else class="default-content">
      <!-- Goal Creation Section -->
      <div class="panel-section goal-input-section">
        <h4 class="section-title">
          <i class="fas fa-plus"></i>
          Create New Multi Agent Goal
        </h4>
        <div class="goal-input-container">
          <textarea
            ref="goalInputRef"
            v-model="goalInput"
            class="goal-input"
            placeholder="Describe what you want to accomplish... (e.g., 'Research renewable energy trends and create a summary report')"
            rows="3"
            @keydown.ctrl.enter="createGoal"
            @keydown.escape="clearGoalInput"
            :disabled="isCreatingGoal"
          ></textarea>
          <button class="create-goal-button" :class="{ loading: isCreatingGoal }" @click="createGoal" :disabled="!goalInput.trim() || isCreatingGoal">
            <i v-if="isCreatingGoal" class="fas fa-spinner fa-spin"></i>
            <i v-else class="fas fa-plus"></i>
            {{ isCreatingGoal ? 'Creating...' : 'Create Goal' }}
          </button>
        </div>
        <div class="input-hint">
          <i class="fas fa-info-circle"></i>
          Press Ctrl+Enter to create, or Escape to clear
        </div>
      </div>

      <!-- Recent Runs -->
      <div class="panel-section recent-runs-section">
        <h4 class="section-title">
          <i class="fas fa-history"></i>
          Recent Runs
        </h4>
        <div class="recent-runs-list">
          <div v-for="execution in recentExecutionsList" :key="execution.id" class="recent-run-item" @click="selectExecution(execution)">
            <div class="run-info">
              <div class="run-name">{{ execution.workflowName || execution.name || 'Untitled Run' }}</div>
              <div class="run-meta">
                <span class="run-status" :class="execution.status.toLowerCase()">
                  <i :class="getStatusIcon(execution.status)"></i>
                  {{ execution.status }}
                </span>
                <span class="run-duration">{{ formatDuration(execution.duration) }}</span>
              </div>
            </div>
            <div class="run-date">{{ formatRelativeDate(execution.startTime || execution.created_at) }}</div>
          </div>

          <div v-if="recentExecutionsList.length === 0" class="no-runs">
            <i class="fas fa-play"></i>
            <span>No runs yet</span>
          </div>
        </div>
      </div>

      <!-- Placeholder message -->
      <div class="panel-section placeholder-section">
        <p>Select an execution to view details.</p>
      </div>
    </div>

    <!-- Resources Section -->
    <ResourcesSection />
  </div>
</template>

<script>
import { ref, computed, watch } from 'vue';
import { useStore } from 'vuex';
import ResourcesSection from '@/views/_components/common/ResourcesSection.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'RunsPanel',
  components: {
    ResourcesSection,
    Tooltip,
  },
  props: {
    selectedExecutionId: {
      type: String,
      default: null,
    },
    executions: {
      type: Array,
      default: () => [],
    },
  },
  emits: ['panel-action'],
  setup(props, { emit, expose }) {
    const store = useStore();

    // Node section expansion state
    const expandedNodeSections = ref({});
    const selectedExecution = ref(null);
    const showCopiedMessage = ref(false);

    // Goal creation state
    const goalInput = ref('');
    const goalInputRef = ref(null);
    const isCreatingGoal = computed(() => store.getters['goals/isCreatingGoal']);

    // Watch for selectedExecutionId changes
    watch(
      () => props.selectedExecutionId,
      (newId) => {
        if (!newId) {
          selectedExecution.value = null;
        }
      }
    );

    // Method to update selected execution from parent
    const updateSelectedExecution = (execution) => {
      selectedExecution.value = execution;
    };

    // Expose method to parent component
    const handlePanelAction = (action, payload) => {
      if (action === 'update-execution-details') {
        updateSelectedExecution(payload);
      }
    };

    // Expose methods for external access
    expose({
      updateSelectedExecution,
      handlePanelAction,
    });

    const toggleNodeSection = (nodeId, section) => {
      const key = `${nodeId}-${section}`;
      if (!expandedNodeSections.value[key]) {
        expandedNodeSections.value[key] = true;
      } else {
        expandedNodeSections.value[key] = !expandedNodeSections.value[key];
      }
    };

    const isNodeSectionExpanded = (nodeId, section) => {
      const key = `${nodeId}-${section}`;
      return expandedNodeSections.value[key] || false;
    };

    // Helper methods for enhanced details
    const getNodeType = (nodeExecution) => {
      // First check if this is a synthetic node with a log name
      if (nodeExecution._synthetic && nodeExecution._logName) {
        return nodeExecution._logName;
      }

      // Then try to get the actual node name/type from the execution data
      if (nodeExecution.name) {
        return nodeExecution.name;
      }
      if (nodeExecution.type) {
        return nodeExecution.type;
      }
      if (nodeExecution.tool_name) {
        return nodeExecution.tool_name;
      }
      if (nodeExecution.node_type) {
        return nodeExecution.node_type;
      }
      if (nodeExecution.label) {
        return nodeExecution.label;
      }
      if (nodeExecution.title) {
        return nodeExecution.title;
      }

      // Try to extract from input/output data
      if (nodeExecution.input) {
        if (nodeExecution.input.tool_name) {
          return nodeExecution.input.tool_name;
        }
        if (nodeExecution.input.type) {
          return nodeExecution.input.type;
        }
        if (nodeExecution.input.name) {
          return nodeExecution.input.name;
        }
        if (nodeExecution.input.label) {
          return nodeExecution.input.label;
        }
      }

      if (nodeExecution.output) {
        if (nodeExecution.output.tool_name) {
          return nodeExecution.output.tool_name;
        }
        if (nodeExecution.output.type) {
          return nodeExecution.output.type;
        }
        if (nodeExecution.output.name) {
          return nodeExecution.output.name;
        }
      }

      // Try to extract name from execution log if available
      if (selectedExecution.value && selectedExecution.value.log && nodeExecution.node_id) {
        const log = selectedExecution.value.log;
        // Look for patterns like "node: uuid (Node Name)" in the log
        const nodeIdShort = nodeExecution.node_id.substring(0, 8);
        const patterns = [
          new RegExp(`${nodeExecution.node_id}\\s*\\(([^)]+)\\)`, 'i'),
          new RegExp(`${nodeIdShort}[^(]*\\(([^)]+)\\)`, 'i'),
          new RegExp(`node:\\s*${nodeExecution.node_id}[^(]*\\(([^)]+)\\)`, 'i'),
          new RegExp(`Executing node:\\s*${nodeExecution.node_id}[^(]*\\(([^)]+)\\)`, 'i'),
        ];

        for (const pattern of patterns) {
          const match = log.match(pattern);
          if (match && match[1]) {
            return match[1].trim();
          }
        }
      }

      // If no name/type found, try to extract from node_id
      if (nodeExecution.node_id) {
        // Check if it's a UUID format and try to find a meaningful name
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidPattern.test(nodeExecution.node_id)) {
          return 'Workflow Node';
        } else {
          // For non-UUID node_ids, use the first part
          const parts = nodeExecution.node_id.split('-');
          return parts[0] || 'Node';
        }
      }

      return 'Unknown Node';
    };

    const formatTime = (timestamp) => {
      if (!timestamp) return '-';
      return new Date(timestamp).toLocaleTimeString();
    };

    const getDataSize = (data) => {
      if (!data) return '0 bytes';
      const str = typeof data === 'string' ? data : JSON.stringify(data);
      const bytes = new Blob([str]).size;
      if (bytes < 1024) return `${bytes} bytes`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const formatJSON = (data) => {
      if (!data) return '';
      if (typeof data === 'string') return data;
      try {
        return JSON.stringify(data, null, 2);
      } catch (e) {
        return String(data);
      }
    };

    // Helper function to determine if a node is a label node
    const isLabelNode = (nodeExecution) => {
      // Check various properties that might indicate this is a label node
      const nodeType = getNodeType(nodeExecution).toLowerCase();

      // Check if the node type contains "label"
      if (nodeType.includes('label')) {
        return true;
      }

      // Check if the node has specific label-related properties
      if (nodeExecution.type && nodeExecution.type.toLowerCase().includes('label')) {
        return true;
      }

      if (nodeExecution.node_type && nodeExecution.node_type.toLowerCase().includes('label')) {
        return true;
      }

      if (nodeExecution.name && nodeExecution.name.toLowerCase().includes('label')) {
        return true;
      }

      // Check input/output data for label indicators
      if (nodeExecution.input) {
        if (nodeExecution.input.type && nodeExecution.input.type.toLowerCase().includes('label')) {
          return true;
        }
        if (nodeExecution.input.node_type && nodeExecution.input.node_type.toLowerCase().includes('label')) {
          return true;
        }
        // Check input data as string for label patterns
        const inputStr = JSON.stringify(nodeExecution.input).toLowerCase();
        if (inputStr.includes('label node') || inputStr.includes('"label"')) {
          return true;
        }
      }

      if (nodeExecution.output) {
        if (nodeExecution.output.type && nodeExecution.output.type.toLowerCase().includes('label')) {
          return true;
        }
        if (nodeExecution.output.node_type && nodeExecution.output.node_type.toLowerCase().includes('label')) {
          return true;
        }
        // Check output data as string for label patterns
        const outputStr = JSON.stringify(nodeExecution.output).toLowerCase();
        if (outputStr.includes('label node') || outputStr.includes('"label"')) {
          return true;
        }
        // Specific check for "Label node - no action needed" message
        if (nodeExecution.output.message && nodeExecution.output.message.toLowerCase().includes('label node')) {
          return true;
        }
      }

      // Check synthetic log name for label indicators
      if (nodeExecution._synthetic && nodeExecution._logName) {
        if (nodeExecution._logName.toLowerCase().includes('label')) {
          return true;
        }
      }

      // Check if the node execution has any error or status indicating it's a label
      if (nodeExecution.error && typeof nodeExecution.error === 'string') {
        if (nodeExecution.error.toLowerCase().includes('label')) {
          return true;
        }
      }

      return false;
    };

    // Helper function to get filtered execution log (removes label node references)
    const getFilteredExecutionLog = () => {
      if (!selectedExecution.value || !selectedExecution.value.log) {
        return '';
      }

      const log = selectedExecution.value.log;
      const nodeExecutions = selectedExecution.value.nodeExecutions || [];

      // Get all label node IDs that should be filtered out
      const labelNodeIds = new Set();

      // Check actual node executions for label nodes
      nodeExecutions.forEach((nodeExecution) => {
        if (isLabelNode(nodeExecution)) {
          labelNodeIds.add(nodeExecution.node_id);
          // Also add short version
          if (nodeExecution.node_id) {
            labelNodeIds.add(nodeExecution.node_id.substring(0, 8));
          }
        }
      });

      // Also check log for label nodes and add their IDs
      const executingNodePattern = /Executing node:\s*([a-f0-9-]{36})\s*\(([^)]+)\)/gi;
      let match;
      while ((match = executingNodePattern.exec(log)) !== null) {
        const [, nodeId, nodeName] = match;
        if (nodeName.toLowerCase().includes('label')) {
          labelNodeIds.add(nodeId);
          labelNodeIds.add(nodeId.substring(0, 8));
        }
      }

      // Filter out log lines that contain any of the label node IDs
      const logLines = log.split('\n');
      const filteredLines = logLines.filter((line) => {
        // Check if this line contains any label node ID
        for (const labelNodeId of labelNodeIds) {
          if (line.includes(labelNodeId)) {
            return false;
          }
        }
        return true;
      });

      return filteredLines.join('\n');
    };

    // Deduplicate node executions and add missing nodes from execution log
    const getUniqueNodeExecutions = (nodeExecutions) => {
      if (!nodeExecutions || !Array.isArray(nodeExecutions)) {
        nodeExecutions = [];
      }

      // First, extract nodes from execution log that might be missing from nodeExecutions
      const logNodes = [];
      if (selectedExecution.value && selectedExecution.value.log) {
        const log = selectedExecution.value.log;
        const executingNodePattern = /Executing node:\s*([a-f0-9-]{36})\s*\(([^)]+)\)/gi;
        let match;

        while ((match = executingNodePattern.exec(log)) !== null) {
          const [, nodeId, nodeName] = match;
          const nodeIdShort = nodeId.substring(0, 8);

          // Skip label nodes from log extraction
          if (nodeName.toLowerCase().includes('label')) {
            continue;
          }

          // Check if this node is already in nodeExecutions
          const existsInExecutions = nodeExecutions.some((ne) => ne.node_id && ne.node_id.substring(0, 8) === nodeIdShort);

          if (!existsInExecutions) {
            // Create a synthetic node execution entry
            logNodes.push({
              id: `synthetic-${nodeId}`,
              node_id: nodeId,
              status: 'completed', // Assume completed since it's in the log
              start_time: null,
              end_time: null,
              credits_used: 0,
              input: null,
              output: null,
              error: null,
              _synthetic: true, // Mark as synthetic
              _logName: nodeName, // Store the name from log
            });
          }
        }
      }

      // Combine real executions with synthetic ones
      const allExecutions = [...nodeExecutions, ...logNodes];
      const nodeMap = new Map();

      allExecutions.forEach((nodeExecution) => {
        const nodeIdShort = nodeExecution.node_id ? nodeExecution.node_id.substring(0, 8) : 'unknown';

        // If we haven't seen this node ID before, add it
        if (!nodeMap.has(nodeIdShort)) {
          nodeMap.set(nodeIdShort, nodeExecution);
        } else {
          // If we have seen this node ID, keep the one with the better name
          const existing = nodeMap.get(nodeIdShort);
          const existingName = getNodeType(existing);
          const currentName = getNodeType(nodeExecution);

          // Prefer real executions over synthetic ones
          if (existing._synthetic && !nodeExecution._synthetic) {
            nodeMap.set(nodeIdShort, nodeExecution);
            return;
          } else if (!existing._synthetic && nodeExecution._synthetic) {
            return; // Keep the real execution
          }

          // Prefer executions with longer, more descriptive names
          // Also prefer executions that are not just the short node ID
          const existingIsGeneric = existingName === 'Workflow Node' || existingName === nodeIdShort || existingName.length <= 8;
          const currentIsGeneric = currentName === 'Workflow Node' || currentName === nodeIdShort || currentName.length <= 8;

          if (currentIsGeneric && !existingIsGeneric) {
            // Keep existing (it's better)
            return;
          } else if (!currentIsGeneric && existingIsGeneric) {
            // Replace with current (it's better)
            nodeMap.set(nodeIdShort, nodeExecution);
          } else if (currentName.length > existingName.length) {
            // Replace with current (longer name is usually better)
            nodeMap.set(nodeIdShort, nodeExecution);
          }
          // Otherwise keep existing
        }
      });

      // Return the deduplicated executions in their original order (real first, then synthetic)
      // Filter out label nodes
      const uniqueNodeIds = new Set();
      return allExecutions.filter((nodeExecution) => {
        // Skip label nodes
        if (isLabelNode(nodeExecution)) {
          return false;
        }

        const nodeIdShort = nodeExecution.node_id ? nodeExecution.node_id.substring(0, 8) : 'unknown';
        if (uniqueNodeIds.has(nodeIdShort)) {
          return false;
        }
        // Only include if this is the selected execution for this node ID
        const selectedExecution = nodeMap.get(nodeIdShort);
        if (selectedExecution === nodeExecution) {
          uniqueNodeIds.add(nodeIdShort);
          return true;
        }
        return false;
      });
    };

    // Status icon helper
    const getStatusIcon = (status) => {
      const icons = {
        running: 'fas fa-play',
        started: 'fas fa-play',
        completed: 'fas fa-check',
        failed: 'fas fa-times',
        error: 'fas fa-times',
        stopped: 'fas fa-stop',
        queued: 'fas fa-clock',
      };
      return icons[status] || 'fas fa-question';
    };

    // Date formatting
    const formatDate = (dateString) => {
      if (!dateString) return '-';
      return new Date(dateString).toLocaleString();
    };

    // Duration calculation
    const calculateDuration = (execution) => {
      if (!execution.startTime) return '-';

      const start = new Date(execution.startTime);
      const end = execution.endTime ? new Date(execution.endTime) : new Date();
      const duration = end - start;

      if (duration < 1000) return '< 1s';
      if (duration < 60000) return `${Math.floor(duration / 1000)}s`;
      if (duration < 3600000) return `${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`;

      const hours = Math.floor(duration / 3600000);
      const minutes = Math.floor((duration % 3600000) / 60000);
      return `${hours}h ${minutes}m`;
    };

    const calculateNodeDuration = (nodeExecution) => {
      if (!nodeExecution.start_time) return '-';

      const start = new Date(nodeExecution.start_time);
      const end = nodeExecution.end_time ? new Date(nodeExecution.end_time) : new Date();
      const duration = end - start;

      if (duration < 1000) return '< 1s';
      if (duration < 60000) return `${Math.floor(duration / 1000)}s`;

      const minutes = Math.floor(duration / 60000);
      const seconds = Math.floor((duration % 60000) / 1000);
      return `${minutes}m ${seconds}s`;
    };

    // Recent executions (last 5)
    const recentExecutionsList = computed(() => {
      return [...props.executions]
        .sort((a, b) => {
          const dateA = new Date(a.startTime || a.created_at || 0);
          const dateB = new Date(b.startTime || b.created_at || 0);
          return dateB - dateA;
        })
        .slice(0, 5);
    });

    // Helper methods for Recent Runs and Quick Actions
    const selectExecution = (execution) => {
      emit('panel-action', 'execution-selected', execution);
    };

    const refreshRuns = () => {
      emit('panel-action', 'refresh-runs');
    };

    const exportRuns = () => {
      const runsData = props.executions;
      const dataStr = JSON.stringify(runsData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `runs-export-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);
      emit('panel-action', 'show-feedback', {
        type: 'success',
        message: '[Runs] Runs exported successfully.',
      });
    };

    const formatDuration = (duration) => {
      if (!duration) return 'N/A';
      if (typeof duration === 'number') {
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
      }
      return duration;
    };

    const formatRelativeDate = (dateString) => {
      if (!dateString) return 'Unknown';

      const date = new Date(dateString);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;

      return date.toLocaleDateString();
    };

    const copyExecutionDetails = () => {
      if (!selectedExecution.value) return;

      const execution = selectedExecution.value;
      const details = `
Execution Details:
ID: ${execution.id}
Workflow: ${execution.workflowName || 'Unnamed Workflow'}
Status: ${execution.status}
Start Time: ${formatDate(execution.startTime)}
End Time: ${execution.endTime ? formatDate(execution.endTime) : 'Still running'}
Duration: ${calculateDuration(execution)}
Credits Used: ${execution.creditsUsed || 0}

${
  execution.nodeExecutions && execution.nodeExecutions.length > 0
    ? `
Node Executions:
${execution.nodeExecutions
  .map(
    (node) => `
  Node ID: ${node.node_id}
  Status: ${node.status}
  Duration: ${calculateNodeDuration(node)}
  Credits: ${node.credits_used || 0}
`
  )
  .join('')}
`
    : ''
}

${
  execution.log
    ? `
Execution Log:
${execution.log}
`
    : ''
}
      `.trim();

      navigator.clipboard.writeText(details).then(() => {
        // Show visual indicator
        showCopiedMessage.value = true;
        setTimeout(() => {
          showCopiedMessage.value = false;
        }, 2000);

        emit('panel-action', 'show-feedback', { type: 'success', message: 'Copied' });
      });
    };

    // Helper to extract executed tools from task output
    const getExecutedTools = (task) => {
      if (!task || !task.output) return [];

      // Check if toolExecutions is directly in output
      if (task.output.toolExecutions && Array.isArray(task.output.toolExecutions)) {
        return task.output.toolExecutions;
      }

      // Check if output is a string that needs parsing
      if (typeof task.output === 'string') {
        try {
          const parsed = JSON.parse(task.output);
          if (parsed.toolExecutions && Array.isArray(parsed.toolExecutions)) {
            return parsed.toolExecutions;
          }
        } catch (e) {
          // Not valid JSON, continue
        }
      }

      return [];
    };

    // Goal creation methods
    const createGoal = async () => {
      if (!goalInput.value.trim()) return;

      const goalText = goalInput.value.trim();
      emit('panel-action', 'show-feedback', {
        type: 'info',
        message: `[Goals] Creating goal: ${goalText.substring(0, 50)}...`,
      });

      try {
        await store.dispatch('goals/createGoal', {
          text: goalText,
          priority: 'medium',
        });

        goalInput.value = '';

        // Refresh executions to show the new goal immediately
        emit('panel-action', 'refresh-executions');

        emit('panel-action', 'show-feedback', {
          type: 'success',
          message: '[Goals] Goal created successfully',
        });
      } catch (error) {
        emit('panel-action', 'show-feedback', {
          type: 'error',
          message: `[Goals] Error creating goal: ${error.message}`,
        });
      }
    };

    const clearGoalInput = () => {
      goalInput.value = '';
      goalInputRef.value?.blur();
    };

    const closePanel = () => {
      selectedExecution.value = null;
      emit('panel-action', 'close-panel');
    };

    const handleEditWorkflow = () => {
      if (selectedExecution.value && selectedExecution.value.workflowId) {
        emit('panel-action', 'edit-workflow', selectedExecution.value.workflowId);
      }
    };

    return {
      selectedExecution,
      showCopiedMessage,
      toggleNodeSection,
      isNodeSectionExpanded,
      getNodeType,
      formatTime,
      getDataSize,
      formatJSON,
      getUniqueNodeExecutions,
      getFilteredExecutionLog,
      getStatusIcon,
      formatDate,
      calculateDuration,
      calculateNodeDuration,
      copyExecutionDetails,
      updateSelectedExecution,
      handlePanelAction,
      recentExecutionsList,
      selectExecution,
      refreshRuns,
      exportRuns,
      formatDuration,
      formatRelativeDate,
      getExecutedTools,
      // Goal creation
      goalInput,
      goalInputRef,
      isCreatingGoal,
      createGoal,
      clearGoalInput,
      closePanel,
      handleEditWorkflow,
    };
  },
};
</script>

<style scoped>
.ui-panel.runs-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  background: var(--color-background-soft);
  color: var(--color-text);
  overflow-y: auto;
}

/* Common Section Styling */
/* .panel-section {
  border-radius: 0px;
  padding: 15px;
  background: rgb(0 0 0 / 10%);
  border: 1px solid rgba(18, 224, 255, 0.1);
} */

.selected-execution-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  border-bottom: 1px solid rgba(25, 239, 131, 0.1);
  padding-bottom: 8px;
}

.selected-execution-header h2 {
  color: var(--color-green);
  font-size: 1.1em;
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.copy-btn,
.close-btn {
  background: rgba(25, 239, 131, 0.1);
  border: 1px solid rgba(25, 239, 131, 0.3);
  color: var(--color-light-green);
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.9em;
}

.copy-btn:hover,
.close-btn:hover {
  background: rgba(25, 239, 131, 0.2);
  border-color: rgba(25, 239, 131, 0.5);
}

.close-btn {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
  color: var(--color-red);
}

.close-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
}

.detail-section {
  margin-bottom: 24px;
}

.detail-section h4 {
  color: var(--color-green);
  margin: 0 0 12px 0;
  font-size: 1.1em;
  border-bottom: 1px solid rgba(25, 239, 131, 0.2);
  padding-bottom: 4px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 12px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-item label {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.detail-item span {
  color: var(--color-text);
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.status-badge.running,
.status-badge.started {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.status-badge.completed {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.status-badge.failed,
.status-badge.error {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.status-badge.stopped {
  background: rgba(127, 129, 147, 0.2);
  color: var(--color-text-muted);
}

/* Enhanced Execution Chain Styles */
.execution-chain {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 600px;
  overflow-y: auto;
  padding: 8px 0;
}

.chain-node {
  display: flex;
  gap: 16px;
  position: relative;
}

.chain-step {
  display: flex;
  display: none;

  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
}

.step-number {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(25, 239, 131, 0.2);
  border: 2px solid var(--color-green);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 0.9em;
  color: var(--color-text);
  z-index: 2;
}

.step-connector {
  width: 2px;
  height: 40px;
  background: linear-gradient(to bottom, var(--color-green), rgba(25, 239, 131, 0.3));
  margin-top: 8px;
  z-index: 1;
}

.node-card {
  flex: 1;
  /* background: var(--color-darker-0); */
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 16px;
  transition: all 0.2s ease;
}

.node-card {
  border-left: 3px solid var(--color-green);
}

.node-card.has-error {
  border-left-color: var(--color-red);
}

.node-card:hover {
  background: rgba(0, 0, 0, 0.1);
  /* border-color: rgba(25, 239, 131, 0.3); */
}

/* Task Card Specific Styles */
.task-card {
  border-left: 3px solid var(--color-green);
}

.task-card.executing,
.task-card.running,
.task-card.started {
  border-left-color: var(--color-blue);
}

.task-card.completed {
  border-left-color: var(--color-green);
}

.task-card.failed,
.task-card.error {
  border-left-color: var(--color-red);
}

.task-card.paused {
  border-left-color: var(--color-yellow);
}

.task-card.stopped {
  border-left-color: var(--color-text-muted);
}

.task-card.pending {
  border-left-color: var(--color-grey);
}

.task-agent-info {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: rgba(59, 130, 246, 0.1);
  border-radius: 6px;
  margin-bottom: 12px;
  font-size: 0.9em;
}

.task-agent-info i {
  color: var(--color-blue);
  font-size: 0.9em;
}

.agent-label {
  color: var(--color-text-muted);
  font-weight: 500;
}

.agent-name {
  color: var(--color-blue);
  font-weight: 600;
}

.task-description {
  color: var(--color-text-muted);
  font-size: 0.9em;
  line-height: 1.4;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: var(--color-darker-0);
  border-radius: 6px;
  border-left: 2px solid rgba(25, 239, 131, 0.3);
}

.task-tools {
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid rgba(255, 193, 7, 0.2);
}

.task-tools.required-tools {
  background: rgba(255, 193, 7, 0.05);
  border-color: rgba(255, 193, 7, 0.2);
}

.task-tools.executed-tools {
  background: rgba(34, 197, 94, 0.05);
  border-color: rgba(34, 197, 94, 0.2);
}

.tools-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 0.85em;
  font-weight: 600;
  color: var(--color-text-muted);
}

.tools-header i {
  color: var(--color-yellow);
  font-size: 0.9em;
}

.executed-tools .tools-header i {
  color: var(--color-green);
}

.tools-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tool-badge {
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 0.75em;
  font-weight: 500;
  text-transform: lowercase;
  display: flex;
  align-items: center;
  gap: 4px;
}

.tool-badge.required {
  background: rgba(255, 193, 7, 0.15);
  border: 1px solid rgba(255, 193, 7, 0.3);
  color: var(--color-yellow);
}

.tool-badge.executed {
  background: rgba(34, 197, 94, 0.15);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: var(--color-green);
}

.tool-badge.executed i {
  font-size: 0.9em;
}

.node-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
  gap: 12px;
}

.node-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.node-id {
  font-weight: 600;
  color: var(--color-text);
  font-size: 1em;
}

.node-type {
  font-size: 0.85em;
  color: var(--color-grey);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.node-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 12px;
  font-size: 0.85em;
  font-weight: 500;
  flex-shrink: 0;
}

.node-status.running,
.node-status.started {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.agent-prompt-section,
.agent-response-section {
  margin-top: 16px;
}

.node-status.completed {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.node-status.failed,
.node-status.error {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.node-status.stopped {
  background: rgba(127, 129, 147, 0.2);
  color: var(--color-text-muted);
}

.node-timing {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
  font-size: 0.9em;
  color: var(--color-grey);
  flex-wrap: wrap;
}

.node-timing span {
  display: flex;
  align-items: center;
  gap: 4px;
}

.node-io-section {
  margin-top: 12px;
  border: 1px solid rgba(25, 239, 131, 0.1);
  border-radius: 6px;
  overflow: hidden;
}

.node-io-section.error-section {
  border-color: rgba(239, 68, 68, 0.3);
}

.io-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(25, 239, 131, 0.05);
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}

.error-section .io-header {
  background: rgba(239, 68, 68, 0.1);
}

.io-header:hover {
  background: rgba(25, 239, 131, 0.1);
}

.error-section .io-header:hover {
  background: rgba(239, 68, 68, 0.15);
}

.io-header i {
  font-size: 0.8em;
  color: var(--color-pink);
  transition: transform 0.2s ease;
}

.error-section .io-header i {
  color: var(--color-red);
}

.io-header i.rotated {
  transform: rotate(90deg);
}

.io-header span:first-of-type {
  font-weight: 600;
  color: var(--color-text);
}

.error-section .io-header span:first-of-type {
  color: var(--color-red);
}

.io-size {
  font-size: 0.8em;
  color: var(--color-grey);
  margin-left: auto;
}

.io-content {
  padding: 0;
  border-top: 1px solid rgba(25, 239, 131, 0.1);
}

.error-section .io-content {
  border-top-color: rgba(239, 68, 68, 0.2);
}

.io-data,
.error-data {
  background: var(--color-darker-0);
  padding: 12px;
  font-size: var(--font-size-xs);
  color: var(--color-text);
  max-height: 300px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-family: var(--font-family-mono);
  line-height: 1.4;
  border: none;
  width: 100%;
  border-radius: 0;
}

.error-data {
  color: var(--color-red);
  background: rgba(239, 68, 68, 0.05);
}

.execution-log {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  padding: 12px;
  font-size: 0.9em;
  color: var(--color-text);
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.io-data::-webkit-scrollbar,
.error-data::-webkit-scrollbar,
.execution-log::-webkit-scrollbar {
  width: 4px;
}

.io-data::-webkit-scrollbar-track,
.error-data::-webkit-scrollbar-track,
.execution-log::-webkit-scrollbar-track {
  background: var(--color-darker-0);
}

.io-data::-webkit-scrollbar-thumb {
  background: rgba(25, 239, 131, 0.3);
  border-radius: 2px;
}

.error-data::-webkit-scrollbar-thumb {
  background: rgba(239, 68, 68, 0.3);
  border-radius: 2px;
}

.execution-log::-webkit-scrollbar-thumb {
  background: rgba(25, 239, 131, 0.3);
  border-radius: 2px;
}

.placeholder-section {
  text-align: center;
  color: var(--color-grey);
  padding: 30px 15px;
  border: 1px dashed rgba(25, 239, 131, 0.2);
  border-radius: 4px;
}

.placeholder-section p {
  font-style: italic;
  margin: 0;
}

/* Default content sections */
.default-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  height: 100%;
  min-height: 0;
}

.panel-section {
  background: rgb(0 0 0 / 10%);
  border: 1px solid var(--terminal-border-color);
  padding: 16px;
  border-radius: 8px;
}

.section-title {
  color: var(--color-text-muted);
  font-size: 0.9em;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 16px 0;
  font-weight: 600;
  opacity: 0.95;
}

.section-title i {
  color: var(--color-green);
}

/* Recent Runs */
.recent-runs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* max-height: 200px; */
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(25, 239, 131, 0.3) transparent;
}

.recent-run-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.recent-run-item:hover {
  background: rgba(25, 239, 131, 0.08);
  border-color: rgba(25, 239, 131, 0.2);
}

.run-info {
  flex: 1;
  min-width: 0;
}

.run-name {
  font-size: 0.85em;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75em;
}

.run-status {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 4px;
  border-radius: 8px;
  font-weight: 500;
  text-transform: uppercase;
}

.run-status.running {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.run-status.completed {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.run-status.failed {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.run-status.stopped {
  background: rgba(127, 129, 147, 0.2);
  color: var(--color-text-muted);
}

.run-status.pending {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-yellow);
}

.run-status.started {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.run-status i {
  font-size: 0.8em;
}

.run-duration {
  color: var(--color-green);
  font-weight: 600;
}

.run-date {
  font-size: 0.75em;
  color: var(--color-text-muted);
  white-space: nowrap;
  opacity: 0.8;
}

.no-runs {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px;
  color: var(--color-text-muted);
  opacity: 0.7;
}

.no-runs i {
  font-size: 1.5em;
  color: rgba(127, 129, 147, 0.3);
}

.no-runs span {
  font-size: 0.85em;
}

/* Action Buttons */
.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.action-button {
  padding: 8px 16px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-text);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
  font-size: 0.9em;
  justify-content: flex-start;
  width: 100%;
}

.action-button:hover {
  background: rgba(25, 239, 131, 0.1);
  border-color: rgba(25, 239, 131, 0.5);
}

.action-button i {
  width: 16px;
  text-align: center;
}

/* Goal Input Section */
.goal-input-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 12px;
}

.goal-input {
  width: 100%;
  padding: 12px 16px;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  color: var(--color-text);
  font-size: 0.95em;
  font-family: inherit;
  resize: vertical;
  min-height: 80px;
  transition: all 0.2s ease;
}

.goal-input:focus {
  outline: none;
  border-color: rgba(25, 239, 131, 0.5);
  box-shadow: 0 0 0 2px rgba(25, 239, 131, 0.1);
}

.goal-input::placeholder {
  color: var(--color-text-muted);
  opacity: 0.7;
}

.create-goal-button {
  padding: 12px 20px;
  background: var(--color-darker-0);
  color: var(--color-text);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  align-self: flex-start;
}

.create-goal-button:hover:not(:disabled) {
  background: rgba(25, 239, 131, 0.1);
  border-color: rgba(25, 239, 131, 0.5);
  transform: translateY(-1px);
}

.create-goal-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.create-goal-button.loading {
  opacity: 0.8;
}

.input-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8em;
  color: var(--color-text-muted);
  opacity: 0.7;
}

.input-hint i {
  color: var(--color-green);
  font-size: 0.9em;
}

/* Workflow Actions Section */
.workflow-actions-section {
  border-top: 1px dashed rgba(25, 239, 131, 0.2);
  padding-top: 15px;
}

.workflow-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.action-button {
  background: transparent;
  border: 1px solid rgba(25, 239, 131, 0.3);
  color: var(--color-light-green);
  padding: 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.action-button:hover {
  background: rgba(25, 239, 131, 0.1);
  border-color: var(--color-green);
}

.action-button.edit {
  border-color: rgba(25, 239, 131, 0.5);
  color: var(--color-green);
}

.action-button.edit:hover {
  background: rgba(25, 239, 131, 0.15);
  border-color: var(--color-green);
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .chain-node {
    gap: 12px;
  }

  .node-card {
    padding: 12px;
  }

  .node-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .node-timing {
    flex-direction: column;
    gap: 8px;
  }

  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
