<template>
  <SharedModelSelector
    :provider="provider"
    :model="model"
    @update:provider="$emit('update:provider', $event)"
    @update:model="$emit('update:model', $event)"
  />
</template>

<script>
import SharedModelSelector from "@/views/_components/feature/ModelSelector.vue";

export default {
  name: "ToolForgeModelSelector",
  components: {
    SharedModelSelector,
  },
  props: {
    provider: {
      type: String,
      default: "",
    },
    model: {
      type: String,
      default: "",
    },
  },
  emits: ["update:provider", "update:model"],
};
</script>
