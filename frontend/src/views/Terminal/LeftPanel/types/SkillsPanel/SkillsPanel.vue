<template>
  <CollectionStatsPanel title="Skills" icon="fas fa-brain" :stats="stats" :lists="lists" @panel-action="(...args) => $emit('panel-action', ...args)" />
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';
import CollectionStatsPanel from '@/views/Terminal/_components/panels/CollectionStatsPanel.vue';
import { recentItems, statusIs } from '@/views/Terminal/_components/panels/collectionStats.js';

export default {
  name: 'SkillsPanel',
  components: { CollectionStatsPanel },
  props: {
    allSkills: { type: Array, default: () => [] },
    selectedSkill: { type: Object, default: null },
  },
  emits: ['panel-action'],
  setup() {
    const store = useStore();
    const skills = computed(() => store.getters['skills/allSkills'] || []);
    const discovered = computed(() => store.getters['skills/discoveredSkills'] || []);
    const stats = computed(() => {
      const builtin = skills.value.filter((s) => s.is_builtin).length;
      const fromPlugins = skills.value.filter((s) => s.source_plugin).length;
      return [
        { label: 'Skills', value: skills.value.length },
        { label: 'Yours', value: skills.value.length - builtin - fromPlugins },
        { label: 'From plugins', value: fromPlugins },
        { label: 'Found on disk', value: discovered.value.length },
      ];
    });
    const lists = computed(() => [
      {
        title: 'Recently updated',
        items: recentItems(skills.value, { date: (s) => s.updated_at || s.created_at, label: (s) => s.name, icon: (s) => s.icon }),
      },
    ]);
    return { stats, lists };
  },
};
</script>
