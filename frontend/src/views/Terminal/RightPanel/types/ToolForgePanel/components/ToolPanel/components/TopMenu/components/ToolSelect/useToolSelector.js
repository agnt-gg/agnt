import { ref, computed, watch } from 'vue';

export function useToolSelector(props, emit) {
  const customSelect = ref(null);
  const internalSelectedTool = ref(props.selectedTool);

  const templateOptions = computed(() => {
    const createNewOption = { 
      label: "Create New Tool", 
      value: "create-new", 
      highlight: true,
      class: 'create-new-option'
    };

    const sortedTools = [...props.tools].sort((a, b) => 
      a.title.localeCompare(b.title)
    );

    const toolOptions = sortedTools.map((tool) => ({
      label: tool.title,
      value: tool.id,
    }));

    return [createNewOption, ...toolOptions];
  });

  const handleOptionSelected = (option) => {
    if (option && option.value === "create-new") {
      internalSelectedTool.value = { id: "create-new", title: "" };
    } else if (option) {
      internalSelectedTool.value = props.tools.find((t) => t.id === option.value);
    } else {
      internalSelectedTool.value = null;
    }
    emit("update:selectedTool", internalSelectedTool.value);
  };

  watch(() => props.selectedTool, (newTool) => {
    if (newTool !== internalSelectedTool.value) {
      internalSelectedTool.value = newTool;
      if (customSelect.value && customSelect.value.setSelectedOption) {
        const option = newTool ? templateOptions.value.find(opt => opt.value === newTool.id) : null;
        customSelect.value.setSelectedOption(option);
      }
    }
  }, { immediate: true });

  watch(internalSelectedTool, (newTool) => {
    if (newTool !== props.selectedTool) {
      emit("update:selectedTool", newTool);
    }
  });

  return {
    customSelect,
    templateOptions,
    handleOptionSelected,
  };
}