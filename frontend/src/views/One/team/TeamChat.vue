<template>
  <div class="chat-wrap">
    <div ref="logRef" class="log" aria-live="polite">
      <p v-if="!loading && !messages.length" class="empty">No messages yet. Say hello, or @mention an agent to hand it work.</p>
      <div v-for="m in shown" :key="m.id" class="msg" :class="{ 'is-live': m.live }" tabindex="-1" :data-message="m.id">
        <TeamAvatar :who="m.author" :label="displayName(m.author)" size="lg" />
        <div class="msg-body">
          <div class="msg-name">
            {{ displayName(m.author) }}<span v-if="m.author.kind === 'agent'" class="tag pink" style="margin-left: 6px">Agent</span><span class="msg-time">{{ m.live ? 'writing…' : ago(m.createdAt) }}</span>
          </div>
          <!-- The main chat's own renderer: markdown, code, tables, images, tool cards, streaming. -->
          <MessageItem
            class="team-msg-item"
            :message="chatMessageOf(m)"
            :show-avatar="false"
            :compact="true"
            :expanded-tool-calls="expandedToolCalls"
            :status="m.live ? { text: 'Annie is working…' } : null"
            @toggle-tool="onToggleTool"
          />
          <button v-if="m.taskId" type="button" class="attach" @click="$emit('open-task', m.taskId)"><i class="far fa-check-square" aria-hidden="true"></i>Open the card</button>
        </div>
        <div v-if="canWrite && !m.live" class="msg-actions">
          <button v-if="!m.taskId" type="button" @click="toTask(m)"><i class="far fa-check-square" aria-hidden="true"></i>Create task</button>
          <button v-if="!m.taskId && agents.length" type="button" @click="toAgent(m)"><i class="fas fa-robot" aria-hidden="true"></i>Hand to {{ agents[0].name }}</button>
          <button type="button" @click="toDoc(m)"><i class="far fa-file-alt" aria-hidden="true"></i>Save to doc</button>
          <button v-if="canDelete(m)" type="button" aria-label="Delete message" @click="remove(m)"><i class="far fa-trash-alt" aria-hidden="true"></i></button>
        </div>
      </div>
    </div>
    <form v-if="canWrite" class="composer" style="position: relative" @submit.prevent="send">
      <!-- @ picker: Annie, teammates and this teamspace's agents. -->
      <ul v-if="picker.open && options.length" class="mk-mentions" role="listbox" aria-label="Mention" data-testid="mention-picker">
        <li v-for="(o, i) in options" :key="o.kind + o.id" role="option" :aria-selected="i === picker.index" :class="{ on: i === picker.index }" @mousedown.prevent="pick(o)">
          <TeamAvatar :who="{ kind: o.kind, id: o.id }" :label="o.name" size="sm" /><span class="mk-mentions-n">{{ o.name }}</span><span class="mk-mentions-h">{{ o.hint }}</span>
        </li>
      </ul>
      <textarea ref="inputRef" v-model="draft" rows="1" :placeholder="`Message ${spaceName} — @mention a teammate, an agent or Annie`" aria-label="Message" @keydown="onKey" @input="onInput" @click="onInput" @blur="picker.open = false"></textarea>
      <div class="composer-row">
        <button v-for="a in chips" :key="a.id" type="button" class="mention-chip" @click="insert(a.name)"><TeamAvatar :who="{ kind: 'agent', id: a.id }" size="sm" />@{{ a.name }}</button>
        <button class="send" type="submit" data-tour-id="team-send" :disabled="!draft.trim() || sending" aria-label="Send"><i class="fas fa-arrow-up" aria-hidden="true"></i></button>
      </div>
    </form>
    <p v-else class="mk-muted">You can read this teamspace. Ask an admin for edit access to post.</p>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick, inject, onMounted } from 'vue';
import TeamAvatar from './TeamAvatar.vue';
import MessageItem from '@/views/Terminal/CenterPanel/screens/Chat/components/MessageItem.vue';
import { chatMessageOf } from './teamChatMessage.js';
import { teamApi } from './useTeam.js';
import { ago, mentionsIn, nameOf, ANNIE, mentionAt, mentionOptions } from './teamModel.js';

const props = defineProps({
  workspaceId: { type: String, required: true },
  spaceName: { type: String, default: 'the team' },
  agents: { type: Array, default: () => [] },
});
const emit = defineEmits(['open-task', 'open-doc']);
const ctx = inject('teamCtx');

const messages = ref([]);
// Replies being written right now (Annie streaming), shown after the saved messages.
const liveMessages = ref([]);
const shown = computed(() => [...messages.value, ...liveMessages.value]);
const expandedToolCalls = reactive({});
// MessageItem emits ('toggle-tool', messageId, index), as in the main chat.
function onToggleTool(messageId, index) {
  if (messageId == null) return;
  const open = new Set(expandedToolCalls[messageId] || []);
  open.has(index) ? open.delete(index) : open.add(index);
  expandedToolCalls[messageId] = [...open];
}
const loading = ref(true);
const draft = ref('');
const sending = ref(false);
const logRef = ref(null);
const inputRef = ref(null);
const canWrite = computed(() => ctx.canWrite.value);
// Annie is taggable everywhere; the server answers her as the person who tagged her.
const taggableAgents = computed(() => [ANNIE, ...props.agents]);
const chips = computed(() => taggableAgents.value.slice(0, 3));
const names = computed(() => [...taggableAgents.value.map((a) => a.name), ...ctx.people.value.flatMap((p) => [p.name, p.first])]);
const picker = reactive({ open: false, query: '', start: 0, index: 0 });
// Only the people in this teamspace can be tagged in it.
const spaceMemberIds = inject('spaceMemberIds', null);
const taggablePeople = computed(() => ctx.people.value.filter((p) => !spaceMemberIds?.value || spaceMemberIds.value.includes(p.id)));
const options = computed(() => mentionOptions(picker.query, { people: taggablePeople.value, agents: props.agents, me: ctx.me.value }));
function onInput() {
  grow();
  const el = inputRef.value;
  const at = el ? mentionAt(draft.value, el.selectionStart) : null;
  if (!at) { picker.open = false; return; }
  Object.assign(picker, { open: true, query: at.query, start: at.start, index: 0 });
}
function pick(option) {
  const el = inputRef.value;
  const caret = el ? el.selectionStart : draft.value.length;
  draft.value = draft.value.slice(0, picker.start) + '@' + option.name + ' ' + draft.value.slice(caret);
  picker.open = false;
  nextTick(() => { if (!el) return; const pos = picker.start + option.name.length + 2; el.focus(); el.setSelectionRange(pos, pos); grow(); });
}
function onKey(event) {
  if (picker.open && options.value.length) {
    if (event.key === 'ArrowDown') { event.preventDefault(); picker.index = (picker.index + 1) % options.value.length; return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); picker.index = (picker.index - 1 + options.value.length) % options.value.length; return; }
    if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); pick(options.value[picker.index]); return; }
    if (event.key === 'Escape') { event.preventDefault(); picker.open = false; return; }
  }
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); }
}
const displayName = (ref_) => {
  const name = nameOf(ref_, { people: ctx.people.value, agents: props.agents, me: ctx.me.value });
  return name === 'You' ? ctx.people.value.find((p) => p.isMe)?.first || 'You' : name;
};
const canDelete = (m) => (m.author.kind === 'person' && m.author.id === ctx.me.value) || ['owner', 'admin'].includes(ctx.role.value);

async function loadLive() {
  try {
    const nearBottom = !logRef.value || logRef.value.scrollHeight - logRef.value.scrollTop - logRef.value.clientHeight < 120;
    liveMessages.value = await teamApi.liveMessages(props.workspaceId);
    if (nearBottom) { await nextTick(); if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight; }
  } catch { liveMessages.value = []; }
}
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
    await teamApi.postMessage(props.workspaceId, body, mentionsIn(body, { people: taggablePeople.value, agents: taggableAgents.value }), props.spaceName);
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
    ctx.toast('Added to Tasks');
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
    ctx.toast('Saved as a doc in this teamspace’s Files');
    emit('open-doc', doc.id);
  } catch (error) { ctx.toast(error.message); }
}
async function remove(m) {
  if (!(await ctx.confirm({ title: 'Delete message?', message: 'Teammates will no longer see it.', confirmText: 'Delete', danger: true }))) return;
  try { await teamApi.deleteMessage(props.workspaceId, m.id); await load(); } catch (error) { ctx.toast(error.message); }
}

watch(() => props.workspaceId, () => { loading.value = true; messages.value = []; liveMessages.value = []; load({ scroll: true }); loadLive(); });
watch(() => ctx.version.value, () => {
  const signal = ctx.lastSignal.value;
  if (signal && signal.workspaceId !== props.workspaceId) return;
  // A streaming tick only refreshes the live reply; anything else refreshes the chat.
  if (signal?.live && !signal.done) { loadLive(); return; }
  load(); loadLive();
});
onMounted(() => { load({ scroll: true }); loadLive(); });
</script>

<style scoped>
/* MessageItem brings its own bubble padding and actions row for the main chat; here it sits under the
   author line, flush with it. */
.team-msg-item { margin: 2px 0 0; }
.team-msg-item :deep(.message) { padding: 0; margin: 0; max-width: 100%; }
.team-msg-item :deep(.message-content) { padding: 0; }
.msg.is-live { opacity: 0.98; }
</style>
