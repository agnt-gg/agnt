<template>
  <div class="dash-panel">
    <div class="panel-header">
      <h2 class="title">/ Dashboard</h2>
    </div>

    <div class="dash-nav">
      <!-- Your pages: the custom widget pages from the rail's "+ New page",
           listed where the dashboard is so they read as siblings of it. -->
      <div class="nav-section">
        <h4>Pages</h4>
        <div class="nav-items">
          <button class="nav-item active" type="button">
            <i class="fas fa-tachometer-alt"></i>
            <span>Dashboard</span>
          </button>
          <button v-for="page in customPages" :key="page.id" class="nav-item" type="button" @click="openPage(page)">
            <i :class="page.icon || 'fas fa-th'"></i>
            <span>{{ page.name }}</span>
          </button>
          <button class="nav-item nav-item-quiet" type="button" @click="newPage">
            <i class="fas fa-plus"></i>
            <span>New page</span>
          </button>
        </div>
      </div>

      <div class="nav-section">
        <h4>Go to</h4>
        <div class="nav-items">
          <button v-for="g in GOTO" :key="g.screen" class="nav-item" type="button" @click="$emit('panel-action', 'navigate', g.screen)">
            <i :class="g.icon"></i>
            <span>{{ g.label }}</span>
            <span v-if="g.count && counts[g.count]" class="nav-count">{{ counts[g.count] }}</span>
          </button>
        </div>
      </div>

      <div class="nav-section">
        <h4>Quick actions</h4>
        <div class="nav-items">
          <button class="nav-item" type="button" @click="$emit('panel-action', 'navigate', { screen: 'GoalsScreen', opts: { newGoal: true } })">
            <i class="fas fa-bullseye"></i><span>New goal</span>
          </button>
          <button class="nav-item" type="button" @click="$emit('panel-action', 'navigate', 'AgentForgeScreen')">
            <i class="fas fa-robot"></i><span>New agent</span>
          </button>
          <button class="nav-item" type="button" @click="$emit('panel-action', 'navigate', 'WorkflowForgeScreen')">
            <i class="fas fa-project-diagram"></i><span>New workflow</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
/**
 * DashboardPanel (left) — pages · go to · quick actions.
 * The Dashboard used to render Chat's Saved Chats here because no panel
 * existed for it and LeftPanel falls back to ChatPanel.
 */
import { computed } from 'vue';
import { useStore } from 'vuex';
import { SECTION_ROUTES } from '@/canvas/sections.js';

const GOTO = Object.freeze([
  { screen: 'GoalsScreen', icon: 'fas fa-bullseye', label: 'Goals', count: 'goals' },
  { screen: 'TracesScreen', icon: 'fas fa-stream', label: 'Traces', count: 'running' },
  { screen: 'AgentsScreen', icon: 'fas fa-robot', label: 'Agents' },
  { screen: 'WorkflowsScreen', icon: 'fas fa-project-diagram', label: 'Workflows' },
  { screen: 'ConnectorsScreen', icon: 'fas fa-plug', label: 'Connections' },
]);

export default {
  name: 'DashboardPanel',
  emits: ['panel-action'],
  setup() {
    const store = useStore();
    const customPages = computed(() =>
      (store.getters['widgetLayout/allPages'] || []).filter((p) => !SECTION_ROUTES.has(p.route) && !(typeof p.route === 'string' && p.route.startsWith('workspace:'))),
    );
    const counts = computed(() => ({
      goals: (store.getters['goals/allGoals'] || []).filter((g) => g.status === 'executing').length,
      running: (store.getters['executionHistory/getExecutions'] || []).filter((e) => ['running', 'executing', 'in_progress'].includes(String(e.status || '').toLowerCase())).length,
    }));
    // The canvas owns page switching (it flips the custom-page flag), so we
    // ask it by event rather than dispatching to the store directly.
    const openPage = (page) => window.dispatchEvent(new CustomEvent('agnt:open-page', { detail: { pageId: page.id } }));
    const newPage = () => window.dispatchEvent(new CustomEvent('agnt:new-page'));
    return { GOTO, customPages, counts, openPage, newPage };
  },
};
</script>

<style scoped>
.dash-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.panel-header {
  display: flex;
  align-items: center;
  padding: 0 0 12px;
  border-bottom: 1px solid var(--terminal-border-color);
}
.title {
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--color-green);
  font-weight: 600;
  margin: 0;
}
.dash-nav {
  padding-top: 10px;
  overflow: auto;
}
.nav-section {
  margin-bottom: 14px;
}
.nav-section h4 {
  margin: 0 0 6px;
  font-size: 9.5px;
  letter-spacing: 0.17em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  font-weight: 600;
}
.nav-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 9px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: none;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.nav-item i {
  width: 14px;
  text-align: center;
  font-size: 11px;
}
.nav-item:hover {
  color: var(--color-text);
  background: rgba(255, 255, 255, 0.03);
}
.nav-item.active {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.25);
  background: rgba(var(--green-rgb), 0.06);
}
.nav-item-quiet {
  border-style: dashed;
  border-color: var(--terminal-border-color);
}
.nav-count {
  margin-left: auto;
  font-size: 10px;
  color: var(--color-text-muted);
}
</style>
