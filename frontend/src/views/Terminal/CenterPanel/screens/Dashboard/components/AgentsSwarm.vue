<template>
  <BaseDashboardCard title="AGENTS SWARM">
    <div class="agents-list" ref="listRef" :class="{ 'has-fade': canScroll && !isAtBottom }" @scroll="checkScroll">
      <div v-if="agents.length === 0" class="no-agents">
        <div class="empty-state">
          <i class="fas fa-robot"></i>
          <p>No agents created yet</p>
          <button class="create-btn" @click="navigateToAgentForge"><i class="fas fa-plus"></i> <span>Create New Agent</span></button>
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
import { computed, ref, onMounted, onUpdated, nextTick } from 'vue';
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
    const listRef = ref(null);
    const isAtBottom = ref(true);
    const canScroll = ref(false);
    const checkScroll = () => {
      const el = listRef.value;
      if (!el) return;
      canScroll.value = el.scrollHeight > el.clientHeight + 4;
      isAtBottom.value = !canScroll.value || el.scrollHeight - el.scrollTop - el.clientHeight < 4;
    };
    onMounted(() => nextTick(checkScroll));
    onUpdated(() => nextTick(checkScroll));

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
      listRef,
      isAtBottom,
      canScroll,
      checkScroll,
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
  scrollbar-width: none;
}

.agents-list::-webkit-scrollbar {
  display: none;
}

.agents-list.has-fade {
  -webkit-mask-image: linear-gradient(to bottom, black calc(100% - 8px), transparent 100%);
  mask-image: linear-gradient(to bottom, black calc(100% - 8px), transparent 100%);
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
  margin-bottom: 0;
  display: block;
}

.empty-state p {
  margin: 12px 0 12px 0;
  font-size: 0.9em;
}

.create-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: 1px dashed var(--color-duller-navy);
  border-radius: 6px;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 0.85em;
  transition: all 0.2s ease;
}

.create-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.05);
}

.create-btn i {
  font-size: 0.8em;
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
