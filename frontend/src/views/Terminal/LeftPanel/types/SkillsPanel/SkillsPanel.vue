<template>
  <CategoryNavPanel
    root-class="skills-panel"
    title="/ Skills"
    icon="fas fa-brain"
    all-option-label="All Skills"
    :items="allSkills"
    :categories="categories"
    :main-categories="mainSkillCategories"
    @panel-action="(...args) => $emit('panel-action', ...args)"
  />
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';
import CategoryNavPanel from '@/views/Terminal/_components/panels/CategoryNavPanel.vue';
import { capitalizedMainCategories } from '@/views/Terminal/_components/panels/categoryDerivations.js';

export default {
  name: 'SkillsPanel',
  components: { CategoryNavPanel },
  props: {
    allSkills: { type: Array, default: () => [] },
    selectedSkill: { type: Object, default: null },
  },
  emits: ['panel-action'],
  setup() {
    const store = useStore();
    const categories = computed(() => store.getters['skills/skillCategories'] || []);
    const allSkills = computed(() => store.getters['skills/allSkills'] || []);
    const mainSkillCategories = computed(() => capitalizedMainCategories(categories.value));
    return { categories, allSkills, mainSkillCategories };
  },
};
</script>
