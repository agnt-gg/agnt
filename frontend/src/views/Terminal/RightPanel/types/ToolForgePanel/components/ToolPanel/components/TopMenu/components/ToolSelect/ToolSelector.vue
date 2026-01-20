<template>
  <CustomSelect
    ref="customSelect"
    :options="templateOptions"
    :placeholder="placeholder"
    @option-selected="handleOptionSelected"
  />
</template>

<script>
import { defineComponent } from "vue";
import CustomSelect from "@/views/_components/common/CustomSelect.vue";
import { useToolSelector } from "./useToolSelector";

export default defineComponent({
  name: "ToolSelector",
  components: {
    CustomSelect,
  },
  props: {
    tools: {
      type: Array,
      required: true,
    },
    selectedTool: {
      type: Object,
      default: null,
    },
    placeholder: {
      type: String,
      default: "Select Template or Create New",
    },
  },
  emits: ["update:selectedTool"],
  setup(props, { emit }) {
    const { customSelect, templateOptions, handleOptionSelected } =
      useToolSelector(props, emit);

    return {
      customSelect,
      templateOptions,
      handleOptionSelected,
    };
  },
});
</script>