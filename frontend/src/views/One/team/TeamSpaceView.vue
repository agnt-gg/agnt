<template>
  <div class="mk-split">
    <div class="content">
      <div class="page is-wide" style="padding-bottom: 0">
        <div class="space-head">
          <span class="space-icon">#</span>
          <div style="flex: 1; min-width: 0"><h1>{{ space.name }}</h1><div class="mk-muted">Teamspace in {{ team.name }}</div></div>
          <span v-tooltip="`${ctx.people.value.length} people`" class="stack"><TeamAvatar v-for="p in ctx.people.value.slice(0, 5)" :key="p.id" :who="{ kind: 'person', id: p.id }" :label="p.name" size="sm" /></span>
          <span class="scope"><i class="fas fa-users" aria-hidden="true"></i>{{ ctx.people.value.length }} people + {{ agents.length }} agents</span>
        </div>
        <nav class="tabs" aria-label="Teamspace">
          <button v-for="t in SPACE_TABS" :key="t.id" type="button" class="tab" :class="{ 'is-active': location.tab === t.id }" :aria-current="location.tab === t.id ? 'page' : undefined" @click="ctx.go({ view: 'space', space: space.id, tab: t.id })">{{ t.label }}</button>
        </nav>
        <TeamChat v-if="location.tab === 'chat'" :workspace-id="space.id" :space-name="space.name" :agents="agents" @open-task="openTask" @open-doc="openDoc" />
        <TeamBoard v-else-if="location.tab === 'board'" :workspace-id="space.id" :agents="agents" :selected="location.task" @open-task="openTask" />
        <TeamDocs v-else-if="location.tab === 'docs'" :workspace-id="space.id" :space-name="space.name" @open-doc="openDoc" />
        <TeamNative v-else-if="location.tab === 'agents'" :workspace-id="space.id" :space-name="space.name" kind="agent" @open-editor="openEditor('agents', $event)" />
        <TeamNative v-else-if="location.tab === 'routines'" :workspace-id="space.id" :space-name="space.name" kind="workflow" @open-editor="openEditor('workflows', $event)" />
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
import { ref, watch, inject, onMounted } from 'vue';
import TeamAvatar from './TeamAvatar.vue';
import TeamChat from './TeamChat.vue';
import TeamBoard from './TeamBoard.vue';
import TeamDocs from './TeamDocs.vue';
import TeamNative from './TeamNative.vue';
import TeamTaskPanel from './TeamTaskPanel.vue';
import TeamMembers from '@/views/_components/team/TeamMembers.vue';
import '@/views/_components/team/team.css';
import { teamApi } from './useTeam.js';
import { SPACE_TABS } from './teamModel.js';

const props = defineProps({ team: { type: Object, required: true }, space: { type: Object, required: true }, location: { type: Object, required: true } });
const ctx = inject('teamCtx');
const agents = ref([]);

async function loadAgents() {
  try { agents.value = (await teamApi.people(props.space.id)).agents || []; } catch (e) { agents.value = []; console.warn('[team] agents:', e.message); }
}
const openTask = (id) => ctx.go({ view: 'space', space: props.space.id, tab: props.location.tab === 'chat' ? 'chat' : 'board', task: id });
const openDoc = (id) => ctx.go({ view: 'doc', space: props.space.id, doc: id });
/** Native editors run in this teamspace's scope, which the page picks up at load (useSpaces.openTeam). */
function openEditor(tab, item) {
  if (props.space.is_default) ctx.openLibrary(tab, item?.id || null);
  else ctx.openTeam(props.team, props.space.id);
}
watch(() => props.space.id, loadAgents);
watch(() => ctx.version.value, () => { if (props.location.tab === 'agents') loadAgents(); });
onMounted(loadAgents);
</script>
