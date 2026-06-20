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
        <GoalsToolbar
          ref="toolbarRef"
          v-model:searchQuery="searchQuery"
          v-model:activeFilters="activeFilters"
          v-model:sortBy="sortBy"
          :goals="allGoals || []"
        />

        <!-- Loading skeleton -->
        <div v-if="isLoading && (!allGoals || allGoals.length === 0)" class="kanban-board">
          <div v-for="i in 4" :key="'skeleton-' + i" class="kanban-column">
            <div class="column-header">
              <div class="skeleton-block" style="height: 16px; width: 70px"></div>
              <div class="skeleton-block" style="height: 16px; width: 30px; border-radius: 12px"></div>
            </div>
            <div class="column-content">
              <div v-for="j in 2" :key="'skel-card-' + j" class="skeleton-block" style="height: 90px; border-radius: 8px"></div>
            </div>
          </div>
        </div>

        <div v-else class="kanban-board fade-in" @click.self="deselectGoal">
          <div v-for="column in columns" :key="column.id" class="kanban-column" :class="[column.id + '-column']">
            <div class="column-header" :style="{ borderTopColor: column.color }">
              <h3>
                <i :class="column.icon" :style="{ color: column.color }"></i>
                {{ column.title }}
              </h3>
              <div class="column-header-right">
                <Tooltip v-if="column.id === 'planning'" text="Create new goal (N)">
                  <button class="add-goal-btn" @click="showCreateModal = true">
                    <i class="fas fa-plus"></i>
                  </button>
                </Tooltip>
                <span
                  class="column-count"
                  :class="{
                    'at-limit': column.wipLimit && column.goals.length >= column.wipLimit,
                    'over-limit': column.wipLimit && column.goals.length > column.wipLimit,
                  }"
                >
                  {{ column.goals.length }}<span v-if="column.wipLimit" class="wip-limit"> / {{ column.wipLimit }}</span>
                </span>
              </div>
            </div>

            <!-- Done column has sub-sections for success vs failure -->
            <template v-if="column.id === 'done'">
              <div class="column-content done-column-content" @click.self="deselectGoal">
                <div v-if="doneSuccessGoals.length > 0" class="done-sub-list">
                  <GoalCard
                    v-for="element in doneSuccessGoals"
                    :key="element.id"
                    :goal="element"
                    :isSelected="selectedGoalId === element.id"
                    :liveIteration="getLiveIteration(element.id)"
                    @click="handleGoalClick"
                    @pause="pauseGoal"
                    @resume="resumeGoal"
                    @delete="deleteGoal"
                    @schedule="openScheduleModal"
                  />
                </div>

                <div v-if="doneFailureGoals.length > 0" class="done-section-label failure"><i class="fas fa-times-circle"></i> Failed</div>
                <div v-if="doneFailureGoals.length > 0" class="done-sub-list">
                  <GoalCard
                    v-for="element in doneFailureGoals"
                    :key="element.id"
                    :goal="element"
                    :isSelected="selectedGoalId === element.id"
                    :liveIteration="getLiveIteration(element.id)"
                    @click="handleGoalClick"
                    @pause="pauseGoal"
                    @resume="resumeGoal"
                    @delete="deleteGoal"
                    @schedule="openScheduleModal"
                  />
                </div>

                <div v-if="column.goals.length === 0" class="empty-column">
                  <div class="empty-icon">{{ getEmptyIcon(column.id) }}</div>
                  <div class="empty-text">{{ getEmptyText(column.id) }}</div>
                </div>
              </div>
            </template>

            <template v-else>
              <div class="column-content" @click.self="deselectGoal">
                <GoalCard
                  v-for="element in column.goals"
                  :key="element.id"
                  :goal="element"
                  :isSelected="selectedGoalId === element.id"
                  :liveIteration="getLiveIteration(element.id)"
                  @click="handleGoalClick"
                  @pause="pauseGoal"
                  @resume="resumeGoal"
                  @delete="deleteGoal"
                  @schedule="openScheduleModal"
                />
                <div v-if="column.goals.length === 0" class="empty-column">
                  <div class="empty-icon">{{ getEmptyIcon(column.id) }}</div>
                  <div class="empty-text">{{ getEmptyText(column.id) }}</div>
                  <button v-if="column.id === 'planning'" @click="showCreateModal = true" class="empty-cta">
                    <i class="fas fa-plus"></i> Create your first goal
                  </button>
                </div>
              </div>
            </template>
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
              <label class="modal-label">What do you want to accomplish?</label>
              <textarea
                ref="goalInputRef"
                v-model="goalInput"
                class="goal-input"
                placeholder="Describe your goal in detail..."
                rows="4"
                @keydown.ctrl.enter="handleCreateGoal"
                @keydown.escape="showCreateModal = false"
                :disabled="isCreatingGoal"
              ></textarea>

              <label class="modal-label">Priority</label>
              <div class="priority-selector">
                <button
                  v-for="p in ['low', 'medium', 'high', 'urgent']"
                  :key="p"
                  type="button"
                  :class="['priority-option', p, { active: newGoalPriority === p }]"
                  @click="newGoalPriority = p"
                >
                  <span class="priority-dot" :class="p"></span>
                  {{ p }}
                </button>
              </div>

              <label class="modal-label">Max autonomous iterations</label>
              <input type="number" v-model.number="maxIterations" min="1" max="100" class="iterations-input" />

              <template v-if="availableTemplates.length > 0">
                <label class="modal-label">Start from a template (optional)</label>
                <div class="template-gallery">
                  <button
                    v-for="tpl in availableTemplates"
                    :key="tpl.id"
                    type="button"
                    :class="['template-card', { active: selectedTemplateId === tpl.id }]"
                    @click="applyTemplate(tpl)"
                  >
                    <i :class="tpl.icon || 'fas fa-bookmark'" class="tpl-icon"></i>
                    <span class="tpl-name">{{ tpl.title }}</span>
                  </button>
                </div>
              </template>
            </div>
            <div class="modal-footer">
              <span class="modal-hint">Ctrl+Enter to create · Esc to close</span>
              <div class="modal-actions">
                <button class="modal-btn modal-cancel" @click="showCreateModal = false">Cancel</button>
                <button class="modal-btn create" @click="handleCreateGoal" :disabled="!goalInput.trim() || isCreatingGoal">
                  <i v-if="isCreatingGoal" class="fas fa-spinner fa-spin"></i>
                  <i v-else class="fas fa-rocket"></i>
                  {{ isCreatingGoal ? 'Creating...' : 'Create & Run' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Teleport>

      <SimpleModal ref="simpleModal" />

      <!-- Schedule a goal -->
      <Teleport to="body">
        <ScheduleGoalModal
          v-if="scheduleModalGoal"
          :goal="scheduleModalGoal"
          @close="scheduleModalGoal = null"
          @created="onScheduleCreated"
        />
      </Teleport>
    </template>
  </BaseScreen>
</template>

<script>
import { ref, computed, inject, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { useStore } from 'vuex';
import BaseScreen from '../../BaseScreen.vue';
import GoalCard from './components/GoalCard.vue';
import GoalsToolbar from './components/GoalsToolbar.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import ScheduleGoalModal from './components/ScheduleGoalModal.vue';

// Status sets shared across column filtering
const DONE_SUCCESS = ['completed', 'validated'];
const DONE_FAILURE = ['failed', 'error', 'stopped'];

export default {
  name: 'GoalsScreen',
  components: {
    BaseScreen,
    GoalCard,
    GoalsToolbar,
    Tooltip,
    SimpleModal,
    ScheduleGoalModal,
  },
  emits: ['screen-change'],
  setup(props, { emit }) {
    const store = useStore();
    const playSound = inject('playSound', () => {});
    const baseScreenRef = ref(null);
    const toolbarRef = ref(null);
    const simpleModal = ref(null);
    const terminalLines = ref([]);
    const selectedGoalId = ref(null);

    // Schedule a goal
    const scheduleModalGoal = ref(null);
    const openScheduleModal = (goal) => { scheduleModalGoal.value = goal; };
    const onScheduleCreated = () => {
      store.dispatch('schedules/fetchSchedules');
    };

    // Create-goal modal
    const showCreateModal = ref(false);
    const goalInput = ref('');
    const goalInputRef = ref(null);
    const newGoalPriority = ref('medium');
    const maxIterations = ref(50);
    const selectedTemplateId = ref(null);
    const isCreatingGoal = computed(() => store.getters['goals/isCreatingGoal']);

    // Search / filter / sort
    const searchQuery = ref('');
    const activeFilters = ref([]);
    const sortBy = ref('created_desc');

    // Forces age displays to refresh periodically without per-card timers
    const ageTick = ref(0);
    let ageInterval = null;

    const allGoals = computed(() => store.getters['goals/allGoals']);
    const isLoading = computed(() => store.getters['goals/isLoading']);
    const availableTemplates = computed(() => {
      const templates = store.getters['goalTemplates/allTemplates'] || [];
      return templates.slice(0, 8);
    });

    const getLiveIteration = (goalId) => store.getters['goals/getLiveIteration'](goalId);

    const filteredGoals = computed(() => {
      // Touch ageTick so aging re-evaluates even though filter logic doesn't depend on it directly
      ageTick.value;

      let goals = allGoals.value || [];

      if (searchQuery.value) {
        const q = searchQuery.value.toLowerCase();
        goals = goals.filter(
          (g) =>
            (g.title || '').toLowerCase().includes(q) || (g.id || '').toLowerCase().includes(q) || (g.description || '').toLowerCase().includes(q),
        );
      }

      if (activeFilters.value.length > 0) {
        goals = goals.filter((g) => {
          // "completed" chip covers validated; "failed" chip covers error/stopped;
          // "planning" chip also covers review-rejected `queued` goals.
          if (activeFilters.value.includes('completed') && DONE_SUCCESS.includes(g.status)) return true;
          if (activeFilters.value.includes('failed') && DONE_FAILURE.includes(g.status)) return true;
          if (activeFilters.value.includes('planning') && g.status === 'queued') return true;
          return activeFilters.value.includes(g.status);
        });
      }

      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      const sortFns = {
        created_desc: (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0),
        created_asc: (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0),
        progress_desc: (a, b) => (b.progress || 0) - (a.progress || 0),
        progress_asc: (a, b) => (a.progress || 0) - (b.progress || 0),
        priority: (a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2),
      };

      if (sortFns[sortBy.value]) {
        goals = [...goals].sort(sortFns[sortBy.value]);
      }

      return goals;
    });

    const columns = computed(() => {
      const goals = filteredGoals.value;
      return [
        {
          id: 'planning',
          // Review-rejected goals come back from the backend as `queued`; show them
          // here so they stay visible even though the dedicated Queued column is gone.
          title: 'Planning',
          icon: 'fas fa-lightbulb',
          color: 'var(--color-violet)',
          statuses: ['planning', 'queued'],
          goals: goals.filter((g) => g.status === 'planning' || g.status === 'queued'),
          wipLimit: 10,
        },
        {
          id: 'done',
          title: 'Done',
          icon: 'fas fa-check-circle',
          color: 'var(--color-green)',
          statuses: [...DONE_SUCCESS, ...DONE_FAILURE],
          goals: goals.filter((g) => [...DONE_SUCCESS, ...DONE_FAILURE].includes(g.status)),
          wipLimit: null,
        },
        {
          id: 'active',
          title: 'Active',
          icon: 'fas fa-cog',
          color: 'var(--color-green)',
          statuses: ['executing', 'paused'],
          goals: goals.filter((g) => ['executing', 'paused'].includes(g.status)),
          wipLimit: 6,
        },
        {
          id: 'review',
          title: 'Needs Review',
          icon: 'fas fa-exclamation-triangle',
          color: 'var(--color-orange)',
          statuses: ['needs_review'],
          goals: goals.filter((g) => g.status === 'needs_review'),
          wipLimit: 10,
        },
      ];
    });

    const doneSuccessGoals = computed(() => filteredGoals.value.filter((g) => DONE_SUCCESS.includes(g.status)));
    const doneFailureGoals = computed(() => filteredGoals.value.filter((g) => DONE_FAILURE.includes(g.status)));

    const initializeScreen = () => {
      terminalLines.value.push('Loading goals...');
      store
        .dispatch('goals/fetchGoals')
        .then(() => {
          terminalLines.value.push(`Loaded ${allGoals.value.length} goals.`);
          // Hydrate task progress for in-flight goals so cards show running tasks
          // immediately instead of waiting for the next socket event.
          const inFlight = (allGoals.value || []).filter((g) => ['executing', 'paused'].includes(g.status));
          inFlight.forEach((g) => {
            store.dispatch('goals/fetchGoalTaskProgress', g.id).catch(() => {});
          });
          baseScreenRef.value?.scrollToBottom();
        })
        .catch((error) => {
          terminalLines.value.push(`Error loading goals: ${error.message}`);
          baseScreenRef.value?.scrollToBottom();
        });

      // Load templates for the create modal gallery (no-op if already loaded)
      store.dispatch('goalTemplates/fetchTemplates').catch(() => {});

      // Prefetch schedules so GoalCard can show the per-goal badge.
      store.dispatch('schedules/fetchSchedules').catch(() => {});
    };

    const handleGoalClick = async (goal) => {
      playSound('typewriterKeyPress');
      selectedGoalId.value = goal.id;
      terminalLines.value.push(`Selected goal: ${goal.title}`);
      baseScreenRef.value?.scrollToBottom();
      baseScreenRef.value?.triggerPanelMethod('updateSelectedGoal', goal);

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
      const confirmed = await simpleModal.value?.showModal({
        title: 'Delete Goal?',
        message: `Are you sure you want to delete goal "${goal.title}"?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        showCancel: true,
        confirmClass: 'btn-danger',
      });
      if (!confirmed) return;
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
          priority: newGoalPriority.value,
          maxIterations: maxIterations.value,
        });
        goalInput.value = '';
        newGoalPriority.value = 'medium';
        maxIterations.value = 50;
        selectedTemplateId.value = null;
        showCreateModal.value = false;
        terminalLines.value.push(`Created goal: ${goalText.substring(0, 50)}...`);
        baseScreenRef.value?.scrollToBottom();
      } catch (error) {
        terminalLines.value.push(`Error creating goal: ${error.message}`);
        baseScreenRef.value?.scrollToBottom();
      }
    };

    const applyTemplate = (tpl) => {
      selectedTemplateId.value = tpl.id;
      goalInput.value = tpl.template || tpl.description || tpl.title || '';
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

    const getEmptyIcon = (columnId) =>
      ({
        planning: '💡',
        active: '🚀',
        review: '⚠️',
        done: '🏆',
      })[columnId] || '📋';

    const getEmptyText = (columnId) =>
      ({
        planning: 'No goals being planned',
        active: 'No active executions',
        review: 'Nothing needs review',
        done: 'No completed goals yet',
      })[columnId] || 'No goals';

    // Keyboard shortcuts
    const navigateCards = (direction) => {
      const visible = filteredGoals.value;
      if (!visible.length) return;
      const currentIdx = visible.findIndex((g) => g.id === selectedGoalId.value);
      let nextIdx;
      if (currentIdx === -1) {
        nextIdx = direction === 'next' ? 0 : visible.length - 1;
      } else {
        nextIdx = direction === 'next' ? currentIdx + 1 : currentIdx - 1;
        if (nextIdx < 0) nextIdx = visible.length - 1;
        if (nextIdx >= visible.length) nextIdx = 0;
      }
      handleGoalClick(visible[nextIdx]);
    };

    const onKeyDown = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) {
        // Allow Escape to bubble out of inputs to close modal
        if (e.key === 'Escape' && showCreateModal.value) {
          showCreateModal.value = false;
        }
        return;
      }

      switch (e.key) {
        case 'n':
        case 'N':
          e.preventDefault();
          showCreateModal.value = true;
          nextTick(() => goalInputRef.value?.focus());
          break;
        case '/':
          e.preventDefault();
          toolbarRef.value?.focus();
          break;
        case 'Escape':
          if (showCreateModal.value) showCreateModal.value = false;
          else deselectGoal();
          break;
        case 'ArrowDown':
        case 'j':
          e.preventDefault();
          navigateCards('next');
          break;
        case 'ArrowUp':
        case 'k':
          e.preventDefault();
          navigateCards('prev');
          break;
        case 'r':
        case 'R':
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            store.dispatch('goals/fetchGoals');
          }
          break;
      }
    };

    // Focus textarea when modal opens
    watch(showCreateModal, (open) => {
      if (open) nextTick(() => goalInputRef.value?.focus());
    });

    onMounted(() => {
      document.addEventListener('keydown', onKeyDown);
      // Refresh aging displays every 60s
      ageInterval = setInterval(() => {
        ageTick.value++;
      }, 60 * 1000);
    });

    onBeforeUnmount(() => {
      document.removeEventListener('keydown', onKeyDown);
      if (ageInterval) clearInterval(ageInterval);
    });

    return {
      baseScreenRef,
      toolbarRef,
      simpleModal,
      terminalLines,
      columns,
      doneSuccessGoals,
      doneFailureGoals,
      initializeScreen,
      handleGoalClick,
      scheduleModalGoal,
      openScheduleModal,
      onScheduleCreated,
      pauseGoal,
      resumeGoal,
      deleteGoal,
      handlePanelAction,
      handleCreateGoal,
      deselectGoal,
      getLiveIteration,
      getEmptyIcon,
      getEmptyText,
      applyTemplate,
      emit,
      selectedGoalId,
      allGoals,
      isLoading,
      showCreateModal,
      goalInput,
      goalInputRef,
      newGoalPriority,
      maxIterations,
      selectedTemplateId,
      availableTemplates,
      isCreatingGoal,
      searchQuery,
      activeFilters,
      sortBy,
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
  flex-direction: column;
  overflow: hidden;
}

body[data-page='terminal-goals'] .scrollable-content {
  overflow-y: hidden !important;
  padding: 0;
}

.kanban-board {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  gap: 12px;
  padding-bottom: 16px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}

.kanban-column {
  flex: 1 1 220px;
  min-width: 220px;
  flex-shrink: 0;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.column-header {
  padding: 10px 14px;
  border-bottom: 1px solid var(--terminal-border-color);
  border-top: 2px solid var(--terminal-border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--color-darker-1);
  border-radius: 6px 6px 0 0;
}

.column-header h3 {
  margin: 0;
  font-size: 0.92em;
  color: var(--color-text);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
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
  width: 18px;
  height: 16px;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.7em;
  padding: 0;
}

.add-goal-btn:hover {
  background: rgba(var(--green-rgb), 0.15);
  border-color: rgba(var(--green-rgb), 0.5);
  color: var(--color-green);
}

.column-count {
  background: var(--color-darker-2);
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.75em;
  font-weight: 600;
  color: var(--color-text-muted);
}

.column-count.at-limit {
  background: rgba(var(--yellow-rgb), 0.18);
  color: var(--color-yellow);
}

.column-count.over-limit {
  background: rgba(var(--red-rgb), 0.18);
  color: var(--color-red);
  animation: pulse-warning 2s ease-in-out infinite;
}

.wip-limit {
  font-weight: 400;
  opacity: 0.6;
}

@keyframes pulse-warning {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}

.column-content,
.done-column-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 60px;
  scrollbar-width: none;
}

.column-content::-webkit-scrollbar,
.done-column-content::-webkit-scrollbar {
  display: none;
}

.done-column-content {
  gap: 6px;
}

.done-section-label {
  font-size: 0.7em;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--color-green);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 2px;
  margin-top: 2px;
}

.done-section-label.failure {
  color: var(--color-red);
  margin-top: 10px;
  border-top: 1px dashed var(--terminal-border-color);
  padding-top: 10px;
}

.done-sub-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.empty-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 28px 16px;
  gap: 8px;
  min-height: 120px;
  color: var(--color-text-muted);
}

.empty-icon {
  font-size: 28px;
  opacity: 0.7;
}

.empty-text {
  font-size: 0.8em;
  text-align: center;
  opacity: 0.85;
}

.empty-cta {
  margin-top: 6px;
  padding: 6px 14px;
  font-size: 0.75em;
  border-radius: 6px;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.25);
  color: var(--color-green);
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: inherit;
}

.empty-cta:hover {
  background: rgba(var(--green-rgb), 0.18);
  border-color: rgba(var(--green-rgb), 0.45);
}

/* Create Goal Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}

.modal-container {
  background: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  width: 560px;
  max-width: 92vw;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
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
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.modal-label {
  font-size: 0.78em;
  color: var(--color-text-muted);
  margin-top: 6px;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}

.goal-input {
  width: 100%;
  padding: 10px 14px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-text);
  font-size: 0.92em;
  font-family: inherit;
  resize: vertical;
  min-height: 84px;
  transition: border-color 0.2s ease;
  box-sizing: border-box;
}

.goal-input:focus {
  outline: none;
  border-color: rgba(var(--green-rgb), 0.5);
}

.goal-input::placeholder {
  color: var(--color-text-muted);
  opacity: 0.7;
}

.priority-selector {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.priority-option {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-text-muted);
  padding: 6px 12px;
  font-size: 0.8em;
  cursor: pointer;
  transition: all 0.18s ease;
  text-transform: capitalize;
  font-family: inherit;
}

.priority-option:hover {
  border-color: rgba(var(--green-rgb), 0.35);
  color: var(--color-text);
}

.priority-option.active {
  background: rgba(var(--green-rgb), 0.12);
  border-color: rgba(var(--green-rgb), 0.5);
  color: var(--color-green);
}

.priority-option .priority-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.priority-option .priority-dot.urgent {
  background: var(--color-red);
}
.priority-option .priority-dot.high {
  background: var(--color-orange);
}
.priority-option .priority-dot.medium {
  background: var(--color-yellow);
}
.priority-option .priority-dot.low {
  background: var(--color-blue);
}

.iterations-input {
  width: 120px;
  padding: 8px 12px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-text);
  font-family: var(--font-family-mono);
  font-size: 0.9em;
  outline: none;
  transition: border-color 0.2s ease;
}

.iterations-input:focus {
  border-color: rgba(var(--green-rgb), 0.5);
}

.template-gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 6px;
}

.template-card {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-text-muted);
  padding: 8px 10px;
  font-size: 0.8em;
  cursor: pointer;
  transition: all 0.18s ease;
  text-align: left;
  font-family: inherit;
}

.template-card:hover {
  border-color: rgba(var(--green-rgb), 0.35);
  color: var(--color-text);
}

.template-card.active {
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.5);
  color: var(--color-green);
}

.tpl-icon {
  font-size: 0.9em;
  opacity: 0.9;
}

.tpl-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.modal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  border-top: 1px solid var(--terminal-border-color);
}

.modal-hint {
  font-size: 0.75em;
  color: var(--color-text-muted);
  opacity: 0.7;
}

.modal-actions {
  display: flex;
  gap: 8px;
}

.modal-btn {
  padding: 7px 16px;
  border-radius: 4px;
  font-size: 0.88em;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: inherit;
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
