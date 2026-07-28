<template>
  <div class="form-field">
    <label v-if="label" :for="id">{{ label }}</label>
    <CustomSelect
      ref="customSelect"
      :options="formattedOptions"
      :model-value="modelValue"
      :disabled="disabled"
      :placeholder="placeholder || 'Select an option'"
      :maxHeight="maxHeight"
      :zIndex="zIndex"
      @update:model-value="$emit('update:modelValue', $event)"
      :class="['base-select-wrapper', selectClass]"
    />
  </div>
</template>

<script>
import CustomSelect from '@/views/_components/common/CustomSelect.vue';

export default {
  name: 'BaseSelect',
  components: {
    CustomSelect,
  },
  props: {
    modelValue: [String, Number],
    label: String,
    id: String,
    options: {
      type: Array,
      required: true, // [{ value, label }]
    },
    selectClass: String,
    disabled: Boolean,
    placeholder: String,
    maxHeight: {
      type: String,
      default: '300px',
    },
    zIndex: {
      type: [Number, String],
      default: 9999,
    },
  },
  emits: ['update:modelValue'],
  computed: {
    formattedOptions() {
      // Convert BaseSelect format {value, label} to CustomSelect format {label, value}
      return this.options.map((option) => ({
        label: option.label,
        value: option.value,
        disabled: option.disabled || false,
        class: option.class || '',
      }));
    },
  },
  // No mounted/watch sync: CustomSelect derives its display from modelValue, so
  // the mirror this component used to maintain can only ever be a source of
  // drift and a one-frame placeholder flash.
};
</script>
