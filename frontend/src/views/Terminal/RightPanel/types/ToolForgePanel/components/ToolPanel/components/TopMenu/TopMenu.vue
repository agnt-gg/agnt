<template>
  <tool-menu>
    <ToolSelector :tools="tools" :selectedTool="selectedTool" @update:selectedTool="updateSelectedTool" />
    <ToolActions @update:selectedTool="updateSelectedTool" />
  </tool-menu>
</template>

<script>
import ToolSelector from './components/ToolSelect/ToolSelector.vue';
import ToolActions from './components/ToolActions/ToolActions.vue';
import { useTopMenu } from './useTopMenu';
import { onMounted, watch } from 'vue';

export default {
  name: 'TopMenu',
  components: {
    ToolSelector,
    ToolActions,
  },
  props: {
    selectedTool: {
      type: Object,
      default: null,
    },
    formData: {
      type: Object,
      required: true,
    },
  },
  emits: ['tool-selected'],
  setup(props, { emit }) {
    const { tools, loadTools, updateSelectedTool } = useTopMenu(props, emit);

    // Load tools initially
    onMounted(() => {
      loadTools();
    });

    // Watch for changes in the selectedTool prop
    watch(
      () => props.selectedTool,
      (newTool) => {
        if (newTool) {
          updateSelectedTool(newTool);
        }
      }
    );

    return {
      tools,
      updateSelectedTool,
    };
  },
};
</script>

<style scoped>
tool-menu {
  position: relative;
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 16px;
  padding: 0 0 16px;
  width: 100%;
  width: -webkit-fill-available;
  background: transparent;
  border-bottom: 1px solid var(--terminal-border-color);
}
body.dark tool-menu {
  border-bottom: 1px solid var(--terminal-border-color);
}
</style>
