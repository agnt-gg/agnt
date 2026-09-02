<template>
  <!-- A clicked reference (from any dashboard widget) swaps to the entity;
       ✕ / Esc returns to the summary. -->
  <EntityInspector v-if="target" :kind="target.kind" :id="target.id" caption="Dashboard" @close="clear" @action="onEntityAction" />

  <ListSummaryPanel
    v-else
    caption="Dashboard"
    overview-title="Right now"
    :stats="stats"
    hint="Click an agent, workflow or run in any widget to inspect it here."
    :actions="actions"
  >
    <ActiveWorkflows
      @edit-workflow="(payload) => $emit('panel-action', 'edit-workflow', payload.workflowId)"
      @panel-action="(action, ...args) => $emit('panel-action', action, ...args)"
    />
  </ListSummaryPanel>
</template>

<script>
/**
 * DashboardPanel (right) — the dashboard's own summary. No panel existed for
 * this screen, so RightPanel fell back to Chat's; that block (Active
 * Workflows · Integration Health · Resources) is exactly what a dashboard's
 * right panel should hold, minus the two that now live on Connectors and
 * Settings › About.
 */
import { computed } from 'vue';
import { useStore } from 'vuex';
import ListSummaryPanel from '@/views/_components/one/ListSummaryPanel.vue';
import EntityInspector from '@/views/_components/one/EntityInspector.vue';
import ActiveWorkflows from '@/views/Terminal/RightPanel/types/ChatPanel/components/ActiveWorkflows.vue';
import { useInspect } from '@/composables/useInspect.js';

const RUNNING = new Set(['running', 'executing', 'in_progress']);

export default {
  name: 'DashboardPanel',
  components: { ListSummaryPanel, EntityInspector, ActiveWorkflows },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    const { target, clear } = useInspect(['agent', 'workflow', 'goal', 'trace', 'execution', 'running', 'autonomy', 'memory']);
    const stats = computed(() => {
      const ex = store.getters['executionHistory/getExecutions'] || [];
      const running = ex.filter((e) => RUNNING.has(String(e.status || '').toLowerCase())).length;
      const goals = (store.getters['goals/allGoals'] || []).filter((g) => g.status === 'executing').length;
      const approvals = (store.getters['insights/escalatedInsights'] || []).length;
      const healthy = store.getters['appAuth/healthyConnectionsCount'] || 0;
      const total = store.getters['appAuth/totalConnectionsCount'] || 0;
      return [
        { label: 'Running', value: running, live: running > 0, onClick: () => store.dispatch('shell/inspect', { kind: 'running' }) },
        { label: 'Goals executing', value: goals, onClick: () => emit('panel-action', 'navigate', 'GoalsScreen') },
        { label: 'To approve', value: approvals, live: approvals > 0, onClick: () => store.dispatch('shell/inspect', { kind: 'autonomy' }) },
        { label: 'Connections', value: `${healthy} / ${total}`, onClick: () => emit('panel-action', 'navigate', 'ConnectorsScreen') },
      ];
    });
    const actions = [
      { label: 'Open Traces', onClick: () => emit('panel-action', 'navigate', 'TracesScreen') },
      { label: 'Connectors', onClick: () => emit('panel-action', 'navigate', 'ConnectorsScreen') },
    ];
    const onEntityAction = (action, payload) => {
      if (action === 'open-forge') emit('panel-action', 'edit-workflow', payload.id);
      else if (action === 'edit-agent') emit('panel-action', 'navigate', { screen: 'AgentForgeScreen', opts: { agentId: payload.id } });
      else if (action === 'apply-insight') store.dispatch('insights/applyInsight', payload.id);
      else if (action === 'reject-insight') store.dispatch('insights/rejectInsight', payload.id);
      else emit('panel-action', action, payload);
    };
    return { target, clear, stats, actions, onEntityAction };
  },
};
</script>
