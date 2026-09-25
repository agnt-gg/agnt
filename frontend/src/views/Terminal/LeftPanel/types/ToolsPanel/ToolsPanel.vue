<template>
  <CollectionStatsPanel title="Tools" icon="fas fa-wrench" :stats="stats" :lists="lists" @panel-action="(...args) => $emit('panel-action', ...args)" />
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';
import CollectionStatsPanel from '@/views/Terminal/_components/panels/CollectionStatsPanel.vue';
import { recentItems, statusIs } from '@/views/Terminal/_components/panels/collectionStats.js';

export default {
  name: 'ToolsPanel',
  components: { CollectionStatsPanel },
  props: {
    allAvailableTools: { type: Array, default: () => [] },
    activeTab: { type: String, default: 'all' },
    selectedTool: { type: Object, default: null },
  },
  emits: ['panel-action'],
  setup() {
    const store = useStore();
    const library = computed(() => store.getters['tools/workflowTools'] || {});
    const system = computed(() =>
      ['triggers', 'actions', 'utilities', 'widgets', 'controls'].flatMap((group) => library.value[group] || []),
    );
    const custom = computed(() => store.getters['tools/customTools'] || []);
    const stats = computed(() => {
      const plugin = system.value.filter((t) => t.isPlugin).length;
      return [
        { label: 'Tools', value: system.value.length + custom.value.length },
        { label: 'Yours', value: custom.value.length },
        { label: 'From plugins', value: plugin },
        { label: 'Built in', value: system.value.length - plugin },
      ];
    });
    const lists = computed(() => [
      {
        title: 'Your tools',
        empty: 'Tools you build appear here.',
        items: recentItems(custom.value, { date: (t) => t.updated_at || t.created_at, label: (t) => t.title || t.name }),
      },
    ]);
    return { stats, lists };
  },
};
</script>
