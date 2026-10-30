<template>
  <!-- A card Annie is waiting on, in the approved mockup's markup (tc-card,
       styled by One/mk/mk.css). Everything being approved is shown ABOVE the
       buttons. A decided card folds away; a final review stays open. -->
  <details v-if="folded" class="mk tc-card fold" :data-testid="`checkpoint-${target.id}`">
    <summary>
      <span class="tc-okfill"><MkIcon name="check" size="xs" /></span>
      <span class="tc-kick">{{ KIND_LABELS[kind] || 'Card' }}</span><span class="tc-title">{{ title }}</span>
      <span class="tc-tag" :class="tagTone">{{ STATE_LABELS[state] }}</span>
    </summary>
    <!-- eslint-disable-next-line vue/no-v-html -- markdown sanitised by DOMPurify, as every chat message is -->
    <div class="tc-body message-text" v-html="html"></div>
  </details>
  <div v-else class="mk tc-card" :class="{ 'is-open': isPending }" :data-testid="`checkpoint-${target.id}`">
    <div class="tc-head">
      <span v-if="isPending" class="tc-gate"></span>
      <span v-else class="tc-okfill"><MkIcon name="check" size="xs" /></span>
      <span class="tc-kick">{{ KIND_LABELS[kind] || 'Card' }}</span><span class="tc-title">{{ title }}</span>
      <span class="tc-tag" :class="tagTone">{{ STATE_LABELS[state] }}</span>
    </div>
    <!-- eslint-disable-next-line vue/no-v-html -- markdown sanitised by DOMPurify, as every chat message is -->
    <div v-if="checkpoint" class="tc-body message-text" v-html="html"></div>
    <div v-else class="tc-body">Loading the card…</div>
    <div v-if="checkpoint?.task" class="tc-body" style="padding-top: 0">
      <button type="button" class="link" @click="openTask"><MkIcon name="task" size="xs" /> {{ checkpoint.taskTitle ? 'Task: ' + checkpoint.taskTitle : 'Open the task' }}</button>
    </div>
    <div v-if="isPending" class="tc-foot">
      <button type="button" class="primary" :disabled="busy" @click="decide('approved')">{{ APPROVE_LABELS[kind] || 'Approve' }}</button>
      <button type="button" class="btn sm" :disabled="busy" @click="askForChanges">Ask for changes</button>
      <button v-if="kind === 'run'" type="button" class="btn ghost sm" :disabled="busy" @click="decide('skipped')">Skip this run</button>
      <span class="tc-hint">Nothing happens until you approve.</span>
    </div>
    <div v-if="error" class="tc-body" role="alert" style="color: var(--color-pink)">{{ error }}</div>
  </div>
</template>

<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue';
import { useStore } from 'vuex';
import DOMPurify from 'dompurify';
import { renderMarkdown } from '@/utils/markdownPipeline';
import { useCheckpoints } from '@/composables/useCheckpoints.js';
import MkIcon from '@/views/One/mk/MkIcon.vue';
import '@/views/One/mk/mk.css';
import { KIND_LABELS, APPROVE_LABELS, STATE_LABELS, decisionReply } from './checkpointCards.js';

const props = defineProps({ target: { type: Object, required: true } });
const store = useStore();
const nav = inject('focusedNav', null);
const checkpoints = useCheckpoints();
const busy = ref(false);
const error = ref('');

const checkpoint = computed(() => checkpoints.get(props.target.id));
const kind = computed(() => checkpoint.value?.kind || props.target.kind);
const title = computed(() => checkpoint.value?.title || props.target.title);
const state = computed(() => checkpoint.value?.state || 'pending');
const isPending = computed(() => state.value === 'pending');
const folded = computed(() => !!checkpoint.value && !isPending.value && kind.value !== 'final');
const tagTone = computed(() => (isPending.value ? 'need' : ['changes', 'skipped', 'superseded'].includes(state.value) ? 'amber' : 'ok'));
const html = computed(() => DOMPurify.sanitize(renderMarkdown(checkpoint.value?.content || '')));

function ask(text, send) {
  window.dispatchEvent(new CustomEvent('agnt:ask-annie', { detail: { text, send } }));
}
async function decide(decision) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const decided = await checkpoints.decide(props.target.id, decision);
    ask(decisionReply(decided, decision), true); // Annie carries on from the reply, in this chat
  } catch (e) {
    error.value = e.code === 'not_pending' ? e.message : 'Couldn’t record that. ' + e.message;
    checkpoints.load(props.target.id);
  } finally {
    busy.value = false;
  }
}
function askForChanges() {
  ask(`Change to “${title.value}”: `, false); // typed in the composer, nothing sent
}
function openTask() {
  const task = checkpoint.value?.task;
  if (task && nav) nav.go({ page: 'team', view: 'space', space: task.workspaceId, tab: 'board', task: task.id });
}
/** Remember which saved chat this card is in, so Home's "Review" reopens it. */
function locateOnce() {
  const outputId = store.state.chat?.savedOutputId;
  if (checkpoint.value && !checkpoint.value.outputId && outputId) checkpoints.locate(props.target.id, String(outputId));
}
onMounted(async () => {
  if (!checkpoint.value) await checkpoints.load(props.target.id);
  locateOnce();
});
watch(() => store.state.chat?.savedOutputId, locateOnce);
</script>
