<template>
  <div class="ui-panel runs-panel">
    <!-- Selected Goal Details -->
    <div v-if="selectedGoal" class="panel-section selected-execution-section">
      <div class="selected-execution-header">
        <h2>Goal Details</h2>
        <div class="header-actions">
          <Tooltip text="Copy Details" width="auto">
          <button @click="copyGoalDetails" class="copy-btn">
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
              <label>Goal:</label>
              <span>{{ selectedGoal.title || 'Untitled Goal' }}</span>
            </div>
            <div class="detail-item">
              <label>Status:</label>
              <span :class="['status-badge', (selectedGoal.status || '').toLowerCase()]">
                <i :class="getStatusIcon(selectedGoal.status)"></i>
                {{ selectedGoal.status }}
              </span>
            </div>
            <div class="detail-item">
              <label>Created At:</label>
              <span>{{ formatDate(selectedGoal.created_at) }}</span>
            </div>
            <div class="detail-item">
              <label>Progress:</label>
              <span>{{ selectedGoal.progress || 0 }}%</span>
            </div>
            <div class="detail-item">
              <label>Tasks:</label>
              <span>{{ selectedGoal.completed_tasks || 0 }}/{{ selectedGoal.task_count || 0 }}</span>
            </div>
          </div>
        </div>

        <div v-if="selectedGoal.description" class="detail-section">
          <h4>Description</h4>
          <p class="goal-description">{{ selectedGoal.description }}</p>
        </div>

        <!-- Goal Tasks: Show Tasks -->
        <div v-if="selectedGoal.tasks && selectedGoal.tasks.length > 0" class="detail-section">
          <h4>Tasks ({{ selectedGoal.tasks.length }})</h4>
          <div class="execution-chain">
            <div v-for="(task, index) in selectedGoal.tasks" :key="task.id" class="chain-node">
              <div class="node-card task-card" :class="(task.status || '').toLowerCase()">
                <div class="node-header">
                  <div class="node-info">
                    <span class="node-id">{{ task.title || 'Untitled Task' }}</span>
                    <span class="node-type">Task {{ index + 1 }}</span>
                  </div>
                  <span :class="['node-status', (task.status || '').toLowerCase()]">
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

        <div v-if="selectedGoal.evaluation" class="detail-section">
          <h4>Evaluation</h4>
          <pre class="execution-log">{{ formatJSON(selectedGoal.evaluation) }}</pre>
        </div>
      </div>
    </div>

    <!-- Default content when no goal selected -->
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

      <!-- Recent Goals -->
      <div class="panel-section recent-runs-section">
        <h4 class="section-title">
          <i class="fas fa-history"></i>
          Recent Goals
        </h4>
        <div class="recent-runs-list">
          <div v-for="goal in recentGoalsList" :key="goal.id" class="recent-run-item" @click="selectGoal(goal)">
            <div class="run-info">
              <div class="run-name">{{ goal.title || 'Untitled Goal' }}</div>
              <div class="run-meta">
                <span class="run-status" :class="(goal.status || '').toLowerCase()">
                  <i :class="getStatusIcon(goal.status)"></i>
                  {{ goal.status }}
                </span>
                <span class="run-duration" v-if="goal.progress">{{ goal.progress }}%</span>
              </div>
            </div>
            <div class="run-date">{{ formatRelativeDate(goal.created_at) }}</div>
          </div>

          <div v-if="recentGoalsList.length === 0" class="no-runs">
            <i class="fas fa-bullseye"></i>
            <span>No goals yet</span>
          </div>
        </div>
      </div>

      <!-- Placeholder message -->
      <div class="panel-section placeholder-section">
        <p>Select a goal to view details.</p>
      </div>
    </div>

    <!-- Resources Section -->
    <ResourcesSection />
  </div>
</template>

<script>
import { ref, computed, watch, inject } from 'vue';
import { useStore } from 'vuex';
import ResourcesSection from '@/views/_components/common/ResourcesSection.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'GoalsPanel',
  components: {
    ResourcesSection,
    Tooltip,
  },
  props: {
    selectedGoalId: {
      type: String,
      default: null,
    },
    goals: {
      type: Array,
      default: () => [],
    },
  },
  emits: ['panel-action'],
  setup(props, { emit, expose }) {
    const store = useStore();
    const playSound = inject('playSound', () => {});

    // Node section expansion state
    const expandedNodeSections = ref({});
    const selectedGoal = ref(null);
    const showCopiedMessage = ref(false);

    // Goal creation state
    const goalInput = ref('');
    const goalInputRef = ref(null);
    const isCreatingGoal = computed(() => store.getters['goals/isCreatingGoal']);

    // Watch for selectedGoalId changes
    watch(
      () => props.selectedGoalId,
      (newId) => {
        if (!newId) {
          selectedGoal.value = null;
        } else {
          // If we have an ID, try to find the goal in the props or store
          const foundGoal = props.goals.find((g) => g.id === newId) || store.getters['goals/getGoalById'](newId);
          if (foundGoal) {
            selectedGoal.value = foundGoal;
          }
        }
      },
      { immediate: true }
    );

    // Method to update selected goal from parent
    const updateSelectedGoal = (goal) => {
      selectedGoal.value = goal;
    };

    // Expose method to parent component
    const handlePanelAction = (action, payload) => {
      if (action === 'update-goal-details') {
        updateSelectedGoal(payload);
      }
    };

    // Expose methods for external access
    expose({
      updateSelectedGoal,
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

    // Status icon helper
    const getStatusIcon = (status) => {
      const icons = {
        planning: 'fas fa-lightbulb',
        queued: 'fas fa-clock',
        executing: 'fas fa-cog fa-spin',
        paused: 'fas fa-pause',
        needs_review: 'fas fa-exclamation-triangle',
        validated: 'fas fa-check-double',
        completed: 'fas fa-check',
        failed: 'fas fa-times',
        error: 'fas fa-times',
        stopped: 'fas fa-stop',
      };
      return icons[status] || 'fas fa-circle';
    };

    // Date formatting
    const formatDate = (dateString) => {
      if (!dateString) return '-';
      return new Date(dateString).toLocaleString();
    };

    // Recent goals (last 5)
    const recentGoalsList = computed(() => {
      return [...props.goals]
        .sort((a, b) => {
          const dateA = new Date(a.created_at || 0);
          const dateB = new Date(b.created_at || 0);
          return dateB - dateA;
        })
        .slice(0, 5);
    });

    // Helper methods for Recent Goals and Quick Actions
    const selectGoal = (goal) => {
      emit('panel-action', 'goal-selected', goal);
    };

    const refreshGoals = () => {
      emit('panel-action', 'refresh-goals');
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

    const copyGoalDetails = () => {
      if (!selectedGoal.value) return;

      const goal = selectedGoal.value;
      const details = `
Goal Details:
ID: ${goal.id}
Title: ${goal.title || 'Untitled Goal'}
Status: ${goal.status}
Created At: ${formatDate(goal.created_at)}
Progress: ${goal.progress || 0}%
Tasks: ${goal.completed_tasks || 0}/${goal.task_count || 0}

Description:
${goal.description || 'No description'}

${
  goal.tasks && goal.tasks.length > 0
    ? `
Tasks:
${goal.tasks
  .map(
    (task, index) => `
  Task ${index + 1}: ${task.title || 'Untitled'}
  Status: ${task.status}
  Started: ${task.started_at ? formatDate(task.started_at) : '-'}
  Completed: ${task.completed_at ? formatDate(task.completed_at) : '-'}
`
  )
  .join('')}
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
        emit('panel-action', 'refresh-goals');

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
      selectedGoal.value = null;
      emit('panel-action', 'close-panel');
    };

    return {
      selectedGoal,
      showCopiedMessage,
      toggleNodeSection,
      isNodeSectionExpanded,
      formatTime,
      getDataSize,
      formatJSON,
      getStatusIcon,
      formatDate,
      copyGoalDetails,
      updateSelectedGoal,
      handlePanelAction,
      recentGoalsList,
      selectGoal,
      refreshGoals,
      formatRelativeDate,
      // Goal creation
      goalInput,
      goalInputRef,
      isCreatingGoal,
      createGoal,
      clearGoalInput,
      closePanel,
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

.selected-execution-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.1);
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
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  color: var(--color-light-green);
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.9em;
}

.copy-btn:hover,
.close-btn:hover {
  background: rgba(var(--green-rgb), 0.2);
  border-color: rgba(var(--green-rgb), 0.5);
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
  border-bottom: 1px solid rgba(var(--green-rgb), 0.2);
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
  text-transform: uppercase;
}

.status-badge.running,
.status-badge.started,
.status-badge.executing {
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

.status-badge.planning {
  background: rgba(127, 129, 147, 0.2);
  color: var(--color-text-muted);
}

.status-badge.needs_review,
.status-badge.paused {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-yellow);
}

.goal-description {
  color: var(--color-text-muted);
  font-size: 0.9em;
  line-height: 1.5;
  background: var(--color-darker-0);
  padding: 12px;
  border-radius: 6px;
  border-left: 2px solid var(--color-blue);
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

.node-card {
  flex: 1;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 16px;
  transition: all 0.2s ease;
}

.node-card:hover {
  background: rgba(0, 0, 0, 0.1);
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

.task-card.pending,
.task-card.queued {
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
  border-left: 2px solid rgba(var(--green-rgb), 0.3);
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
.node-status.started,
.node-status.executing {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
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

.node-status.queued {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-yellow);
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
  border: 1px solid rgba(var(--green-rgb), 0.1);
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
  background: rgba(var(--green-rgb), 0.05);
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}

.error-section .io-header {
  background: rgba(239, 68, 68, 0.1);
}

.io-header:hover {
  background: rgba(var(--green-rgb), 0.1);
}

.error-section .io-header:hover {
  background: rgba(239, 68, 68, 0.15);
}

.io-header i {
  font-size: 0.8em;
  color: var(--color-primary);
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
  border-top: 1px solid rgba(var(--green-rgb), 0.1);
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
  background: rgba(var(--green-rgb), 0.3);
  border-radius: 2px;
}

.error-data::-webkit-scrollbar-thumb {
  background: rgba(239, 68, 68, 0.3);
  border-radius: 2px;
}

.execution-log::-webkit-scrollbar-thumb {
  background: rgba(var(--green-rgb), 0.3);
  border-radius: 2px;
}

.placeholder-section {
  text-align: center;
  color: var(--color-grey);
  padding: 30px 15px;
  border: 1px dashed rgba(var(--green-rgb), 0.2);
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
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--green-rgb), 0.3) transparent;
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
  background: rgba(var(--green-rgb), 0.08);
  border-color: rgba(var(--green-rgb), 0.2);
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

.run-status.running,
.run-status.executing {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.run-status.completed,
.run-status.validated {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.run-status.failed,
.run-status.error {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.run-status.stopped {
  background: rgba(127, 129, 147, 0.2);
  color: var(--color-text-muted);
}

.run-status.pending,
.run-status.planning,
.run-status.queued {
  background: rgba(127, 129, 147, 0.2);
  color: var(--color-text-muted);
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
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.5);
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
  border-color: rgba(var(--green-rgb), 0.5);
  box-shadow: 0 0 0 2px rgba(var(--green-rgb), 0.1);
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
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.5);
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
  border-top: 1px dashed rgba(var(--green-rgb), 0.2);
  padding-top: 15px;
}

.workflow-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.action-button {
  background: transparent;
  border: 1px solid rgba(var(--green-rgb), 0.3);
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
  background: rgba(var(--green-rgb), 0.1);
  border-color: var(--color-green);
}

.action-button.edit {
  border-color: rgba(var(--green-rgb), 0.5);
  color: var(--color-green);
}

.action-button.edit:hover {
  background: rgba(var(--green-rgb), 0.15);
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
