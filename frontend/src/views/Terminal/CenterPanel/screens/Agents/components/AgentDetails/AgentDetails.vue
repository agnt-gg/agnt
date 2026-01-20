<template>
  <div class="agent-details-section" :class="{ expanded: isDetailsExpanded }">
    <div class="tabs-header">
      <div class="tabs-left">
        <button v-for="tab in tabs" :key="tab.id" :class="['tab-button', { active: activeTab === tab.id }]" @click="activeTab = tab.id">
          <i :class="tab.icon"></i>
          {{ tab.name }}
        </button>
      </div>
      <div class="tabs-right">
        <Tooltip :text="isDetailsExpanded ? 'Minimize' : 'Expand'" width="auto">
          <button class="expand-button" @click="toggleDetailsExpanded">
            <i :class="isDetailsExpanded ? 'fas fa-compress' : 'fas fa-expand'"></i>
          </button>
        </Tooltip>
        <Tooltip text="Close" width="auto">
          <button class="close-button" @click="closeDetails">
            <i class="fas fa-times"></i>
          </button>
        </Tooltip>
      </div>
    </div>

    <div class="tab-content">
      <!-- Overview Tab -->
      <OverviewTab
        v-if="activeTab === 'overview'"
        :selected-agent="selectedAgent"
        :format-uptime="formatUptime"
        @toggle-agent="emit('toggle-agent', $event)"
      />

      <!-- Chat Tab -->
      <ChatTab v-if="activeTab === 'chat'" :selected-agent="selectedAgent" @add-terminal-line="emit('add-terminal-line', $event)" />

      <!-- Goals Tab -->
      <GoalsTab
        v-if="activeTab === 'goals'"
        v-model:goalInput="goalInput"
        :is-creating-goal="isCreatingGoal"
        :active-goals="activeGoals"
        :recent-goals="recentGoals"
        :format-goal-status="formatGoalStatus"
        :format-goal-time="formatGoalTime"
        :get-goal-progress="getGoalProgress"
        @create-goal="createGoal"
        @view-goal-details="viewGoalDetails"
        @pause-goal="pauseGoal"
        @resume-goal="resumeGoal"
        @delete-goal="deleteGoal"
      />

      <!-- Tasks Tab -->
      <TasksTab
        v-if="activeTab === 'tasks'"
        v-model:taskFilter="taskFilter"
        :goals-with-tasks="goalsWithTasks"
        :get-goal-tasks-progress="getGoalTasksProgress"
        :get-filtered-tasks="getFilteredTasks"
        :get-agent-name-for-task="getAgentNameForTask"
        :format-task-status="formatTaskStatus"
        :format-task-time="formatTaskTime"
        @refresh-tasks="refreshGoalTasks"
      />

      <!-- Tools Tab -->
      <ToolsTab
        v-if="activeTab === 'tools'"
        :selected-agent="selectedAgent"
        @execute-tool="emit('execute-tool', $event)"
        @view-tool-details="emit('view-tool-details', $event)"
      />

      <!-- Workflows Tab -->
      <!-- <WorkflowsTab v-if="activeTab === 'workflows'" /> -->

      <!-- Resources Tab -->
      <!-- <ResourcesTab v-if="activeTab === 'resources'" /> -->

      <!-- Configure Tab -->
      <ConfigureTab
        v-if="activeTab === 'configure'"
        :selected-agent="selectedAgent"
        :available-tools="availableTools"
        :category-options="categoryOptions"
        :save-status="saveStatus"
        @save-configuration="emit('save-configuration', $event)"
        @delete-agent="emit('delete-agent', $event)"
        @add-terminal-line="emit('add-terminal-line', $event)"
      />
      <!-- :available-workflows="availableWorkflows" -->
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config.js';

import OverviewTab from './tabs/OverviewTab.vue';
import ChatTab from './tabs/ChatTab.vue';
import GoalsTab from './tabs/GoalsTab.vue';
import TasksTab from './tabs/TasksTab.vue';
import ToolsTab from './tabs/ToolsTab.vue';
// import WorkflowsTab from './tabs/WorkflowsTab.vue';
import ResourcesTab from './tabs/ResourcesTab.vue';
import ConfigureTab from './tabs/ConfigureTab.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

const props = defineProps({
  selectedAgent: {
    type: Object,
    required: true,
  },
  formatUptime: {
    type: Function,
    required: true,
  },
  availableTools: {
    type: Array,
    default: () => [],
  },
  availableWorkflows: {
    type: Array,
    default: () => [],
  },
  categoryOptions: {
    type: Array,
    default: () => [],
  },
  isDetailsExpanded: {
    type: Boolean,
    required: true,
  },
  saveStatus: {
    type: String,
    required: false,
  },
});

const emit = defineEmits([
  'toggle-details-expanded',
  'close-details',
  'toggle-agent',
  'save-configuration',
  'delete-agent',
  'add-terminal-line',
  'fetch-goals',
  'create-goal',
  'pause-goal',
  'resume-goal',
  'delete-goal',
  'execute-tool',
  'view-tool-details',
]);

const store = useStore();

const activeTab = ref('overview');

const toggleDetailsExpanded = () => {
  emit('toggle-details-expanded');
};

const closeDetails = () => {
  console.log('[AgentDetails] Close button clicked!');
  emit('close-details');
};

const tabs = [
  { id: 'overview', name: 'Overview', icon: 'fas fa-chart-bar' },
  { id: 'chat', name: 'Chat', icon: 'fas fa-comments' },
  // { id: 'goals', name: 'Goals', icon: 'fas fa-bullseye' },
  // { id: 'missions', name: 'Missions', icon: 'fas fa-flag' },
  // { id: 'tasks', name: 'Tasks', icon: 'fas fa-tasks' },
  // { id: 'workflows', name: 'Workflows', icon: 'fas fa-sitemap' },
  { id: 'tools', name: 'Tools', icon: 'fas fa-tools' },
  // { id: 'resources', name: 'Resources', icon: 'fas fa-database' },
  { id: 'configure', name: 'Configure', icon: 'fas fa-cog' },
];

// Goals and Tasks functionality
const goalInput = ref('');
const isCreatingGoal = ref(false);
const goals = ref([]);
const taskFilter = ref('all');
const goalStatusSubscriptions = new Map();

const activeGoals = computed(() => goals.value.filter((goal) => ['planning', 'executing', 'paused'].includes(goal.status)));

const recentGoals = computed(() => goals.value.filter((goal) => ['completed', 'failed', 'stopped'].includes(goal.status)).slice(0, 12));

const goalsWithTasks = computed(() => goals.value.filter((goal) => goal.tasks && goal.tasks.length > 0));

const formatGoalStatus = (status) => {
  const statusMap = {
    planning: 'Planning',
    executing: 'Executing',
    paused: 'Paused',
    completed: 'Completed',
    failed: 'Failed',
    stopped: 'Stopped',
  };
  return statusMap[status] || status;
};

const formatGoalTime = (timestamp) => {
  if (!timestamp) return 'Just now';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

const getGoalProgress = (goal) => {
  if (goal.progress !== undefined) return goal.progress;
  if (!goal.task_count) return 0;
  return Math.round((goal.completed_tasks / goal.task_count) * 100);
};

const getGoalTasksProgress = (goal) => {
  if (!goal.tasks || !goal.tasks.length) return '0/0 tasks';
  const completed = goal.tasks.filter((t) => t.status === 'completed').length;
  return `${completed}/${goal.tasks.length} tasks`;
};

const getFilteredTasks = (tasks) => {
  if (!tasks) return [];
  if (taskFilter.value === 'all') return tasks;
  return tasks.filter((task) => task.status === taskFilter.value);
};

const formatTaskStatus = (status) => {
  const statusMap = {
    pending: 'Pending',
    assigned: 'Assigned',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    timeout: 'Timeout',
  };
  return statusMap[status] || status;
};

const getAgentNameForTask = (task) => {
  if (!task.agent_id) {
    if (task.required_tools?.includes('research')) return 'Research Agent';
    if (task.required_tools?.includes('writing')) return 'Content Agent';
    if (task.required_tools?.includes('analysis')) return 'Analysis Agent';
    return 'General Agent';
  }
  return `Agent ${task.agent_id}`;
};

const formatTaskTime = (timestamp) => new Date(timestamp).toLocaleString();

const viewGoalDetails = (goal) => {
  activeTab.value = 'tasks';
  emit('add-terminal-line', `[Goals] Viewing details for: ${goal.title}`);
};

onMounted(() => {
  fetchGoals();
});

onUnmounted(() => {
  goalStatusSubscriptions.forEach((interval) => clearInterval(interval));
  goalStatusSubscriptions.clear();
});

// Mocked fetchGoals and related methods for now
// In a real scenario, these would make API calls
const fetchGoals = async () => {
  emit('fetch-goals', (fetchedGoals) => {
    goals.value = fetchedGoals;
    // Post-fetch logic
    for (const goal of goals.value) {
      if (['executing', 'paused'].includes(goal.status)) {
        // monitorGoalProgress(goal.id);
      }
    }
  });
};

const createGoal = () => {
  emit('create-goal', goalInput.value);
  goalInput.value = '';
};
const pauseGoal = (goal) => emit('pause-goal', goal);
const resumeGoal = (goal) => emit('resume-goal', goal);
const deleteGoal = (goal) => emit('delete-goal', goal);
const refreshGoalTasks = async () => {
  emit('add-terminal-line', `[Goals] Refreshing goals and tasks...`);
  await fetchGoals();
  emit('add-terminal-line', `[Goals] Goals refreshed.`);
};

// ... and so on for other goal methods
// The full implementation would require more events to the parent.
</script>

<style scoped>
/* Copied from Agents.vue */
.agent-details-section {
  flex: 1;
  width: calc(100% - 2px);
  border: 1px solid var(--terminal-border-color);
  border-radius: 0 0 0 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 56.75%;
  transition: all 0.3s ease;
  /* backdrop-filter: blur(4px); */
}

.tabs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(25, 239, 131, 0.1);
  border-bottom: 1px solid var(--terminal-border-color);
}

.tabs-left {
  display: flex;
}

.tabs-right {
  display: flex;
  align-items: center;
}

.tab-button {
  padding: 10px 16px;
  background: none;
  border: none;
  color: var(--color-white);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
  border-bottom: 2px solid transparent;
  opacity: 0.9;
}

.tab-button i {
  font-size: 0.9em;
}

.tab-button.active {
  color: var(--color-white);
  background: rgba(25, 239, 131, 0.15);
  border-bottom: 2px solid var(--color-green);
  opacity: 1;
}

.tab-button:hover:not(.active) {
  color: var(--color-light-green);
  background: rgba(25, 239, 131, 0.05);
}

.table-container {
  border-radius: 0 !important;
}

.tab-content {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* .agent-details-section.expanded .tab-content {
  background: var(--color-popup);
} */

/* Overview Tab Styles */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
  width: 100%;
}

.stat-item {
  background: rgba(25, 239, 131, 0.1);
  padding: 12px;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  color: var(--color-grey);
  font-size: 0.9em;
}

.stat-value {
  color: var(--color-light-green);
  font-size: 1.1em;
}

.quick-actions {
  display: flex;
  gap: 10px;
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

/* Tools Tab Styles */
.tools-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
  width: 100%;
}

.tool-card {
  background: rgba(25, 239, 131, 0.1);
  border-radius: 4px;
  padding: 12px;
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--color-light-green);
}

.tool-actions {
  display: flex;
  gap: 8px;
}

.tool-button {
  flex: 1;
  padding: 6px;
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 4px;
  background: none;
  color: var(--color-light-green);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 0.9em;
}

.tool-button:hover {
  background: rgba(25, 239, 131, 0.15);
}

/* Resources Tab Styles */
.resources-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 16px;
  width: 100%;
}

.resource-item {
  background: rgba(25, 239, 131, 0.1);
  padding: 12px;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.resource-label {
  color: var(--color-grey);
  font-size: 0.9em;
}

.resource-value {
  color: var(--color-light-green);
  font-size: 1.1em;
}

/* Missions Tab Styles */
.missions-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.missions-group {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.missions-group-title {
  color: var(--color-grey);
  font-size: 1em;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(25, 239, 131, 0.1);
}

.missions-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.mission-card {
  background: rgba(25, 239, 131, 0.1);
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 4px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mission-card.completed {
  opacity: 0.7;
}

.mission-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.mission-title {
  color: var(--color-light-green);
  font-weight: bold;
}

.mission-status {
  color: var(--color-grey);
  font-size: 0.9em;
}

.mission-description {
  color: var(--color-grey);
  font-size: 0.9em;
  line-height: 1.4;
}

.mission-rewards {
  display: flex;
  gap: 12px;
}

.reward-item {
  color: var(--color-light-green);
  font-size: 0.9em;
  display: flex;
  align-items: center;
  gap: 4px;
}

.mission-progress {
  display: flex;
  align-items: center;
  gap: 8px;
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

/* Empty State Styles */
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

.overview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.agent-name-display {
  color: var(--color-white);
  font-size: 1.2em;
  margin: 0;
}

.agent-description-display {
  color: var(--color-white);
  margin-bottom: 15px;
  line-height: 1.5;
}

.divider {
  border: none;
  border-top: 1px dashed rgba(25, 239, 131, 0.2);
  margin: 15px 0;
}

.edit-button {
  color: var(--color-grey);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s ease;
  font-size: 0.9em;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid transparent;
}

.edit-button:hover {
  color: var(--color-green);
  background-color: rgba(25, 239, 131, 0.1);
  border-color: rgba(25, 239, 131, 0.3);
}

.overview-edit {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.overview-edit h4 {
  color: var(--color-green);
  margin-bottom: 5px;
  border-bottom: 1px solid rgba(25, 239, 131, 0.2);
  padding-bottom: 5px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.form-field label {
  color: var(--color-grey);
  font-size: 0.9em;
}

.input {
  /* background: rgba(25, 239, 131, 0.1); */
  border: 1px solid rgba(25, 239, 131, 0.3);
  color: var(--color-light-green);
  padding: 10px 12px;
  border-radius: 4px;
  width: 100%;
  font-size: 1em;
}

textarea.input {
  font-family: inherit;
  resize: vertical;
  min-height: 80px;
}

select.input {
  appearance: none;
  background-image: url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2319EF83%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E');
  background-repeat: no-repeat;
  background-position: right 0.7rem top 50%;
  background-size: 0.65rem auto;
  padding: 2px 12px 0px 12px;
}

.edit-actions {
  display: flex;
  gap: 10px;
  margin-top: 10px;
  border-top: 1px dashed rgba(25, 239, 131, 0.2);
  padding-top: 15px;
}

.edit-actions .base-button {
  width: auto;
}

/* Configure Tab Styles */
.configure-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 0 auto;
  width: 100%;
}

h3.section-title {
  color: var(--color-light-green);
  font-size: 1em;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(25, 239, 131, 0.2);
}

h4.section-title {
  color: var(--color-light-green);
  font-size: 0.9em;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 16px;
  margin-bottom: 16px;
  border-bottom: 1px solid rgba(25, 239, 131, 0.2);
}

.section-title i {
  color: var(--color-green);
}

.group-title {
  color: var(--color-light-green);
  font-size: 1em;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.config-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  width: 100%;
}

.config-group {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(25, 239, 131, 0.2);
  border-radius: 6px;
  padding: 16px;
}

.config-item {
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.config-item:last-child {
  margin-bottom: 0;
}

.config-item label {
  color: var(--color-grey);
  font-size: 0.9em;
}

.input-with-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}

.adjust-button {
  background: rgba(25, 239, 131, 0.1);
  border: 1px solid rgba(25, 239, 131, 0.3);
  color: var(--color-light-green);
  width: 32px;
  height: 32px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}

.adjust-button:hover {
  background: rgba(25, 239, 131, 0.2);
}

.number-input {
  text-align: center;
  width: 120px;
}

.input-description {
  color: var(--color-grey);
  font-size: 0.8em;
  opacity: 0.8;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-light-green);
  cursor: pointer;
}

.checkbox-label input[type='checkbox'] {
  width: 16px;
  height: 16px;
  background: rgba(25, 239, 131, 0.1);
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 3px;
  cursor: pointer;
  appearance: none;
  position: relative;
}

.checkbox-label input[type='checkbox']:checked {
  background: var(--color-green);
}

.checkbox-label input[type='checkbox']:checked::after {
  content: '✓';
  position: absolute;
  color: black;
  font-size: 12px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.config-actions {
  display: flex;
  gap: 12px;
  /* margin-top: 16px; */
  padding-top: 16px;
  border-top: 1px dashed rgba(25, 239, 131, 0.2);
}

.action-button.primary {
  background: var(--color-green);
  color: var(--color-dark-navy);
  border: none;
}

.action-button.primary:hover {
  background: rgba(25, 239, 131, 0.8);
}

.tab-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

/* Agent avatar styles */
.agent-profile {
  display: flex;
  align-items: center;
  gap: 15px;
}

.agent-overview-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  object-fit: cover;
  background: rgba(25, 239, 131, 0.1);
  border: 2px solid rgba(25, 239, 131, 0.5);
}

/* Avatar Upload Styles */
.avatar-upload {
  margin-bottom: 15px;
}

.avatar-preview-container {
  display: flex;
  align-items: center;
  gap: 15px;
  margin-top: 8px;
}

.avatar-preview {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  object-fit: cover;
  background: rgba(25, 239, 131, 0.1);
  border: 2px solid rgba(25, 239, 131, 0.5);
}

.avatar-controls {
  display: flex;
  gap: 8px;
}

.upload-button {
  padding: 6px 12px;
  background: rgba(25, 239, 131, 0.1);
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 4px;
  color: var(--color-light-green);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9em;
  transition: all 0.2s;
}

.upload-button:hover {
  background: rgba(25, 239, 131, 0.2);
}

.file-input {
  display: none;
}

.remove-button {
  padding: 6px 10px;
  background: rgba(255, 50, 50, 0.1);
  border: 1px solid rgba(255, 50, 50, 0.3);
  color: rgba(255, 50, 50, 0.8);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.remove-button:hover {
  background: rgba(255, 50, 50, 0.2);
}

/* Danger (red) button for destructive actions */
.action-button.danger {
  background: #ff4d4f;
  color: #fff;
  border: 1px solid #ff4d4f;
  transition: background 0.2s, color 0.2s;
}

.action-button.danger:hover {
  background: #ff7875;
  color: #fff;
  border-color: #ff7875;
}

.config-actions.danger-actions {
  /* margin-top: 24px; */
  margin-bottom: 16px;
  border-top: 1px dashed rgba(255, 77, 79, 0.2);
  padding-top: 16px;
}

.config-row.assign-tools-workflows-row {
  display: flex;
  flex-direction: row;
  gap: 16px;
  width: 100%;
}
.config-group.half-width {
  flex: 1 1 0;
  min-width: 0;
}

/* Chat Tab Styles */
.chat-container {
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 400px;
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 6px;
  overflow: hidden;
}

.chat-messages {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.1);
  scrollbar-width: thin;
  scrollbar-color: rgba(25, 239, 131, 0.3) transparent;
}

.chat-message {
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chat-message.user {
  align-items: flex-end;
}

.chat-message.agent {
  align-items: flex-start;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8em;
  color: var(--color-grey);
}

.chat-message.user .message-header {
  justify-content: flex-end;
}

.message-sender {
  font-weight: bold;
}

.chat-message.user .message-sender {
  color: var(--color-light-green);
}

.chat-message.agent .message-sender {
  color: var(--color-green);
}

.message-content {
  max-width: 70%;
  padding: 8px 12px;
  border-radius: 12px;
  line-height: 1.4;
  word-wrap: break-word;
}

.chat-message.user .message-content {
  background: var(--color-green);
  color: var(--color-dark-navy);
  border-bottom-right-radius: 4px;
}

.chat-message.agent .message-content {
  background: rgba(25, 239, 131, 0.1);
  color: var(--color-light-green);
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-bottom-left-radius: 4px;
}

.typing-indicator {
  display: flex;
  gap: 4px;
  align-items: center;
}

.typing-indicator span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-green);
  animation: typing 1.4s infinite ease-in-out;
}

.typing-indicator span:nth-child(1) {
  animation-delay: -0.32s;
}
.typing-indicator span:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes typing {
  0%,
  80%,
  100% {
    transform: scale(0.8);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

.chat-input-container {
  border-top: 1px solid rgba(25, 239, 131, 0.3);
  padding: 12px;
  background: rgba(25, 239, 131, 0.05);
}

.chat-input-wrapper {
  display: flex;
  gap: 8px;
  align-items: center;
}

.chat-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 20px;
  background: rgba(0, 0, 0, 0.2);
  color: var(--color-light-green);
  font-size: 0.9em;
}

.chat-input:focus {
  outline: none;
  border-color: var(--color-green);
  box-shadow: 0 0 0 2px rgba(25, 239, 131, 0.2);
}

.chat-send-button {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--color-green);
  color: var(--color-dark-navy);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.chat-send-button:hover:not(:disabled) {
  background: rgba(25, 239, 131, 0.8);
  transform: scale(1.05);
}

.chat-send-button:disabled {
  background: rgba(25, 239, 131, 0.3);
  cursor: not-allowed;
  transform: none;
}

.chat-status-message {
  margin-top: 8px;
  color: var(--color-grey);
  font-size: 0.8em;
  text-align: center;
  font-style: italic;
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

.create-task-form {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(25, 239, 131, 0.2);
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 16px;
}

.form-row {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-actions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px dashed rgba(25, 239, 131, 0.2);
}

.tasks-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 16px;
}

.tasks-group {
  display: flex;
  flex-direction: column;
  gap: 16px;
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

.task-priority {
  font-size: 0.8em;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: bold;
  text-transform: uppercase;
}

.task-priority.low {
  background: rgba(108, 117, 125, 0.2);
  color: #6c757d;
}

.task-priority.medium {
  background: rgba(255, 193, 7, 0.2);
  color: #ffc107;
}

.task-priority.high {
  background: rgba(255, 152, 0, 0.2);
  color: #ff9800;
}

.task-priority.urgent {
  background: rgba(244, 67, 54, 0.2);
  color: #f44336;
}

.task-status {
  color: var(--color-grey);
  font-size: 0.8em;
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

.task-actions {
  display: flex;
  gap: 8px;
  margin-top: auto;
}

.task-button {
  padding: 6px 12px;
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 4px;
  background: rgba(25, 239, 131, 0.1);
  color: var(--color-light-green);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  font-size: 0.9em;
}

.task-button:hover {
  background: rgba(25, 239, 131, 0.2);
  border-color: rgba(25, 239, 131, 0.5);
}

.task-button.danger {
  border-color: rgba(244, 67, 54, 0.3);
  background: rgba(244, 67, 54, 0.1);
  color: #f44336;
}

.task-button.danger:hover {
  background: rgba(244, 67, 54, 0.2);
  border-color: rgba(244, 67, 54, 0.5);
}

.task-completed-time {
  color: var(--color-grey);
  font-size: 0.8em;
  font-style: italic;
}

/* Goals Tab Styles */
.goals-container {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.goal-input-section {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(25, 239, 131, 0.2);
  border-radius: 8px;
  padding: 16px;
}

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
  /* margin-top: 12px; */
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
  /* gap: 16px; */
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

/* Task-related styles in goals context */
.info-card {
  background: rgba(25, 239, 131, 0.05);
  border: 1px solid rgba(25, 239, 131, 0.2);
  border-radius: 6px;
  padding: 16px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  /* margin-bottom: 16px; */
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

.goal-tasks-group {
  /* margin-bottom: 24px; */
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

select option {
  background-color: #080921;
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

.expand-button,
.close-button {
  background: none;
  border: none;
  color: var(--color-light-green);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
  padding: 8px 16px;
  border-radius: 4px;
}

.expand-button:hover,
.close-button:hover {
  background: rgba(25, 239, 131, 0.1);
}

.expand-button i,
.close-button i {
  font-size: 0.9em;
}

.close-button:hover {
  color: #ff4d4f;
  background: rgba(255, 77, 79, 0.1);
}

.expanded .tabs-header {
  border-bottom: 2px solid var(--color-green);
}

.expanded .tabs-left {
  flex: 1;
}

.expanded .tabs-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.agent-details-section.expanded {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  height: 100%;
  width: 100%;
  border: none;
  background: #0c0c29;
}
</style>
