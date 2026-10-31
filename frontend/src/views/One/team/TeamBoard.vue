<template>
  <div>
    <div class="board-bar">
      <div class="seg" role="group" aria-label="Show">
        <button v-for="f in FILTERS" :key="f.id" type="button" :class="{ 'on': filter === f.id }" @click="filter = f.id">{{ f.label }}</button>
      </div>
      <span style="font-size: 12.5px; color: var(--text-tertiary)">Drag cards between columns · assign to a person or an agent</span>
      <span class="fill"></span>
      <button v-if="canWrite" type="button" class="primary" @click="adding = 'todo'"><MkIcon name="plus" size="sm" />New task</button>
    </div>
    <div class="board">
      <div
        v-for="column in TASK_STATUSES"
        :key="column.id"
        class="col"
        :class="{ 'over': over === column.id }"
        @dragover.prevent="canWrite && (over = column.id)"
        @dragleave="over === column.id && (over = null)"
        @drop.prevent="drop(column.id)"
      >
        <div class="col-head"><span class="col-dot" :style="{ background: column.color }"></span>{{ column.label }}<span class="n">{{ byStatus(column.id).length }}</span></div>
        <button
          v-for="t in byStatus(column.id)"
          :key="t.id"
          type="button"
          class="tcard"
          :class="{ 'sel': t.id === selected, 'dragging': t.id === dragging }"
          :draggable="canWrite"
          @dragstart="dragging = t.id"
          @dragend="dragging = null; over = null"
          @click="$emit('open-task', t.id)"
        >
          <div class="tcard-title">{{ t.title }}</div>
          <div class="tcard-meta">
            <TeamAvatar v-if="t.assignee" :who="t.assignee" :label="who(t.assignee)" size="sm" /><span>{{ who(t.assignee) }}</span>
            <template v-if="t.agentState === 'running'"><span class="pulse"></span>working</template>
            <span v-else-if="agentStateLabel(t.agentState)" class="tag" :class="t.agentState === 'waiting' ? 'pink' : 'amber'">{{ agentStateLabel(t.agentState) }}</span>
            <span v-if="t.due">· {{ t.due }}</span>
            <span v-if="t.commentCount">· <i class="far fa-comment" aria-hidden="true"></i> {{ t.commentCount }}</span>
          </div>
        </button>
        <form v-if="adding === column.id" @submit.prevent="add(column.id)">
          <input ref="addRef" v-model="newTitle" class="field" placeholder="Task name, then Enter" aria-label="New task name" @keydown.esc="adding = null" @blur="!newTitle && (adding = null)" />
        </form>
        <button v-else-if="canWrite" type="button" class="add-card" @click="adding = column.id">+ Add</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, inject, onMounted } from 'vue';
import TeamAvatar from './TeamAvatar.vue';
import MkIcon from '@/views/One/mk/MkIcon.vue';
import { teamApi } from './useTeam.js';
import { TASK_STATUSES, filterTasks, nameOf, agentStateLabel } from './teamModel.js';

const FILTERS = [{ id: 'all', label: 'All' }, { id: 'mine', label: 'Mine' }, { id: 'agents', label: 'Agents' }];
const props = defineProps({
  workspaceId: { type: String, required: true },
  agents: { type: Array, default: () => [] },
  selected: { type: String, default: null },
  // My Space: the caller's private cards in this workspace; new cards are private and theirs.
  private: { type: Boolean, default: false },
});
defineEmits(['open-task']);
const ctx = inject('teamCtx');

const tasks = ref([]);
const filter = ref('all');
const adding = ref(null);
const newTitle = ref('');
const addRef = ref(null);
const dragging = ref(null);
const over = ref(null);
const canWrite = computed(() => ctx.canWrite.value);
const visible = computed(() => filterTasks(tasks.value, filter.value, ctx.me.value));
const byStatus = (status) => visible.value.filter((t) => t.status === status);
const who = (ref_) => nameOf(ref_, { people: ctx.people.value, agents: props.agents, me: ctx.me.value });

async function load() {
  try { tasks.value = await teamApi.tasks(props.workspaceId, { private: props.private }); } catch (error) { ctx.toast(error.message); }
}
async function add(status) {
  const title = newTitle.value.trim();
  if (!title) { adding.value = null; return; }
  try {
    await teamApi.createTask(props.workspaceId, props.private ? { title, status, private: true, assignee: { kind: 'person', id: ctx.me.value } } : { title, status });
    newTitle.value = '';
    await load();
  } catch (error) { ctx.toast(error.message); }
}
async function drop(status) {
  over.value = null;
  const task = tasks.value.find((t) => t.id === dragging.value);
  dragging.value = null;
  if (!task || task.status === status || !canWrite.value) return;
  const before = task.status;
  task.status = status; // moves now; reverts if the server refuses
  try {
    await teamApi.updateTask(props.workspaceId, task.id, { status, expectedRevision: task.revision });
  } catch (error) {
    task.status = before;
    ctx.toast(error.code === 'revision_conflict' ? 'A teammate just changed that card. The board is up to date now; try again.' : error.message);
  }
  await load();
}

watch(adding, async (value) => { if (value) { await nextTick(); (Array.isArray(addRef.value) ? addRef.value[0] : addRef.value)?.focus(); } });
watch(() => props.workspaceId, load);
watch(() => ctx.version.value, () => {
  const signal = ctx.lastSignal.value;
  if (!signal || signal.workspaceId === props.workspaceId) load();
});
onMounted(load);
/** The page header's "New task" opens the add field in a column, the same as the bar's button. */
defineExpose({ load, startAdding: (status = 'todo') => { adding.value = status; } });
</script>
