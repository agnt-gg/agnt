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
        <div v-else class="kanban-board fade-in">
          <div v-for="column in columns" :key="column.id" class="kanban-column">
            <div class="column-header">
              <h3>{{ column.title }}</h3>
              <span class="count">{{ column.goals.length }}</span>
            </div>
            <div class="column-content fade-in-stagger">
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
    </template>
  </BaseScreen>
</template>

<script>
import { ref, computed } from 'vue';
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
    const baseScreenRef = ref(null);
    const terminalLines = ref([]);
    const selectedGoalId = ref(null);

    document.body.setAttribute('data-page', 'terminal-goals');

    const allGoals = computed(() => store.getters['goals/allGoals']);
    const isLoading = computed(() => store.getters['goals/isLoading']);

    const columns = computed(() => {
      const goals = allGoals.value || [];
      return [
        {
          id: 'active',
          title: 'Active',
          goals: goals.filter((g) => ['executing', 'paused'].includes(g.status)),
        },
        // {
        //   id: 'review',
        //   title: 'Review',
        //   goals: goals.filter((g) => ['needs_review', 'validated'].includes(g.status)),
        // },
        {
          id: 'done',
          title: 'Done',
          goals: goals.filter((g) => ['completed', 'validated'].includes(g.status)),
        },
        {
          id: 'failed',
          title: 'Failed',
          goals: goals.filter((g) => ['failed', 'error', 'stopped'].includes(g.status)),
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

    const handlePanelAction = (action, payload) => {
      if (action === 'navigate') {
        emit('screen-change', payload);
      } else if (action === 'goal-selected') {
        handleGoalClick(payload);
      } else if (action === 'refresh-goals') {
        store.dispatch('goals/fetchGoals');
      } else if (action === 'close-panel') {
        selectedGoalId.value = null;
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
      emit,
      selectedGoalId,
      allGoals,
      isLoading,
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
</style>
