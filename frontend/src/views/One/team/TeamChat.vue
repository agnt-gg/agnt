<template>
  <div class="chat-wrap">
    <div ref="logRef" class="log" aria-live="polite">
      <p v-if="!loading && !messages.length" class="empty">No messages yet. Say hello, or @mention an agent to hand it work.</p>
      <div v-for="m in messages" :key="m.id" class="msg" tabindex="-1">
        <TeamAvatar :who="m.author" :label="displayName(m.author)" size="lg" />
        <div class="msg-body">
          <div class="msg-name">
            {{ displayName(m.author) }}<span v-if="m.author.kind === 'agent'" class="tag pink" style="margin-left: 6px">Agent</span><span class="msg-time">{{ ago(m.createdAt) }}</span>
          </div>
          <div class="msg-text"><template v-for="(run, i) in runsOf(m.body)" :key="i"><span v-if="run.mention" class="mention">{{ run.text }}</span><template v-else>{{ run.text }}</template></template></div>
          <button v-if="m.taskId" type="button" class="attach" @click="$emit('open-task', m.taskId)"><i class="far fa-check-square" aria-hidden="true"></i>Open the card</button>
        </div>
        <div v-if="canWrite" class="msg-actions">
          <button v-if="!m.taskId" type="button" @click="toTask(m)"><i class="far fa-check-square" aria-hidden="true"></i>Create task</button>
          <button v-if="!m.taskId && agents.length" type="button" @click="toAgent(m)"><i class="fas fa-robot" aria-hidden="true"></i>Hand to {{ agents[0].name }}</button>
          <button type="button" @click="toDoc(m)"><i class="far fa-file-alt" aria-hidden="true"></i>Save to doc</button>
          <button v-if="canDelete(m)" type="button" aria-label="Delete message" @click="remove(m)"><i class="far fa-trash-alt" aria-hidden="true"></i></button>
        </div>
      </div>
    </div>
    <form v-if="canWrite" class="composer" @submit.prevent="send">
      <textarea ref="inputRef" v-model="draft" rows="1" :placeholder="`Message ${spaceName}. @mention a teammate, or an agent to hand it work`" aria-label="Message" @keydown.enter.exact.prevent="send" @input="grow"></textarea>
      <div class="composer-row">
        <button v-for="a in agents.slice(0, 3)" :key="a.id" type="button" class="mention-chip" @click="insert(a.name)"><TeamAvatar :who="{ kind: 'agent', id: a.id }" size="sm" />@{{ a.name }}</button>
        <button class="send" type="submit" data-tour-id="team-send" :disabled="!draft.trim() || sending" aria-label="Send"><i class="fas fa-arrow-up" aria-hidden="true"></i></button>
      </div>
    </form>
    <p v-else class="mk-muted">You can read this teamspace. Ask an admin for edit access to post.</p>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, inject, onMounted } from 'vue';
import TeamAvatar from './TeamAvatar.vue';
import { teamApi } from './useTeam.js';
import { ago, mentionsIn, mentionRuns, nameOf } from './teamModel.js';

const props = defineProps({
  workspaceId: { type: String, required: true },
  spaceName: { type: String, default: 'the team' },
  agents: { type: Array, default: () => [] },
});
const emit = defineEmits(['open-task', 'open-doc']);
const ctx = inject('teamCtx');

const messages = ref([]);
const loading = ref(true);
const draft = ref('');
const sending = ref(false);
const logRef = ref(null);
const inputRef = ref(null);
const canWrite = computed(() => ctx.canWrite.value);
const names = computed(() => [...props.agents.map((a) => a.name), ...ctx.people.value.flatMap((p) => [p.name, p.first])]);
const runsOf = (body) => mentionRuns(body, names.value);
const displayName = (ref_) => {
  const name = nameOf(ref_, { people: ctx.people.value, agents: props.agents, me: ctx.me.value });
  return name === 'You' ? ctx.people.value.find((p) => p.isMe)?.first || 'You' : name;
};
const canDelete = (m) => (m.author.kind === 'person' && m.author.id === ctx.me.value) || ['owner', 'admin'].includes(ctx.role.value);

async function load({ scroll = false } = {}) {
  try {
    const nearBottom = !logRef.value || logRef.value.scrollHeight - logRef.value.scrollTop - logRef.value.clientHeight < 80;
    messages.value = await teamApi.messages(props.workspaceId);
    if (scroll || nearBottom) { await nextTick(); if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight; }
  } catch (error) {
    ctx.toast(error.message);
  } finally {
    loading.value = false;
  }
}

async function send() {
  const body = draft.value.trim();
  if (!body || sending.value) return;
  sending.value = true;
  try {
    await teamApi.postMessage(props.workspaceId, body, mentionsIn(body, { people: ctx.people.value, agents: props.agents }));
    draft.value = '';
    grow();
    await load({ scroll: true });
  } catch (error) {
    ctx.toast(error.message);
  } finally {
    sending.value = false;
  }
}
function insert(name) {
  draft.value = (draft.value ? draft.value.trimEnd() + ' ' : '') + '@' + name + ' ';
  inputRef.value?.focus();
}
function grow() {
  const el = inputRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}
const titleFrom = (body) => body.replace(/\s+/g, ' ').trim().slice(0, 120) || 'From chat';

async function toTask(m) {
  try {
    const task = await teamApi.createTask(props.workspaceId, { title: titleFrom(m.body), sourceMessageId: m.id });
    await load();
    ctx.toast('Card created on the board');
    emit('open-task', task.id);
  } catch (error) { ctx.toast(error.message); }
}
async function toAgent(m) {
  try {
    const agent = props.agents[0];
    const task = await teamApi.createTask(props.workspaceId, { title: titleFrom(m.body), sourceMessageId: m.id, assignee: { kind: 'agent', id: agent.id } });
    await load();
    ctx.toast(`${agent.name} is on it`);
    emit('open-task', task.id);
  } catch (error) { ctx.toast(error.message); }
}
async function toDoc(m) {
  try {
    const doc = await teamApi.createDoc(props.workspaceId, 'From chat: ' + titleFrom(m.body).slice(0, 60), m.body);
    ctx.toast('Saved as a doc in this teamspace');
    emit('open-doc', doc.id);
  } catch (error) { ctx.toast(error.message); }
}
async function remove(m) {
  if (!(await ctx.confirm({ title: 'Delete message?', message: 'Teammates will no longer see it.', confirmText: 'Delete', danger: true }))) return;
  try { await teamApi.deleteMessage(props.workspaceId, m.id); await load(); } catch (error) { ctx.toast(error.message); }
}

watch(() => props.workspaceId, () => { loading.value = true; messages.value = []; load({ scroll: true }); });
watch(() => ctx.version.value, () => {
  const signal = ctx.lastSignal.value;
  if (!signal || signal.workspaceId === props.workspaceId) load();
});
onMounted(() => load({ scroll: true }));
</script>
