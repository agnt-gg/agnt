<template>
  <!-- A card Annie is waiting on. Everything being approved is shown ABOVE
       the buttons; nothing is approved that is not on screen. A decided card
       folds away (a final review stays open: it is the record). -->
  <component
    :is="folded ? 'details' : 'div'"
    class="tc-card"
    :class="{ 'is-open': isPending, 'is-folded': folded }"
    :data-testid="`checkpoint-${target.id}`"
  >
    <component :is="folded ? 'summary' : 'div'" class="tc-head">
      <span v-if="isPending" class="tc-gate" aria-hidden="true"></span>
      <span v-else class="tc-done" aria-hidden="true"><i class="fas fa-check"></i></span>
      <span class="tc-kick">{{ KIND_LABELS[kind] || 'Card' }}</span>
      <span class="tc-title">{{ checkpoint?.title || target.title }}</span>
      <span class="tc-tag" :class="'is-' + (checkpoint?.state || 'pending')">{{ STATE_LABELS[checkpoint?.state || 'pending'] }}</span>
    </component>
    <!-- eslint-disable-next-line vue/no-v-html -- markdown sanitised by DOMPurify, as every chat message is -->
    <div v-if="checkpoint" class="tc-body message-text" v-html="html"></div>
    <p v-else class="tc-body tc-muted">Loading the card…</p>
    <div v-if="checkpoint?.task" class="tc-task">
      <button type="button" class="tc-link" @click="openTask"><i class="far fa-check-square" aria-hidden="true"></i> {{ taskLabel }}</button>
    </div>
    <div v-if="isPending" class="tc-foot">
      <button type="button" class="tc-primary" :disabled="busy" @click="decide('approved')">{{ APPROVE_LABELS[kind] || 'Approve' }}</button>
      <button type="button" class="tc-btn" :disabled="busy" @click="askForChanges">Ask for changes</button>
      <button v-if="kind === 'run'" type="button" class="tc-btn is-ghost" :disabled="busy" @click="decide('skipped')">Skip this run</button>
      <span class="tc-hint">Nothing happens until you approve.</span>
    </div>
    <p v-if="error" class="tc-error" role="alert">{{ error }}</p>
  </component>
</template>

<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue';
import { useStore } from 'vuex';
import DOMPurify from 'dompurify';
import { renderMarkdown } from '@/utils/markdownPipeline';
import { useCheckpoints } from '@/composables/useCheckpoints.js';
import { KIND_LABELS, APPROVE_LABELS, STATE_LABELS, decisionReply } from './checkpointCards.js';

const props = defineProps({ target: { type: Object, required: true } });
const store = useStore();
const nav = inject('focusedNav', null);
const checkpoints = useCheckpoints();
const busy = ref(false);
const error = ref('');

const checkpoint = computed(() => checkpoints.get(props.target.id));
const kind = computed(() => checkpoint.value?.kind || props.target.kind);
const isPending = computed(() => (checkpoint.value?.state || 'pending') === 'pending');
const folded = computed(() => !!checkpoint.value && !isPending.value && kind.value !== 'final');
const html = computed(() => DOMPurify.sanitize(renderMarkdown(checkpoint.value?.content || '')));
const taskLabel = computed(() => (checkpoint.value?.taskTitle ? `Task: ${checkpoint.value.taskTitle}` : 'Open the task'));

function ask(text, send) {
  window.dispatchEvent(new CustomEvent('agnt:ask-annie', { detail: { text, send } }));
}
async function decide(decision) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const decided = await checkpoints.decide(props.target.id, decision);
    // Annie carries on from the person's reply, in this same chat.
    ask(decisionReply(decided, decision), true);
  } catch (e) {
    error.value = e.code === 'not_pending' ? e.message : 'Couldn’t record that. ' + e.message;
    checkpoints.load(props.target.id);
  } finally {
    busy.value = false;
  }
}
function askForChanges() {
  // Typed in the composer, not sent: the person says what to change.
  ask(`Change to “${checkpoint.value?.title || props.target.title}”: `, false);
}
function openTask() {
  const task = checkpoint.value?.task;
  if (!task || !nav) return;
  nav.go({ page: 'team', view: 'space', space: task.workspaceId, tab: 'board', task: task.id });
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

<style scoped>
.tc-card { margin: 8px 0 4px; border: 1px solid var(--terminal-border-color); border-radius: 14px; background: var(--color-background); overflow: hidden; }
.tc-card.is-open { border-color: rgba(var(--pink-rgb), 0.45); box-shadow: 0 0 0 3px rgba(var(--pink-rgb), 0.07); }
.tc-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--terminal-border-color); cursor: default; list-style: none; }
.tc-card.is-folded .tc-head { border-bottom: 0; cursor: pointer; }
.tc-card.is-folded[open] .tc-head { border-bottom: 1px solid var(--terminal-border-color); }
.tc-head::-webkit-details-marker { display: none; }
.tc-gate { width: 9px; height: 9px; flex: none; border-radius: 50%; background: var(--color-pink); }
.tc-done { width: 16px; height: 16px; flex: none; display: grid; place-items: center; border-radius: 50%; background: var(--surface-active); color: var(--text-secondary); font-size: 8px; }
.tc-kick { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); }
.tc-title { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tc-tag { padding: 1px 8px; border-radius: 999px; font-size: 11.5px; background: var(--surface-active); color: var(--text-secondary); white-space: nowrap; }
.tc-tag.is-pending { background: rgba(var(--pink-rgb), 0.1); color: var(--color-pink); }
.tc-tag.is-changes, .tc-tag.is-skipped { background: rgba(var(--orange-rgb), 0.14); color: var(--text-orange); }
.tc-body { padding: 10px 14px 4px; font-size: 14px; }
.tc-muted { color: var(--text-tertiary); }
.tc-task { padding: 0 14px 6px; }
.tc-link { padding: 0; border: 0; background: none; color: var(--text-secondary); font: inherit; font-size: 12.5px; cursor: pointer; text-decoration: underline; text-decoration-color: var(--terminal-border-color); text-underline-offset: 3px; }
.tc-link:hover { color: var(--text-primary); }
.tc-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 14px 12px; border-top: 1px solid var(--terminal-border-color); }
.tc-primary { min-height: 32px; padding: 0 15px; border: 1px solid transparent; border-radius: 999px; background: var(--text-primary); color: var(--color-dark-navy); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.tc-primary:hover:not(:disabled) { opacity: 0.86; }
.tc-btn { min-height: 30px; padding: 0 12px; border: 1px solid var(--terminal-border-color); border-radius: 999px; background: transparent; color: var(--text-primary); font: inherit; font-size: 12.5px; cursor: pointer; }
.tc-btn:hover:not(:disabled) { background: var(--surface-hover); }
.tc-btn.is-ghost { border-color: transparent; }
.tc-primary:disabled, .tc-btn:disabled { opacity: 0.55; cursor: default; }
.tc-hint { margin-left: auto; font-size: 12px; color: var(--text-tertiary); }
.tc-error { margin: 0; padding: 0 14px 10px; font-size: 12.5px; color: var(--color-pink); }
</style>
