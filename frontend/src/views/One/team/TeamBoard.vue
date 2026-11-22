<template>
  <div>
    <div class="board-bar">
      <div class="seg" role="group" aria-label="Show">
        <button v-for="f in FILTERS" :key="f.id" type="button" :class="{ 'on': filter === f.id }" @click="filter = f.id">{{ f.label }}</button>
      </div>
      <span class="board-hint">Drag cards between columns · give one to a person or an assistant</span>
      <span class="fill"></span>
      <button v-if="canWrite" type="button" class="primary" @click="adding = 'todo'"><MkIcon name="plus" size="sm" />New task</button>
    </div>
    <div class="board">
      <div
        v-for="column in TASK_STATUSES"
        :key="column.id"
        class="col"
        :class="{ 'over': over === column.id, 'is-full': loadOf(column.id).full }"
        :data-column="column.id"
        @dragover.prevent="canWrite && (over = column.id)"
        @dragleave="over === column.id && (over = null)"
        @drop.prevent="drop(column.id)"
      >
        <div class="col-head">
          <span class="col-dot" :style="{ background: column.color }"></span>{{ column.label }}<span class="n">{{ byStatus(column.id).length }}</span>
          <span v-if="limitable(column.id)" class="limit-anchor">
            <button
              type="button"
              class="limit-chip"
              :class="{ 'is-full': loadOf(column.id).full, 'is-off': !limits[column.id] }"
              :disabled="!canWrite"
              :aria-expanded="String(editing === column.id)"
              :aria-label="limits[column.id] ? `${column.label}: ${loadOf(column.id).label} cards. Change the work limit` : `Set a work limit for ${column.label}`"
              :data-testid="`limit-${column.id}`"
              @click.stop="openLimit(column.id)"
            >{{ limitLabel(column.id) }}</button>
            <div v-if="editing === column.id" class="limit-pop" role="dialog" :aria-label="`${column.label} work limit`" @click.stop>
              <p class="limit-pop-title">{{ column.label }} limit</p>
              <div class="limit-stepper">
                <button type="button" class="btn sm" :disabled="draft <= 1" aria-label="Lower the limit" @click="draft--">−</button>
                <output :data-testid="`limit-draft-${column.id}`">{{ draft }}</output>
                <button type="button" class="btn sm" :disabled="draft >= 99" aria-label="Raise the limit" @click="draft++">+</button>
              </div>
              <p class="limit-pop-help">{{ column.id === 'review' ? 'When Review is full, assistants finish the card they are on but start no new ones.' : 'When In progress is full, assistants start no new cards.' }}</p>
              <div class="row-gap">
                <button type="button" class="primary sm" @click="saveLimit(column.id, draft)">Save limit</button>
                <button v-if="limits[column.id]" type="button" class="btn ghost sm" @click="saveLimit(column.id, null)">Remove limit</button>
              </div>
            </div>
          </span>
        </div>
        <div v-if="loadOf(column.id).full" class="limit-note" role="status">
          Assistants wait until {{ column.label }} has fewer than {{ limits[column.id] }} cards<template v-if="column.id === 'review'">: {{ loadOf('review').toFree === 1 ? '1 review makes room' : plural(loadOf('review').toFree, 'review') + ' make room' }}</template>.
          <button v-if="column.id === 'review' && reviewQueue.length" type="button" class="btn sm" @click="$emit('open-task', reviewQueue[0].id)">Open the oldest</button>
        </div>
        <button
          v-for="t in byStatus(column.id)"
          :key="t.id"
          type="button"
          class="tcard"
          :class="{ 'sel': t.id === selected, 'dragging': t.id === dragging, 'is-stopped': t.agentState === 'blocked' }"
          :draggable="canWrite"
          @dragstart="dragging = t.id"
          @dragend="dragging = null; over = null"
          @click="$emit('open-task', t.id)"
        >
          <div class="tcard-title">{{ t.title }}</div>
          <div class="tcard-meta">
            <TeamAvatar v-if="t.assignee" :who="t.assignee" :label="who(t.assignee)" size="sm" /><span>{{ who(t.assignee) }}</span><span v-if="t.assignee && t.assignee.kind === 'agent'" class="tag violet" data-testid="card-ai">AI</span>
            <span v-if="t.due">· {{ t.due }}</span>
            <span v-if="t.commentCount">· <i class="far fa-comment" aria-hidden="true"></i> {{ t.commentCount }}</span>
          </div>
          <div v-if="hasStateRow(t)" class="tcard-meta">
            <template v-if="t.agentState === 'running'"><span class="pulse"></span>Working on it</template>
            <span v-else-if="cardStateLine(t)" class="tag" :class="cardStateLine(t).tone">{{ cardStateLine(t).label }}</span>
            <span v-if="t.id === nextUpId" class="tag blue">Next up for assistants</span>
            <span v-if="showsAge(t)" class="age" :class="{ 'is-warn': ageOf(t).warn }">{{ ageOf(t).label }} in {{ column.label }}</span>
            <span v-if="reviewOutcome(t)" class="tag" :class="reviewOutcome(t).tone">{{ reviewOutcome(t).label }}</span>
          </div>
        </button>
        <form v-if="adding === column.id" @submit.prevent="add(column.id)">
          <input ref="addRef" v-model="newTitle" class="field" placeholder="Task name, then Enter" aria-label="New task name" @keydown.esc="adding = null" @blur="!newTitle && (adding = null)" />
        </form>
        <button v-else-if="canWrite" type="button" class="add-card" @click="adding = column.id">+ Add card</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, inject, onMounted, onBeforeUnmount } from 'vue';
import TeamAvatar from './TeamAvatar.vue';
import MkIcon from '@/views/One/mk/MkIcon.vue';
import { teamApi } from './useTeam.js';
import { TASK_STATUSES, filterTasks, nameOf, plural, cardStateLine, timeInColumn, reviewOutcome, nextUpTaskId, columnLoad } from './teamModel.js';

const FILTERS = [{ id: 'all', label: 'All' }, { id: 'mine', label: 'Mine' }, { id: 'agents', label: 'Assistants' }];
// Columns that can carry a work limit (the server holds agent starts when one is full).
const LIMITED = ['doing', 'review'];
const NO_LIMITS = Object.freeze({ doing: null, review: null });
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
const limits = ref({ ...NO_LIMITS });
const filter = ref('all');
const adding = ref(null);
const newTitle = ref('');
const addRef = ref(null);
const dragging = ref(null);
const over = ref(null);
const editing = ref(null);
const draft = ref(3);
const now = ref(Date.now());
const canWrite = computed(() => ctx.canWrite.value);
const visible = computed(() => filterTasks(tasks.value, filter.value, ctx.me.value));
const byStatus = (status) => visible.value.filter((t) => t.status === status);
const who = (ref_) => nameOf(ref_, { people: ctx.people.value, agents: props.agents, me: ctx.me.value });

const limitable = (status) => !props.private && LIMITED.includes(status);
// Loads count the whole board, as the server does, whatever the filter shows.
const loadOf = (status) => columnLoad(tasks.value.filter((t) => t.status === status).length, limitable(status) ? limits.value[status] : null);
const limitLabel = (status) => {
  if (!limits.value[status]) return canWrite.value ? 'Set limit' : 'No limit';
  const load = loadOf(status);
  return load.over ? `${load.label} · over limit` : load.label;
};
const nextUpId = computed(() => nextUpTaskId(tasks.value));
const reviewQueue = computed(() => tasks.value.filter((t) => t.status === 'review')
  .sort((a, b) => Date.parse(a.statusChangedAt || a.updatedAt) - Date.parse(b.statusChangedAt || b.updatedAt)));
const ageOf = (t) => timeInColumn(t, now.value);
// Only where waiting matters, and only when the card carries a time to measure from.
const showsAge = (t) => (['doing', 'review'].includes(t.status) || ['blocked', 'queued'].includes(t.agentState)) && Boolean(ageOf(t));
const hasStateRow = (t) => t.agentState === 'running' || Boolean(cardStateLine(t)) || t.id === nextUpId.value || showsAge(t) || Boolean(reviewOutcome(t));

async function load() {
  try {
    const [list, columnLimits] = await Promise.all([
      teamApi.tasks(props.workspaceId, { private: props.private }),
      props.private ? Promise.resolve(NO_LIMITS) : teamApi.limits(props.workspaceId),
    ]);
    tasks.value = list;
    limits.value = { ...NO_LIMITS, ...(columnLimits || {}) };
  } catch (error) { ctx.toast(error.message); }
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

function openLimit(status) {
  if (!canWrite.value) return;
  if (editing.value === status) { editing.value = null; return; }
  draft.value = limits.value[status] || Math.min(99, Math.max(1, loadOf(status).count || 3));
  editing.value = status;
}
async function saveLimit(status, max) {
  editing.value = null;
  const label = TASK_STATUSES.find((s) => s.id === status)?.label || status;
  try {
    limits.value = { ...NO_LIMITS, ...(await teamApi.setLimit(props.workspaceId, status, max)) };
    ctx.toast(max ? `${label} limit is ${max}.` : `${label} has no limit now.`);
  } catch (error) { ctx.toast(error.message); }
  await load();
}
const closeLimit = () => { editing.value = null; };
const onKey = (event) => { if (event.key === 'Escape') closeLimit(); };

watch(adding, async (value) => { if (value) { await nextTick(); (Array.isArray(addRef.value) ? addRef.value[0] : addRef.value)?.focus(); } });
watch(() => props.workspaceId, load);
watch(() => ctx.version.value, () => {
  const signal = ctx.lastSignal.value;
  if (!signal || signal.workspaceId === props.workspaceId) load();
});
let clock = null;
onMounted(() => {
  load();
  document.addEventListener('click', closeLimit);
  document.addEventListener('keydown', onKey);
  // Ages on the cards move on by themselves.
  clock = setInterval(() => { now.value = Date.now(); }, 60e3);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', closeLimit);
  document.removeEventListener('keydown', onKey);
  clearInterval(clock);
});
/** The page header's "New task" opens the add field in a column, the same as the bar's button. */
defineExpose({ load, startAdding: (status = 'todo') => { adding.value = status; } });
</script>

<style scoped>
.board-hint { font-size: 13px; color: var(--text-secondary); }
.col.is-full { border-color: rgba(var(--orange-rgb), 0.45); }
.limit-anchor { position: relative; margin-left: auto; display: inline-flex; }
.limit-chip { display: inline-flex; align-items: center; padding: 1px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--raised); color: var(--text-tertiary); font-size: 11.5px; font-weight: 500; white-space: nowrap; }
.limit-chip:hover:not(:disabled) { border-color: var(--border-strong); color: var(--text-primary); }
.limit-chip:disabled { cursor: default; opacity: 1; }
.limit-chip.is-off { border-style: dashed; }
.limit-chip.is-full { border-color: transparent; background: rgba(var(--orange-rgb), 0.14); color: var(--amber-text); }
.limit-pop { position: absolute; top: calc(100% + 6px); right: 0; z-index: 80; width: 250px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--popup); box-shadow: var(--shadow-lg); font-weight: 400; cursor: default; }
.limit-pop-title { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--text-primary); }
.limit-stepper { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.limit-stepper output { min-width: 26px; text-align: center; font-size: 18px; font-weight: 600; color: var(--text-primary); }
.limit-pop-help { margin: 0 0 10px; font-size: 12.5px; line-height: 1.4; color: var(--text-secondary); }
.limit-note { margin: 0 0 10px; padding: 9px 10px; border-radius: 10px; background: rgba(var(--orange-rgb), 0.1); color: var(--text-primary); font-size: 12.5px; line-height: 1.4; }
.limit-note .btn { margin-top: 8px; display: flex; }
.tcard-meta + .tcard-meta { margin-top: 6px; }
.tcard.is-stopped { border-color: rgba(var(--orange-rgb), 0.5); }
.age.is-warn { color: var(--amber-text); font-weight: 500; }
</style>
