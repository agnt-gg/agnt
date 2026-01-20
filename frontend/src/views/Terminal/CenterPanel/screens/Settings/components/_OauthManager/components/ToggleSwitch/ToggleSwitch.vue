<template>
  <label class="toggle-switch">
    <input
      type="checkbox"
      :checked="modelValue"
      @change="$emit('update:modelValue', $event.target.checked)"
    />
    <span class="slider"></span>
  </label>
</template>

<script setup>
defineProps({
  modelValue: {
    type: Boolean,
    required: true,
  },
});

defineEmits(["update:modelValue"]);
</script>

<style scoped>
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 2rem;
  height: 1.25rem;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  transition: 0.4s;
  border-radius: 1.25rem;
}

.slider:before {
  position: absolute;
  content: "";
  height: 1rem;
  width: 1rem;
  left: 0.125rem;
  bottom: 0.125rem;
  background-color: var(--color-dull-white);
  transition: 0.4s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: var(--color-pink);
}

input:focus + .slider {
  box-shadow: 0 0 1px var(--color-dull-white);
}

input:checked + .slider:before {
  transform: translateX(0.75rem);
}
</style>
