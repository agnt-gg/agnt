<template>
  <!-- System overview — the dashboard's left panel. One glance: what is moving
       right now, and how much of everything the account has. Every row is a
       door to the screen that owns the number.

       Counts come from the store modules the screens already load. The
       dashboard is a legitimate first screen, though, so a module nobody has
       opened yet would read zero forever — hydrate() fills only what is still
       empty, and until that settles a zero renders as an em dash rather than
       lying about an empty account. -->
  <div class="sys-overview">
    <div class="sys-head">
      <span class="sys-cap">System</span>
      <span class="sys-live" :class="{ on: live.running > 0 }">
        <i class="fas fa-circle"></i> {{ live.running }} running
      </span>
    </div>

    <div class="sys-sec-title">Right now</div>
    <div class="sys-cards">
      <button
        v-for="t in liveTiles"
        :key="t.label"
        type="button"
        class="sys-card"
        :class="{ 'is-hot': t.hot }"
        @click="go(t.screen, t.opts)"
      >
        <span class="sys-card-v">{{ display(t.value) }}</span>
        <span class="sys-card-l"><i :class="t.icon"></i>{{ t.label }}</span>
      </button>
    </div>

    <div class="sys-sec-title">Inventory</div>
    <div class="sys-rows">
      <button
        v-for="t in inventoryTiles"
        :key="t.label"
        type="button"
        class="sys-row"
        @click="go(t.screen, t.opts)"
      >
        <i class="sys-row-i" :class="t.icon"></i>
        <span class="sys-row-l">{{ t.label }}</span>
        <span class="sys-row-v" :class="{ 'is-empty': isEmpty(t.value) }">{{ display(t.value) }}</span>
      </button>
    </div>
  </div>
</template>

<script>
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config.js';

const RUNNING = new Set(['running', 'executing', 'in_progress']);
const len = (v) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0);

// [getter that proves the module is populated, action that populates it].
// Dispatched only when the getter is still empty, so opening the dashboard
// after any other screen costs nothing. Chats deliberately asks for a single
// row: the server returns the real totalCount with it, and leaving
// hasLoadedAll false keeps the chat sidebar's own full load on mount intact.
const HYDRATION = [
  ['goals/allGoals', 'goals/fetchGoals'],
  ['agents/allAgents', 'agents/fetchAgents'],
  ['workflows/allWorkflows', 'workflows/fetchWorkflows'],
  ['tools/customTools', 'tools/fetchTools'],
  ['skills/allSkills', 'skills/fetchSkills'],
  ['schedules/allSchedules', 'schedules/fetchSchedules'],
  ['widgetDefinitions/allDefinitions', 'widgetDefinitions/fetchDefinitions'],
  ['insights/agentMemories', 'insights/fetchAllMemories'],
  ['insights/allInsights', 'insights/fetchInsights'],
  ['executionHistory/getExecutions', 'executionHistory/fetchExecutions'],
  ['contentOutputs/outputs', 'contentOutputs/fetchOutputs', { limit: 1, offset: 0, loadAll: false, force: true }],
];

// Add-ons has no store module, and the tools-derived `installedPlugins` getter
// groups plugin TOOLS by plugin_name — so a plugin that ships only agents,
// workflows, skills or widgets (see GET /plugins/:name/assets) counts as zero.
// GET /plugins/installed reports stats.total for every installed plugin.
const fetchAddOnCount = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_CONFIG.BASE_URL}/plugins/installed`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`Add-on count failed: ${response.status}`);
  const body = await response.json();
  return body?.stats?.total ?? (Array.isArray(body?.plugins) ? body.plugins.length : 0);
};

export default {
  name: 'SystemOverviewPanel',
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    const hydrating = ref(true);
    const addOns = ref(0);

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
        { label: 'Chats', value: g('contentOutputs/totalCount', 0) || len(g('contentOutputs/outputs', [])), icon: 'fas fa-comments', screen: 'ChatScreen' },
        { label: 'Goals', value: len(g('goals/allGoals', [])), icon: 'fas fa-bullseye', screen: 'GoalsScreen' },
        { label: 'Agents', value: len(g('agents/allAgents', [])), icon: 'fas fa-robot', screen: 'AgentsScreen' },
        { label: 'Workflows', value: len(g('workflows/allWorkflows', [])), icon: 'fas fa-project-diagram', screen: 'WorkflowsScreen' },
        { label: 'Tools', value: len(g('tools/customTools', [])), icon: 'fas fa-wrench', screen: 'ToolsScreen' },
        { label: 'Skills', value: len(g('skills/allSkills', [])), icon: 'fas fa-graduation-cap', screen: 'SkillsScreen' },
        { label: 'Widgets', value: len(g('widgetDefinitions/allDefinitions', [])), icon: 'fas fa-th', screen: 'WidgetManagerScreen' },
        { label: 'Add-ons', value: addOns.value, icon: 'fas fa-puzzle-piece', screen: 'PluginsScreen' },
        { label: 'Memories', value: len(g('insights/agentMemories', [])), icon: 'fas fa-brain', screen: 'MemoryScreen' },
        { label: 'Schedules', value: len(g('schedules/allSchedules', [])), icon: 'fas fa-clock', screen: 'AutonomyScreen', opts: { section: 'schedules' } },
        { label: 'Connections', value: `${healthy} / ${total}`, icon: 'fas fa-plug', screen: 'ConnectorsScreen' },
      ];
    });

    const isEmpty = (value) => value === 0 || value === '0 / 0';
    // A zero we have not proved yet is not a zero. Say nothing instead.
    const display = (value) => (hydrating.value && isEmpty(value) ? '—' : value);

    const hydrate = async () => {
      const jobs = HYDRATION.filter(([getter]) => len(g(getter, [])) === 0).map(([, action, payload]) =>
        store.dispatch(action, payload).catch(() => {}),
      );
      jobs.push(
        fetchAddOnCount()
          .then((count) => {
            addOns.value = count;
          })
          .catch(() => {}),
      );
      await Promise.allSettled(jobs);
      hydrating.value = false;
    };

    onMounted(hydrate);

    const go = (screen, opts) => emit('panel-action', 'navigate', opts ? { screen, opts } : screen);

    return { live, liveTiles, inventoryTiles, display, isEmpty, go };
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
  margin-top: 2px;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  opacity: 0.75;
}

/* Right now — three cards, because these are the numbers worth a glance.
   Labels wrap rather than truncate; the panel is narrow and "Goals executing"
   has to survive it. */
.sys-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.sys-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: transparent;
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
  min-width: 0;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.sys-card:hover {
  border-color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.06);
}
.sys-card-v {
  font-size: 22px;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.sys-card-l {
  font-size: 10px;
  line-height: 1.3;
  color: var(--color-text-muted);
}
.sys-card-l i {
  margin-right: 4px;
  opacity: 0.7;
}
.sys-card.is-hot {
  border-color: rgba(var(--primary-rgb), 0.5);
  background: rgba(var(--primary-rgb), 0.08);
}
.sys-card.is-hot .sys-card-v {
  color: var(--color-primary);
}

/* Inventory — one row per thing. A grid of boxes made twelve equal-weight
   numbers compete and clipped their own labels; a list reads top to bottom,
   right-aligns the numbers into a column the eye can scan, and never
   truncates. */
.sys-rows {
  display: flex;
  flex-direction: column;
}
.sys-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.sys-row + .sys-row {
  border-top: 1px solid var(--terminal-border-color);
  border-radius: 0;
}
.sys-row:hover {
  background: rgba(var(--primary-rgb), 0.08);
  color: var(--color-primary);
}
.sys-row-i {
  width: 14px;
  font-size: 11px;
  text-align: center;
  color: var(--color-text-muted);
  flex: none;
}
.sys-row:hover .sys-row-i {
  color: var(--color-primary);
}
.sys-row-l {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sys-row-v {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  flex: none;
}
.sys-row-v.is-empty {
  color: var(--color-text-muted);
  font-weight: 400;
}
</style>
