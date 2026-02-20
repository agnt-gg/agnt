<template>
  <div class="ui-panel goals-panel">
    <!-- Panel Header -->
    <div class="panel-header">
      <h2 class="title">/ Goals</h2>
      <div class="panel-stats">
        <span class="stat-item">
          <i class="fas fa-bullseye"></i>
          {{ totalGoals }}
        </span>
      </div>
    </div>

    <!-- Goal Statistics -->
    <div class="goals-stats-section">
      <h4 class="section-title">
        <i class="fas fa-chart-bar"></i>
        Goal Statistics
      </h4>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">{{ totalGoals }}</div>
          <div class="stat-label">Total</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ activeGoals }}</div>
          <div class="stat-label">Active</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ completedGoals }}</div>
          <div class="stat-label">Done</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ failedGoals }}</div>
          <div class="stat-label">Failed</div>
        </div>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="quick-actions-section">
      <h4 class="section-title">
        <i class="fas fa-bolt"></i>
        Quick Actions
      </h4>
      <div class="action-buttons">
        <button @click="createGoal" class="action-button">
          <i class="fas fa-plus"></i>
          New Goal (Chat)
        </button>
        <button @click="refreshGoals" class="action-button">
          <i class="fas fa-sync"></i>
          Refresh Goals
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { computed, inject } from 'vue';
import { useStore } from 'vuex';

export default {
  name: 'GoalsPanel',
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    const playSound = inject('playSound', () => {});

    const allGoals = computed(() => store.getters['goals/allGoals'] || []);

    const totalGoals = computed(() => allGoals.value.length);
    const activeGoals = computed(() => allGoals.value.filter((g) => ['executing', 'paused', 'planning', 'queued'].includes(g.status)).length);
    const completedGoals = computed(() => allGoals.value.filter((g) => ['completed', 'validated'].includes(g.status)).length);
    const failedGoals = computed(() => allGoals.value.filter((g) => ['failed', 'error', 'stopped'].includes(g.status)).length);

    const createGoal = () => {
      playSound('typewriterKeyPress');
      emit('panel-action', 'navigate', 'ChatScreen');
    };

    const refreshGoals = () => {
      playSound('typewriterKeyPress');
      store.dispatch('goals/fetchGoals');
    };

    return {
      totalGoals,
      activeGoals,
      completedGoals,
      failedGoals,
      createGoal,
      refreshGoals,
    };
  },
};
</script>

<style scoped>
.panel-header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 0 0 12px 0;
  border-bottom: 1px solid var(--terminal-border-color-light);
  user-select: none;
}

.panel-header .title {
  color: var(--color-green);
  font-family: var(--font-family-primary);
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0.48px;
  margin: 0;
}

.panel-stats {
  display: flex;
  gap: 12px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-light-med-navy);
  font-size: 0.85em;
  opacity: 0.8;
}

.stat-item i {
  width: 14px;
  text-align: center;
}

.ui-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
  height: 100%;
  position: relative;
  padding-right: 4px;
  z-index: 3;
  overflow-y: auto;
  scrollbar-color: var(--color-duller-navy) transparent;
  scrollbar-width: thin;
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

.goals-stats-section,
.quick-actions-section {
  background: rgb(0 0 0 / 10%);
  border: 1px solid var(--terminal-border-color);
  padding: 16px;
  border-radius: 8px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.stat-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  padding: 12px;
  border-radius: 6px;
  text-align: center;
}

.stat-value {
  font-size: 1.8em;
  font-weight: bold;
  color: var(--color-text);
  margin-bottom: 4px;
}

.stat-label {
  font-size: 0.8em;
  color: var(--color-secondary);
  text-transform: uppercase;
}

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
</style>
