<template>
  <!-- The rail: Home (the inbox, with its badge), Chats, Goals (one-off and
       repeating), Library and Apps, each with its name under the icon; Settings
       and your account menu at the bottom. -->
  <div class="mk mk-rail-host">
    <nav class="rail rail-v2" aria-label="AGNT">
      <div v-for="item in ITEMS" :key="item.id" class="rail-slot">
        <button
          type="button"
          class="rail-btn"
          :class="{ 'is-active': active === item.id }"
          :data-testid="`one-rail-${item.id}`"
          :aria-label="item.label"
          :aria-current="active === item.id ? 'page' : null"
          @click="$emit('select', item.id)"
        >
          <MkIcon :name="item.icon" />
          <span class="rail-label">{{ item.label }}</span>
          <span v-if="item.id === 'home' && badge" class="rail-badge" :aria-label="`${badge} need you`">{{ badge > 99 ? '99+' : badge }}</span>
        </button>
      </div>
      <span class="rail-fill"></span>
      <!-- While an offer runs: opens and closes its corner card (OneOffer). -->
      <button v-if="offer" type="button" class="rail-btn rail-offer" data-testid="one-rail-offer" :aria-label="offer" v-tooltip="offer" @click="$emit('offer')"><MkIcon name="gift" /><span class="rail-dot" aria-hidden="true"></span></button>
      <button type="button" class="rail-btn" :class="{ 'is-active': active === 'settings' }" data-testid="one-rail-settings" aria-label="Settings" :aria-current="active === 'settings' ? 'page' : null" @click="$emit('select', 'settings')">
        <MkIcon name="settings" /><span class="rail-label">Settings</span>
      </button>
      <div ref="meRef" class="rail-slot">
        <button
          type="button"
          class="rail-btn rail-me-btn"
          :class="{ 'is-active': active === 'me' || menuOpen }"
          data-testid="one-rail-me"
          :aria-label="`${userName || 'You'}: account menu`"
          aria-haspopup="menu"
          :aria-expanded="String(menuOpen)"
          @click="menuOpen = !menuOpen"
        >
          <span class="av rail-me">{{ initials }}</span>
        </button>
        <div v-if="menuOpen" class="rail-menu rail-menu-up" role="menu" data-testid="one-rail-menu-account">
          <div class="rail-menu-who"><span class="av rail-me">{{ initials }}</span><span class="rail-menu-name">{{ userName || 'You' }}</span></div>
          <button v-for="m in ACCOUNT" :key="m.id" type="button" role="menuitem" class="menu-item" :class="{ sep: m.sep, 'is-active': activeMore === m.id }" :data-testid="`one-rail-${m.id}`" @click="choose(m.id)">
            <MkIcon :name="m.icon" />{{ m.label }}<kbd v-if="m.hint">{{ m.hint }}</kbd>
          </button>
        </div>
      </div>
      <!-- With the sidebar collapsed, the way back sits at the foot, as in Studio's sidebar. -->
      <button v-if="collapsed" type="button" class="rail-btn rail-expand" data-testid="one-rail-expand" aria-label="Expand sidebar" v-tooltip="'Expand sidebar'" @click="$emit('expand')"><i class="fas fa-angle-double-right" aria-hidden="true"></i></button>
    </nav>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import MkIcon from './MkIcon.vue';

const ITEMS = Object.freeze([
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'chats', label: 'Chats', icon: 'chats' },
  { id: 'goals', label: 'Goals', icon: 'task' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'apps', label: 'Apps', icon: 'plug' },
]);
// Your account menu: everything that is about you or the team rather than a page of work.
const ACCOUNT = Object.freeze([
  { id: 'account', label: 'Your account', icon: 'lock' },
  { id: 'members', label: 'Members', icon: 'users' },
  { id: 'wrapped', label: 'Year in review', icon: 'spark' },
  { id: 'find', label: 'Find anything', icon: 'find', hint: 'Ctrl K', sep: true },
  // Studio: custom pages, every forge, the canvas and Navigation settings (services/uiMode.js).
  { id: 'studio', label: 'Switch to Studio', icon: 'template', hint: 'Ctrl Shift S' },
]);
const props = defineProps({
  active: { type: String, default: null },
  /** The account menu entry that is the page on screen (Members). */
  activeMore: { type: String, default: null },
  badge: { type: Number, default: 0 },
  userName: { type: String, default: '' },
  collapsed: { type: Boolean, default: false },
  /** The running offer's button label; empty while there is none. */
  offer: { type: String, default: '' },
});
const emit = defineEmits(['select', 'expand', 'offer']);
const menuOpen = ref(false);
const meRef = ref(null);
const initials = computed(() => {
  const words = String(props.userName || '').trim().split(/[\s@._-]+/).filter(Boolean);
  return ((words[0]?.[0] || '?') + (words[1]?.[0] || '')).toUpperCase();
});
function choose(id) {
  menuOpen.value = false;
  emit('select', id);
}
const onDown = (e) => { if (menuOpen.value && !meRef.value?.contains(e.target)) menuOpen.value = false; };
const onKey = (e) => { if (e.key === 'Escape') menuOpen.value = false; };
onMounted(() => { document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey); });
onBeforeUnmount(() => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); });
</script>

<style scoped>
.rail-expand { margin-top: 6px; }
.rail-expand i { font-size: 14px; }
</style>
