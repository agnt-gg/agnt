<template>
  <CategoryNavPanel
    root-class="agents-panel"
    title="/ Agents"
    icon="fas fa-users"
    all-option-label="All Agents"
    :items="allAgents"
    :categories="categories"
    :main-categories="mainAgentCategories"
    @panel-action="(...args) => $emit('panel-action', ...args)"
  />
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';
import CategoryNavPanel from '@/views/Terminal/_components/panels/CategoryNavPanel.vue';
import { dottedMainCategories } from '@/views/Terminal/_components/panels/categoryDerivations.js';

export default {
  name: 'AgentsPanel',
  components: { CategoryNavPanel },
  props: {
    // Passed by the screen via leftPanelProps. The panel reads Vuex directly so
    // its data is available before the centre screen has finished mounting;
    // these stay declared so the props land as props and not as stray attrs.
    allAvailableAgents: { type: Array, default: () => [] },
    activeTab: { type: String, default: 'all' },
    selectedAgent: { type: Object, default: null },
  },
  emits: ['panel-action'],
  setup() {
    const store = useStore();
    const categories = computed(() => store.getters['agents/agentCategories'] || []);
    const allAgents = computed(() => store.getters['agents/allAgents'] || []);
    const mainAgentCategories = computed(() => dottedMainCategories(categories.value));
    return { categories, allAgents, mainAgentCategories };
  },
};
</script>
