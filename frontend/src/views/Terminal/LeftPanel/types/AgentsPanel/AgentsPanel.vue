<template>
  <CollectionStatsPanel title="Agents" icon="fas fa-robot" :stats="stats" :lists="lists" @panel-action="(...args) => $emit('panel-action', ...args)" />
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';
import CollectionStatsPanel from '@/views/Terminal/_components/panels/CollectionStatsPanel.vue';
import { recentItems, statusIs } from '@/views/Terminal/_components/panels/collectionStats.js';

export default {
  name: 'AgentsPanel',
  components: { CollectionStatsPanel },
  props: {
    // Passed by the screen via leftPanelProps; the panel reads Vuex so it has
    // data before the centre screen has mounted. Declared so they are not attrs.
    allAvailableAgents: { type: Array, default: () => [] },
    activeTab: { type: String, default: 'all' },
    selectedAgent: { type: Object, default: null },
  },
  emits: ['panel-action'],
  setup() {
    const store = useStore();
    const agents = computed(() => store.getters['agents/allAgents'] || []);
    const stats = computed(() => {
      const active = agents.value.filter((a) => statusIs(a, 'active')).length;
      const tools = new Set(agents.value.flatMap((a) => a.assignedTools || [])).size;
      const credits = agents.value.reduce((sum, a) => sum + (Number(a.creditsUsed) || 0), 0);
      return [
        { label: 'Agents', value: agents.value.length },
        { label: 'Active', value: active, tone: active ? 'good' : '' },
        { label: 'Tools in use', value: tools },
        { label: 'Credits used', value: credits.toLocaleString() },
      ];
    });
    const lists = computed(() => [
      {
        title: 'Recently active',
        empty: 'No agent has run yet.',
        items: recentItems(agents.value, { date: (a) => a.lastActive || a.updated_at, label: (a) => a.name }),
      },
    ]);
    return { stats, lists };
  },
};
</script>
