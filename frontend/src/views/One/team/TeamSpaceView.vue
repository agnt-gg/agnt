<template>
  <div class="mk-split">
    <div class="content">
      <div class="page is-wide" style="padding-bottom: 0">
        <div class="space-head">
          <span class="space-icon">{{ emoji }}</span>
          <div style="flex: 1; min-width: 0">
            <h1 style="font-size: 22px; font-weight: 700">{{ space.name }}</h1>
            <div style="font-size: 13px; color: var(--text-secondary)">{{ space.description || `Everyone on ${team.name} works here` }}</div>
          </div>
          <span class="scope team"><MkIcon name="users" size="sm" />{{ plural(ctx.people.value.length, 'member') }} + {{ plural(agents.length, 'agent') }}</span>
          <button v-if="canManage" type="button" class="btn" @click="ctx.go({ view: 'space', space: space.id, tab: 'people' })"><MkIcon name="plus" size="sm" />Add people</button>
        </div>
        <nav class="tabs" aria-label="Teamspace">
          <button v-for="t in tabs" :key="t.id" type="button" class="tab" :class="{ 'is-active': location.tab === t.id }" :aria-current="location.tab === t.id ? 'page' : undefined" @click="ctx.go({ view: 'space', space: space.id, tab: t.id })">
            <MkIcon :name="t.icon" size="sm" />{{ t.label }}<span v-if="counts[t.id] !== undefined" class="count">{{ counts[t.id] }}</span>
          </button>
        </nav>
        <TeamChat v-if="location.tab === 'chat'" :workspace-id="space.id" :space-name="space.name" :agents="agents" @open-task="openTask" @open-doc="openDoc" />
        <TeamBoard v-else-if="location.tab === 'board'" :workspace-id="space.id" :agents="agents" :selected="location.task" @open-task="openTask" />
        <TeamDocs v-else-if="location.tab === 'docs'" :workspace-id="space.id" :space-name="space.name" @open-doc="openDoc" />
        <TeamNative v-else-if="location.tab === 'agents'" :workspace-id="space.id" :space-name="space.name" kind="agent" @open-editor="openEditor('agents', $event)" @library="ctx.go({ view: 'library' })" />
        <TeamNative v-else-if="location.tab === 'routines'" :workspace-id="space.id" :space-name="space.name" kind="workflow" @open-editor="openEditor('workflows', $event)" />
        <TeamFiles v-else-if="location.tab === 'files'" :team-id="team.id" :workspace-id="space.id" :space-name="space.name" @loaded="counts.files = $event.length" />
        <div v-else-if="location.tab === 'people'">
          <p class="mk-muted" style="margin-top: 0">Everyone on {{ team.name }} works in every teamspace by their role. Owners and admins can narrow one person's access per teamspace in Team settings.</p>
          <TeamMembers :team="team" @error="ctx.toast" @changed="ctx.reload" />
        </div>
      </div>
    </div>
    <TeamTaskPanel v-if="location.task" :key="location.task" :workspace-id="space.id" :task-id="location.task" :space-name="space.name" :agents="agents"
      @close="ctx.go({ view: 'space', space: space.id, tab: location.tab })" @open-chat="ctx.go({ view: 'space', space: space.id, tab: 'chat' })" @open-doc="openDoc" />
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, inject, onMounted } from 'vue';
import MkIcon from '@/views/One/mk/MkIcon.vue';
import TeamChat from './TeamChat.vue';
import TeamBoard from './TeamBoard.vue';
import TeamDocs from './TeamDocs.vue';
import TeamNative from './TeamNative.vue';
import TeamFiles from './TeamFiles.vue';
import TeamTaskPanel from './TeamTaskPanel.vue';
import TeamMembers from '@/views/_components/team/TeamMembers.vue';
import '@/views/_components/team/team.css';
import { teamApi, teamFiles } from './useTeam.js';
import { SPACE_TABS, spaceEmoji, plural } from './teamModel.js';

const props = defineProps({ team: { type: Object, required: true }, space: { type: Object, required: true }, location: { type: Object, required: true } });
const ctx = inject('teamCtx');
const agents = ref([]);
const counts = reactive({});
const tabs = SPACE_TABS.filter((t) => !t.hidden);
const emoji = computed(() => spaceEmoji(props.space));
const canManage = computed(() => ['owner', 'admin'].includes(ctx.role.value));

async function loadAgents() {
  try { agents.value = (await teamApi.people(props.space.id)).agents || []; } catch (e) { agents.value = []; console.warn('[team] agents:', e.message); }
}
/** The numbers beside the tabs, as in the mockup. A count that cannot be read is simply not shown. */
async function loadCounts() {
  const ws = props.space.id;
  const [tasks, docs, native, files] = await Promise.all([
    teamApi.tasks(ws).catch(() => null), teamApi.docs(ws).catch(() => null), teamApi.native(ws).catch(() => null), teamFiles.list(props.team.id, ws).catch(() => null),
  ]);
  for (const key of Object.keys(counts)) delete counts[key];
  if (tasks) counts.board = tasks.filter((t) => t.status !== 'done').length;
  if (docs) counts.docs = docs.length;
  if (native) { counts.agents = native.filter((i) => i.kind === 'agent').length; counts.routines = native.filter((i) => i.kind === 'workflow').length; }
  if (files) counts.files = files.length;
}
const openTask = (id) => ctx.go({ view: 'space', space: props.space.id, tab: props.location.tab === 'chat' ? 'chat' : 'board', task: id });
const openDoc = (id) => ctx.go({ view: 'doc', space: props.space.id, doc: id });
/** Native editors run in this teamspace's scope, which the page picks up at load (useSpaces.openTeam). */
function openEditor(tab, item) {
  if (props.space.is_default) ctx.openLibrary(tab, item?.id || null);
  else ctx.openTeam(props.team, props.space.id);
}
watch(() => props.space.id, () => { loadAgents(); loadCounts(); });
watch(() => ctx.version.value, () => { loadCounts(); if (props.location.tab === 'agents') loadAgents(); });
onMounted(() => { loadAgents(); loadCounts(); });
</script>
