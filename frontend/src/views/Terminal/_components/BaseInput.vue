<template>
  <div class="form-field">
    <label v-if="label" :for="id">{{ label }}</label>
    <input
      :id="id"
      v-model="modelValueProxy"
      :type="type"
      :placeholder="placeholder"
      :min="min"
      :max="max"
      :step="step"
      :class="['input', inputClass]"
      :disabled="disabled"
      @input="$emit('update:modelValue', $event.target.value)"
      v-bind="$attrs"
    />
  </div>
</template>

<script>
export default {
  name: 'BaseInput',
  props: {
    modelValue: [String, Number],
    label: String,
    id: String,
    type: {
      type: String,
      default: 'text',
    },
    placeholder: String,
    min: [String, Number],
    max: [String, Number],
    step: [String, Number],
    inputClass: String,
    disabled: Boolean,
  },
  emits: ['update:modelValue'],
  computed: {
    modelValueProxy: {
      get() {
        return this.modelValue;
      },
      set(val) {
        this.$emit('update:modelValue', this.type === 'number' ? Number(val) : val);
      },
    },
  },
};
</script>
