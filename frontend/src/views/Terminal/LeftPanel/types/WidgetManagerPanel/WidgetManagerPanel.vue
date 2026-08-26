<template>
  <CategoryNavPanel
    root-class="widget-manager-panel"
    title="/ Widgets"
    icon="fas fa-puzzle-piece"
    all-option-label="All Widgets"
    :items="allWidgetItems"
    :categories="widgetCategories"
    :main-categories="mainWidgetCategories"
    :main-category-uses-code="true"
    @panel-action="(...args) => $emit('panel-action', ...args)"
  />
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';
import CategoryNavPanel from '@/views/Terminal/_components/panels/CategoryNavPanel.vue';
import { capitalizedMainCategories, uniqueCategories } from '@/views/Terminal/_components/panels/categoryDerivations.js';
import { getAllWidgets } from '@/canvas/widgetRegistry.js';

export default {
  name: 'WidgetManagerPanel',
  components: { CategoryNavPanel },
  emits: ['panel-action'],
  setup() {
    const store = useStore();
    const customDefinitions = computed(() => store.getters['widgetDefinitions/allDefinitions'] || []);

    // Registry widgets plus the user's saved definitions.
    const allWidgetItems = computed(() => {
      const builtIn = getAllWidgets()
        .filter((w) => !w.isCustomWidget)
        .map((w) => ({ ...w, category: w.category || 'other' }));

      const custom = customDefinitions.value.map((d) => ({
        id: d.id,
        name: d.name,
        category: 'custom',
      }));

      return [...builtIn, ...custom];
    });

    const widgetCategories = computed(() => uniqueCategories(allWidgetItems.value));
    const mainWidgetCategories = computed(() => capitalizedMainCategories(widgetCategories.value));

    return { allWidgetItems, widgetCategories, mainWidgetCategories };
  },
};
</script>
