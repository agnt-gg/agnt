<template>
  <textarea ref="el" :value="modelValue" rows="3" @input="onInput"></textarea>
</template>

<script setup>
// A textarea that grows with its text, so a long prompt or document reads as
// a page instead of a scrolling box inside a scrolling page.
import { ref, watch, nextTick, onMounted } from 'vue';

const props = defineProps({ modelValue: { type: String, default: '' } });
const emit = defineEmits(['update:modelValue']);
const el = ref(null);

function grow() {
  const t = el.value;
  if (!t) return;
  t.style.height = 'auto';
  t.style.height = `${t.scrollHeight + 2}px`;
}
function onInput(e) {
  emit('update:modelValue', e.target.value);
  grow();
}
onMounted(grow);
watch(
  () => props.modelValue,
  () => nextTick(grow),
);
</script>
