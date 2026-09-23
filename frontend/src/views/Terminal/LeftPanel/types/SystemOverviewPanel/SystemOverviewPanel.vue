<template>
  <!-- Presentation only: every count retains its store binding and destination. -->
  <div class="sys-overview">
    <header class="sys-head">
      <h2 class="sys-cap">System overview</h2>
      <span class="sys-live" :class="{ on: live.running > 0 }">
        <span class="sys-live-dot" aria-hidden="true"></span>{{ display(live.running) }} running
      </span>
    </header>

    <section class="sys-status" aria-label="Right now">
      <h3 class="sys-sec-title">Right now</h3>
      <div class="sys-activities">
        <button
          v-for="tile in liveTiles"
          :key="tile.label"
          type="button"
          class="sys-activity"
          :class="{ 'is-hot': tile.hot }"
          :aria-label="`${tile.label}: ${display(tile.value)}`"
          @click="go(tile.screen, tile.opts)"
        >
          <span class="sys-activity-icon" aria-hidden="true"><i :class="tile.icon"></i></span>
          <span class="sys-activity-label">{{ tile.label }}</span>
          <span class="sys-activity-value">{{ display(tile.value) }}</span>
          <i class="fas fa-chevron-right sys-arrow" aria-hidden="true"></i>
        </button>
      </div>
    </section>

    <section class="sys-inventory" aria-label="Inventory">
      <h3 class="sys-sec-title">Inventory</h3>
      <div class="sys-grid">
        <button
          v-for="tile in inventoryTiles"
          :key="tile.label"
          type="button"
          class="sys-tile"
          :class="{ 'sys-tile--wide': tile.screen === 'ConnectorsScreen' }"
          :aria-label="`${tile.label}: ${display(tile.value)}${tile.screen === 'ConnectorsScreen' ? ' healthy / total' : ''}`"
          @click="go(tile.screen, tile.opts)"
        >
          <span class="sys-tile-icon" aria-hidden="true"><i :class="tile.icon"></i></span>
          <span class="sys-tile-value" :class="{ 'is-empty': isEmpty(tile.value) }">{{ display(tile.value) }}</span>
          <span class="sys-tile-label">{{ tile.label }}</span>
          <span v-if="tile.screen === 'ConnectorsScreen'" class="sys-tile-detail">Healthy / total</span>
          <i class="fas fa-chevron-right sys-arrow" aria-hidden="true"></i>
        </button>
      </div>
    </section>
  </div>
</template>

<script>
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config.js';
// The getter/action list is shared with the navigation onion, so the rail and
// this overview can never disagree about what the account has.
import { HYDRATION, len } from '@/services/accountInventory.js';

const RUNNING = new Set(['running', 'executing', 'in_progress']);

// Plugins have no store module, and the tools-derived `installedPlugins` getter
// groups plugin TOOLS by plugin_name — so a plugin that ships only agents,
// workflows, skills or widgets (see GET /plugins/:name/assets) counts as zero.
// GET /plugins/installed reports stats.total for every installed plugin.
const fetchPluginCount = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_CONFIG.BASE_URL}/plugins/installed`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`Plugin count failed: ${response.status}`);
  const body = await response.json();
  return body?.stats?.total ?? (Array.isArray(body?.plugins) ? body.plugins.length : 0);
};

export default {
  name: 'SystemOverviewPanel',
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    const hydrating = ref(true);
    const pluginCount = ref(0);

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
        { label: 'Plugins', value: pluginCount.value, icon: 'fas fa-puzzle-piece', screen: 'PluginsScreen' },
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
        fetchPluginCount()
          .then((count) => {
            pluginCount.value = count;
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
  gap: 14px;
  min-height: 0;
  min-width: 0;
  height: 100%;
  padding: 4px 2px 12px;
  box-sizing: border-box;
  overflow: hidden auto;
  scrollbar-width: thin;
  color: var(--color-text);
  container-type: inline-size;
}
.sys-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 2px;
}
.sys-cap {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
}
.sys-live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 7px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 20px;
  color: var(--color-text-muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.sys-live.on {
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.08);
  border-color: rgba(var(--primary-rgb), 0.22);
}
.sys-live-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  flex: none;
}
.sys-sec-title {
  margin: 0;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  line-height: 1.4;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
.sys-status {
  flex: none;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: var(--color-darker-0);
}
.sys-status > .sys-sec-title {
  padding: 10px 12px;
  border-bottom: 1px solid var(--terminal-border-color);
}
.sys-activities {
  padding: 4px;
}
.sys-activity,
.sys-tile {
  font-family: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
  transition: background 150ms ease, border-color 150ms ease;
}
.sys-activity {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto 8px;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
}
.sys-activity-icon {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: var(--color-darker-0);
  color: var(--color-text-muted);
  font-size: 11px;
}
.sys-activity-label {
  font-size: 11px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.sys-activity-value {
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.sys-activity.is-hot .sys-activity-icon {
  background: rgba(var(--primary-rgb), 0.1);
  color: var(--color-primary);
}
.sys-activity.is-hot .sys-activity-value {
  color: var(--color-primary);
}
.sys-inventory {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: none;
}
.sys-inventory > .sys-sec-title {
  padding: 0 2px;
}
.sys-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.sys-tile {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  grid-template-areas: 'icon value' 'label arrow';
  align-items: center;
  align-content: start;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: var(--color-darker-0);
}
.sys-tile-icon {
  grid-area: icon;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 1px solid rgba(var(--primary-rgb), 0.12);
  border-radius: 6px;
  background: rgba(var(--primary-rgb), 0.07);
  color: var(--color-primary);
  font-size: 10px;
}
.sys-tile-value {
  grid-area: value;
  min-width: 0;
  margin: 0;
  text-align: right;
  font-size: clamp(16px, 7cqi, 22px);
  font-weight: 600;
  letter-spacing: -0.04em;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.sys-tile-value.is-empty {
  color: var(--color-text-muted);
}
.sys-tile-label {
  grid-area: label;
  grid-column: 1 / -1;
  padding-right: 14px;
  color: var(--color-text-muted);
  font-size: 11px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.sys-arrow {
  color: var(--color-text-muted);
  font-size: 8px;
  transition: color 150ms ease;
}
.sys-tile > .sys-arrow {
  grid-area: arrow;
  align-self: center;
  justify-self: end;
}
.sys-tile--wide {
  grid-column: 1 / -1;
  grid-template-columns: 22px minmax(0, 1fr) auto 8px;
  grid-template-areas: 'icon label value arrow' 'icon detail value arrow';
  align-items: center;
  column-gap: 10px;
  row-gap: 3px;
}
.sys-tile--wide .sys-tile-label {
  grid-column: 2;
  padding: 0;
  color: var(--color-text);
}
.sys-tile--wide .sys-tile-value {
  margin: 0;
  font-size: 18px;
  letter-spacing: -0.02em;
}
.sys-tile-detail {
  grid-area: detail;
  color: var(--color-text-muted);
  font-size: 10px;
  line-height: 1.4;
}
.sys-activity:hover,
.sys-tile:hover {
  border-color: rgba(var(--primary-rgb), 0.4);
  background: rgba(var(--primary-rgb), 0.06);
}
.sys-activity:hover .sys-arrow,
.sys-tile:hover .sys-arrow {
  color: var(--color-primary);
}
.sys-activity:focus-visible,
.sys-tile:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}
/* Match the resizable panel, not the viewport. At its narrowest, use rows
   rather than shrinking or truncating the labels and exact counts. */
@container (max-width: 225px) {
  .sys-grid { grid-template-columns: minmax(0, 1fr); }
  .sys-tile {
    grid-template-columns: 22px minmax(0, 1fr) auto 8px;
    grid-template-areas: 'icon label value arrow';
    align-items: center;
    gap: 8px;
    padding: 10px;
  }
  .sys-tile-value { font-size: 18px; margin: 0; }
  .sys-tile-label { grid-column: 2; padding: 0; }
  .sys-tile--wide { grid-template-areas: 'icon label value arrow' 'icon detail value arrow'; }
}
@media (prefers-reduced-motion: reduce) {
  .sys-activity, .sys-tile, .sys-arrow { transition: none; }
}
</style>
