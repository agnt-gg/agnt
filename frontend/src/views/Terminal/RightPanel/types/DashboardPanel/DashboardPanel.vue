<template>
  <ListSummaryPanel
    caption="Dashboard"
    overview-title="Right now"
    :stats="stats"
    :actions="actions"
  >
    <ActiveWorkflows
      @edit-workflow="(payload) => $emit('panel-action', 'edit-workflow', payload.workflowId)"
      @panel-action="(action, ...args) => $emit('panel-action', action, ...args)"
    />
    <IntegrationHealth />
  </ListSummaryPanel>
</template>

<script>
/**
 * DashboardPanel (right) — the dashboard's own summary. No panel existed for
 * this screen, so RightPanel fell back to Chat's; that block (Active
 * Workflows · Integration Health) is exactly what a dashboard's right panel
 * should hold. There is nothing to inspect on a dashboard, so no inspector
 * section here — clicks in widgets navigate.
 */
import { computed } from 'vue';
import { useStore } from 'vuex';
import ListSummaryPanel from '@/views/_components/one/ListSummaryPanel.vue';
import ActiveWorkflows from '@/views/Terminal/RightPanel/types/ChatPanel/components/ActiveWorkflows.vue';
import IntegrationHealth from '@/views/Terminal/RightPanel/types/ChatPanel/components/IntegrationHealth.vue';

const RUNNING = new Set(['running', 'executing', 'in_progress']);

export default {
  name: 'DashboardPanel',
  components: { ListSummaryPanel, ActiveWorkflows, IntegrationHealth },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    const stats = computed(() => {
      const ex = store.getters['executionHistory/getExecutions'] || [];
      const running = ex.filter((e) => RUNNING.has(String(e.status || '').toLowerCase())).length;
      const goals = (store.getters['goals/allGoals'] || []).filter((g) => g.status === 'executing').length;
      const approvals = (store.getters['insights/escalatedInsights'] || []).length;
      const healthy = store.getters['appAuth/healthyConnectionsCount'] || 0;
      const total = store.getters['appAuth/totalConnectionsCount'] || 0;
      return [
        { label: 'Running', value: running, live: running > 0, onClick: () => emit('panel-action', 'navigate', 'TracesScreen') },
        { label: 'Goals executing', value: goals, onClick: () => emit('panel-action', 'navigate', 'GoalsScreen') },
        { label: 'To approve', value: approvals, live: approvals > 0, onClick: () => emit('panel-action', 'navigate', 'AutonomyScreen') },
        { label: 'Connections', value: `${healthy} / ${total}`, onClick: () => emit('panel-action', 'navigate', 'ConnectorsScreen') },
      ];
    });
    const actions = [
      { label: 'Open Activity', onClick: () => emit('panel-action', 'navigate', 'TracesScreen') },
      { label: 'Apps', onClick: () => emit('panel-action', 'navigate', 'ConnectorsScreen') },
    ];
    return { stats, actions };
  },
};
</script>
