<template>
  <!-- "Visible to": one control for every item that can live in a teamspace (cards, agents,
       routines, and personal items going to a team). The caller decides what a choice does
       (move, make private, copy); this only reports it. Controlled: until the caller
       updates modelValue, a cancelled or failed change shows where the item still is. -->
  <CustomSelect
    class="visible-to-select"
    data-testid="visible-to"
    :model-value="modelValue"
    :options="options"
    :disabled="disabled"
    aria-label="Visible to"
    @update:model-value="pick"
  />
</template>

<script setup>
import CustomSelect from '@/views/_components/common/CustomSelect.vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
  options: { type: Array, required: true },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['change']);
const pick = (value) => {
  if (value && value !== props.modelValue) emit('change', value);
};
</script>
