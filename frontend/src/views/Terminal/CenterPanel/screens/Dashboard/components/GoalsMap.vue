<template>
  <BaseDashboardCard title="GOALS MAP" footer-text="Click any [G-*] to tree">
    <div class="goals-list">
      <div v-if="goals.length === 0" class="no-goals">
        <div class="empty-state">
          <i class="fas fa-bullseye"></i>
          <p>No goals defined yet</p>
          <button class="create-link" @click="navigateToChat"><i class="fas fa-comments"></i> Create via Chat</button>
        </div>
      </div>
      <div v-else>
        <div v-for="goal in goals" :key="goal.id" class="goal-item">
          <span class="goal-link">{{ goal.title || goal.name || goal.id }}</span>
          <span class="goal-progress">{{ goal.progress }}%</span>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: goal.progress + '%' }"></div>
          </div>
        </div>
      </div>
    </div>
  </BaseDashboardCard>
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';
import BaseDashboardCard from './BaseDashboardCard.vue';

export default {
  name: 'GoalsMap',
  components: {
    BaseDashboardCard,
  },
  props: {
    goalsData: {
      type: Array,
      default: () => [],
    },
  },
  emits: ['navigate'],
  setup(props, { emit }) {
    const store = useStore();

    const goals = computed(() => {
      // Try to get goals from store first, fallback to props
      const storeGoals = store.getters['goals/allGoals'] || [];
      return storeGoals.length > 0 ? storeGoals : props.goalsData;
    });

    const navigateToChat = () => {
      emit('navigate', 'ChatScreen');
    };

    return {
      goals,
      navigateToChat,
    };
  },
};
</script>

<style scoped>
.goals-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0;
  max-height: 306px;
  overflow-y: auto;
}

.no-goals {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-state {
  text-align: center;
  color: var(--color-text-muted);
  /* opacity: 0.7; */
}

.empty-state i {
  font-size: 2em;
  margin-bottom: 4px;
  display: block;
}

.empty-state p {
  margin: 0 0 12px 0;
  font-size: 0.9em;
}

.create-link {
  background: var(--color-primary);
  color: var(--color-white);
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85em;
  transition: all 0.2s ease;
}

.create-link:hover {
  background: var(--color-primary-hover);
  transform: translateY(-1px);
}

.create-link i {
  /* margin-right: 4px; */
  font-size: 0.9em;
}

.goal-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.goal-link {
  color: var(--color-blue);
  /* background: var(--color-darker-1);
  padding: 2px 4px; */
  border-radius: 2px;
  /* border: 1px solid var(--terminal-border-color); */
  transition: all 0.2s ease;
  min-width: 120px;
  font-size: 0.8em;
}

/* .goal-link:hover {
  background: var(--color-darker-2);
  transform: translateY(-1px);
} */

.goal-progress {
  color: var(--color-text);
  font-weight: bold;
  min-width: 35px;
  font-size: 0.8em;
}

.progress-bar {
  flex: 1;
  height: 8px;
  background: var(--color-darker-1);
  border-radius: 4px;
  overflow: hidden;
  position: relative;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary), var(--color-secondary));
  transition: width 0.3s ease;
  position: relative;
  min-width: 105%; /* Ensure fill extends beyond container to avoid border-radius showing through */
  max-width: 105%;
}

.progress-fill::after {
  content: '';
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: rgba(255, 255, 255, 0.8);
}
</style>
