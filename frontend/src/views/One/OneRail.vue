<template>
  <nav class="one-rail" aria-label="AGNT One">
    <!-- The rail: icons only (oneModel railItems). An item with a `menu`
         (More) opens it beside the rail. Settings is pinned to the bottom. -->
    <img class="one-rail-mark" src="/images/agnt-logo-mark.svg" alt="AGNT" />
    <div v-for="item in items" :key="item.id" class="one-rail-slot">
      <button
        type="button"
        class="one-rail-btn"
        :class="{ 'is-active': item.active, 'is-open': (item.open || openMenu === item.id) && !item.active }"
        :data-testid="`one-rail-${item.id}`"
        :aria-label="item.label"
        :aria-pressed="item.active ? 'true' : 'false'"
        :aria-haspopup="item.menu ? 'menu' : undefined"
        :aria-expanded="item.menu ? String(openMenu === item.id) : item.open === undefined ? undefined : item.open ? 'true' : 'false'"
        v-tooltip="openMenu === item.id ? '' : item.label"
        @click="press(item)"
      >
        <!-- eslint-disable-next-line vue/no-v-html -- static icons from oneModel.js, never user data -->
        <svg class="one-rail-icon" viewBox="0 0 24 24" aria-hidden="true" v-html="item.icon"></svg>
        <span v-if="item.badge" class="one-rail-badge" :aria-label="`${item.badge} unread`">{{ item.badge }}</span>
      </button>
      <div v-if="item.menu && openMenu === item.id" class="one-rail-menu" role="menu" :data-testid="`one-rail-menu-${item.id}`">
        <button
          v-for="entry in item.menu"
          :key="entry.id"
          type="button"
          role="menuitem"
          class="one-rail-menu-item"
          :class="{ 'is-active': entry.active, 'is-separated': entry.separated }"
          :data-testid="`one-rail-${entry.id}`"
          @click="choose(entry.id)"
        >
          <!-- eslint-disable-next-line vue/no-v-html -- static icons from oneModel.js -->
          <svg class="one-rail-icon" viewBox="0 0 24 24" aria-hidden="true" v-html="entry.icon"></svg>
          {{ entry.label }}<kbd v-if="entry.hint" class="one-rail-menu-kbd">{{ entry.hint }}</kbd>
        </button>
      </div>
    </div>
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
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { RAIL_ICONS } from './oneModel.js';

defineProps({
  items: { type: Array, required: true },
  settingsActive: { type: Boolean, default: false },
});
const emit = defineEmits(['select']);

const openMenu = ref(null);
function press(item) {
  if (item.menu) {
    openMenu.value = openMenu.value === item.id ? null : item.id;
    return;
  }
  openMenu.value = null;
  emit('select', item.id);
}
function choose(id) {
  openMenu.value = null;
  emit('select', id);
}
// A click anywhere else, or Escape, closes the menu.
function onDocDown(event) {
  if (openMenu.value && !event.target.closest?.('.one-rail-slot')) openMenu.value = null;
}
function onKey(event) {
  if (event.key === 'Escape') openMenu.value = null;
}
onMounted(() => {
  document.addEventListener('mousedown', onDocDown);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown);
  document.removeEventListener('keydown', onKey);
});
</script>
