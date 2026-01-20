<template>
  <div class="form-field">
    <label v-if="label" :for="id">{{ label }}</label>
    <textarea
      :id="id"
      v-model="modelValueProxy"
      :placeholder="placeholder"
      :rows="rows"
      :class="['input', textareaClass]"
      :disabled="disabled"
      v-bind="$attrs"
      @input="$emit('update:modelValue', $event.target.value)"
      :style="height ? { height: typeof height === 'number' ? height + 'px' : height } : {}"
    ></textarea>
  </div>
</template>

<script>
export default {
  name: 'BaseTextarea',
  props: {
    modelValue: String,
    label: String,
    id: String,
    placeholder: String,
    rows: {
      type: [String, Number],
      default: 3,
    },
    textareaClass: String,
    disabled: Boolean,
    height: {
      type: [String, Number],
      default: null,
    },
  },
  emits: ['update:modelValue'],
  computed: {
    modelValueProxy: {
      get() {
        return this.modelValue;
      },
      set(val) {
        this.$emit('update:modelValue', val);
      },
    },
  },
};
</script>
