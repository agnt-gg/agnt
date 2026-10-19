<template>
  <nav class="one-rail" aria-label="AGNT One">
    <!-- The rail: icons only, and only for things the account has (oneModel
         railItems). Settings is pinned to the bottom. -->
    <img class="one-rail-mark" src="/images/agnt-logo-mark.svg" alt="AGNT" />
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="one-rail-btn"
      :class="{ 'is-active': item.active }"
      :data-testid="`one-rail-${item.id}`"
      :aria-label="item.label"
      :aria-pressed="item.active ? 'true' : 'false'"
      v-tooltip="item.label"
      @click="$emit('select', item.id)"
    >
      <!-- eslint-disable-next-line vue/no-v-html -- static icons from oneModel.js, never user data -->
      <svg class="one-rail-icon" viewBox="0 0 24 24" aria-hidden="true" v-html="item.icon"></svg>
    </button>
    <span class="one-rail-fill"></span>
    <button
      type="button"
      class="one-rail-btn"
      :class="{ 'is-active': settingsActive }"
      data-testid="one-rail-settings"
      aria-label="Settings"
      :aria-pressed="settingsActive ? 'true' : 'false'"
      v-tooltip="'Settings'"
      @click="$emit('select', 'settings')"
    >
      <!-- eslint-disable-next-line vue/no-v-html -- static icon from oneModel.js -->
      <svg class="one-rail-icon" viewBox="0 0 24 24" aria-hidden="true" v-html="RAIL_ICONS.settings"></svg>
    </button>
  </nav>
</template>

<script setup>
import { RAIL_ICONS } from './oneModel.js';

defineProps({
  items: { type: Array, required: true },
  settingsActive: { type: Boolean, default: false },
});
defineEmits(['select']);
</script>
