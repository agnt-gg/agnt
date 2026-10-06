<template>
  <BaseScreen
    screenId="LearningScreen"
    :leftPanelProps="{ activeSection: 'learning' }"
    :panelProps="rightPanelProps"
    @panel-action="handlePanel"
    @screen-change="(screen, opts) => $emit('screen-change', screen, opts)"
  >
    <template #default>
      <LearningBoard
        :data="snapshot"
        :waiting="waiting"
        :busy="busy"
        :error="error"
        :progress="progress"
        :selected-key="selectedKey"
        @select="item => (selected = item)"
        @refresh="refresh"
        @pause="paused => mutate('/settings', { paused })"
        @approve="approve"
        @dismiss="dismiss"
        @keep="keep"
        @undo="undo"
        @accept-insights="acceptInsights"
        @reject-insights="rejectInsights"
        @stop="stopRequested = true"
      />
    </template>
  </BaseScreen>
</template>
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import BaseScreen from '../../BaseScreen.vue';
import LearningBoard from './LearningBoard.vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config.js';
import { learningPanelRoute } from './learningPanelRoute.js';
import { inBatches } from './inBatches.js';

const store = useStore();
const emit = defineEmits(['screen-change']);
const empty = () => ({ settings: { paused: false }, findings: [], trials: [], policies: [], coverage: { events: 0, work: 0 } });
const snapshot = ref(empty()), busy = ref(false), error = ref('');
let controller = null, disposed = false;

// ── The learning loop (findings → trials → policies) ──
async function request(path, body) {
  const token = localStorage.getItem('token'); if (!token) throw new Error('Sign in to view account learning.');
  const response = await fetch(API_CONFIG.BASE_URL + '/learning' + path, { method: body ? 'POST' : 'GET', credentials: 'include', signal: controller?.signal, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json(); if (token !== localStorage.getItem('token')) throw new DOMException('Account changed', 'AbortError'); if (!response.ok) throw new Error(result.error || 'Learning is unavailable.'); return result;
}
async function refresh() {
  if (disposed || busy.value) return; busy.value = true; error.value = ''; controller = new AbortController();
  try { [snapshot.value] = await Promise.all([request(''), store.dispatch('insights/fetchEscalated')]); }
  catch (e) { if (e.name !== 'AbortError') error.value = e.message; }
  finally { busy.value = false; }
}
async function mutate(path, body) { if (busy.value || disposed) return; busy.value = true; error.value = ''; controller = new AbortController(); try { await request(path, body); snapshot.value = await request(''); } catch (e) { if (e.name !== 'AbortError') error.value = ({ insufficient_baseline: 'More known baseline calls are needed before starting this trial.', stale_finding: 'Evidence changed. Refresh and review the latest proposal.', stale_trial: 'This trial changed. Refresh before continuing.', learning_paused: 'Resume learning before activating a change.' }[e.message] || e.message); } finally { busy.value = false; } }
const approve = item => mutate('/findings/' + item.id + '/approve', { revision: item.revision, candidateHash: item.candidate_hash, durationDays: 7, minimumSamples: 20 });
const dismiss = item => mutate('/findings/' + item.id + '/dismiss', { revision: item.revision });
const keep = item => mutate('/trials/' + item.id + '/keep', { revision: item.revision, candidateHash: item.candidate_hash });
const undo = item => mutate('/trials/' + item.id + '/undo', { revision: item.revision });

// ── The escalation queue (insights waiting for a yes or no) ──
const waiting = computed(() => store.getters['insights/escalatedInsights'] || []);
// Accept can call a model per insight: the server takes 50 at a time. Reject
// is one statement per batch; 500 stays clear of SQLite's parameter limit.
const ACCEPT_BATCH = 50, REJECT_BATCH = 500;
const progress = ref(null), stopRequested = ref(false);
watch(stopRequested, stopping => { if (progress.value) progress.value = { ...progress.value, stopping }; });

async function runQueue(verb, ids, size, work) {
  if (busy.value || disposed || !ids.length) return;
  busy.value = true; error.value = ''; stopRequested.value = false;
  progress.value = ids.length > size ? { verb, done: 0, total: ids.length, stoppable: true, stopping: false } : null;
  try {
    return await inBatches(ids, size, work, {
      shouldStop: () => stopRequested.value || disposed,
      onProgress: done => { if (progress.value) progress.value = { ...progress.value, done }; },
    });
  } catch (e) {
    error.value = e.message || 'Something went wrong. Refresh and try again.';
  } finally {
    progress.value = null; stopRequested.value = false; busy.value = false;
    // Resynchronise with the server whatever happened: a batch that failed
    // mid-way may still have applied part of its work.
    store.dispatch('insights/fetchEscalated').catch(() => {});
    store.dispatch('insights/fetchStats').catch(() => {});
  }
}
async function acceptInsights(ids) {
  const run = await runQueue('Accepting', ids, ACCEPT_BATCH, batch => store.dispatch('insights/acceptEscalated', batch));
  const failed = run?.results.flatMap(r => r.failed) || [];
  if (failed.length) error.value = `${failed.length} ${failed.length === 1 ? 'action' : 'actions'} could not be applied and are still waiting: ${failed[0].error}`;
}
const rejectInsights = ids => runQueue('Rejecting', ids, REJECT_BATCH, batch => store.dispatch('insights/rejectEscalated', batch));

// ── Selection → right panel ──
const selected = ref(null);
const selectedKey = computed(() => (selected.value ? selected.value.kind + ':' + selected.value.id : ''));
// Keep the receipt current, and drop it once its item is gone (accepted,
// rejected, dismissed, or closed elsewhere).
watch([snapshot, waiting], () => {
  const item = selected.value; if (!item) return;
  const rows = item.kind === 'insight' ? waiting.value : item.kind === 'finding' ? snapshot.value.findings : snapshot.value.trials;
  const updated = rows.find(row => row.id === item.id);
  selected.value = updated ? { ...updated, kind: item.kind } : null;
});
const rightPanelProps = computed(() => ({
  selected: selected.value,
  busy: busy.value,
  paused: !!snapshot.value.settings.paused,
  summary: {
    waiting: waiting.value.length,
    attention: snapshot.value.findings.filter(x => x.state === 'detected' && x.occurrences >= 3 && x.independent_runs >= 2).length + snapshot.value.trials.filter(x => x.state === 'reviewed').length,
    watching: snapshot.value.trials.filter(x => x.state === 'watching').length,
    learned: snapshot.value.policies.filter(x => x.state === 'active').length,
  },
}));
const VERBS = { approve, dismiss, keep, undo, accept: item => acceptInsights([item.id]), reject: item => rejectInsights([item.id]), close: () => (selected.value = null) };

// Learning shares the Settings nav: every row in it must lead somewhere from
// here (a Settings section opens Settings on that section). The right panel
// speaks in `learning` actions, performed here.
function handlePanel(action, payload) {
  if (action === 'learning') { VERBS[payload?.verb]?.(payload.item); return; }
  const target = learningPanelRoute(action, payload); if (target) emit('screen-change', target.screen, target.opts);
}
watch(() => store.state.userAuth?.user?.id || store.state.userAuth?.userId, () => { controller?.abort(); snapshot.value = empty(); selected.value = null; error.value = ''; });
onMounted(refresh);
onBeforeUnmount(() => { disposed = true; controller?.abort(); snapshot.value = empty(); });
</script>
