<template>
  <aside class="ot-drawer" aria-label="Spaces">
    <div class="ot-drawer-head" ref="headRef">
      <button type="button" class="ot-ws-btn" :aria-expanded="String(menuOpen)" data-testid="ot-switcher" @click="menuOpen = !menuOpen">
        <span class="ot-ws-tile"><img src="/images/agnt-logo-mark.svg" alt="" /></span>
        <span style="flex: 1; min-width: 0">
          <div class="ot-ws-name">{{ team ? team.name : 'Personal' }}</div>
          <div class="ot-ws-sub">{{ team ? roleLabel(team.role) : 'Only you' }}</div>
        </span>
        <i class="fas fa-chevron-down" aria-hidden="true" style="font-size: 11px; color: var(--text-tertiary)"></i>
      </button>
      <div v-if="menuOpen" class="ot-menu" role="menu">
        <button type="button" class="ot-menu-item" :class="{ 'is-active': !team }" role="menuitem" @click="goPersonal">
          <span class="ot-ws-tile" style="width: 22px; height: 22px"><i class="fas fa-lock" style="font-size: 10px" aria-hidden="true"></i></span>
          <span style="flex: 1">Personal<div class="ot-ws-sub">Only you</div></span>
          <i v-if="!team" class="fas fa-check" aria-hidden="true"></i>
        </button>
        <button v-for="t in teams" :key="t.id" type="button" class="ot-menu-item" :class="{ 'is-active': team?.id === t.id }" role="menuitem" @click="goTeam(t)">
          <span class="ot-ws-tile" style="width: 22px; height: 22px"><img src="/images/agnt-logo-mark.svg" alt="" /></span>
          <span style="flex: 1">{{ t.name }}<div class="ot-ws-sub">{{ roleLabel(t.role) }}</div></span>
          <i v-if="team?.id === t.id" class="fas fa-check" aria-hidden="true"></i>
        </button>
        <button type="button" class="ot-menu-item is-sep" role="menuitem" @click="openTeamSettings">
          <i class="fas fa-users" aria-hidden="true"></i>Manage teams and invitations
        </button>
      </div>
    </div>
    <button type="button" class="ot-find" @click="$emit('find')"><i class="fas fa-search" aria-hidden="true"></i>Search or ask Annie<kbd>Ctrl K</kbd></button>
    <div class="ot-drawer-scroll">
      <!-- Home is also the inbox: the count is everything waiting on you. -->
      <button type="button" class="ot-d-item" :class="{ 'is-active': is('home') || is('inbox') }" @click="go({ view: 'home' })">
        <i class="fas fa-home" aria-hidden="true"></i>Home<span v-if="unread" class="ot-count">{{ unread }}</span>
      </button>

      <div class="ot-d-head"><i class="fas fa-lock" aria-hidden="true"></i> My Space</div>
      <button v-if="team" type="button" class="ot-d-item" :class="{ 'is-active': is('mine') }" @click="go({ view: 'mine' })"><i class="far fa-check-square" aria-hidden="true"></i>My tasks</button>
      <button type="button" class="ot-d-item" @click="$emit('chats')"><i class="far fa-comment" aria-hidden="true"></i>My chats with Annie</button>
      <button type="button" class="ot-d-item" @click="$emit('files')"><i class="far fa-file-alt" aria-hidden="true"></i>My files</button>

      <template v-if="team">
        <div class="ot-d-head" data-tour-id="team-spaces"><i class="fas fa-users" aria-hidden="true"></i> Teamspaces
          <button v-if="team.role === 'owner'" v-tooltip="'New teamspace'" type="button" aria-label="New teamspace" @click="$emit('new-space')"><i class="fas fa-plus" aria-hidden="true" style="font-size: 10px"></i></button>
        </div>
        <button v-for="s in spaces" :key="s.id" type="button" class="ot-d-item" :class="{ 'is-active': location.space === s.id && ['space', 'doc'].includes(location.view) }" @click="go({ view: 'space', space: s.id })">
          <i class="fas fa-hashtag" aria-hidden="true"></i><span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ s.name }}</span>
        </button>
        <p v-if="!spaces.length" class="ot-d-note">No teamspaces yet.<template v-if="team.role === 'owner'"> Add one with +.</template></p>
      </template>
      <p v-else class="ot-d-note">
        You are in your personal space, private to you.<template v-if="teams.length"> Pick a team above to work with others.</template>
        <template v-else> Teams share chat, boards, docs and agents. <button type="button" class="ot-link" @click="openTeamSettings">Set one up</button>.</template>
      </p>
    </div>
  </aside>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { roleLabel } from '@/utils/teamClient.js';
import { openTeam, openPersonal } from '@/composables/useSpaces.js';

const props = defineProps({
  team: { type: Object, default: null },
  teams: { type: Array, default: () => [] },
  spaces: { type: Array, default: () => [] },
  unread: { type: Number, default: 0 },
  location: { type: Object, required: true },
});
const emit = defineEmits(['go', 'find', 'chats', 'files', 'new-space', 'team-settings', 'error']);

const menuOpen = ref(false);
const headRef = ref(null);
const is = (view) => props.location.view === view;
const go = (loc) => emit('go', loc);

async function goTeam(team) {
  menuOpen.value = false;
  if (team.id === props.team?.id) return;
  try {
    if (!(await openTeam(team))) emit('error', 'This team has no instance address yet.');
  } catch (error) {
    emit('error', error.message);
  }
}
async function goPersonal() {
  menuOpen.value = false;
  if (!props.team) return;
  try {
    if (!(await openPersonal())) emit('error', 'This is the team\u2019s own instance. Open your personal space from the desktop app or your own instance.');
  } catch (error) {
    emit('error', error.message);
  }
}
function openTeamSettings() {
  menuOpen.value = false;
  emit('team-settings');
}
function onDocDown(event) {
  if (menuOpen.value && !headRef.value?.contains(event.target)) menuOpen.value = false;
}
onMounted(() => document.addEventListener('mousedown', onDocDown));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown));
</script>
