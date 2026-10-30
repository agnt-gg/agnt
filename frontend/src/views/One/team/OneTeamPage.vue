<template>
  <div class="ot" data-testid="one-team-page">
    <div v-if="state.error && !state.team" class="ot-scroll"><div class="ot-page"><p class="ot-error">{{ state.error }}</p><button type="button" class="focused-btn" @click="reload">Try again</button></div></div>
    <div v-else-if="!state.loaded" class="ot-scroll"><div class="ot-page"><p class="ot-muted">Loading your team…</p></div></div>
    <TeamInbox v-else-if="location.view === 'inbox'" />
    <TeamMyTasks v-else-if="location.view === 'mine' && state.team" />
    <TeamSpaceView v-else-if="location.view === 'space' && space" :key="space.id" :team="state.team" :space="space" :location="location" />
    <TeamDocPage v-else-if="location.view === 'doc' && space && location.doc" :key="location.doc" :workspace-id="space.id" :doc-id="location.doc" :space-name="space.name" @back="go({ view: 'space', space: space.id, tab: 'docs' })" />
    <div v-else-if="['space', 'doc'].includes(location.view)" class="ot-scroll">
      <div class="ot-page"><p class="ot-error">That teamspace is not available to you. It may have been archived, or your access was changed.</p><button type="button" class="focused-btn" @click="go({ view: 'home' })">Go home</button></div>
    </div>
    <TeamHome v-else />
  </div>
</template>

<script setup>
import { computed, provide, inject } from 'vue';
import { useStore } from 'vuex';
import { useTeam, teamApi } from './useTeam.js';
import { openTeam } from '@/composables/useSpaces.js';
import TeamHome from './TeamHome.vue';
import TeamInbox from './TeamInbox.vue';
import TeamMyTasks from './TeamMyTasks.vue';
import TeamSpaceView from './TeamSpaceView.vue';
import TeamDocPage from './TeamDocPage.vue';
import '@/views/_components/team/team.css';
import './team.css';

const props = defineProps({ location: { type: Object, required: true } });
const store = useStore();
const nav = inject('focusedNav');
const team = useTeam(store);
const state = team.state;

const space = computed(() => state.spaces.find((s) => s.id === props.location.space) || null);
const role = computed(() => state.team?.role || null);

function go(loc) { nav.go({ page: 'team', ...loc }); }
async function openTeamIn(target, projectId = null) {
  try { if (!(await openTeam(target, projectId))) nav.toast('This team has no instance address yet.'); } catch (e) { nav.toast(e.message); }
}
/** An inbox row opens what it is about, and is marked read on the way. */
async function openInbox(item) {
  if (!item.read) {
    team.markLocalRead([item.id]);
    teamApi.markRead(item.id).catch((e) => console.warn('[team] mark read:', e.message));
  }
  const target = item.target;
  if (target?.kind === 'task' && item.workspaceId) go({ view: 'space', space: item.workspaceId, tab: 'board', task: target.id });
  else if (target?.kind === 'message' && item.workspaceId) go({ view: 'space', space: item.workspaceId, tab: 'chat' });
  else if (item.workspaceId) go({ view: 'space', space: item.workspaceId });
}
const reload = () => team.reload();

provide('teamCtx', {
  team: computed(() => state.team),
  teams: computed(() => state.teams),
  spaces: computed(() => state.spaces),
  inbox: computed(() => state.inbox),
  people: computed(() => state.members),
  me: computed(() => state.me),
  role,
  canWrite: computed(() => ['owner', 'admin', 'member'].includes(role.value)),
  version: computed(() => state.version),
  lastSignal: computed(() => state.lastSignal),
  unread: team.unread,
  markLocalRead: team.markLocalRead,
  reload,
  go,
  openInbox,
  openTeam: openTeamIn,
  ask: (text) => nav.ask(text),
  openPage: (id) => nav.go({ page: id }),
  openLibrary: (tab, item) => nav.go({ page: 'library', tab, item }),
  teamSettings: () => nav.go({ page: 'settings', section: 'members' }),
  toast: (text) => nav.toast(text),
  confirm: (options) => nav.confirm(options),
  prompt: (options) => nav.prompt(options),
});
</script>
