<template>
  <span v-if="who?.kind === 'agent'" v-tooltip="label || 'Agent'" class="av agent" :class="sizeClass"><img src="/images/agnt-logo-mark.svg" alt="" /></span>
  <span v-else-if="who?.kind === 'system'" v-tooltip="'AGNT'" class="av is-system" :class="sizeClass"><i class="fas fa-info" aria-hidden="true"></i></span>
  <span v-else v-tooltip="label" class="av" :class="sizeClass">{{ initials(label) }}</span>
</template>

<script setup>
import { computed } from 'vue';
import { initials } from './teamModel.js';

const props = defineProps({
  who: { type: Object, default: null }, // { kind: 'person' | 'agent' | 'system', id }
  label: { type: String, default: '' },
  size: { type: String, default: '' }, // '', 'sm', 'lg'
});
const sizeClass = computed(() => (props.size ? 'is-' + props.size : ''));
</script>
