<template>
  <div class="tab-pane tasks">
    <h3 class="section-title">
      <i class="fas fa-tasks"></i> Goal-Generated Tasks
    </h3>
    <div class="tasks-container">
      <!-- Task Info -->
      <div class="task-info-section">
        <div class="info-card">
          <i class="fas fa-info-circle"></i>
          <div class="info-content">
            <p>
              Tasks are automatically generated from your goals and assigned
              to specialized agents.
            </p>
            <p>
              Create goals in the <strong>Goals</strong> tab to see tasks
              appear here.
            </p>
          </div>
        </div>
      </div>

      <!-- Task Controls -->
      <div class="task-controls">
        <button @click="$emit('refresh-tasks')" class="action-button">
          <i class="fas fa-sync"></i>
          Refresh Tasks
        </button>
        <select
          :value="taskFilter"
          @change="$emit('update:taskFilter', $event.target.value)"
          class="task-filter-select"
        >
          <option value="all">All Tasks</option>
          <option value="pending">Pending</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <!-- Tasks List -->
      <div class="tasks-section">
        <!-- Goal-based Tasks -->
        <div
          v-for="goal in goalsWithTasks"
          :key="goal.id"
          class="goal-tasks-group"
        >
          <div class="goal-task-header">
            <h4 class="goal-task-title">
              <i class="fas fa-bullseye"></i>
              {{ goal.title }}
            </h4>
            <span class="goal-task-progress">{{
              getGoalTasksProgress(goal)
            }}</span>
          </div>

          <div
            class="tasks-list"
            v-if="getFilteredTasks(goal.tasks).length"
          >
            <div
              v-for="task in getFilteredTasks(goal.tasks)"
              :key="task.id"
              class="task-card"
              :class="task.status"
            >
              <div class="task-header">
                <span class="task-title">{{ task.title }}</span>
                <div class="task-meta">
                  <span class="task-agent">
                    <i class="fas fa-robot"></i>
                    {{ getAgentNameForTask(task) }}
                  </span>
                  <span :class="['task-status-badge', task.status]">
                    {{ formatTaskStatus(task.status) }}
                  </span>
                </div>
              </div>
              <div class="task-description">{{ task.description }}</div>

              <!-- Required Tools -->
              <div
                class="task-tools"
                v-if="task.required_tools && task.required_tools.length"
              >
                <span class="tools-label">Required tools:</span>
                <div class="tools-list">
                  <span
                    v-for="tool in task.required_tools"
                    :key="tool"
                    class="tool-tag"
                  >
                    {{ tool }}
                  </span>
                </div>
              </div>

              <!-- Progress Bar -->
              <div
                class="task-progress"
                v-if="
                  task.status === 'running' && task.progress !== undefined
                "
              >
                <div class="progress-bar">
                  <div
                    class="progress-fill"
                    :style="{ width: `${task.progress}%` }"
                  ></div>
                </div>
                <span class="progress-text">{{ task.progress }}%</span>
              </div>

              <!-- Task Times -->
              <div class="task-times">
                <span v-if="task.started_at" class="task-time">
                  <i class="fas fa-play"></i>
                  Started: {{ formatTaskTime(task.started_at) }}
                </span>
                <span v-if="task.completed_at" class="task-time">
                  <i class="fas fa-check"></i>
                  Completed: {{ formatTaskTime(task.completed_at) }}
                </span>
              </div>
            </div>
          </div>
          <div v-else class="empty-state small">
            <p>No {{ taskFilter }} tasks for this goal</p>
          </div>
        </div>

        <!-- No Goals Message -->
        <div v-if="!goalsWithTasks.length" class="empty-state">
          <i class="fas fa-tasks"></i>
          <p>No goal-generated tasks yet</p>
          <p>
            Create goals in the <strong>Goals</strong> tab to see automated
            tasks here
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  goalsWithTasks: {
    type: Array,
    default: () => [],
  },
  taskFilter: {
    type: String,
    required: true,
  },
  getGoalTasksProgress: {
    type: Function,
    required: true,
  },
  getFilteredTasks: {
    type: Function,
    required: true,
  },
  getAgentNameForTask: {
    type: Function,
    required: true,
  },
  formatTaskStatus: {
    type: Function,
    required: true,
  },
  formatTaskTime: {
    type: Function,
    required: true,
  },
});

defineEmits(["update:taskFilter", "refresh-tasks"]);
</script>

<style scoped>
/* Copied from AgentDetails.vue */
.tab-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}
h3.section-title,
h4.section-title {
  color: var(--color-light-green);
  font-size: 1em;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 16px;
  margin: 0;
  border-bottom: 1px solid rgba(25, 239, 131, 0.2);
}
h4.section-title {
  font-size: 0.9em;
  padding-bottom: 12px;
  margin-bottom: 12px;
}
.section-title i {
  color: var(--color-green);
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  color: var(--color-grey);
  gap: 8px;
  background: rgba(25, 239, 131, 0.05);
  border-radius: 4px;
}
.empty-state i {
  font-size: 1.5em;
  opacity: 0.5;
}
.empty-state p {
  font-size: 0.9em;
}
.action-button {
  padding: 8px 16px;
  background: rgba(25, 239, 131, 0.1);
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 4px;
  color: var(--color-light-green);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
}
.action-button:hover {
  background: rgba(25, 239, 131, 0.2);
}
.progress-bar {
  flex: 1;
  height: 4px;
  background: rgba(25, 239, 131, 0.1);
  border-radius: 2px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--color-green);
  transition: width 0.3s ease;
}
.progress-text {
  color: var(--color-grey);
  font-size: 0.9em;
  min-width: 40px;
  text-align: right;
}
/* Tasks Tab Styles */
.tasks-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.task-controls {
  display: flex;
  gap: 12px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(25, 239, 131, 0.2);
}
.tasks-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 16px;
}
.tasks-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
  padding: 16px;
}
.task-card {
  background: rgba(25, 239, 131, 0.1);
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 6px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: all 0.2s;
}
.task-card:hover {
  background: rgba(25, 239, 131, 0.15);
  border-color: rgba(25, 239, 131, 0.5);
}
.task-card.completed {
  opacity: 0.7;
  border-style: dashed;
}
.task-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.task-title {
  color: var(--color-light-green);
  font-weight: bold;
  font-size: 1em;
  line-height: 1.3;
}
.task-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
.task-description {
  color: var(--color-grey);
  font-size: 0.9em;
  line-height: 1.4;
}
.task-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}
.info-card {
  background: rgba(25, 239, 131, 0.05);
  border: 1px solid rgba(25, 239, 131, 0.2);
  border-radius: 6px;
  padding: 16px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.info-card i {
  color: var(--color-green);
  font-size: 1.2em;
  margin-top: 2px;
}
.info-content p {
  margin: 0 0 8px 0;
  color: var(--color-grey);
  line-height: 1.4;
}
.info-content p:last-child {
  margin-bottom: 0;
}
.task-filter-select {
  width: 120px;
  padding: 8px 12px;
  border-radius: 4px;
  border: 1px solid rgba(25, 239, 131, 0.25);
  background: rgba(25, 239, 131, 0.1);
  color: var(--color-light-green);
  font-size: 0.95em;
  transition: background 0.15s, color 0.15s, border 0.15s;
  margin-left: 8px;
  height: 33px;
}
select option {
  background-color: #080921;
}
.goal-tasks-group {
  border: 1px solid rgba(25, 239, 131, 0.2);
  border-radius: 6px;
  overflow: hidden;
}
.goal-task-header {
  background: rgba(25, 239, 131, 0.1);
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(25, 239, 131, 0.2);
}
.goal-task-title {
  color: var(--color-light-green);
  font-size: 1em;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.goal-task-progress {
  color: var(--color-grey);
  font-size: 0.9em;
}
.task-card.pending {
  border-left: 4px solid #6c757d;
  background: rgba(108, 117, 125, 0.1);
}
.task-card.assigned {
  border-left: 4px solid #ffc107;
  background: rgba(255, 193, 7, 0.1);
}
.task-card.running {
  border-left: 4px solid var(--color-green);
  background: rgba(25, 239, 131, 0.1);
}
.task-card.completed {
  border-left: 4px solid #28a745;
  opacity: 0.8;
}
.task-card.failed {
  border-left: 4px solid #dc3545;
}
.task-agent {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--color-grey);
  font-size: 0.8em;
}
.task-status-badge {
  font-size: 0.75em;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: bold;
  text-transform: uppercase;
}
.task-status-badge.pending {
  background: rgba(108, 117, 125, 0.2);
  color: #6c757d;
}
.task-status-badge.assigned {
  background: rgba(255, 193, 7, 0.2);
  color: #ffc107;
}
.task-status-badge.running {
  background: rgba(25, 239, 131, 0.2);
  color: var(--color-green);
}
.task-status-badge.completed {
  background: rgba(40, 167, 69, 0.2);
  color: #28a745;
}
.task-status-badge.failed {
  background: rgba(220, 53, 69, 0.2);
  color: #dc3545;
}
.task-tools {
  margin: 8px 0;
}
.tools-label {
  color: var(--color-grey);
  font-size: 0.8em;
  margin-bottom: 4px;
  display: block;
}
.tools-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.tool-tag {
  background: rgba(25, 239, 131, 0.15);
  color: var(--color-light-green);
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.75em;
  border: 1px solid rgba(25, 239, 131, 0.3);
}
.task-times {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
}
.task-time {
  color: var(--color-grey);
  font-size: 0.8em;
  display: flex;
  align-items: center;
  gap: 4px;
}
.empty-state.small {
  padding: 16px;
  background: rgba(25, 239, 131, 0.05);
  text-align: center;
  color: var(--color-grey);
  font-size: 0.9em;
  border-radius: 4px;
  margin: 8px 0;
}
</style> 