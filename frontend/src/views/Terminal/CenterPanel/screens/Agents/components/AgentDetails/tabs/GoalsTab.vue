<template>
  <div class="tab-pane goals">
    <!-- <h3 class="section-title">
      <i class="fas fa-bullseye"></i> Goal-Driven Automation
    </h3> -->
    <div class="goals-container">
      <!-- Goal Input Section -->
      <div class="goal-input-section">
        <h4 class="section-title">
          <i class="fas fa-plus"></i>
          Create New Goal
        </h4>
        <div class="goal-input-wrapper">
          <textarea
            :value="goalInput"
            @input="$emit('update:goalInput', $event.target.value)"
            @keyup.ctrl.enter="$emit('create-goal')"
            class="goal-input"
            placeholder="Describe what you want to accomplish in natural language... 

Examples:
• 'Create a comprehensive marketing strategy for our new product launch'
• 'Research and write a technical blog post about Vue.js 3 composition API'
• 'Analyze our competitor's pricing and create a competitive analysis report'"
            rows="4"
          ></textarea>
          <div class="goal-input-actions">
            <button @click="$emit('create-goal')" :disabled="!goalInput.trim() || isCreatingGoal" class="action-button primary">
              <i class="fas fa-magic"></i>
              {{ isCreatingGoal ? 'Analyzing...' : 'Create & Execute Goal' }}
            </button>
            <button @click="$emit('update:goalInput', '')" :disabled="!goalInput.trim()" class="action-button">
              <i class="fas fa-times"></i>
              Clear
            </button>
          </div>
        </div>
      </div>

      <!-- Active Goals -->
      <div class="goals-group">
        <h4 class="section-title"><i class="fas fa-play"></i> Active Goals ({{ activeGoals.length }})</h4>
        <div class="goals-list" v-if="activeGoals.length">
          <div v-for="goal in activeGoals" :key="goal.id" class="goal-card" :class="{ executing: goal.status === 'executing' }">
            <div class="goal-header">
              <div class="goal-title-section">
                <span class="goal-title">{{ goal.title }}</span>
                <span :class="['goal-status', goal.status]">{{ formatGoalStatus(goal.status) }}</span>
              </div>
              <div class="goal-meta">
                <span class="goal-priority" :class="goal.priority">{{ goal.priority.toUpperCase() }}</span>
                <span class="goal-time">{{ formatGoalTime(goal.created_at) }}</span>
              </div>
            </div>
            <div class="goal-description">{{ goal.description }}</div>

            <!-- Progress Bar -->
            <div class="goal-progress" v-if="goal.status === 'executing' || goal.status === 'completed'">
              <div class="progress-bar">
                <div class="progress-fill" :style="{ width: `${getGoalProgress(goal)}%` }"></div>
              </div>
              <span class="progress-text">{{ getGoalProgress(goal) }}%</span>
            </div>

            <!-- Current Tasks -->
            <div class="goal-current-tasks" v-if="goal.currentTasks && goal.currentTasks.length">
              <div class="current-task-label">
                <i class="fas fa-cog fa-spin"></i>
                Currently executing:
              </div>
              <div class="current-tasks-list">
                <span v-for="task in goal.currentTasks" :key="task.id" class="current-task"> {{ task.title }} ({{ task.progress }}%) </span>
              </div>
            </div>

            <!-- Actions -->
            <div class="goal-actions">
              <button @click="$emit('view-goal-details', goal)" class="goal-button">
                <i class="fas fa-eye"></i>
                Details
              </button>
              <button v-if="goal.status === 'executing'" @click="$emit('pause-goal', goal)" class="goal-button">
                <i class="fas fa-pause"></i>
                Pause
              </button>
              <button v-if="goal.status === 'paused'" @click="$emit('resume-goal', goal)" class="goal-button">
                <i class="fas fa-play"></i>
                Resume
              </button>
              <button @click="$emit('delete-goal', goal)" class="goal-button danger">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
        <div v-else class="empty-state">
          <i class="fas fa-bullseye"></i>
          <p>No active goals. Create your first goal above!</p>
        </div>
      </div>

      <!-- Recent Goals -->
      <div class="goals-group">
        <h4 class="section-title"><i class="fas fa-history"></i> Recent Goals ({{ recentGoals.length }})</h4>
        <div class="goals-list recent" v-if="recentGoals.length">
          <div v-for="goal in recentGoals" :key="goal.id" class="goal-card completed">
            <div class="goal-header">
              <div class="goal-title-section">
                <span class="goal-title">{{ goal.title }}</span>
                <span :class="['goal-status', goal.status]">{{ formatGoalStatus(goal.status) }}</span>
              </div>
              <div class="goal-meta">
                <span class="goal-time">{{ formatGoalTime(goal.completed_at || goal.created_at) }}</span>
              </div>
            </div>
            <div class="goal-description">{{ goal.description }}</div>
            <div class="goal-stats" v-if="goal.task_count">
              <span class="stat">
                <i class="fas fa-tasks"></i>
                {{ goal.completed_tasks }}/{{ goal.task_count }} tasks completed
              </span>
            </div>
          </div>
        </div>
        <div v-else class="empty-state">
          <i class="fas fa-history"></i>
          <p>No recent goals</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  goalInput: {
    type: String,
    required: true,
  },
  isCreatingGoal: {
    type: Boolean,
    default: false,
  },
  activeGoals: {
    type: Array,
    default: () => [],
  },
  recentGoals: {
    type: Array,
    default: () => [],
  },
  formatGoalStatus: {
    type: Function,
    required: true,
  },
  formatGoalTime: {
    type: Function,
    required: true,
  },
  getGoalProgress: {
    type: Function,
    required: true,
  },
});

defineEmits(['update:goalInput', 'create-goal', 'view-goal-details', 'pause-goal', 'resume-goal', 'delete-goal']);
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
  /* color: var(--color-light-green); */
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

.action-button.primary {
  background: var(--color-green);
  color: var(--color-dark-navy);
  border: none;
}

.action-button.primary:hover {
  background: rgba(25, 239, 131, 0.8);
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

/* Goals Tab Styles */
.goals-container {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* .goal-input-section {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(25, 239, 131, 0.2);
  border-radius: 8px;
  padding: 16px;
} */

.goal-input-wrapper {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.goal-input {
  width: 100%;
  min-height: 120px;
  padding: 16px;
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.3);
  color: var(--color-light-green);
  font-family: inherit;
  font-size: 0.95em;
  line-height: 1.5;
  resize: vertical;
}

.goal-input:focus {
  outline: none;
  border-color: var(--color-green);
  box-shadow: 0 0 0 2px rgba(25, 239, 131, 0.2);
}

.goal-input::placeholder {
  color: var(--color-grey);
  opacity: 0.7;
}

.goal-input-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-start;
}

.goals-group {
  display: flex;
  flex-direction: column;
}

.goals-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 16px;
}

.goals-list.recent {
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
}

.goal-card {
  background: rgba(25, 239, 131, 0.08);
  border: 1px solid rgba(25, 239, 131, 0.25);
  border-radius: 8px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: all 0.2s ease;
  position: relative;
}

.goal-card:hover {
  background: rgba(25, 239, 131, 0.12);
  border-color: rgba(25, 239, 131, 0.4);
  transform: translateY(-1px);
}

.goal-card.executing {
  border-color: var(--color-green);
  box-shadow: 0 0 12px rgba(25, 239, 131, 0.3);
}

.goal-card.executing::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--color-green), transparent);
  animation: pulse-glow 2s ease-in-out infinite;
}

@keyframes pulse-glow {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}

.goal-card.completed {
  opacity: 0.8;
  border-style: dashed;
  border-color: rgba(25, 239, 131, 0.2);
}

.goal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.goal-title-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.goal-title {
  color: var(--color-light-green);
  font-weight: bold;
  font-size: 1.1em;
  line-height: 1.3;
}

.goal-status {
  font-size: 0.8em;
  padding: 2px 8px;
  border-radius: 12px;
  font-weight: bold;
  text-transform: uppercase;
  align-self: flex-start;
}

.goal-status.planning {
  background: rgba(108, 117, 125, 0.2);
  color: #6c757d;
}

.goal-status.executing {
  background: rgba(25, 239, 131, 0.2);
  color: var(--color-green);
}

.goal-status.paused {
  background: rgba(255, 193, 7, 0.2);
  color: #ffc107;
}

.goal-status.completed {
  background: rgba(40, 167, 69, 0.2);
  color: #28a745;
}

.goal-status.failed {
  background: rgba(220, 53, 69, 0.2);
  color: #dc3545;
}

.goal-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.goal-priority {
  font-size: 0.75em;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: bold;
  text-transform: uppercase;
}

.goal-priority.low {
  background: rgba(108, 117, 125, 0.2);
  color: #6c757d;
}

.goal-priority.medium {
  background: rgba(255, 193, 7, 0.2);
  color: #ffc107;
}

.goal-priority.high {
  background: rgba(255, 152, 0, 0.2);
  color: #ff9800;
}

.goal-priority.urgent {
  background: rgba(244, 67, 54, 0.2);
  color: #f44336;
}

.goal-time {
  color: var(--color-grey);
  font-size: 0.8em;
}

.goal-description {
  color: var(--color-grey);
  font-size: 0.9em;
  line-height: 1.4;
  display: -webkit-box;
  /* -webkit-line-clamp: 3; */
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.goal-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}

.goal-current-tasks {
  background: rgba(25, 239, 131, 0.1);
  border-radius: 4px;
  padding: 8px;
  margin: 4px 0;
}

.current-task-label {
  color: var(--color-green);
  font-size: 0.8em;
  font-weight: bold;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.current-tasks-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.current-task {
  background: rgba(25, 239, 131, 0.2);
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 0.8em;
  color: var(--color-light-green);
}

.goal-actions {
  display: flex;
  gap: 8px;
  margin-top: auto;
  flex-wrap: wrap;
}

.goal-button {
  padding: 6px 12px;
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 4px;
  background: rgba(25, 239, 131, 0.1);
  color: var(--color-light-green);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.85em;
  transition: all 0.2s;
}

.goal-button:hover {
  background: rgba(25, 239, 131, 0.2);
  border-color: rgba(25, 239, 131, 0.5);
}

.goal-button.danger {
  border-color: rgba(244, 67, 54, 0.3);
  background: rgba(244, 67, 54, 0.1);
  color: #f44336;
}

.goal-button.danger:hover {
  background: rgba(244, 67, 54, 0.2);
  border-color: rgba(244, 67, 54, 0.5);
}

.goal-stats {
  margin-top: 8px;
  color: var(--color-grey);
  font-size: 0.85em;
}

.goal-stats .stat {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
