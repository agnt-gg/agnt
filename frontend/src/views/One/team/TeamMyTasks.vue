<template>
  <div class="mk-split">
    <div class="content">
      <div class="page is-wide">
        <div class="page-head">
          <div><h1>My tasks</h1><p>Private tasks plus everything assigned to you across teamspaces.</p></div>
          <button v-if="home" type="button" class="primary" @click="boardRef?.startAdding('todo')"><MkIcon name="plus" size="sm" />New task</button>
        </div>
        <!-- Private cards live in the team's main teamspace, visible to their owner only (server-enforced). -->
        <TeamBoard v-if="home" ref="boardRef" :workspace-id="home.id" private :selected="selected" @open-task="selected = $event" />
        <div class="sec-head"><h3>Assigned to you in teamspaces</h3></div>
        <ul class="list">
          <li v-if="!assigned.length" class="empty">{{ loading ? 'Loading…' : 'Nothing assigned to you.' }}</li>
          <li v-for="t in assigned" :key="t.id"><TeamTaskRow :task="t" @open="ctx.go({ view: 'space', space: t.workspaceId, tab: 'board', task: t.id })" /></li>
        </ul>
      </div>
    </div>
    <TeamTaskPanel v-if="selected && home" :key="selected" :workspace-id="home.id" :task-id="selected" space-name="My Space" :agents="[]"
      @close="selected = null; boardRef?.load()" @open-chat="selected = null" @open-doc="(id) => ctx.go({ view: 'doc', space: home.id, doc: id })" />
  </div>
</template>

<script setup>
import { ref, computed, watch, inject, onMounted } from 'vue';
import MkIcon from '@/views/One/mk/MkIcon.vue';
import TeamBoard from './TeamBoard.vue';
import TeamTaskRow from './TeamTaskRow.vue';
import TeamTaskPanel from './TeamTaskPanel.vue';
import { teamApi } from './useTeam.js';

const ctx = inject('teamCtx');
const boardRef = ref(null);
const selected = ref(null);
const tasks = ref([]);
const loading = ref(true);
const home = computed(() => ctx.spaces.value.find((s) => s.is_default) || ctx.spaces.value[0] || null);
const assigned = computed(() => tasks.value.filter((t) => t.status !== 'done' && t.assignee?.kind === 'person' && t.assignee.id === ctx.me.value));

async function load() {
  const lists = await Promise.all(ctx.spaces.value.map((s) => teamApi.tasks(s.id).catch(() => [])));
  tasks.value = lists.flat();
  loading.value = false;
}
watch(() => [ctx.version.value, ctx.spaces.value.length], load);
onMounted(load);
</script>
