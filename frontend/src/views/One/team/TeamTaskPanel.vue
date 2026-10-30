<template>
  <aside class="panel" aria-label="Card">
    <div class="panel-head">
      <span class="tag"><i class="fas fa-hashtag" aria-hidden="true"></i> {{ spaceName }}</span>
      <span class="fill"></span>
      <button v-if="task && canDelete" v-tooltip="'Delete card'" type="button" class="one-icon-btn" aria-label="Delete card" @click="remove"><i class="far fa-trash-alt" aria-hidden="true"></i></button>
      <button type="button" class="btn sm" @click="$emit('close')">Close</button>
    </div>
    <div v-if="!task" class="panel-scroll"><p class="mk-muted">{{ error || 'Loading…' }}</p></div>
    <template v-else>
      <div class="panel-scroll">
        <input v-model="title" class="panel-title" aria-label="Card title" :readonly="!canWrite" @keydown.enter="$event.target.blur()" @blur="saveTitle" />
        <div class="props">
          <span>Status</span>
          <CustomSelect :model-value="task.status" :options="statusOptions" :disabled="!canWrite" aria-label="Status" @update:model-value="(value) => value !== task.status && save({ status: value })" />
          <span>Assignee</span>
          <CustomSelect :model-value="assigneeValue" :options="assigneeOptions" :disabled="!canWrite" aria-label="Assignee" @update:model-value="(value) => value !== assigneeValue && assign(value)" />
          <span>Due</span>
          <input v-model="due" class="field" style="padding: 5px 9px; font-size: 13px" placeholder="e.g. Fri" aria-label="Due" :readonly="!canWrite" @keydown.enter="$event.target.blur()" @blur="saveDue" />
          <span>Visible to</span>
          <span class="scope"><i class="fas fa-users" aria-hidden="true"></i>{{ spaceName }}</span>
          <template v-if="task.sourceMessageId"><span>From</span><button type="button" class="link" style="justify-self: start" @click="$emit('open-chat')">a message in {{ spaceName }}</button></template>
        </div>

        <div v-if="task.agentState === 'running'" class="banner"><span class="pulse"></span>{{ who(task.assignee) }} is working on this.</div>
        <div v-if="task.agentState === 'waiting'" class="approve-box">
          <b>{{ who(task.assignee) }}</b> finished and needs a person to approve.
          <div v-if="task.result" class="tc-docprev">{{ task.result }}</div>
          <div v-if="canWrite" class="row-gap">
            <button type="button" class="primary sm" :disabled="busy" @click="decide(true, false)">Approve</button>
            <button type="button" class="btn sm" :disabled="busy" @click="decide(true, true)">Approve and save as doc</button>
            <button type="button" class="btn sm" :disabled="busy" @click="sendBack">Send back</button>
          </div>
        </div>
        <div v-else-if="task.result && task.status === 'done'" style="margin-top: 8px">
          <div class="mk-label">Result</div>
          <div class="tc-docprev">{{ task.result }}</div>
        </div>

        <div class="divider"></div>
        <div class="mk-label">Thread</div>
        <p v-if="!task.comments.length" class="mk-muted">No comments yet. @mention an agent here to hand it this card.</p>
        <div v-for="c in task.comments" :key="c.id" class="msg" style="padding: 7px 4px">
          <TeamAvatar :who="c.author" :label="who(c.author)" />
          <div class="msg-body">
            <div class="msg-name">{{ who(c.author) }}<span class="msg-time">{{ ago(c.createdAt) }}</span></div>
            <div class="msg-text">{{ c.body }}</div>
          </div>
        </div>
      </div>
      <form v-if="canWrite" class="composer" style="margin: 12px" @submit.prevent="comment">
        <textarea v-model="draft" rows="1" placeholder="Comment. @mention a teammate or an agent" aria-label="Comment" @keydown.enter.exact.prevent="comment"></textarea>
        <div class="composer-row">
          <button v-for="a in agents.slice(0, 2)" :key="a.id" type="button" class="mention-chip" @click="draft = (draft ? draft.trimEnd() + ' ' : '') + '@' + a.name + ' '"><TeamAvatar :who="{ kind: 'agent', id: a.id }" size="sm" />@{{ a.name }}</button>
          <button class="send" type="submit" :disabled="!draft.trim() || busy" aria-label="Send"><i class="fas fa-arrow-up" aria-hidden="true"></i></button>
        </div>
      </form>
    </template>
  </aside>
</template>

<script setup>
import { ref, computed, watch, inject, onMounted } from 'vue';
import TeamAvatar from './TeamAvatar.vue';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import { teamApi } from './useTeam.js';
import { TASK_STATUSES, ago, nameOf, mentionsIn } from './teamModel.js';

const props = defineProps({
  workspaceId: { type: String, required: true },
  taskId: { type: String, required: true },
  spaceName: { type: String, default: '' },
  agents: { type: Array, default: () => [] },
});
const emit = defineEmits(['close', 'open-chat', 'open-doc', 'changed']);
const ctx = inject('teamCtx');

const task = ref(null);
const error = ref('');
const title = ref('');
const due = ref('');
const draft = ref('');
const busy = ref(false);
const canWrite = computed(() => ctx.canWrite.value);
const canDelete = computed(() => canWrite.value && (task.value?.createdBy === ctx.me.value || ['owner', 'admin'].includes(ctx.role.value)));
const assigneeValue = computed(() => (task.value?.assignee ? task.value.assignee.kind + ':' + task.value.assignee.id : ''));
const statusOptions = TASK_STATUSES.map((s) => ({ label: s.label, value: s.id }));
const assigneeOptions = computed(() => [
  { label: 'Unassigned', value: '' },
  ...ctx.people.value.map((p) => ({ label: p.isMe ? p.name + ' (you)' : p.name, value: 'person:' + p.id })),
  ...props.agents.map((a) => ({ label: 'Agent: ' + a.name + (a.status === 'draft' ? ' (not published)' : ''), value: 'agent:' + a.id })),
]);
const who = (ref_) => nameOf(ref_, { people: ctx.people.value, agents: props.agents, me: ctx.me.value });

async function load() {
  try {
    const next = await teamApi.task(props.workspaceId, props.taskId);
    task.value = next;
    title.value = next.title;
    due.value = next.due;
    error.value = '';
  } catch (e) {
    error.value = e.status === 404 ? 'This card was deleted.' : e.message;
    task.value = null;
  }
}
async function save(input) {
  if (!task.value) return;
  busy.value = true;
  try {
    await teamApi.updateTask(props.workspaceId, task.value.id, { ...input, expectedRevision: task.value.revision });
    emit('changed');
  } catch (e) {
    ctx.toast(e.code === 'revision_conflict' ? 'A teammate changed this card. Showing their version now.' : e.message);
  } finally {
    busy.value = false;
    await load();
  }
}
function saveTitle() { const value = title.value.trim(); if (value && value !== task.value?.title) save({ title: value }); else title.value = task.value?.title || ''; }
function saveDue() { if (due.value.trim() !== (task.value?.due || '')) save({ due: due.value.trim() }); }
function assign(value) {
  const [kind, ...rest] = value.split(':');
  save({ assignee: value ? { kind, id: rest.join(':') } : null });
  if (kind === 'agent') ctx.toast('Assigned. The agent starts on it now.');
}
async function decide(approve, saveAsDoc) {
  busy.value = true;
  try {
    const result = await teamApi.approve(props.workspaceId, task.value.id, { saveAsDoc });
    ctx.toast(result.doc ? 'Approved and saved as a doc' : 'Approved');
    emit('changed');
    if (result.doc) emit('open-doc', result.doc.id);
  } catch (e) { ctx.toast(e.message); } finally { busy.value = false; await load(); }
}
async function sendBack() {
  const note = await ctx.prompt({ title: 'Send back', message: 'What should change? The agent runs again with your note.', placeholder: 'e.g. Shorter, and use the Q3 prices', confirmText: 'Send back' });
  if (note === null) return;
  busy.value = true;
  try { await teamApi.sendBack(props.workspaceId, task.value.id, note); emit('changed'); } catch (e) { ctx.toast(e.message); } finally { busy.value = false; await load(); }
}
async function comment() {
  const body = draft.value.trim();
  if (!body || busy.value) return;
  busy.value = true;
  try {
    await teamApi.comment(props.workspaceId, task.value.id, body, mentionsIn(body, { people: ctx.people.value, agents: props.agents }));
    draft.value = '';
    emit('changed');
  } catch (e) { ctx.toast(e.message); } finally { busy.value = false; await load(); }
}
async function remove() {
  if (!(await ctx.confirm({ title: 'Delete this card?', message: 'It disappears from the board for everyone.', confirmText: 'Delete', danger: true }))) return;
  try { await teamApi.deleteTask(props.workspaceId, task.value.id); emit('changed'); emit('close'); } catch (e) { ctx.toast(e.message); }
}

watch(() => props.taskId, load);
watch(() => ctx.version.value, () => {
  const signal = ctx.lastSignal.value;
  if (!signal || signal.taskId === props.taskId || (signal.workspaceId === props.workspaceId && signal.kind === 'tasks')) load();
});
onMounted(load);
</script>
