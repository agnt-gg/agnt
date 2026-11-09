<template>
  <div class="mk mk-page" data-testid="one-team-page">
    <div v-if="state.error && !state.team" class="content"><div class="page"><p class="mk-error">{{ state.error }}</p><button type="button" class="btn" @click="reload">Try again</button></div></div>
    <div v-else-if="!state.loaded" class="content"><div class="page"><p class="mk-muted">Loading your team…</p></div></div>
    <MkAgents v-else-if="location.view === 'agents'" />
    <MkAgent v-else-if="location.view === 'agent' && location.item" :key="location.item" :agent-id="location.item" />
    <MkLibrary v-else-if="location.view === 'library'" :tab="location.tab" />
    <MkMembers v-else-if="location.view === 'members'" />
    <TeamMyTasks v-else-if="location.view === 'mine' && state.team" />
    <TeamSpaceView v-else-if="location.view === 'space' && space" :key="space.id" :team="state.team" :space="space" :location="location" />
    <TeamDocPage v-else-if="location.view === 'doc' && space && location.doc" :key="location.doc" :workspace-id="space.id" :doc-id="location.doc" :space-name="space.name" @back="go({ view: 'space', space: space.id, tab: 'files' })" />
    <div v-else-if="['space', 'doc'].includes(location.view)" class="content">
      <div class="page"><p class="mk-error">That teamspace is not available to you. It may have been archived, or your access was changed.</p><button type="button" class="btn" @click="go({ view: 'home' })">Go home</button></div>
    </div>
    <!-- Home is the inbox: an old /team?view=inbox link opens Home on "Needs you". -->
    <TeamHome v-else initial-tab="needs" />
  </div>
</template>

<script setup>
import { computed, provide, inject } from 'vue';
import { useStore } from 'vuex';
import { useTeam, teamApi } from './useTeam.js';
import { openTeam } from '@/composables/useSpaces.js';
import { useCheckpoints } from '@/composables/useCheckpoints.js';
import { useRoutineRuns } from '@/composables/useRoutineRuns.js';
import TeamHome from './TeamHome.vue';
import TeamMyTasks from './TeamMyTasks.vue';
import MkAgents from '@/views/One/mk/MkAgents.vue';
import MkAgent from '@/views/One/mk/MkAgent.vue';
import MkLibrary from '@/views/One/mk/MkLibrary.vue';
import MkMembers from '@/views/One/mk/MkMembers.vue';
import TeamSpaceView from './TeamSpaceView.vue';
import TeamDocPage from './TeamDocPage.vue';
import '@/views/_components/team/team.css';
import '@/views/One/mk/mk.css';
import '@/views/One/mk/mk-frame.css';

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
const checkpoints = useCheckpoints();
const routineRuns = useRoutineRuns(store);
/** "Review" opens the chat the card is in, where the whole card is on screen. */
function openCheckpoint(checkpoint) {
  if (checkpoint.outputId) nav.openConversation(checkpoint.outputId);
  else { nav.chat(); nav.toast('Open the chat this task started in to review it.'); }
}
/** A routine run is a goal run: open that run. */
function openRun(run) {
  const goalId = run.run_target_id || run.target_id;
  if (goalId) nav.openScreen('GoalsScreen', { select: { kind: 'goal', id: goalId } });
}

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
  openCheckpoint,
  openRun,
  checkpoints,
  routineRuns: routineRuns.runs,
  routineRunsLoaded: routineRuns.loaded,
  loadRoutineRuns: () => routineRuns.loadRoutineRuns(),
  openTeam: openTeamIn,
  ask: (text) => nav.ask(text),
  openPage: (id) => nav.go({ page: id }),
  create: (kind) => nav.create?.(kind),
  openMarket: (item = null) => nav.go({ page: 'market', item }),
  openLibrary: (tab, item, isNew = false) => nav.go({ page: 'library', tab, item, ...(isNew ? { isNew: true } : {}) }),
  teamSettings: () => nav.go({ page: 'settings', section: 'members' }),
  toast: (text) => nav.toast(text),
  confirm: (options) => nav.confirm(options),
  prompt: (options) => nav.prompt(options),
});
</script>
