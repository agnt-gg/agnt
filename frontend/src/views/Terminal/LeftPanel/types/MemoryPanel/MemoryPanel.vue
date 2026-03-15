<template>
  <div class="memory-panel">
    <!-- Panel Header -->
    <div class="panel-header">
      <h2 class="title">/ Memory</h2>
      <div class="panel-stats">
        <span class="stat-item">
          <i class="fas fa-database"></i>
          {{ totalMemories }}
        </span>
      </div>
    </div>

    <!-- Panel Content -->
    <div class="panel-content">
      <!-- Stats Grid -->
      <div class="section-label">Overview</div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">{{ agentCount }}</div>
          <div class="stat-label">Agents</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ orchestratorCount }}</div>
          <div class="stat-label">Global</div>
        </div>
      </div>

      <!-- Type Breakdown -->
      <div v-if="typeBreakdown.length > 0" class="section-label">By Type</div>
      <div v-if="typeBreakdown.length > 0" class="target-breakdown">
        <div
          v-for="item in typeBreakdown"
          :key="item.type"
          class="target-row"
          :class="{ active: activeType === item.type }"
          @click="filterByType(item.type)"
        >
          <i :class="typeIcon(item.type)"></i>
          <span class="target-type">{{ formatType(item.type) }}</span>
          <span class="target-count">{{ item.count }}</span>
        </div>
      </div>

      <!-- Agent Breakdown -->
      <div v-if="agentBreakdown.length > 0" class="section-label">By Agent</div>
      <div v-if="agentBreakdown.length > 0" class="target-breakdown">
        <div
          v-for="item in agentBreakdown"
          :key="item.id"
          class="target-row"
          :class="{ active: activeAgent === item.id }"
          @click="filterByAgent(item.id)"
        >
          <i :class="item.id === 'orchestrator' ? 'fas fa-brain' : 'fas fa-robot'"></i>
          <span class="target-type">{{ item.name }}</span>
          <span class="target-count">{{ item.count }}</span>
        </div>
      </div>

      <!-- Actions -->
      <div class="action-buttons">
        <button @click="emit('panel-action', 'add-memory')" class="action-button">
          <i class="fas fa-plus"></i> Add Memory
        </button>
        <button @click="refreshMemories" class="action-button">
          <i class="fas fa-sync"></i> Refresh
        </button>
        <button v-if="orphanedCount > 0" @click="emit('panel-action', 'clear-orphaned')" class="action-button danger">
          <i class="fas fa-broom"></i> Clear Deleted ({{ orphanedCount }})
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';

export default {
  name: 'MemoryPanel',
  props: {
    activeType: { type: String, default: 'all' },
    activeAgent: { type: String, default: 'all' },
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    const memories = computed(() => store.getters['insights/agentMemories'] || []);
    const agents = computed(() => store.getters['agents/allAgents'] || []);

    const agentNameMap = computed(() => {
      const map = {};
      for (const a of agents.value) map[a.id] = a.name;
      return map;
    });

    const totalMemories = computed(() => memories.value.length);

    const orchestratorCount = computed(() =>
      memories.value.filter(m => m.agent_id === 'orchestrator' || m.agent_id === '__orchestrator__').length
    );

    const agentCount = computed(() => {
      const ids = new Set();
      for (const m of memories.value) {
        if (m.agent_id !== 'orchestrator' && m.agent_id !== '__orchestrator__' && agentNameMap.value[m.agent_id]) {
          ids.add(m.agent_id);
        }
      }
      return ids.size;
    });

    const orphanedCount = computed(() =>
      memories.value.filter(m => {
        const id = m.agent_id;
        return id !== 'orchestrator' && id !== '__orchestrator__' && !agentNameMap.value[id];
      }).length
    );

    const typeBreakdown = computed(() => {
      const counts = {};
      for (const m of memories.value) {
        counts[m.memory_type] = (counts[m.memory_type] || 0) + 1;
      }
      return Object.entries(counts)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count);
    });

    const agentBreakdown = computed(() => {
      const counts = {};
      for (const m of memories.value) {
        counts[m.agent_id] = (counts[m.agent_id] || 0) + 1;
      }
      return Object.entries(counts)
        .map(([id, count]) => ({
          id,
          name: id === 'orchestrator' || id === '__orchestrator__'
            ? 'Orchestrator'
            : agentNameMap.value[id] || null,
          count,
        }))
        .filter(a => a.name) // exclude deleted agents
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    });

    const typeIcon = (t) => ({
      fact: 'fas fa-info-circle',
      preference: 'fas fa-sliders-h',
      correction: 'fas fa-exclamation-triangle',
      context: 'fas fa-bookmark',
      pattern: 'fas fa-project-diagram',
      tool_insight: 'fas fa-wrench',
      workflow_insight: 'fas fa-sitemap',
      prompt_guidance: 'fas fa-lightbulb',
    }[t] || 'fas fa-circle');

    const formatType = (t) => (t || '').replace(/_/g, ' ');

    const filterByType = (type) => {
      emit('panel-action', 'filter-type', type === props.activeType ? 'all' : type);
    };

    const filterByAgent = (id) => {
      emit('panel-action', 'filter-agent', id === props.activeAgent ? 'all' : id);
    };

    const refreshMemories = () => {
      store.dispatch('insights/fetchAllMemories');
      store.dispatch('agents/fetchAgents', { force: true });
    };

    return {
      emit, totalMemories, orchestratorCount, agentCount, orphanedCount,
      typeBreakdown, agentBreakdown, typeIcon, formatType,
      filterByType, filterByAgent, refreshMemories,
    };
  },
};
</script>

<style scoped>
.memory-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 16px;
}

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
  color: var(--color-primary);
  font-family: var(--font-family-primary);
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0.48px;
  margin: 0;
}

.panel-stats {
  display: flex;
  align-items: center;
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

.panel-content {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-content::-webkit-scrollbar {
  display: none;
}

.section-label {
  font-size: 0.7em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-grey);
  margin-top: 4px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.stat-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color-light);
  padding: 12px;
  border-radius: 0px;
  text-align: center;
}

.stat-value {
  font-size: 1.8em;
  font-weight: bold;
  color: var(--color-primary);
  margin-bottom: 4px;
}

.stat-label {
  font-size: 0.8em;
  color: var(--color-text-muted);
  text-transform: uppercase;
}

.target-breakdown {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.target-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color-light);
  font-size: 0.85em;
  cursor: pointer;
  transition: all 0.15s;
}
.target-row:hover {
  background: rgba(var(--primary-rgb), 0.05);
  border-color: rgba(var(--primary-rgb), 0.3);
}
.target-row.active {
  background: rgba(var(--primary-rgb), 0.1);
  border-color: rgba(var(--primary-rgb), 0.5);
}
.target-row i {
  color: var(--color-grey);
  width: 14px;
  text-align: center;
  font-size: 0.9em;
}
.target-type {
  flex: 1;
  color: var(--color-text);
  text-transform: capitalize;
}
.target-count {
  color: var(--color-primary);
  font-weight: 600;
}

.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.action-button {
  padding: 8px 16px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color-light);
  border-radius: 0px;
  color: var(--color-text);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
  font-size: 0.9em;
  width: 100%;
}

.action-button:hover {
  background: rgba(var(--primary-rgb), 0.1);
  border-color: rgba(var(--primary-rgb), 0.5);
}

.action-button i {
  width: 14px;
  text-align: center;
  color: var(--color-primary);
}

.action-button.danger {
  color: #ef4444;
}
.action-button.danger i {
  color: #ef4444;
}
.action-button.danger:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.5);
}
</style>
