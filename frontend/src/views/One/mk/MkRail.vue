<template>
  <!-- The rail: Home (also the inbox, with its badge), Chats, Routines, Library
       (agents, workflows, tools, skills, widgets), Apps (plugins, connectors),
       More; Settings and you at the bottom. -->
  <div class="mk mk-rail-host">
    <nav class="rail" aria-label="AGNT">
      <img class="rail-mark" src="/images/agnt-logo-mark.svg" alt="AGNT" />
      <div v-for="item in ITEMS" :key="item.id" class="rail-slot">
        <button
          type="button"
          class="rail-btn"
          :class="{ 'is-active': active === item.id }"
          :data-testid="`one-rail-${item.id}`"
          :aria-label="item.label"
          v-tooltip="item.label"
          @click="$emit('select', item.id)"
        >
          <MkIcon :name="item.icon" />
          <span v-if="item.id === 'home' && badge" class="rail-badge">{{ badge > 99 ? '99+' : badge }}</span>
        </button>
      </div>
      <div ref="moreRef" class="rail-slot">
        <button type="button" class="rail-btn" :class="{ 'is-active': active === 'more' || menuOpen }" data-testid="one-rail-more" aria-label="More" :aria-expanded="String(menuOpen)" v-tooltip="menuOpen ? '' : 'More'" @click="menuOpen = !menuOpen">
          <MkIcon name="more" />
        </button>
        <div v-if="menuOpen" class="rail-menu" role="menu" data-testid="one-rail-menu-more">
          <button v-for="m in MORE" :key="m.id" type="button" role="menuitem" class="menu-item" :class="{ sep: m.sep, 'is-active': activeMore === m.id }" :data-testid="`one-rail-${m.id}`" @click="choose(m.id)">
            <MkIcon :name="m.icon" />{{ m.label }}<kbd v-if="m.hint">{{ m.hint }}</kbd>
          </button>
        </div>
      </div>
      <span class="rail-fill"></span>
      <button type="button" class="rail-btn" :class="{ 'is-active': active === 'settings' }" data-testid="one-rail-settings" aria-label="Settings" v-tooltip="'Settings'" @click="$emit('select', 'settings')"><MkIcon name="settings" /></button>
      <button type="button" class="rail-btn" data-testid="one-rail-me" :aria-label="userName || 'You'" v-tooltip="userName || 'You'" @click="$emit('select', 'members')">
        <span class="av rail-me" :style="{ background: 'var(--color-pink)' }">{{ initials }}</span>
      </button>
    </nav>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import MkIcon from './MkIcon.vue';

const ITEMS = Object.freeze([
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'chats', label: 'Chats with Annie', icon: 'chats' },
  { id: 'routines', label: 'Routines', icon: 'routines' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'apps', label: 'Apps', icon: 'plug' },
]);
const MORE = Object.freeze([
  { id: 'activity', label: 'Activity', icon: 'activity' },
  { id: 'memory', label: 'Memories', icon: 'doc' },
  { id: 'dashboard', label: 'Dashboard', icon: 'board' },
  { id: 'goals', label: 'Goals', icon: 'task' },
  { id: 'members', label: 'Members', icon: 'users' },
  { id: 'approvals', label: 'Approvals', icon: 'approvals' },
  { id: 'find', label: 'Find anything', icon: 'find', hint: 'Ctrl K', sep: true },
  // Studio: custom pages, every forge, the canvas and Navigation settings (services/uiMode.js).
  { id: 'studio', label: 'Switch to Studio', icon: 'template', hint: 'Ctrl Shift S' },
]);
const props = defineProps({ active: { type: String, default: null }, activeMore: { type: String, default: null }, badge: { type: Number, default: 0 }, userName: { type: String, default: '' } });
const emit = defineEmits(['select']);
const menuOpen = ref(false);
const moreRef = ref(null);
const initials = computed(() => {
  const words = String(props.userName || '').trim().split(/[\s@._-]+/).filter(Boolean);
  return ((words[0]?.[0] || '?') + (words[1]?.[0] || '')).toUpperCase();
});
function choose(id) {
  menuOpen.value = false;
  emit('select', id);
}
const onDown = (e) => { if (menuOpen.value && !moreRef.value?.contains(e.target)) menuOpen.value = false; };
const onKey = (e) => { if (e.key === 'Escape') menuOpen.value = false; };
onMounted(() => { document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey); });
onBeforeUnmount(() => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); });
</script>
