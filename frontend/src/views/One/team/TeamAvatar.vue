<template>
  <span v-if="who?.kind === 'agent'" v-tooltip="label || 'Agent'" class="av agent" :class="size"><img src="/images/agnt-logo-mark.svg" alt="" /></span>
  <span v-else-if="who?.kind === 'system'" v-tooltip="'AGNT'" class="av is-system" :class="size"><i class="fas fa-info" aria-hidden="true"></i></span>
  <span v-else v-tooltip="label" class="av" :class="size" :style="{ background: avatarHue(who?.id || label) }">{{ initials(label) }}</span>
</template>

<script setup>
import { initials, avatarHue } from './teamModel.js';

// The size is the mockup's class itself ('sm' | 'lg' | 'xl'): mk.css styles .av.sm/.av.lg.
// A person gets their own colour, as in the mockup; without one the initials were white on white.
defineProps({
  who: { type: Object, default: null }, // { kind: 'person' | 'agent' | 'system', id }
  label: { type: String, default: '' },
  size: { type: String, default: '' },
});
</script>
