<template>
  <!-- The approved mockup's drawer: workspace switcher, search, New…, My Space
       (private), Teamspaces. Every row goes to the real page. -->
  <div class="mk mk-drawer-host">
    <aside class="drawer" aria-label="Spaces">
      <div ref="headRef" class="drawer-head">
        <button type="button" class="ws-btn" data-testid="ot-switcher" :aria-expanded="String(menu === 'ws')" @click="toggle('ws')">
          <span class="ws-tile"><img src="/images/agnt-logo-mark.svg" alt="" /></span>
          <span style="flex: 1; min-width: 0"><div class="ws-name">{{ team ? team.name : 'Personal' }}</div><div class="ws-plan">{{ team ? roleLabel(team.role) + ' · team workspace' : 'Only you' }}</div></span>
          <MkIcon name="down" size="sm" />
        </button>
        <div v-if="menu === 'ws'" class="ws-menu" role="menu">
          <button type="button" class="menu-item" :class="{ 'is-active': !team }" role="menuitem" @click="goPersonal">
            <span class="ws-tile" style="width: 22px; height: 22px"><MkIcon name="lock" size="xs" /></span><span style="flex: 1"><div>Personal</div><div class="ws-plan">Only you</div></span><MkIcon v-if="!team" name="check" size="sm" />
          </button>
          <button v-for="t in teams" :key="t.id" type="button" class="menu-item" :class="{ 'is-active': team?.id === t.id }" role="menuitem" @click="goTeam(t)">
            <span class="ws-tile" style="width: 22px; height: 22px"><img src="/images/agnt-logo-mark.svg" alt="" /></span><span style="flex: 1"><div>{{ t.name }}</div><div class="ws-plan">{{ roleLabel(t.role) }}</div></span><MkIcon v-if="team?.id === t.id" name="check" size="sm" />
          </button>
          <button type="button" class="menu-item sep" role="menuitem" @click="pick('team-settings')"><MkIcon name="plus" size="sm" />Create or join a team</button>
        </div>
      </div>
      <button type="button" class="find-btn" @click="$emit('find')"><MkIcon name="find" size="sm" />Search or ask Annie<kbd>Ctrl K</kbd></button>
      <div class="drawer-scroll">
        <div class="mk-new-anchor">
          <button type="button" class="d-item" style="color: var(--text-primary); font-weight: 500" @click="toggle('new')"><MkIcon name="plus" size="sm" />New…</button>
          <div v-if="menu === 'new'" class="ws-menu" role="menu" style="top: 100%">
            <button type="button" class="menu-item" role="menuitem" @click="pick('new-task')"><MkIcon name="task" size="sm" />Task</button>
            <button type="button" class="menu-item" role="menuitem" @click="pick('new-doc')"><MkIcon name="doc" size="sm" />Doc</button>
            <button type="button" class="menu-item" role="menuitem" @click="pick('new-agent')"><MkIcon name="bot" size="sm" />Agent</button>
            <button type="button" class="menu-item" role="menuitem" @click="pick('new-routine')"><MkIcon name="bolt" size="sm" />Routine</button>
          </div>
        </div>
        <div class="d-head"><MkIcon name="lock" size="xs" /> My Space</div>
        <button v-if="team" type="button" class="d-item" :class="{ 'is-active': active === 'mine-tasks' }" @click="pick('mine-tasks')"><MkIcon name="task" size="sm" />My tasks<span v-if="counts.tasks" class="count">{{ counts.tasks }}</span></button>
        <button type="button" class="d-item" :class="{ 'is-active': active === 'mine-drafts' }" @click="pick('mine-drafts')"><MkIcon name="doc" size="sm" />Drafts<span v-if="counts.drafts" class="count">{{ counts.drafts }}</span></button>
        <button type="button" class="d-item" :class="{ 'is-active': active === 'mine-agents' }" @click="pick('mine-agents')"><MkIcon name="bot" size="sm" />My agents<span v-if="counts.agents" class="count">{{ counts.agents }}</span></button>
        <button type="button" class="d-item" :class="{ 'is-active': active === 'mine-routines' }" @click="pick('mine-routines')"><MkIcon name="bolt" size="sm" />My routines<span v-if="counts.routines" class="count">{{ counts.routines }}</span></button>
        <button type="button" class="d-item" :class="{ 'is-active': active === 'mine-files' }" @click="pick('mine-files')"><MkIcon name="file" size="sm" />My files</button>
        <template v-if="team">
          <div class="d-head" data-tour-id="team-spaces"><MkIcon name="users" size="xs" /> Teamspaces
            <button v-if="team.role === 'owner'" v-tooltip="'New teamspace'" type="button" aria-label="New teamspace" @click="$emit('new-space')"><MkIcon name="plus" size="xs" /></button>
          </div>
          <button v-for="s in spaces" :key="s.id" type="button" class="d-item" :class="{ 'is-active': active === 'space:' + s.id }" @click="$emit('go', { view: 'space', space: s.id })">
            <span style="width: 15px; text-align: center">#</span>{{ s.name }}
          </button>
          <p v-if="!spaces.length" class="d-note">No teamspaces yet.<template v-if="team.role === 'owner'"> Add one with +.</template></p>
        </template>
        <div v-else class="d-note">This is your personal workspace: everything here is private.<template v-if="teams.length"> Teamspaces live in <button type="button" class="link" @click="goTeam(teams[0])">{{ teams[0].name }}</button>.</template><template v-else> <button type="button" class="link" @click="pick('team-settings')">Set up a team</button> to work with others.</template></div>
      </div>
    </aside>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import MkIcon from './MkIcon.vue';
import { roleLabel } from '@/utils/teamClient.js';
import { openTeam, openPersonal } from '@/composables/useSpaces.js';

const props = defineProps({
  team: { type: Object, default: null },
  teams: { type: Array, default: () => [] },
  spaces: { type: Array, default: () => [] },
  active: { type: String, default: null },
  counts: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['go', 'pick', 'find', 'new-space', 'error']);
const menu = ref(null);
const headRef = ref(null);
const toggle = (name) => { menu.value = menu.value === name ? null : name; };
function pick(what) { menu.value = null; emit('pick', what); }
async function goTeam(t) {
  menu.value = null;
  if (t.id === props.team?.id) return;
  try { if (!(await openTeam(t))) emit('error', 'This team has no instance address yet.'); } catch (e) { emit('error', e.message); }
}
async function goPersonal() {
  menu.value = null;
  if (!props.team) return;
  try { if (!(await openPersonal())) emit('error', 'This is the team’s own instance. Open your personal space from the desktop app or your own instance.'); } catch (e) { emit('error', e.message); }
}
const onDown = (e) => { if (menu.value && !e.target.closest?.('.ws-menu, .ws-btn, .mk-new-anchor')) menu.value = null; };
onMounted(() => document.addEventListener('mousedown', onDown));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDown));
</script>
