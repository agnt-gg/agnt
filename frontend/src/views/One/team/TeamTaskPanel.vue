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
          <VisibleToSelect :model-value="scopeValue" :options="scopeOptions" :disabled="!canMove || busy" @change="move" />
          <template v-if="!task.private">
            <span>Waits on</span>
            <CustomSelect :model-value="task.waitsOn || ''" :options="waitsOnOptions" :disabled="!canWrite || busy" aria-label="Waits on" data-testid="waits-on" @update:model-value="(value) => (value || null) !== (task.waitsOn || null) && save({ waitsOn: value || null })" />
          </template>
          <template v-if="task.sourceMessageId"><span>From</span><button type="button" class="link" style="justify-self: start" @click="$emit('open-chat')">a message in {{ spaceName }}</button></template>
        </div>

        <div v-if="task.agentState === 'running'" class="banner"><span class="pulse"></span>{{ who(task.assignee) }} is working on this.</div>
        <div v-if="task.agentState === 'queued'" class="banner">Waiting to start: {{ task.stopReason || 'no room yet' }}. It starts on its own when there is room.</div>
        <section v-if="task.agentState === 'blocked'" class="stop-box" data-testid="stop-box" aria-label="Why it stopped">
          <b><span class="stop-dot" aria-hidden="true"></span>{{ who(task.assignee) }} {{ task.decision ? 'stopped and needs a decision' : 'stopped' }}</b>
          <p>{{ sentence(task.stopReason || 'the run stopped') }}</p>
          <small>{{ stoppedSince }}<template v-if="heldUp.length"> · holding up {{ plural(heldUp.length, 'card') }}</template><template v-if="task.escalatedFrom"> · {{ who({ kind: 'agent', id: task.escalatedFrom }) }} asked first, then the team lead</template></small>
        </section>
        <template v-if="task.agentState === 'blocked' && ladder.length">
          <div class="mk-label section-label">What has been tried</div>
          <ol class="ladder" data-testid="ladder">
            <li v-for="step in ladder" :key="step.id"><span class="ladder-mark" aria-hidden="true">✓</span><span>{{ step.text }}</span><time>{{ step.when }}</time></li>
            <li class="is-now"><span class="ladder-mark" aria-hidden="true">›</span><span><b>Now with you.</b></span><time></time></li>
          </ol>
        </template>
        <template v-if="task.agentState === 'blocked' && canWrite">
          <div class="mk-label section-label">{{ task.decision ? 'Your decision' : 'What to do' }}</div>
          <div v-if="task.decision" class="choices">
            <button v-for="(option, index) in task.decision.options" :key="option" type="button" :class="index === 0 ? 'primary' : 'btn'" :disabled="busy" @click="answer(option)">{{ option }}</button>
            <form class="own-answer" @submit.prevent="answer(ownAnswer)">
              <input v-model="ownAnswer" class="field" placeholder="Or answer in your own words" aria-label="Your answer" />
              <button type="submit" class="btn" :disabled="busy || !ownAnswer.trim()">Send answer</button>
            </form>
            <label v-if="canAddRule" class="rule"><input v-model="addRule" type="checkbox" /><span>Let {{ leadName }} decide this from now on<small>Your answer becomes one of its rules. You can change them on the Assistants page.</small></span></label>
          </div>
          <div v-else class="choices">
            <button type="button" class="primary" :disabled="busy" @click="retry">Try again</button>
            <button type="button" class="btn" :disabled="busy" @click="takeIt">Take it myself</button>
          </div>
        </template>
        <template v-if="task.checks?.length && ['blocked', 'waiting', null].includes(task.agentState)">
          <div class="mk-label section-label">Checks the assistant reports</div>
          <ul class="checks" data-testid="checks">
            <li v-for="check in task.checks" :key="check.label" :class="check.ok === true ? 'is-ok' : check.ok === false ? 'is-bad' : 'is-unknown'">
              <span class="check-mark" aria-hidden="true">{{ check.ok === true ? '✓' : check.ok === false ? '✕' : '?' }}</span>
              <span>{{ check.label }}<small v-if="check.detail">{{ check.detail }}</small></span>
              <span class="check-verdict">{{ check.ok === true ? 'passed' : check.ok === false ? 'failed' : 'no verdict' }}</span>
            </li>
          </ul>
        </template>
        <div v-if="task.agentState === 'waiting'" class="approve-box">
          <b>{{ who(task.assignee) }}</b> finished and needs a person to approve.
          <div v-if="task.result" class="tc-docprev">{{ task.result }}</div>
          <div v-if="canWrite" class="row-gap">
            <button type="button" class="primary sm" :disabled="busy" @click="decide(true, false)">Approve</button>
            <button type="button" class="btn sm" :disabled="busy" @click="decide(true, true)">Approve and save as a file</button>
            <button type="button" class="btn sm" :disabled="busy" @click="sendBack">Send back</button>
          </div>
        </div>
        <div v-else-if="task.result && task.status === 'done'" style="margin-top: 8px">
          <div class="mk-label">Result</div>
          <div class="tc-docprev">{{ task.result }}</div>
        </div>

        <template v-if="heldUp.length">
          <div class="mk-label section-label">Also held up</div>
          <ul class="list held-up" data-testid="held-up">
            <li v-for="c in heldUp" :key="c.id"><button type="button" class="r" @click="ctx.go({ view: 'space', space: c.workspaceId, tab: 'board', task: c.id })"><span class="r-text"><strong>{{ c.title }}</strong><small>Waits for this card</small></span></button></li>
          </ul>
        </template>
        <div class="divider"></div>
        <div class="mk-label">Thread</div>
        <p v-if="!task.comments.length" class="mk-muted">No comments yet. @mention an assistant here to hand it this card.</p>
        <div v-for="c in task.comments" :key="c.id" class="msg" style="padding: 7px 4px">
          <TeamAvatar :who="c.author" :label="who(c.author)" />
          <div class="msg-body">
            <div class="msg-name">{{ who(c.author) }}<span class="msg-time">{{ ago(c.createdAt) }}</span></div>
            <div class="msg-text">{{ c.body }}</div>
          </div>
        </div>
      </div>
      <form v-if="canWrite" class="composer" style="margin: 12px" @submit.prevent="comment">
        <textarea v-model="draft" rows="1" placeholder="Comment. @mention a teammate or an assistant" aria-label="Comment" @keydown.enter.exact.prevent="comment"></textarea>
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
import VisibleToSelect from '@/views/_components/team/VisibleToSelect.vue';
import { teamApi } from './useTeam.js';
import { TASK_STATUSES, ago, nameOf, mentionsIn, visibleToOptions, homeSpaceOf, PRIVATE_SCOPE, plural } from './teamModel.js';

const props = defineProps({
  workspaceId: { type: String, required: true },
  taskId: { type: String, required: true },
  spaceName: { type: String, default: '' },
  agents: { type: Array, default: () => [] },
});
const emit = defineEmits(['close', 'open-chat', 'open-doc', 'changed']);
const ctx = inject('teamCtx');
// Inside a teamspace, only its people can be assigned (null outside one: no narrowing).
const spaceMemberIds = inject('spaceMemberIds', computed(() => null));

const task = ref(null);
const boardTasks = ref([]);
const lead = ref({ leadAgentId: null, leadRules: '' });
const ownAnswer = ref('');
const addRule = ref(false);
const error = ref('');
const title = ref('');
const due = ref('');
const draft = ref('');
const busy = ref(false);
const canWrite = computed(() => ctx.canWrite.value);
const isMaker = computed(() => task.value?.createdBy === ctx.me.value);
const canDelete = computed(() => canWrite.value && (isMaker.value || ['owner', 'admin'].includes(ctx.role.value)));
// Who may change where a card shows: the same people who may delete it (the server enforces both).
const canMove = canDelete;
const scopeValue = computed(() => (task.value?.private ? PRIVATE_SCOPE : props.workspaceId));
// "Only you" is offered to the card's maker only: making it private hides it from everyone else.
const scopeOptions = computed(() => visibleToOptions(ctx.spaces.value || [], { includePrivate: isMaker.value || Boolean(task.value?.private), privateLabel: 'Only you (My Space)' }));
const assigneeValue = computed(() => (task.value?.assignee ? task.value.assignee.kind + ':' + task.value.assignee.id : ''));
const statusOptions = TASK_STATUSES.map((s) => ({ label: s.label, value: s.id }));
const assigneeOptions = computed(() => [
  { label: 'Unassigned', value: '' },
  ...ctx.people.value.filter((p) => !spaceMemberIds.value || spaceMemberIds.value.includes(p.id)).map((p) => ({ label: p.isMe ? p.name + ' (you)' : p.name, value: 'person:' + p.id })),
  ...props.agents.map((a) => ({ label: 'Assistant: ' + a.name + (a.status === 'draft' ? ' (not published)' : ''), value: 'agent:' + a.id })),
]);
const who = (ref_) => nameOf(ref_, { people: ctx.people.value, agents: props.agents, me: ctx.me.value });
const sentence = (value) => { const text = String(value).trim(); return text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? '' : '.'); };
const heldUp = computed(() => task.value?.heldUp || []);
const stoppedSince = computed(() => {
  const since = ago(task.value?.agentStateAt);
  return !since ? 'Stopped' : since === 'just now' ? 'Stopped just now' : `Stopped ${since} ago`;
});
// The cards this one may wait on: open cards on this board, plus the current choice.
const waitsOnOptions = computed(() => [
  { label: 'Nothing', value: '' },
  ...boardTasks.value.filter((t) => t.id !== task.value?.id && (t.status !== 'done' || t.id === task.value?.waitsOn)).map((t) => ({ label: t.title, value: t.id })),
]);
// What happened since a person last touched the card: the agent's and the team lead's steps.
const ladder = computed(() => {
  const comments = task.value?.comments || [];
  let start = 0;
  comments.forEach((c, index) => { if (c.author.kind === 'person') start = index + 1; });
  return comments.slice(start).slice(-6).map((c) => ({
    id: c.id,
    text: (c.author.kind === 'agent' ? who(c.author) + ': ' : '') + String(c.body).split('\n')[0].slice(0, 160),
    when: ago(c.createdAt),
  }));
});
const canAddRule = computed(() => Boolean(lead.value.leadAgentId) && ['owner', 'admin'].includes(ctx.role.value));
const leadName = computed(() => (lead.value.leadAgentId ? who({ kind: 'agent', id: lead.value.leadAgentId }) : 'the team lead'));

async function load() {
  try {
    const next = await teamApi.task(props.workspaceId, props.taskId);
    task.value = next;
    if (!next.private) {
      // The board (for Waits on) and the team lead (for answers that become rules). The card shows
      // without them; if one fails to load, that control is the only thing missing.
      const [board, settings] = await Promise.allSettled([teamApi.tasks(props.workspaceId), teamApi.lead(props.workspaceId)]);
      boardTasks.value = board.status === 'fulfilled' && Array.isArray(board.value) ? board.value : [];
      if (settings.status === 'fulfilled' && settings.value) lead.value = settings.value;
      else if (settings.status === 'rejected') console.warn('[team] could not load the team lead:', settings.reason?.message);
    }
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
  if (kind === 'agent') ctx.toast('Assigned. The assistant starts on it now.');
}
async function decide(approve, saveAsDoc) {
  busy.value = true;
  try {
    const result = await teamApi.approve(props.workspaceId, task.value.id, { saveAsDoc });
    ctx.toast(result.doc ? 'Approved and saved as a file' : 'Approved');
    emit('changed');
    if (result.doc) emit('open-doc', result.doc.id);
  } catch (e) { ctx.toast(e.message); } finally { busy.value = false; await load(); }
}
async function sendBack() {
  const note = await ctx.prompt({ title: 'Send back', message: 'What should change? The assistant runs again with your note.', placeholder: 'e.g. Shorter, and use the Q3 prices', confirmText: 'Send back' });
  if (note === null) return;
  busy.value = true;
  try { await teamApi.sendBack(props.workspaceId, task.value.id, note); emit('changed'); } catch (e) { ctx.toast(e.message); } finally { busy.value = false; await load(); }
}
async function answer(choice) {
  const text = String(choice || '').trim();
  if (!text || busy.value) return;
  busy.value = true;
  try {
    await teamApi.answer(props.workspaceId, task.value.id, text, { addRule: addRule.value && canAddRule.value });
    ctx.toast(addRule.value && canAddRule.value ? `Sent. ${leadName.value} decides this from now on.` : 'Sent. The assistant carries on with your answer.');
    ownAnswer.value = '';
    addRule.value = false;
    emit('changed');
  } catch (e) { ctx.toast(e.message); } finally { busy.value = false; await load(); }
}
async function retry() {
  busy.value = true;
  try { await teamApi.retry(props.workspaceId, task.value.id); ctx.toast('Trying again.'); emit('changed'); } catch (e) { ctx.toast(e.message); } finally { busy.value = false; await load(); }
}
function takeIt() { save({ assignee: { kind: 'person', id: ctx.me.value } }); }
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
/** "Visible to": move the card to another teamspace, or make it private in your My Space. */
async function move(value) {
  if (!task.value) return;
  const toPrivate = value === PRIVATE_SCOPE;
  const home = homeSpaceOf(ctx.spaces.value || []);
  const to = toPrivate ? home?.id : value;
  if (!to) return;
  const where = toPrivate ? 'your My Space' : (ctx.spaces.value || []).find((s) => s.id === to)?.name || 'that teamspace';
  const agentLeaves = task.value.assignee?.kind === 'agent';
  const ok = await ctx.confirm({
    title: toPrivate ? 'Make this card private?' : `Move this card to ${where}?`,
    message: toPrivate ? 'Only you will see it, in My tasks. It leaves this board for everyone else.'
      : `It leaves ${props.spaceName || 'this teamspace'} with its thread.${agentLeaves ? ' Its agent stays here, so it arrives unassigned.' : ''}`,
    confirmText: toPrivate ? 'Make private' : 'Move',
  });
  if (!ok) return;
  busy.value = true;
  try {
    const moved = await teamApi.moveTask(props.workspaceId, task.value.id, { to, private: toPrivate, expectedRevision: task.value.revision });
    emit('changed');
    ctx.toast(moved.private ? 'Private now. It is in My tasks.' : `Moved to ${where}.`);
    if (moved.private) ctx.go({ view: 'mine' });
    else ctx.go({ view: 'space', space: moved.workspaceId, tab: 'board', task: moved.id });
  } catch (e) {
    ctx.toast(e.code === 'revision_conflict' ? 'A teammate changed this card. Showing their version now.' : e.message);
    await load();
  } finally {
    busy.value = false;
  }
}
async function remove() {
  if (!(await ctx.confirm({ title: 'Delete this card?', message: 'It disappears from the board for everyone.', confirmText: 'Delete', danger: true }))) return;
  try { await teamApi.deleteTask(props.workspaceId, task.value.id); emit('changed'); emit('close'); } catch (e) { ctx.toast(e.message); }
}

watch(() => props.taskId, () => { ownAnswer.value = ''; addRule.value = false; load(); });
watch(() => ctx.version.value, () => {
  const signal = ctx.lastSignal.value;
  if (!signal || signal.taskId === props.taskId || (signal.workspaceId === props.workspaceId && signal.kind === 'tasks')) load();
});
onMounted(load);
</script>

<style scoped>
/* A stopped card: why, what was tried, the choices. Colours follow the board's tags (mk.css). */
.stop-box { margin: 12px 0 4px; padding: 12px 14px; border: 1px solid rgba(var(--orange-rgb), 0.45); border-radius: 12px; background: rgba(var(--orange-rgb), 0.07); font-size: 13.5px; line-height: 1.45; }
.stop-box b { display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--text-primary); }
.stop-box p { margin: 6px 0; color: var(--text-primary); }
.stop-box small { font-size: 12.5px; color: var(--text-secondary); }
.stop-dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--amber-text); }
.section-label { margin: 16px 0 6px; }
.ladder { list-style: none; margin: 0; padding: 0; }
.ladder li { position: relative; display: grid; grid-template-columns: 20px 1fr auto; gap: 10px; padding: 0 0 12px; font-size: 13.5px; line-height: 1.4; color: var(--text-primary); }
.ladder li:not(:last-child)::before { content: ''; position: absolute; left: 9.5px; top: 21px; bottom: 2px; width: 1px; background: var(--line); }
.ladder li:last-child { padding-bottom: 0; }
.ladder-mark { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: rgba(var(--green-rgb), 0.14); color: var(--green-text); font-size: 11px; font-weight: 700; }
.ladder li.is-now .ladder-mark { background: var(--pink); color: var(--on-fill-brand); }
.ladder time { font-size: 11.5px; color: var(--text-tertiary); padding-top: 2px; }
.choices { display: grid; grid-template-columns: 1fr; gap: 8px; }
.choices > .primary, .choices > .btn { justify-content: center; width: 100%; min-height: 36px; }
.own-answer { display: flex; gap: 8px; }
.own-answer .field { flex: 1; min-width: 0; }
.rule { display: flex; align-items: flex-start; gap: 8px; padding: 9px 10px; border: 1px dashed var(--line); border-radius: 10px; font-size: 13px; color: var(--text-primary); cursor: pointer; }
.rule input { margin: 2px 0 0; accent-color: var(--pink); }
.rule small { display: block; margin-top: 2px; font-size: 12px; color: var(--text-tertiary); }
.checks { list-style: none; margin: 0; padding: 0; }
.checks li { display: flex; align-items: flex-start; gap: 10px; padding: 6px 0; font-size: 13.5px; color: var(--text-primary); border-bottom: 1px solid var(--line-light); }
.checks li:last-child { border-bottom: 0; }
.checks li small { display: block; font-size: 12px; color: var(--text-secondary); }
.check-mark { width: 18px; height: 18px; flex: none; border-radius: 50%; display: grid; place-items: center; font-size: 10px; font-weight: 700; background: var(--surface-active); color: var(--text-tertiary); }
.is-ok .check-mark { background: rgba(var(--green-rgb), 0.16); color: var(--green-text); }
.is-bad .check-mark { background: rgba(var(--orange-rgb), 0.16); color: var(--amber-text); }
.check-verdict { margin-left: auto; font-size: 12.5px; color: var(--text-secondary); white-space: nowrap; }
.held-up .r { padding: 8px 12px; }
</style>
