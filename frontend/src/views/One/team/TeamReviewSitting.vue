<template>
  <div class="layer" role="dialog" aria-modal="true" aria-label="Review assistant results" data-testid="review-sitting" @click.self="$emit('close')">
    <div class="modal sitting">
      <div class="modal-head">
        <h3 v-if="!finished">Review assistant results <span class="sitting-count">{{ index + 1 }} of {{ queue.length }}</span></h3>
        <h3 v-else>All reviewed</h3>
        <button type="button" class="btn ghost sm" aria-label="Close" @click="$emit('close')">Close</button>
      </div>
      <div v-if="!finished" class="modal-body">
        <p class="sitting-where">{{ spaceName(current.workspaceId) }}<template v-if="detail?.assignee"> · {{ who(detail.assignee) }}</template></p>
        <h4 class="sitting-title">{{ current.title }}</h4>
        <p v-if="loadError" class="mk-error">{{ loadError }}</p>
        <div v-else-if="!detail" class="mk-muted">Loading…</div>
        <template v-else>
          <div class="tc-docprev sitting-result" data-testid="sitting-result">{{ detail.result || 'The assistant finished without text.' }}</div>
          <ul v-if="detail.checks?.length" class="sitting-checks">
            <li v-for="check in detail.checks" :key="check.label" :class="check.ok === true ? 'is-ok' : check.ok === false ? 'is-bad' : ''">
              <span aria-hidden="true">{{ check.ok === true ? '✓' : check.ok === false ? '✕' : '?' }}</span>{{ check.label }}<small v-if="check.detail"> · {{ check.detail }}</small>
            </li>
          </ul>
        </template>
      </div>
      <div v-else class="modal-body">
        <p data-testid="sitting-summary">{{ summary }}</p>
      </div>
      <div class="modal-foot">
        <template v-if="!finished">
          <span class="sitting-keys">A approve · S send back · J skip</span>
          <button type="button" class="btn ghost" :disabled="busy" @click="skip">Skip</button>
          <button type="button" class="btn" :disabled="busy || !detail" @click="sendBack">Send back</button>
          <button type="button" class="primary" :disabled="busy || !detail" @click="approve">Approve</button>
        </template>
        <button v-else type="button" class="primary" @click="$emit('close')">Done</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, inject, onMounted, onBeforeUnmount } from 'vue';
import { teamApi } from './useTeam.js';
import { nameOf, plural } from './teamModel.js';

/**
 * One sitting for the agent results waiting for review: each result in turn, decided with a
 * button or a key, instead of one interruption per card. The queue is fixed when it opens.
 */
const props = defineProps({ tasks: { type: Array, required: true } });
const emit = defineEmits(['close', 'changed']);
const ctx = inject('teamCtx');

const queue = ref(props.tasks.map((t) => ({ id: t.id, workspaceId: t.workspaceId, title: t.title })));
const index = ref(0);
const detail = ref(null);
const loadError = ref('');
const busy = ref(false);
const tally = ref({ approved: 0, sentBack: 0, skipped: 0, taken: 0 });
const finished = computed(() => index.value >= queue.value.length);
const current = computed(() => queue.value[index.value] || null);
const spaceName = (id) => (ctx.spaces.value || []).find((s) => s.id === id)?.name || 'Teamspace';
const who = (ref_) => nameOf(ref_, { people: ctx.people.value, agents: [], me: ctx.me.value });
const summary = computed(() => {
  const { approved, sentBack, skipped, taken } = tally.value;
  const parts = [approved && `${approved} approved`, sentBack && `${sentBack} sent back`, skipped && `${skipped} skipped`, taken && `${plural(taken, 'card')} decided by someone else`].filter(Boolean);
  return parts.length ? parts.join(', ') + '.' : 'Nothing was decided.';
});

async function loadCurrent() {
  detail.value = null;
  loadError.value = '';
  if (!current.value) return;
  const wanted = current.value.id;
  try {
    const card = await teamApi.task(current.value.workspaceId, wanted);
    if (current.value?.id !== wanted) return;
    // Decided while the sitting was open (by a teammate, or in another window): move on.
    if (card.agentState !== 'waiting') { tally.value.taken++; next(); return; }
    detail.value = card;
  } catch (error) {
    loadError.value = error.status === 404 ? 'This card was deleted.' : error.message;
  }
}
function next() { index.value++; }
function skip() { if (busy.value) return; tally.value.skipped++; next(); }

async function decide(run, counter) {
  if (busy.value || !detail.value) return;
  busy.value = true;
  try {
    await run();
    tally.value[counter]++;
    emit('changed');
    next();
  } catch (error) {
    if (error.code === 'not_waiting') { tally.value.taken++; next(); } else ctx.toast(error.message);
  } finally {
    busy.value = false;
  }
}
const approve = () => decide(() => teamApi.approve(current.value.workspaceId, current.value.id, {}), 'approved');
async function sendBack() {
  if (busy.value || !detail.value) return;
  busy.value = true;
  const note = await ctx.prompt({ title: 'Send back', message: 'What should change? The assistant runs again with your note.', placeholder: 'e.g. Shorter, and use the Q3 prices', confirmText: 'Send back' });
  busy.value = false;
  if (note === null) return;
  await decide(() => teamApi.sendBack(current.value.workspaceId, current.value.id, note), 'sentBack');
}

function onKey(event) {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'Escape') { emit('close'); return; }
  // Typing in a field (the send-back note) is never a shortcut.
  if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]') || busy.value || finished.value) return;
  const key = event.key.toLowerCase();
  if (key === 'a') { event.preventDefault(); approve(); }
  else if (key === 's') { event.preventDefault(); sendBack(); }
  else if (key === 'j') { event.preventDefault(); skip(); }
}

watch(index, loadCurrent);
onMounted(() => { loadCurrent(); document.addEventListener('keydown', onKey); });
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<style scoped>
.sitting { width: min(720px, 94vw); }
.sitting-count { margin-left: 6px; font-size: 13px; font-weight: 400; color: var(--text-tertiary); }
.sitting-where { margin: 0 0 2px; font-size: 12.5px; color: var(--text-tertiary); }
.sitting-title { margin: 0 0 10px; font-size: 16px; font-weight: 600; }
.sitting-result { max-height: 46vh; }
.sitting-checks { list-style: none; margin: 10px 0 0; padding: 0; font-size: 13px; }
.sitting-checks li { display: flex; gap: 8px; padding: 3px 0; color: var(--text-primary); }
.sitting-checks li small { color: var(--text-secondary); }
.sitting-checks li.is-ok span { color: var(--green-text); }
.sitting-checks li.is-bad span { color: var(--amber-text); }
.sitting-keys { margin-right: auto; align-self: center; font-size: 12px; color: var(--text-tertiary); }
</style>
