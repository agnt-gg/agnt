<template>
  <BaseDashboardCard title="AGENTS SWARM">
    <div class="agents-list">
      <div v-if="agents.length === 0" class="no-agents">
        <div class="empty-state">
          <i class="fas fa-robot"></i>
          <p>No agents created yet</p>
          <button class="create-link" @click="navigateToAgentForge"><i class="fas fa-plus"></i> Create Agent</button>
        </div>
      </div>
      <div v-else>
        <div v-for="agent in agents" :key="agent.id" class="agent-item">
          <div class="agent-info">
            <span class="agent-name">{{ agent.name }}</span>
          </div>
          <div class="agent-status">
            <span class="status-indicator" :class="agent.statusClass">{{ agent.statusIcon }}</span>
            <span class="status-text">{{ agent.statusText }}</span>
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
  name: 'AgentsSwarm',
  components: {
    BaseDashboardCard,
  },
  props: {
    agentsData: {
      type: Array,
      default: () => [],
    },
  },
  emits: ['navigate'],
  setup(props, { emit }) {
    const store = useStore();

    const agents = computed(() => {
      // Try to get agents from store first, fallback to props
      const storeAgents = store.getters['agents/allAgents'] || [];
      return storeAgents.length > 0 ? storeAgents : props.agentsData;
    });

    const navigateToAgentForge = () => {
      emit('navigate', 'AgentForgeScreen');
    };

    return {
      agents,
      navigateToAgentForge,
    };
  },
};
</script>

<style scoped>
.agents-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0;
  max-height: 306px;
  overflow-y: auto;
}

.no-agents {
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

.agent-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
}

.agent-info {
  display: flex;
  align-items: center;
  gap: 4px;
}

.agent-name {
  color: var(--color-text-muted);
  font-size: 0.85em;
  font-weight: 600;
}

.agent-status {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 56px;
  justify-content: space-between;
}

.status-indicator {
  font-size: 0.7em;
}

.status-text {
  color: var(--color-text-muted);
  font-size: 0.75em;
}

.status-active {
  color: var(--color-green);
}

.status-idle {
  color: var(--color-orange);
}

.status-data {
  color: var(--color-blue);
}

.status-guard {
  color: var(--color-indigo);
}
</style>
