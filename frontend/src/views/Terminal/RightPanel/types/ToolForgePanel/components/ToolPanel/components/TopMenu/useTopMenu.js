import { ref, inject, provide } from 'vue';
import { fetchTools } from './components/ToolActions/toolActionsApi';

export function useTopMenu(props, emit) {
  const tools = ref([]);
  const fetchTemplates = inject("toolActions").fetchTemplates;
  const isLoading = ref(false);

  async function loadTools() {
    if (isLoading.value) return;
    isLoading.value = true;
    try {
      const fetchedTools = await fetchTools();
      tools.value = fetchedTools;
    } catch (error) {
      console.error("Error loading tools:", error);
    } finally {
      isLoading.value = false;
    }
  }

  function updateSelectedTool(tool) {
    emit('tool-selected', tool);
  }

  function updateTools(newTools) {
    tools.value = newTools;
  }

  // Provide a function to emit tool changes
  provide('emitToolChange', loadTools);

  return {
    tools,
    loadTools,
    updateSelectedTool,
    updateTools,
  };
}