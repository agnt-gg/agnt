<template>
  <CategoryNavPanel
    root-class="workflows-panel"
    title="/ Workflows"
    icon="fas fa-sitemap"
    all-option-label="All Workflows"
    :items="allWorkflows"
    :categories="categories"
    :main-categories="mainWorkflowCategories"
    @panel-action="(...args) => $emit('panel-action', ...args)"
  />
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';
import CategoryNavPanel from '@/views/Terminal/_components/panels/CategoryNavPanel.vue';
import { dottedMainCategories } from '@/views/Terminal/_components/panels/categoryDerivations.js';

export default {
  name: 'WorkflowsPanel',
  components: { CategoryNavPanel },
  props: {
    allWorkflows: { type: Array, default: () => [] },
    workflowsFilteredByTab: { type: Array, default: () => [] },
    activeTab: { type: String, default: 'all' },
    selectedWorkflowId: { type: String, default: null },
  },
  emits: ['panel-action'],
  setup() {
    const store = useStore();
    const categories = computed(() => store.getters['workflows/workflowCategories'] || []);
    // Read Vuex rather than the prop of the same name: the panel must render
    // before the centre screen has hydrated.
    const allWorkflows = computed(() => store.getters['workflows/allWorkflows'] || []);
    const mainWorkflowCategories = computed(() => dottedMainCategories(categories.value));
    return { categories, allWorkflows, mainWorkflowCategories };
  },
};
</script>
