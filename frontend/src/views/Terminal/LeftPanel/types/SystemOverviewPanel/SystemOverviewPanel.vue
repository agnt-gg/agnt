<template>
  <!-- System overview — the dashboard's left panel. One glance: how much of
       everything the account has, and what is moving right now. Every tile is
       a door to the screen that owns the number. Counts come from the store
       modules the screens already load; nothing is fetched here. -->
  <div class="sys-overview">
    <div class="sys-head">
      <span class="sys-cap">System</span>
      <span class="sys-live" :class="{ on: live.running > 0 }">
        <i class="fas fa-circle"></i> {{ live.running }} running
      </span>
    </div>

    <div class="sys-sec-title">Right now</div>
    <div class="sys-grid sys-grid-live">
      <button v-for="t in liveTiles" :key="t.label" type="button" class="sys-tile" :class="{ 'is-hot': t.hot }" @click="go(t.screen, t.opts)">
        <span class="sys-v">{{ t.value }}</span>
        <span class="sys-l"><i :class="t.icon"></i> {{ t.label }}</span>
      </button>
    </div>

    <div class="sys-sec-title">Inventory</div>
    <div class="sys-grid">
      <button v-for="t in inventoryTiles" :key="t.label" type="button" class="sys-tile" @click="go(t.screen, t.opts)">
        <span class="sys-v">{{ t.value }}</span>
        <span class="sys-l"><i :class="t.icon"></i> {{ t.label }}</span>
      </button>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';

const RUNNING = new Set(['running', 'executing', 'in_progress']);
const len = (v) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0);

export default {
  name: 'SystemOverviewPanel',
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    const g = (key, fallback) => {
      const v = store.getters[key];
      return v === undefined ? fallback : v;
    };

    const live = computed(() => {
      const executions = g('executionHistory/getExecutions', []);
      return {
        running: executions.filter((e) => RUNNING.has(String(e.status || '').toLowerCase())).length,
        goalsExecuting: g('goals/allGoals', []).filter((x) => x.status === 'executing').length,
        approvals: len(g('insights/escalatedInsights', [])),
      };
    });

    const liveTiles = computed(() => [
      { label: 'Running', value: live.value.running, icon: 'fas fa-bolt', hot: live.value.running > 0, screen: 'TracesScreen', opts: { status: 'running' } },
      { label: 'Goals executing', value: live.value.goalsExecuting, icon: 'fas fa-bullseye', hot: live.value.goalsExecuting > 0, screen: 'GoalsScreen' },
      { label: 'Waiting on you', value: live.value.approvals, icon: 'fas fa-user-check', hot: live.value.approvals > 0, screen: 'AutonomyScreen' },
    ]);

    const inventoryTiles = computed(() => {
      const healthy = g('appAuth/healthyConnectionsCount', 0);
      const total = g('appAuth/totalConnectionsCount', 0);
      return [
        { label: 'Chats', value: len(g('conversations/conversations', [])), icon: 'fas fa-comments', screen: 'ChatScreen' },
        { label: 'Goals', value: len(g('goals/allGoals', [])), icon: 'fas fa-bullseye', screen: 'GoalsScreen' },
        { label: 'Agents', value: len(g('agents/allAgents', [])), icon: 'fas fa-robot', screen: 'AgentsScreen' },
        { label: 'Workflows', value: len(g('workflows/allWorkflows', [])), icon: 'fas fa-project-diagram', screen: 'WorkflowsScreen' },
        { label: 'Tools', value: len(g('tools/customTools', [])), icon: 'fas fa-wrench', screen: 'ToolsScreen' },
        { label: 'Skills', value: len(g('skills/allSkills', [])), icon: 'fas fa-graduation-cap', screen: 'SkillsScreen' },
        { label: 'Widgets', value: len(g('widgets/customWidgets', [])), icon: 'fas fa-th', screen: 'WidgetManagerScreen' },
        { label: 'Connections', value: `${healthy} / ${total}`, icon: 'fas fa-plug', screen: 'ConnectorsScreen' },
        { label: 'Add-ons', value: len(g('plugins/installedPlugins', [])), icon: 'fas fa-puzzle-piece', screen: 'PluginsScreen' },
        { label: 'Files', value: len(g('artifacts/allArtifacts', [])), icon: 'fas fa-folder', screen: 'ArtifactsScreen' },
        { label: 'Memories', value: len(g('insights/allMemories', [])), icon: 'fas fa-brain', screen: 'MemoryScreen' },
        { label: 'Schedules', value: len(g('schedules/allSchedules', [])), icon: 'fas fa-clock', screen: 'AutonomyScreen', opts: { section: 'schedules' } },
      ];
    });

    const go = (screen, opts) => emit('panel-action', 'navigate', opts ? { screen, opts } : screen);

    return { live, liveTiles, inventoryTiles, go };
  },
};
</script>

<style scoped>
.sys-overview {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  height: 100%;
  overflow: hidden auto;
  scrollbar-width: thin;
}
.sys-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--terminal-border-color);
}
.sys-cap {
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
.sys-live {
  font-size: 11px;
  color: var(--color-text-muted);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.sys-live i {
  font-size: 7px;
}
.sys-live.on {
  color: var(--color-green);
}
.sys-live.on i {
  animation: sys-pulse 1.4s ease-in-out infinite;
}
@keyframes sys-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.sys-sec-title {
  margin-top: 4px;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
.sys-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.sys-grid-live {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.sys-tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: transparent;
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
  min-width: 0;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.sys-tile:hover {
  border-color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.06);
}
.sys-tile.is-hot .sys-v {
  color: var(--color-primary);
}
.sys-v {
  font-size: 20px;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.sys-l {
  font-size: 11px;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.sys-l i {
  width: 12px;
  margin-right: 4px;
  opacity: 0.8;
}
</style>
