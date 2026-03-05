<template>
  <BaseScreen
    ref="baseScreenRef"
    activeLeftPanel="GoalsPanel"
    activeRightPanel="GoalsPanel"
    :panelProps="{
      selectedGoalId: selectedGoalId,
      goals: allGoals,
    }"
    screenId="GoalsScreen"
    :showInput="false"
    :terminalLines="terminalLines"
    @panel-action="handlePanelAction"
    @screen-change="(screenName) => emit('screen-change', screenName)"
    @base-mounted="initializeScreen"
  >
    <template #default>
      <div class="goals-screen">
        <!-- Loading skeleton while goals load -->
        <div v-if="isLoading && (!allGoals || allGoals.length === 0)" class="kanban-board">
          <div v-for="i in 3" :key="'skeleton-' + i" class="kanban-column">
            <div class="column-header">
              <div class="skeleton-block" style="height: 16px; width: 60px"></div>
              <div class="skeleton-block" style="height: 16px; width: 24px; border-radius: 12px"></div>
            </div>
            <div class="column-content">
              <div v-for="j in 2" :key="'skel-card-' + j" class="skeleton-block" style="height: 80px; border-radius: 8px"></div>
            </div>
          </div>
        </div>

        <!-- Real content with staggered fade -->
        <div v-else class="kanban-board fade-in" @click.self="deselectGoal">
          <div v-for="column in columns" :key="column.id" class="kanban-column">
            <div class="column-header">
              <h3>{{ column.title }}</h3>
              <div class="column-header-right">
                <button v-if="column.id === 'standby'" class="add-goal-btn" @click="showCreateModal = true" title="Create new goal">
                  <i class="fas fa-plus"></i>
                </button>
                <span class="count">{{ column.goals.length }}</span>
              </div>
            </div>
            <div class="column-content fade-in-stagger" @click.self="deselectGoal">
              <GoalCard
                v-for="goal in column.goals"
                :key="goal.id"
                :goal="goal"
                @click="handleGoalClick"
                @pause="pauseGoal"
                @resume="resumeGoal"
                @delete="deleteGoal"
              />
              <div v-if="column.goals.length === 0" class="empty-column">No goals</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Create Goal Modal -->
      <Teleport to="body">
        <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
          <div class="modal-container">
            <div class="modal-header">
              <h3>Create New Goal</h3>
              <button class="modal-close-btn" @click="showCreateModal = false">
                <i class="fas fa-times"></i>
              </button>
            </div>
            <div class="modal-body">
              <textarea
                ref="goalInputRef"
                v-model="goalInput"
                class="goal-input"
                placeholder="Describe what you want to accomplish..."
                rows="4"
                @keydown.ctrl.enter="handleCreateGoal"
                @keydown.escape="showCreateModal = false"
                :disabled="isCreatingGoal"
              ></textarea>
            </div>
            <div class="modal-footer">
              <span class="modal-hint">Ctrl+Enter to create</span>
              <div class="modal-actions">
                <button class="modal-btn modal-cancel" @click="showCreateModal = false">Cancel</button>
                <button class="modal-btn create" @click="handleCreateGoal" :disabled="!goalInput.trim() || isCreatingGoal">
                  <i v-if="isCreatingGoal" class="fas fa-spinner fa-spin"></i>
                  <i v-else class="fas fa-plus"></i>
                  {{ isCreatingGoal ? 'Creating...' : 'Create Goal' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Teleport>
    </template>
  </BaseScreen>
</template>

<script>
import { ref, computed, inject } from 'vue';
import { useStore } from 'vuex';
import BaseScreen from '../../BaseScreen.vue';
import GoalCard from './components/GoalCard.vue';

export default {
  name: 'GoalsScreen',
  components: {
    BaseScreen,
    GoalCard,
  },
  emits: ['screen-change'],
  setup(props, { emit }) {
    const store = useStore();
    const playSound = inject('playSound', () => {});
    const baseScreenRef = ref(null);
    const terminalLines = ref([]);
    const selectedGoalId = ref(null);

    // Create goal modal state
    const showCreateModal = ref(false);
    const goalInput = ref('');
    const goalInputRef = ref(null);
    const isCreatingGoal = computed(() => store.getters['goals/isCreatingGoal']);

    document.body.setAttribute('data-page', 'terminal-goals');

    const allGoals = computed(() => store.getters['goals/allGoals']);
    const isLoading = computed(() => store.getters['goals/isLoading']);

    const columns = computed(() => {
      const goals = allGoals.value || [];
      return [
        {
          id: 'standby',
          title: 'Standby',
          goals: goals.filter((g) => ['planning', 'queued', 'needs_review'].includes(g.status)),
        },
        {
          id: 'active',
          title: 'Active',
          goals: goals.filter((g) => ['executing', 'paused'].includes(g.status)),
        },
        {
          id: 'done',
          title: 'Done',
          goals: goals.filter((g) => ['completed', 'validated', 'failed', 'error', 'stopped'].includes(g.status)),
        },
      ];
    });

    const initializeScreen = () => {
      terminalLines.value.push('Loading goals...');
      // Non-blocking: render kanban immediately, data fills in reactively
      store
        .dispatch('goals/fetchGoals')
        .then(() => {
          terminalLines.value.push(`Loaded ${allGoals.value.length} goals.`);
          baseScreenRef.value?.scrollToBottom();
        })
        .catch((error) => {
          terminalLines.value.push(`Error loading goals: ${error.message}`);
          baseScreenRef.value?.scrollToBottom();
        });
    };

    const handleGoalClick = async (goal) => {
      selectedGoalId.value = goal.id;
      terminalLines.value.push(`Selected goal: ${goal.title}`);
      baseScreenRef.value?.scrollToBottom();

      // Update the right panel immediately with available data
      baseScreenRef.value?.triggerPanelMethod('updateSelectedGoal', goal);

      // Fetch full details including tasks
      try {
        await store.dispatch('goals/fetchGoalTasks', goal.id);
        const updatedGoal = store.getters['goals/getGoalById'](goal.id);
        if (updatedGoal) {
          baseScreenRef.value?.triggerPanelMethod('updateSelectedGoal', updatedGoal);
        }
      } catch (error) {
        console.error('Error fetching goal details:', error);
      }
    };

    const pauseGoal = async (goal) => {
      try {
        await store.dispatch('goals/pauseGoal', goal.id);
        terminalLines.value.push(`Paused goal: ${goal.title}`);
      } catch (error) {
        terminalLines.value.push(`Error pausing goal: ${error.message}`);
      }
      baseScreenRef.value?.scrollToBottom();
    };

    const resumeGoal = async (goal) => {
      try {
        await store.dispatch('goals/resumeGoal', goal.id);
        terminalLines.value.push(`Resumed goal: ${goal.title}`);
      } catch (error) {
        terminalLines.value.push(`Error resuming goal: ${error.message}`);
      }
      baseScreenRef.value?.scrollToBottom();
    };

    const deleteGoal = async (goal) => {
      if (!confirm(`Are you sure you want to delete goal "${goal.title}"?`)) return;
      try {
        await store.dispatch('goals/deleteGoal', goal.id);
        terminalLines.value.push(`Deleted goal: ${goal.title}`);
      } catch (error) {
        terminalLines.value.push(`Error deleting goal: ${error.message}`);
      }
      baseScreenRef.value?.scrollToBottom();
    };

    const deselectGoal = () => {
      selectedGoalId.value = null;
    };

    const handleCreateGoal = async () => {
      if (!goalInput.value.trim()) return;
      const goalText = goalInput.value.trim();
      try {
        await store.dispatch('goals/createGoal', {
          text: goalText,
          priority: 'medium',
        });
        goalInput.value = '';
        showCreateModal.value = false;
        terminalLines.value.push(`Created goal: ${goalText.substring(0, 50)}...`);
        baseScreenRef.value?.scrollToBottom();
      } catch (error) {
        terminalLines.value.push(`Error creating goal: ${error.message}`);
        baseScreenRef.value?.scrollToBottom();
      }
    };

    const handlePanelAction = (action, payload) => {
      if (action === 'navigate') {
        emit('screen-change', payload);
      } else if (action === 'goal-selected') {
        handleGoalClick(payload);
      } else if (action === 'refresh-goals') {
        store.dispatch('goals/fetchGoals');
      } else if (action === 'close-panel') {
        selectedGoalId.value = null;
      } else if (action === 'create-goal') {
        showCreateModal.value = true;
      }
    };

    return {
      baseScreenRef,
      terminalLines,
      columns,
      initializeScreen,
      handleGoalClick,
      pauseGoal,
      resumeGoal,
      deleteGoal,
      handlePanelAction,
      handleCreateGoal,
      deselectGoal,
      emit,
      selectedGoalId,
      allGoals,
      isLoading,
      showCreateModal,
      goalInput,
      goalInputRef,
      isCreatingGoal,
    };
  },
};
</script>

<style scoped>
.goals-screen {
  padding: 0 16px;
  height: calc(100% - 4px);
  width: calc(100% - 32px);
  display: flex;
  overflow-x: auto;
}

body[data-page='goals-page'] .scrollable-content {
  overflow-y: hidden !important;
  padding: 0;
}

.kanban-board {
  display: flex;
  height: calc(100% - 2px);
  width: 100%;
  gap: 16px;
  padding-bottom: 16px;
}

.kanban-column {
  flex: 1;
  min-width: 200px;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.column-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--terminal-border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--color-darker-1);
  border-radius: 8px 8px 0 0;
}

.column-header h3 {
  margin: 0;
  font-size: 1em;
  color: var(--color-text);
  font-weight: 600;
}

.column-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.add-goal-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.75em;
  padding: 0;
}

.add-goal-btn:hover {
  background: rgba(var(--green-rgb), 0.15);
  border-color: rgba(var(--green-rgb), 0.5);
  color: var(--color-green);
}

.count {
  background: var(--color-darker-2);
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.8em;
  color: var(--color-text-muted);
}

.column-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty-column {
  text-align: center;
  color: var(--color-text-muted);
  font-style: italic;
  padding: 20px;
  font-size: 0.9em;
}

/* Create Goal Modal */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}

.modal-container {
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  width: 500px;
  max-width: 90vw;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.modal-header h3 {
  margin: 0;
  color: var(--color-text);
  font-size: 1em;
  font-weight: 600;
}

.modal-close-btn {
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 4px 8px;
  font-size: 0.9em;
  transition: color 0.2s;
}

.modal-close-btn:hover {
  color: var(--color-text);
}

.modal-body {
  padding: 20px;
}

.goal-input {
  width: 100%;
  padding: 12px 16px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-text);
  font-size: 0.95em;
  font-family: inherit;
  resize: vertical;
  min-height: 80px;
  transition: border-color 0.2s ease;
}

.goal-input:focus {
  outline: none;
  border-color: rgba(var(--green-rgb), 0.5);
}

.goal-input::placeholder {
  color: var(--color-text-muted);
  opacity: 0.7;
}

.modal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  border-top: 1px solid var(--terminal-border-color);
}

.modal-hint {
  font-size: 0.8em;
  color: var(--color-text-muted);
  opacity: 0.7;
}

.modal-actions {
  display: flex;
  gap: 8px;
}

.modal-btn {
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 0.9em;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 6px;
}

.modal-btn.modal-cancel {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
}

.modal-btn.modal-cancel:hover {
  border-color: var(--color-text-muted);
  color: var(--color-text);
}

.modal-btn.create {
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  color: var(--color-green);
}

.modal-btn.create:hover:not(:disabled) {
  background: rgba(var(--green-rgb), 0.2);
  border-color: rgba(var(--green-rgb), 0.5);
}

.modal-btn.create:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
