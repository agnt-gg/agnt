<template>
  <div class="form-field">
    <label v-if="label" :for="id">{{ label }}</label>
    <CustomSelect
      ref="customSelect"
      :options="formattedOptions"
      :placeholder="placeholder || 'Select an option'"
      :maxHeight="maxHeight"
      :zIndex="zIndex"
      @option-selected="handleOptionSelected"
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
  methods: {
    handleOptionSelected(option) {
      this.$emit('update:modelValue', option.value);
    },
  },
  mounted() {
    // Set initial selected option if modelValue is provided
    this.$nextTick(() => {
      if (this.modelValue) {
        const selectedOption = this.formattedOptions.find((opt) => opt.value === this.modelValue);
        if (selectedOption && this.$refs.customSelect) {
          this.$refs.customSelect.setSelectedOption(selectedOption);
        }
      }
    });
  },
  watch: {
    modelValue(newValue) {
      // Update selected option when modelValue changes externally
      const selectedOption = this.formattedOptions.find((opt) => opt.value === newValue);
      if (selectedOption && this.$refs.customSelect) {
        this.$refs.customSelect.setSelectedOption(selectedOption);
      }
    },
  },
};
</script>
