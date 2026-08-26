<template>
  <CategoryNavPanel
    root-class="tools-panel"
    title="/ Tools"
    icon="fas fa-tools"
    all-option-label="All Tools"
    :items="allTools"
    :categories="toolCategories"
    :main-categories="mainToolCategories"
    @panel-action="(...args) => $emit('panel-action', ...args)"
  />
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';
import CategoryNavPanel from '@/views/Terminal/_components/panels/CategoryNavPanel.vue';
import { uniqueCategories, verbatimMainCategories } from '@/views/Terminal/_components/panels/categoryDerivations.js';

export default {
  name: 'ToolsPanel',
  components: { CategoryNavPanel },
  props: {
    allAvailableTools: { type: Array, default: () => [] },
    activeTab: { type: String, default: 'all' },
    selectedTool: { type: Object, default: null },
  },
  emits: ['panel-action'],
  setup() {
    const store = useStore();

    // The full tool list is assembled from BOTH stores, mirroring the centre
    // screen's own allAvailableTools: workflow/system tools (triggers, actions,
    // utilities, widgets, controls, plus plugins) and saved custom tools.
    const allTools = computed(() => {
      const toolLibrary = store.getters['tools/workflowTools'];
      const systemTools = [];
      if (toolLibrary) {
        const processCategory = (categoryTools, categoryName) => {
          if (!categoryTools) return;
          categoryTools.forEach((tool) => {
            systemTools.push({
              ...tool,
              id: `system-${tool.type}`,
              source: tool.isPlugin ? 'plugin' : 'system',
              category: tool.isPlugin ? 'plugins' : categoryName,
              isPlugin: tool.isPlugin || false,
            });
          });
        };
        processCategory(toolLibrary.triggers, 'triggers');
        processCategory(toolLibrary.actions, 'actions');
        processCategory(toolLibrary.utilities, 'utilities');
        processCategory(toolLibrary.widgets, 'widgets');
        processCategory(toolLibrary.controls, 'controls');
      }

      const storeCustomTools = (store.getters['tools/customTools'] || []).map((tool) => ({
        ...tool,
        title: tool.title || tool.name,
        source: 'custom',
        category: 'custom',
        icon: tool.icon || 'custom',
      }));

      return [...systemTools, ...storeCustomTools];
    });

    // Tool categories are whatever the tools themselves declare — no grouping
    // and no relabelling, because the codes are already display-ready.
    const toolCategories = computed(() => uniqueCategories(allTools.value));
    const mainToolCategories = computed(() => verbatimMainCategories(toolCategories.value));

    return { allTools, toolCategories, mainToolCategories };
  },
};
</script>
