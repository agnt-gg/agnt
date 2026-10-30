<template>
  <!-- eslint-disable-next-line vue/no-v-html -- static icons from mkIcons.js, never user data -->
  <svg class="i" :class="size" viewBox="0 0 24 24" aria-hidden="true" v-html="MK_ICONS[name] || ''"></svg>
</template>

<script setup>
import { MK_ICONS } from './mkIcons.js';
defineProps({ name: { type: String, required: true }, size: { type: String, default: '' } });
</script>
