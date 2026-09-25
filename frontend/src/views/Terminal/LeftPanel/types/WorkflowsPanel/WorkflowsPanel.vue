<template>
  <CollectionStatsPanel title="Workflows" icon="fas fa-sitemap" :stats="stats" :lists="lists" @panel-action="(...args) => $emit('panel-action', ...args)" />
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';
import CollectionStatsPanel from '@/views/Terminal/_components/panels/CollectionStatsPanel.vue';
import { recentItems, statusIs } from '@/views/Terminal/_components/panels/collectionStats.js';

export default {
  name: 'WorkflowsPanel',
  components: { CollectionStatsPanel },
  props: {
    allWorkflows: { type: Array, default: () => [] },
    workflowsFilteredByTab: { type: Array, default: () => [] },
    activeTab: { type: String, default: 'all' },
    selectedWorkflowId: { type: String, default: null },
  },
  emits: ['panel-action'],
  setup() {
    const store = useStore();
    const workflows = computed(() => store.getters['workflows/allWorkflows'] || []);
    const executions = computed(() => store.getters['executionHistory/getWorkflowExecutions'] || []);
    const stats = computed(() => {
      const live = workflows.value.filter((w) => statusIs(w, 'listening', 'running', 'active')).length;
      const day = Date.now() - 86400e3;
      const today = executions.value.filter((e) => new Date(e.startTime || e.started_at || e.created_at).getTime() > day);
      const failed = today.filter((e) => statusIs(e, 'failed', 'error')).length;
      return [
        { label: 'Workflows', value: workflows.value.length },
        { label: 'Listening', value: live, tone: live ? 'good' : '' },
        { label: 'Runs · 24h', value: today.length },
        { label: 'Failed · 24h', value: failed, tone: failed ? 'bad' : '' },
      ];
    });
    const lists = computed(() => [
      {
        title: 'Recently edited',
        items: recentItems(workflows.value, { date: (w) => w.updated_at || w.created_at, label: (w) => w.name || 'Untitled workflow' }),
      },
    ]);
    return { stats, lists };
  },
};
</script>
