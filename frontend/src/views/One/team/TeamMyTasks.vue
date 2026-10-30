<template>
  <div class="ot-scroll">
    <div class="ot-page">
      <div class="ot-head"><div><h1>My tasks</h1><p>Every card assigned to you, across the teamspaces you can open.</p></div></div>
      <template v-for="status in TASK_STATUSES" :key="status.id">
        <div class="ot-sec"><h3>{{ status.label }} · {{ grouped(status.id).length }}</h3></div>
        <ul class="ot-list">
          <li v-if="!grouped(status.id).length" class="ot-empty">{{ loading ? 'Loading…' : 'Nothing here.' }}</li>
          <li v-for="t in grouped(status.id)" :key="t.id"><TeamTaskRow :task="t" @open="ctx.go({ view: 'space', space: t.workspaceId, tab: 'board', task: t.id })" /></li>
        </ul>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, inject, onMounted } from 'vue';
import TeamTaskRow from './TeamTaskRow.vue';
import { teamApi } from './useTeam.js';
import { TASK_STATUSES } from './teamModel.js';

const ctx = inject('teamCtx');
const tasks = ref([]);
const loading = ref(true);
const mine = computed(() => tasks.value.filter((t) => t.assignee?.kind === 'person' && t.assignee.id === ctx.me.value));
const grouped = (status) => mine.value.filter((t) => t.status === status);

async function load() {
  const lists = await Promise.all(ctx.spaces.value.map((s) => teamApi.tasks(s.id).catch(() => [])));
  tasks.value = lists.flat();
  loading.value = false;
}
watch(() => [ctx.version.value, ctx.spaces.value.length], load);
onMounted(load);
</script>
