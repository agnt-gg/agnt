<template>
  <div class="goal-detail-view">
    <!-- Goal Overview -->
    <div class="detail-section">
      <h4 class="detail-section-title">Goal Overview</h4>
      <div class="goal-overview">
        <div class="goal-title">{{ goal.title }}</div>
        <div class="goal-description">{{ goal.description }}</div>

        <!-- Status and Progress -->
        <div class="goal-status-info">
          <div class="status-grid">
            <div class="status-item">
              <span class="status-label">Status</span>
              <span class="status-value" :class="getStatusClass(goal.status)">
                <i :class="getStatusIcon(goal.status)"></i>
                {{ formatGoalStatus(goal.status) }}
              </span>
            </div>
            <div class="status-item">
              <span class="status-label">Progress</span>
              <span class="status-value">{{ getGoalProgress(goal) }}%</span>
            </div>
            <div class="status-item">
              <span class="status-label">Tasks</span>
              <span class="status-value">{{ getCompletedTasks(goal) }}/{{ getTotalTasks(goal) }}</span>
            </div>
            <div class="status-item">
              <span class="status-label">Priority</span>
              <span class="status-value priority" :class="goal.priority">{{ goal.priority?.toUpperCase() || 'MEDIUM' }}</span>
            </div>
          </div>

          <!-- Progress Bar -->
          <div v-if="goal.status === 'executing' || goal.status === 'completed'" class="progress-section">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: `${getGoalProgress(goal)}%` }"></div>
            </div>
            <span class="progress-text">{{ getGoalProgress(goal) }}% Complete</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Tasks/Steps -->
    <div class="detail-section" v-if="goal.tasks && goal.tasks.length">
      <h4 class="detail-section-title">Task Progress</h4>
      <div class="tasks-list">
        <div v-for="(task, index) in goal.tasks" :key="task.id || index" class="task-item" :class="getTaskStatusClass(task.status)">
          <div class="task-header">
            <span class="task-number">{{ index + 1 }}</span>
            <span class="task-title">{{ task.title || task.description || `Task ${index + 1}` }}</span>
            <span class="task-timestamp">{{ formatTaskTime(task.updated_at || task.created_at) }}</span>
          </div>

          <div v-if="task.status === 'completed'" class="task-success">
            <i class="fas fa-check-circle"></i>
            Completed successfully
          </div>

          <div v-if="task.status === 'failed' && task.error" class="task-error">
            <i class="fas fa-exclamation-triangle"></i>
            {{ task.error }}
          </div>

          <div v-if="task.status === 'executing'" class="task-executing">
            <i class="fas fa-spinner fa-spin"></i>
            In progress...
          </div>

          <!-- Task Details -->
          <div v-if="task.result || task.args" class="task-details">
            <details class="task-details-expandable">
              <summary>View details</summary>
              <div class="task-details-content">
                <div v-if="task.args" class="task-args">
                  <h6>Parameters:</h6>
                  <pre>{{ JSON.stringify(task.args, null, 2) }}</pre>
                </div>
                <div v-if="task.result" class="task-result">
                  <h6>Result:</h6>
                  <pre>{{ JSON.stringify(task.result, null, 2) }}</pre>
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>

    <!-- Goal Actions -->
    <div class="detail-section">
      <h4 class="detail-section-title">Actions</h4>
      <div class="goal-actions">
        <button v-if="goal.status === 'executing'" @click="pauseGoal" class="action-button">
          <i class="fas fa-pause"></i>
          Pause Goal
        </button>
        <button v-if="goal.status === 'paused'" @click="resumeGoal" class="action-button primary">
          <i class="fas fa-play"></i>
          Resume Goal
        </button>
        <button @click="refreshGoal" class="action-button">
          <i class="fas fa-sync"></i>
          Refresh
        </button>
        <button @click="deleteGoal" class="action-button danger">
          <i class="fas fa-trash"></i>
          Delete Goal
        </button>
      </div>
    </div>

    <!-- Raw Data (for debugging) -->
    <div class="detail-section" v-if="showRawData">
      <h4 class="detail-section-title">Raw Data</h4>
      <details class="raw-data-expandable">
        <summary>View raw goal data</summary>
        <pre class="raw-data">{{ JSON.stringify(goal, null, 2) }}</pre>
      </details>
    </div>
  </div>
</template>

<script>
import { ref, computed, inject } from 'vue';
import { useStore } from 'vuex';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';

export default {
  name: 'GoalDetailView',
  components: {
    SimpleModal,
  },
  props: {
    goal: {
      type: Object,
      required: true,
    },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const store = useStore();
    const showRawData = ref(false);
    const simpleModal = ref(null);

    // Helper methods
    const getStatusClass = (status) => {
      const statusMap = {
        executing: 'status-working',
        completed: 'status-complete',
        failed: 'status-failed',
        paused: 'status-needs-input',
        planning: 'status-working',
      };
      return statusMap[status] || 'status-working';
    };

    const getStatusIcon = (status) => {
      const iconMap = {
        executing: 'fas fa-spinner fa-spin',
        completed: 'fas fa-check-circle',
        failed: 'fas fa-times-circle',
        paused: 'fas fa-pause-circle',
        planning: 'fas fa-cog fa-spin',
      };
      return iconMap[status] || 'fas fa-spinner fa-spin';
    };

    const getTaskStatusClass = (status) => {
      const statusMap = {
        pending: 'task-pending',
        executing: 'task-executing',
        completed: 'task-completed',
        failed: 'task-failed',
      };
      return statusMap[status] || 'task-pending';
    };

    const getGoalProgress = (goal) => {
      return store.getters['goals/getGoalProgress'](goal);
    };

    const getCompletedTasks = (goal) => {
      if (goal.tasks) {
        return goal.tasks.filter((t) => t.status === 'completed').length;
      }
      return goal.completed_tasks || 0;
    };

    const getTotalTasks = (goal) => {
      if (goal.tasks) {
        return goal.tasks.length;
      }
      return goal.task_count || 0;
    };

    const formatGoalStatus = (status) => {
      const statusMap = {
        planning: 'Planning',
        executing: 'Executing',
        completed: 'Completed',
        failed: 'Failed',
        paused: 'Paused',
        stopped: 'Stopped',
      };
      return statusMap[status] || status?.charAt(0).toUpperCase() + status?.slice(1) || 'Unknown';
    };

    const formatTaskTime = (timestamp) => {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      return date.toLocaleTimeString();
    };

    // Action methods
    const pauseGoal = async () => {
      try {
        await store.dispatch('goals/pauseGoal', props.goal.id);
        emit('close');
      } catch (error) {
        console.error('Error pausing goal:', error);
      }
    };

    const resumeGoal = async () => {
      try {
        await store.dispatch('goals/resumeGoal', props.goal.id);
        emit('close');
      } catch (error) {
        console.error('Error resuming goal:', error);
      }
    };

    const refreshGoal = async () => {
      try {
        await store.dispatch('goals/refreshGoalStatus', props.goal.id);
        await store.dispatch('goals/fetchGoals');
      } catch (error) {
        console.error('Error refreshing goal:', error);
      }
    };

    const deleteGoal = async () => {
      const confirmed = await simpleModal.value?.showModal({
        title: 'Delete Goal?',
        message: 'Are you sure you want to delete this goal?',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        showCancel: true,
        confirmClass: 'btn-danger',
      });

      if (!confirmed) return;

      try {
        await store.dispatch('goals/deleteGoal', props.goal.id);
        emit('close');
      } catch (error) {
        console.error('Error deleting goal:', error);
      }
    };

    return {
      simpleModal,
      showRawData,
      getStatusClass,
      getStatusIcon,
      getTaskStatusClass,
      getGoalProgress,
      getCompletedTasks,
      getTotalTasks,
      formatGoalStatus,
      formatTaskTime,
      pauseGoal,
      resumeGoal,
      refreshGoal,
      deleteGoal,
    };
  },
};
</script>

<style scoped>
.goal-detail-view {
  max-height: 70vh;
  overflow-y: auto;
  padding: 0;
}

.detail-section {
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.1);
}

.detail-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
}

.detail-section-title {
  color: var(--color-light-green);
  font-size: 1em;
  margin: 0 0 16px 0;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.goal-overview {
  background: rgba(var(--green-rgb), 0.05);
  border-radius: 8px;
  padding: 16px;
}

.goal-title {
  color: var(--color-light-green);
  font-size: 1.2em;
  font-weight: 600;
  margin-bottom: 8px;
}

.goal-description {
  color: var(--color-grey);
  line-height: 1.5;
  margin-bottom: 16px;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.status-item {
  background: rgba(var(--green-rgb), 0.1);
  border-radius: 6px;
  padding: 8px 12px;
  text-align: center;
}

.status-label {
  display: block;
  color: var(--color-grey);
  font-size: 0.8em;
  margin-bottom: 4px;
}

.status-value {
  color: var(--color-light-green);
  font-weight: 600;
  font-size: 0.9em;
}

.status-value.status-working {
  color: var(--color-yellow);
}

.status-value.status-complete {
  color: var(--color-green);
}

.status-value.status-failed {
  color: var(--color-red);
}

.status-value.status-needs-input {
  color: #6366f1;
}

.status-value.priority {
  text-transform: uppercase;
  font-size: 0.8em;
}

.status-value.priority.low {
  color: #10b981;
}

.status-value.priority.medium {
  color: #f59e0b;
}

.status-value.priority.high {
  color: #f97316;
}

.status-value.priority.urgent {
  color: var(--color-red);
}

.progress-section {
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background: rgba(var(--green-rgb), 0.2);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--color-green);
  transition: width 0.3s ease;
}

.progress-text {
  color: var(--color-grey);
  font-size: 0.85em;
  min-width: 80px;
}

.tasks-list {
  max-height: 300px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  padding: 8px;
}

.task-item {
  background: rgba(var(--green-rgb), 0.05);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 8px;
  transition: all 0.2s ease;
}

.task-item:last-child {
  margin-bottom: 0;
}

.task-item.task-completed {
  border-color: rgba(34, 197, 94, 0.3);
  background: rgba(34, 197, 94, 0.1);
}

.task-item.task-failed {
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.1);
}

.task-item.task-executing {
  border-color: rgba(251, 191, 36, 0.3);
  background: rgba(251, 191, 36, 0.1);
}

.task-header {
  display: flex;
  align-items: center;
  gap: 8px;
  /* margin-bottom: 8px; */
}

.task-number {
  background: var(--color-green);
  color: var(--color-dark-navy);
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8em;
  font-weight: 600;
  flex-shrink: 0;
}

.task-title {
  color: var(--color-light-green);
  font-weight: 500;
  flex: 1;
}

.task-timestamp {
  color: var(--color-grey);
  font-size: 0.8em;
}

.task-success,
.task-error,
.task-executing {
  font-size: 0.85em;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.task-success {
  color: var(--color-green);
}

.task-error {
  color: var(--color-red);
}

.task-executing {
  color: var(--color-yellow);
}

.task-details-expandable,
.raw-data-expandable {
  margin-top: 8px;
}

.task-details-expandable summary,
.raw-data-expandable summary {
  color: var(--color-grey);
  font-size: 0.8em;
  cursor: pointer;
  user-select: none;
}

.task-details-expandable summary:hover,
.raw-data-expandable summary:hover {
  color: var(--color-light-green);
}

.task-details-content {
  margin-top: 8px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
}

.task-details-content h6 {
  color: var(--color-light-green);
  font-size: 0.8em;
  margin: 0 0 4px 0;
}

.task-details-content pre,
.raw-data {
  font-size: 0.75em;
  line-height: 1.4;
  color: var(--color-grey);
  background: rgba(0, 0, 0, 0.5);
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 0;
}

.goal-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.action-button {
  padding: 8px 16px;
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 6px;
  background: rgba(var(--green-rgb), 0.1);
  color: var(--color-light-green);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9em;
  transition: all 0.2s ease;
}

.action-button:hover {
  background: rgba(var(--green-rgb), 0.2);
  border-color: rgba(var(--green-rgb), 0.5);
}

.action-button.primary {
  background: var(--color-green);
  color: var(--color-dark-navy);
  border-color: var(--color-green);
}

.action-button.primary:hover {
  background: rgba(var(--green-rgb), 0.8);
}

.action-button.danger {
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-red);
}

.action-button.danger:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
}
</style>
