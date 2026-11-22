<template>
  <!-- Studio's Apps screen: a collection overview, as on Tools and Agents. Rows act
       through the page (AppsScreen), never here. -->
  <CollectionStatsPanel :title="left.title" :icon="left.icon" :stats="left.stats" :lists="left.lists" @panel-action="(...args) => $emit('panel-action', ...args)" />
</template>

<script>
import CollectionStatsPanel from '@/views/Terminal/_components/panels/CollectionStatsPanel.vue';

export default {
  name: 'AppsPanel',
  components: { CollectionStatsPanel },
  props: {
    /** studioPanels(summary).left */
    left: { type: Object, default: () => ({ title: 'Plugins', icon: 'fas fa-plug', stats: [], lists: [] }) },
  },
  emits: ['panel-action'],
};
</script>
