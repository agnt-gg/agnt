<!--
  GoalsSection.vue - Dashboard component for goal-driven automation
  Features:
  - Natural language goal creation
  - Real-time progress monitoring
  - Task breakdown and tracking
  - Goal execution controls (pause/resume/delete)
  - Integration with Vuex goals store
-->
<template>
  <div class="goals-section">
    <div class="section-header">
      <div class="header-with-info">
        <h3><i class="fas fa-bullseye"></i> Goal-Driven Automation</h3>
        <Tooltip
          title="Goal-Driven Automation"
          text="Create natural language goals that are automatically broken down into tasks and executed by your agents. Monitor progress in real-time and track completions."
          position="top"
        >
          <i class="fas fa-info-circle info-icon"></i>
        </Tooltip>
      </div>
    </div>

    <div class="goals-container">
      <!-- Active Goals as Interactive Cards -->
      <div class="goals-group">
        <h4 class="section-title clickable" @click="toggleSectionCollapse('active')">
          <i class="fas fa-play"></i> Active Goals ({{ activeGoals.length }})
          <i :class="isSectionCollapsed('active') ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" class="collapse-icon"></i>
        </h4>
        <div v-show="!isSectionCollapsed('active')">
          <div class="task-cards-grid" v-if="activeGoals.length">
            <div
              v-for="goal in activeGoals"
              :key="goal.id"
              class="task-card"
              :class="{
                'status-working': goal.status === 'executing',
                'status-complete': goal.status === 'completed',
                'status-failed': goal.status === 'failed',
                'status-needs-input': goal.status === 'paused',
              }"
              @click="showGoalDetails(goal)"
            >
              <div class="task-card-header">
                <div class="task-card-title">{{ goal.title }}</div>
                <div class="task-card-status">
                  <span class="status-badge" :class="getStatusClass(goal.status)">
                    <i :class="getStatusIcon(goal.status)"></i>
                    {{ formatGoalStatus(goal.status) }}
                  </span>
                </div>
              </div>

              <div class="task-card-meta">
                <span><i class="fas fa-clock mr-1"></i>{{ formatGoalTime(goal.created_at) }}</span>
                <span><i class="fas fa-list mr-1"></i>{{ getGoalTaskCount(goal) }} steps</span>
                <span class="goal-priority" :class="goal.priority">{{ goal.priority.toUpperCase() }}</span>
              </div>

              <div class="task-card-description">{{ goal.description }}</div>

              <!-- Progress indicator for active goals -->
              <div v-if="goal.status === 'executing'" class="task-card-progress">
                <div class="progress-bar">
                  <div class="progress-fill" :style="{ width: `${getGoalProgress(goal)}%` }"></div>
                </div>
                <span class="progress-text">{{ getGoalProgress(goal) }}%</span>
              </div>

              <!-- Current task indicator -->
              <div v-if="goal.currentTasks && goal.currentTasks.length" class="current-task-indicator">
                <p class="text-sm">
                  <i class="fas fa-cog fa-spin mr-2"></i>
                  Currently: {{ goal.currentTasks[0].title }}
                </p>
              </div>

              <!-- Completion summary for completed goals -->
              <div v-if="goal.status === 'completed' && goal.completionSummary" class="completion-summary">
                <p class="text-sm">
                  <i class="fas fa-check-circle mr-2"></i>
                  {{ goal.completionSummary }}
                </p>
              </div>

              <!-- Error indicator for failed goals -->
              <div v-if="goal.status === 'failed' && goal.error" class="error-indicator">
                <p class="text-sm">
                  <i class="fas fa-times-circle mr-2"></i>
                  {{ goal.error }}
                </p>
              </div>
            </div>
          </div>
          <div v-else class="empty-state">
            <i class="fas fa-bullseye"></i>
            <p>No active goals. Create your first goal above!</p>
          </div>
        </div>
      </div>

      <!-- Recent Goals -->
      <div class="goals-group">
        <h4 class="section-title clickable" @click="toggleSectionCollapse('recent')">
          <i class="fas fa-history"></i> Recent Goals ({{ recentGoals.length }})
          <i :class="isSectionCollapsed('recent') ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" class="collapse-icon"></i>
        </h4>
        <div v-show="!isSectionCollapsed('recent')">
          <div class="task-cards-grid recent" v-if="recentGoals.length">
            <div v-for="goal in recentGoals" :key="goal.id" class="task-card completed" @click="showGoalDetails(goal)">
              <div class="task-card-header">
                <div class="task-card-title">{{ goal.title }}</div>
                <div class="task-card-status">
                  <span class="status-badge" :class="getStatusClass(goal.status)">
                    <i :class="getStatusIcon(goal.status)"></i>
                    {{ formatGoalStatus(goal.status) }}
                  </span>
                </div>
              </div>

              <div class="task-card-meta">
                <span><i class="fas fa-clock mr-1"></i>{{ formatGoalTime(goal.completed_at || goal.created_at) }}</span>
                <span v-if="goal.task_count"><i class="fas fa-tasks mr-1"></i>{{ goal.completed_tasks }}/{{ goal.task_count }} tasks</span>
              </div>

              <div class="task-card-description">{{ goal.description }}</div>
            </div>
          </div>
          <div v-else class="empty-state">
            <i class="fas fa-history"></i>
            <p>No recent goals</p>
          </div>
        </div>
      </div>

      <!-- Tasks Overview -->
      <div class="goals-group" v-if="goalsWithTasks.length">
        <h4 class="section-title clickable" @click="toggleSectionCollapse('tasks')">
          <i class="fas fa-tasks"></i> Task Overview
          <i :class="isSectionCollapsed('tasks') ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" class="collapse-icon"></i>
        </h4>

        <div v-show="!isSectionCollapsed('tasks')">
          <!-- Task Info -->
          <div class="task-info-section">
            <div class="info-card">
              <div class="info-header">
                <div class="info-icon-wrapper">
                  <i class="fas fa-lightbulb"></i>
                </div>
                <h5 class="info-title">How Tasks Work</h5>
              </div>
              <div class="info-content">
                <p>Tasks are automatically generated from your goals and assigned to specialized agents for execution.</p>
                <p>Create goals above to see intelligent task breakdown here.</p>
              </div>
            </div>
          </div>

          <div class="task-controls">
            <div class="controls-left">
              <button @click="refreshGoals" class="control-button primary">
                <i class="fas fa-sync"></i>
                <span>Refresh Tasks</span>
              </button>
            </div>
            <div class="controls-right">
              <div class="filter-group">
                <label class="filter-label">Filter:</label>
                <div class="select-wrapper">
                  <select v-model="taskFilter" class="task-filter-select">
                    <option value="all">All Tasks</option>
                    <option value="pending">Pending</option>
                    <option value="running">Running</option>
                    <option value="completed">Completed</option>
                    <option value="failed">Failed</option>
                  </select>
                  <i class="fas fa-chevron-down select-arrow"></i>
                </div>
              </div>
            </div>
          </div>

          <div class="tasks-section">
            <div v-for="goal in goalsWithTasks" :key="goal.id" class="goal-tasks-group" :id="`goal-tasks-${goal.id}`">
              <div class="goal-task-header" @click="toggleGoalTasksExpanded(goal.id)">
                <div class="goal-task-header-left">
                  <div class="goal-icon-wrapper">
                    <i class="fas fa-bullseye"></i>
                  </div>
                  <div class="goal-title-section">
                    <h5 class="goal-task-title">{{ goal.title }}</h5>
                    <div class="goal-task-meta">
                      <span class="goal-task-count">{{ getGoalTaskCount(goal) }} tasks</span>
                      <span class="goal-status-indicator" :class="getStatusClass(goal.status)">
                        <i :class="getStatusIcon(goal.status)"></i>
                        {{ formatGoalStatus(goal.status) }}
                      </span>
                    </div>
                  </div>
                </div>
                <div class="goal-task-header-right">
                  <div class="progress-indicator">
                    <span class="goal-task-progress">{{ getGoalTasksProgress(goal) }}</span>
                    <div class="mini-progress-bar">
                      <div class="mini-progress-fill" :style="{ width: `${getGoalProgress(goal)}%` }"></div>
                    </div>
                  </div>
                  <div class="collapse-toggle-icon">
                    <i :class="isGoalTasksExpanded(goal.id) ? 'fas fa-chevron-up' : 'fas fa-chevron-down'"></i>
                  </div>
                </div>
              </div>

              <div v-show="isGoalTasksExpanded(goal.id)" class="tasks-list" v-if="getFilteredTasks(goal.tasks).length">
                <div v-for="task in getFilteredTasks(goal.tasks)" :key="task.id" class="task-card" :class="task.status">
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
                  <div class="task-description">
                    {{ task.description }}
                  </div>

                  <!-- Required Tools -->
                  <div class="task-tools" v-if="task.required_tools && task.required_tools.length">
                    <span class="tools-label">Required tools:</span>
                    <div class="tools-list">
                      <span v-for="tool in task.required_tools" :key="tool" class="tool-tag">
                        {{ tool }}
                      </span>
                    </div>
                  </div>

                  <!-- Progress Bar -->
                  <div class="task-progress" v-if="task.status === 'running' && task.progress !== undefined">
                    <div class="progress-bar">
                      <div class="progress-fill" :style="{ width: `${task.progress}%` }"></div>
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
              <div v-else class="empty-state small" v-show="isGoalTasksExpanded(goal.id)">
                <p>No {{ taskFilter }} tasks for this goal</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- No Goals Message -->
      <div v-if="!goalsWithTasks.length" class="goals-group">
        <h4 class="section-title clickable" @click="toggleSectionCollapse('no-tasks')">
          <i class="fas fa-tasks"></i> Task Overview
          <i :class="isSectionCollapsed('no-tasks') ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" class="collapse-icon"></i>
        </h4>
        <div v-show="!isSectionCollapsed('no-tasks')" class="empty-state">
          <i class="fas fa-tasks"></i>
          <p>No goal-generated tasks yet</p>
          <p>Create goals above to see automated tasks here</p>
        </div>
      </div>
    </div>

    <!-- Goal Detail Modal -->
    <div v-if="selectedGoal" class="modal-overlay" @click="closeGoalDetails">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3 class="modal-title">Goal Details</h3>
          <button @click="closeGoalDetails" class="modal-close">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="modal-body">
          <GoalDetailView :goal="selectedGoal" @close="closeGoalDetails" />
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted, watch, inject } from 'vue';
import { useStore } from 'vuex';
import Tooltip from '@/views/Terminal/components/shared/Tooltip.vue';
import GoalDetailView from './GoalDetailView.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';

export default {
  name: 'GoalsSection',
  components: { Tooltip, GoalDetailView, SimpleModal },
  emits: ['log-message'],
  setup(props, { emit }) {
    const store = useStore();
    const taskFilter = ref('all');
    const expandedGoals = ref(new Set()); // Track which goals are expanded

    // Add state for collapsible sections
    const collapsedSections = ref(new Set());

    // Modal state for goal details
    const selectedGoal = ref(null);

    // Track which goals we've seen before to avoid re-expanding manually collapsed ones
    const seenGoalIds = ref(new Set());

    // Inject playSound function
    const playSound = inject('playSound', () => {});

    // Computed properties from store
    const activeGoals = computed(() => store.getters['goals/activeGoals']);
    const recentGoals = computed(() => store.getters['goals/recentGoals']);
    const goalsWithTasks = computed(() => store.getters['goals/goalsWithTasks']);

    // Helper methods from store getters
    const getGoalProgress = (goal) => store.getters['goals/getGoalProgress'](goal);
    const getGoalTasksProgress = (goal) => store.getters['goals/getGoalTasksProgress'](goal);

    // New helper methods for mini-agnt-v3 style interface
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

    const getGoalTaskCount = (goal) => {
      if (goal.tasks && goal.tasks.length) {
        return goal.tasks.length;
      }
      return goal.task_count || 0;
    };

    // Modal functionality
    const showGoalDetails = (goal) => {
      selectedGoal.value = goal;
      emit('log-message', `[Goals] Viewing details for: ${goal.title}`);
    };

    const closeGoalDetails = () => {
      selectedGoal.value = null;
    };

    // Methods
    const pauseGoal = async (goal) => {
      try {
        await store.dispatch('goals/pauseGoal', goal.id);
        emit('log-message', `[Goals] Goal paused: ${goal.title}`);
      } catch (error) {
        emit('log-message', `[Goals] Error pausing goal: ${error.message}`);
      }
    };

    const resumeGoal = async (goal) => {
      try {
        await store.dispatch('goals/resumeGoal', goal.id);
        emit('log-message', `[Goals] Goal resumed: ${goal.title}`);
      } catch (error) {
        emit('log-message', `[Goals] Error resuming goal: ${error.message}`);
      }
    };

    const simpleModal = ref(null);

    const deleteGoal = async (goal) => {
      const confirmed = await simpleModal.value?.showModal({
        title: 'Delete Goal?',
        message: `Are you sure you want to delete the goal "${goal.title}"? This will also delete all associated tasks.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        showCancel: true,
        confirmClass: 'btn-danger',
      });

      if (!confirmed) return;

      try {
        await store.dispatch('goals/deleteGoal', goal.id);
        emit('log-message', `[Goals] Goal deleted: ${goal.title}`);
      } catch (error) {
        emit('log-message', `[Goals] Error deleting goal: ${error.message}`);
      }
    };

    const viewGoalDetails = (goal) => {
      emit('log-message', `[Goals] Viewing details for: ${goal.title}`);

      // Find the corresponding task section and scroll to it
      const taskSection = document.getElementById(`goal-tasks-${goal.id}`);
      if (taskSection) {
        taskSection.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      } else {
        // If no task section exists yet, scroll to the task overview section
        const taskOverview = document.querySelector('.tasks-section');
        if (taskOverview) {
          taskOverview.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
        }
      }
    };

    const refreshGoals = async () => {
      emit('log-message', `[Goals] Refreshing goals and tasks...`);
      try {
        await store.dispatch('goals/fetchGoals');

        // Also refresh status for any executing goals
        const executingGoals = store.getters['goals/activeGoals'].filter((goal) => goal.status === 'executing');
        for (const goal of executingGoals) {
          await store.dispatch('goals/refreshGoalStatus', goal.id);
        }

        emit('log-message', `[Goals] Goals refreshed.`);
      } catch (error) {
        emit('log-message', `[Goals] Error refreshing goals: ${error.message}`);
      }
    };

    const getFilteredTasks = (tasks) => {
      if (!tasks) return [];
      if (taskFilter.value === 'all') return tasks;
      return tasks.filter((task) => task.status === taskFilter.value);
    };

    // Helper methods
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

    const formatTaskTime = (timestamp) => {
      return new Date(timestamp).toLocaleString();
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

    const toggleGoalTasksExpanded = (goalId) => {
      playSound('typewriterKeyPress');
      if (expandedGoals.value.has(goalId)) {
        expandedGoals.value.delete(goalId);
      } else {
        expandedGoals.value.add(goalId);
      }
      // Force reactivity update
      expandedGoals.value = new Set(expandedGoals.value);
    };

    const isGoalTasksExpanded = (goalId) => {
      return expandedGoals.value.has(goalId);
    };

    // Add method to toggle section collapse
    const toggleSectionCollapse = (sectionName) => {
      playSound('typewriterKeyPress');
      if (collapsedSections.value.has(sectionName)) {
        collapsedSections.value.delete(sectionName);
      } else {
        collapsedSections.value.add(sectionName);
      }
      // Force reactivity update
      collapsedSections.value = new Set(collapsedSections.value);
    };

    const isSectionCollapsed = (sectionName) => {
      return collapsedSections.value.has(sectionName);
    };

    // Watch for goals changes to auto-expand only NEW goals
    watch(
      goalsWithTasks,
      (newGoals, oldGoals) => {
        if (newGoals.length > 0) {
          // Find truly new goals that we haven't seen before
          const newGoalIds = newGoals.map((goal) => goal.id);
          const actuallyNewGoals = newGoals.filter((goal) => !seenGoalIds.value.has(goal.id));

          // Update our seen goals list
          newGoalIds.forEach((id) => seenGoalIds.value.add(id));

          // Only auto-expand the first 2 actually new goals
          actuallyNewGoals.slice(0, 2).forEach((goal) => {
            expandedGoals.value.add(goal.id);
          });

          // Force reactivity update if we added any
          if (actuallyNewGoals.length > 0) {
            expandedGoals.value = new Set(expandedGoals.value);
          }
        }
      },
      { immediate: true }
    );

    onMounted(() => {
      store.dispatch('goals/fetchGoals');
    });

    onUnmounted(() => {
      store.dispatch('goals/clearAllSubscriptions');
    });

    return {
      simpleModal,
      taskFilter,
      activeGoals,
      recentGoals,
      goalsWithTasks,
      getGoalProgress,
      getGoalTasksProgress,
      pauseGoal,
      resumeGoal,
      deleteGoal,
      viewGoalDetails,
      refreshGoals,
      getFilteredTasks,
      formatGoalStatus,
      formatGoalTime,
      formatTaskStatus,
      formatTaskTime,
      getAgentNameForTask,
      toggleGoalTasksExpanded,
      isGoalTasksExpanded,
      toggleSectionCollapse,
      isSectionCollapsed,
      selectedGoal,
      showGoalDetails,
      closeGoalDetails,
      getStatusClass,
      getStatusIcon,
      getGoalTaskCount,
    };
  },
};
</script>

<style scoped>
.goals-section {
  background: rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  border-radius: 0 0 0 8px;
  padding: 16px;
}

.section-header {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.2);
}

.section-header h3 {
  color: var(--color-light-green);
  margin: 0;
  font-size: 1.1em;
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-with-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.info-icon {
  color: var(--color-grey);
  font-size: 0.85em !important;
  cursor: help;
  transition: color 0.2s ease;
  opacity: 0.25;
}

.info-icon:hover {
  color: var(--color-green);
}

.goals-container {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.section-title {
  color: var(--color-light-green);
  font-size: 0.9em;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 16px 0;
}

.section-title i {
  color: var(--color-green);
}

.section-title.clickable {
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
  justify-content: space-between;
}

.section-title.clickable:hover {
  color: var(--color-green);
  transform: translateX(2px);
}

.collapse-icon {
  margin-left: auto;
  font-size: 0.8em !important;
  transition: transform 0.2s ease;
  color: var(--color-grey) !important;
}

.section-title.clickable:hover .collapse-icon {
  color: var(--color-green) !important;
}

.goals-group {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Task Cards Grid - Mini-AGNT-v3 Style */
.task-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 16px;
}

.task-cards-grid.recent {
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
}

.task-card {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.3s ease;
  border-left: 3px solid transparent;
  position: relative;
  overflow: hidden;
}

.task-card:hover {
  border-left-color: #6366f1;
  background: rgba(255, 255, 255, 0.05);
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(99, 102, 241, 0.15);
}

.task-card.status-working {
  background: rgba(251, 191, 36, 0.1);
  border-color: rgba(251, 191, 36, 0.3);
}

.task-card.status-complete {
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.3);
}

.task-card.status-failed {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
}

.task-card.status-needs-input {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.3);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

.task-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.task-card-title {
  color: var(--color-light-green);
  font-weight: 600;
  font-size: 1.1em;
  line-height: 1.3;
  flex: 1;
  margin-right: 12px;
}

.task-card-status {
  flex-shrink: 0;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 0.8em;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.status-badge.status-working {
  background: rgba(251, 191, 36, 0.2);
  color: var(--color-yellow);
  border: 1px solid rgba(251, 191, 36, 0.3);
}

.status-badge.status-complete {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.status-badge.status-failed {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.status-badge.status-needs-input {
  background: rgba(99, 102, 241, 0.2);
  color: #6366f1;
  border: 1px solid rgba(99, 102, 241, 0.3);
}

.task-card-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
  font-size: 0.85em;
  color: var(--color-grey);
  flex-wrap: wrap;
}

.task-card-meta span {
  display: flex;
  align-items: center;
  gap: 4px;
}

.task-card-meta .goal-priority {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.75em;
  font-weight: 600;
  text-transform: uppercase;
}

.task-card-meta .goal-priority.low {
  background: rgba(16, 185, 129, 0.2);
  color: #10b981;
}

.task-card-meta .goal-priority.medium {
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
}

.task-card-meta .goal-priority.high {
  background: rgba(249, 115, 22, 0.2);
  color: #f97316;
}

.task-card-meta .goal-priority.urgent {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.task-card-description {
  color: var(--color-grey);
  font-size: 0.95em;
  line-height: 1.5;
  margin-bottom: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.task-card-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.progress-bar {
  flex: 1;
  height: 4px;
  background: rgba(var(--green-rgb), 0.2);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--color-green);
  transition: width 0.3s ease;
  border-radius: 2px;
}

.progress-text {
  color: var(--color-grey);
  font-size: 0.85em;
  min-width: 50px;
  text-align: right;
}

.current-task-indicator {
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 12px;
}

.current-task-indicator p {
  margin: 0;
  color: var(--color-green);
  font-size: 0.85em;
  display: flex;
  align-items: center;
}

.completion-summary {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 12px;
}

.completion-summary p {
  margin: 0;
  color: var(--color-green);
  font-size: 0.85em;
  display: flex;
  align-items: center;
}

.error-indicator {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 12px;
}

.error-indicator p {
  margin: 0;
  color: var(--color-red);
  font-size: 0.85em;
  display: flex;
  align-items: center;
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.modal-content {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  max-width: 800px;
  width: 100%;
  max-height: 90vh;
  overflow: hidden;
  animation: slideUp 0.3s ease-out;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.modal-header {
  padding: 20px 24px;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.2);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-title {
  color: var(--color-light-green);
  font-size: 1.2em;
  font-weight: 600;
  margin: 0;
}

.modal-close {
  background: none;
  border: none;
  color: var(--color-grey);
  font-size: 1.2em;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.modal-close:hover {
  color: var(--color-light-green);
  background: rgba(var(--green-rgb), 0.1);
}

.modal-body {
  padding: 24px;
  overflow-y: auto;
  max-height: calc(90vh - 80px);
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--color-grey);
}

.empty-state i {
  font-size: 3em;
  margin-bottom: 16px;
  opacity: 0.3;
}

.empty-state p {
  margin: 8px 0 0 0;
  font-size: 0.95em;
}

/* Utility classes */
.mr-1 {
  margin-right: 4px;
}
.mr-2 {
  margin-right: 8px;
}
.text-sm {
  font-size: 0.85em;
}

/* Enhanced Task Info Section */
.task-info-section {
  margin-bottom: 24px;
}

.info-card {
  background: linear-gradient(135deg, rgba(var(--green-rgb), 0.08) 0%, rgba(var(--green-rgb), 0.04) 100%);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  border-radius: 12px;
  padding: 20px;
  position: relative;
  overflow: hidden;
}

.info-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--color-green) 0%, rgba(var(--green-rgb), 0.5) 100%);
}

.info-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.info-icon-wrapper {
  background: var(--color-green);
  color: var(--color-dark-navy);
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1em;
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.3);
}

.info-title {
  color: var(--color-light-green);
  font-size: 1.1em;
  font-weight: 600;
  margin: 0;
  letter-spacing: 0.5px;
}

.info-content {
  color: var(--color-grey);
  line-height: 1.6;
}

.info-content p {
  margin: 0 0 8px 0;
  font-size: 0.95em;
}

.info-content p:last-child {
  margin-bottom: 0;
}

/* Enhanced Task Controls */
.task-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding: 16px 20px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(var(--green-rgb), 0.15);
  border-radius: 10px;
  backdrop-filter: blur(10px);
  gap: 20px;
  flex-wrap: wrap;
}

.controls-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.controls-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.control-button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 8px;
  background: rgba(var(--green-rgb), 0.1);
  color: var(--color-light-green);
  cursor: pointer;
  font-size: 0.9em;
  font-weight: 500;
  transition: all 0.3s ease;
  text-decoration: none;
  position: relative;
  overflow: hidden;
}

.control-button::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(var(--green-rgb), 0.2), transparent);
  transition: left 0.5s;
}

.control-button:hover::before {
  left: 100%;
}

.control-button:hover {
  background: rgba(var(--green-rgb), 0.2);
  border-color: rgba(var(--green-rgb), 0.5);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.25);
}

.control-button.primary {
  background: var(--color-green);
  color: var(--color-dark-navy);
  border-color: var(--color-green);
  font-weight: 600;
}

.control-button.primary:hover {
  background: rgba(var(--green-rgb), 0.9);
  box-shadow: 0 6px 20px rgba(var(--green-rgb), 0.4);
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 10px;
}

.filter-label {
  color: var(--color-grey);
  font-size: 0.9em;
  font-weight: 500;
  white-space: nowrap;
}

.select-wrapper {
  position: relative;
  display: inline-block;
}

.task-filter-select {
  appearance: none;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 8px;
  color: var(--color-light-green);
  padding: 8px 32px 8px 12px;
  font-size: 0.9em;
  cursor: pointer;
  transition: all 0.3s ease;
  min-width: 120px;
}

.task-filter-select:hover {
  background: rgba(var(--green-rgb), 0.15);
  border-color: rgba(var(--green-rgb), 0.5);
}

.task-filter-select:focus {
  outline: none;
  background: rgba(var(--green-rgb), 0.2);
  border-color: var(--color-green);
  box-shadow: 0 0 0 2px rgba(var(--green-rgb), 0.2);
}

.select-arrow {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-grey);
  font-size: 0.8em;
  pointer-events: none;
  transition: color 0.3s ease;
}

.select-wrapper:hover .select-arrow {
  color: var(--color-light-green);
}

/* Enhanced Goal Task Header */
.goal-task-header {
  background: linear-gradient(135deg, rgba(var(--green-rgb), 0.08) 0%, rgba(var(--green-rgb), 0.03) 100%);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 16px;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  overflow: hidden;
}

.goal-task-header::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--color-green);
  transform: scaleX(0);
  transition: transform 0.3s ease;
}

.goal-task-header:hover::before {
  transform: scaleX(1);
}

.goal-task-header:hover {
  background: linear-gradient(135deg, rgba(var(--green-rgb), 0.12) 0%, rgba(var(--green-rgb), 0.06) 100%);
  border-color: rgba(var(--green-rgb), 0.4);
  transform: translateY(-1px);
  box-shadow: 0 8px 25px rgba(var(--green-rgb), 0.15);
}

.goal-task-header-left {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
}

.goal-icon-wrapper {
  background: var(--color-green);
  color: var(--color-dark-navy);
  width: 42px;
  height: 42px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2em;
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.3);
  transition: all 0.3s ease;
}

.goal-task-header:hover .goal-icon-wrapper {
  transform: scale(1.1);
  box-shadow: 0 6px 20px rgba(var(--green-rgb), 0.4);
}

.goal-title-section {
  flex: 1;
}

.goal-task-title {
  color: var(--color-light-green);
  font-size: 1.1em;
  font-weight: 600;
  margin: 0 0 6px 0;
  line-height: 1.3;
  letter-spacing: 0.3px;
}

.goal-task-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.goal-task-count {
  color: var(--color-grey);
  font-size: 0.85em;
  font-weight: 500;
}

.goal-status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 0.8em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.goal-status-indicator.status-working {
  background: rgba(251, 191, 36, 0.2);
  color: var(--color-yellow);
  border: 1px solid rgba(251, 191, 36, 0.3);
}

.goal-status-indicator.status-complete {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.goal-status-indicator.status-failed {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.goal-status-indicator.status-needs-input {
  background: rgba(99, 102, 241, 0.2);
  color: #6366f1;
  border: 1px solid rgba(99, 102, 241, 0.3);
}

.goal-task-header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.progress-indicator {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.goal-task-progress {
  color: var(--color-grey);
  font-size: 0.85em;
  font-weight: 600;
  white-space: nowrap;
}

.mini-progress-bar {
  width: 80px;
  height: 6px;
  background: rgba(var(--green-rgb), 0.2);
  border-radius: 3px;
  overflow: hidden;
}

.mini-progress-fill {
  height: 100%;
  background: var(--color-green);
  transition: width 0.5s ease;
  border-radius: 3px;
}

.collapse-toggle-icon {
  color: var(--color-grey);
  font-size: 1.1em;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.2);
}

.goal-task-header:hover .collapse-toggle-icon {
  color: var(--color-light-green);
  background: rgba(var(--green-rgb), 0.2);
  border-color: rgba(var(--green-rgb), 0.4);
}
</style>
