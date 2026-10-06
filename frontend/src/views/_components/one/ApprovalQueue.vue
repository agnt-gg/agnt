<!-- ApprovalQueue — the right panel's "Awaiting approval": approve or reject
     one action, or all of them. "All" asks once and means the actions shown
     when you asked, not whatever arrives while it runs. Large runs walk the
     queue in batches with progress and a stop (useEscalationQueue). -->
<template>
  <div class="aq">
    <div v-if="items.length" class="row bulk">
      <button class="btn" :disabled="busy" @click="ask('reject')">Reject all ({{ items.length }})</button>
      <button class="btn pri" :disabled="busy" @click="ask('accept')">Approve all ({{ items.length }})</button>
    </div>

    <div v-if="pending" class="card confirm" role="alertdialog" aria-live="polite">
      <div class="nm">
        {{ pending.verb === 'accept' ? 'Approve' : 'Reject' }} {{ pending.ids.length }} {{ pending.ids.length === 1 ? 'action' : 'actions' }}?
      </div>
      <div class="muted">{{ pending.verb === 'accept' ? 'Each one is applied to its agent, skill, workflow or tool.' : 'They leave the queue and are not applied.' }}</div>
      <div class="row actions">
        <button class="btn" @click="pending = null">Cancel</button>
        <button class="btn" :class="pending.verb === 'accept' ? 'pri' : 'danger'" @click="confirm">Confirm</button>
      </div>
    </div>

    <div v-if="progress" class="card" aria-live="polite">
      <div class="row">
        <span class="nm">{{ progress.verb }} {{ progress.done }} of {{ progress.total }}…</span>
        <button v-if="progress.stoppable" class="btn" :disabled="progress.stopping" @click="stop">{{ progress.stopping ? 'Stopping…' : 'Stop' }}</button>
      </div>
      <div class="bar"><i :style="{ width: percentDone + '%' }"></i></div>
    </div>

    <div v-if="error" class="err" role="alert">{{ error }}</div>

    <div v-if="!items.length" class="muted">Nothing is waiting for approval.</div>
    <div v-for="ins in items" :key="ins.id" class="card">
      <div class="row">
        <span class="tag warn">{{ ins.insight_type || ins.type || ins.target_type }}</span>
        <span class="nm">{{ ins.title || ins.summary }}</span>
      </div>
      <div class="row actions">
        <button class="btn" :disabled="busy" @click="reject([ins.id])">Reject</button>
        <button class="btn pri" :disabled="busy" @click="accept([ins.id])">Approve</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { useStore } from 'vuex';
import { useEscalationQueue } from '@/composables/useEscalationQueue.js';

const store = useStore();
let disposed = false;
const { busy, error, progress, accept, reject, stop } = useEscalationQueue(store, { isDisposed: () => disposed });
onBeforeUnmount(() => {
  disposed = true;
});

const items = computed(() => store.getters['insights/escalatedInsights'] || []);
const pending = ref(null);
const percentDone = computed(() => (progress.value?.total ? Math.round((100 * progress.value.done) / progress.value.total) : 0));

function ask(verb) {
  if (items.value.length) pending.value = { verb, ids: items.value.map((ins) => ins.id) };
}
function confirm() {
  const { verb, ids } = pending.value;
  pending.value = null;
  (verb === 'accept' ? accept : reject)(ids);
}
</script>

<style scoped>
/* Same vocabulary as EntityInspector, the panel this renders inside. */
.aq { display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.nm { flex: 1; min-width: 0; font-size: 12.5px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; }
.bulk .btn { flex: 1; }
.actions { margin-top: 8px; gap: 6px; }
.confirm .muted { margin-top: 4px; }
.card { background: var(--color-darker-0); border: 1px solid var(--terminal-border-color); border-radius: 10px; padding: 10px; }
.muted { color: var(--color-text-muted); font-size: 12px; line-height: 1.5; }
.err { color: var(--color-red); font-size: 11.5px; background: rgba(var(--red-rgb), 0.07); border: 1px solid rgba(254, 78, 78, 0.22); border-radius: 7px; padding: 6px 8px; }
.tag { font-size: 9px; padding: 1px 6px; border-radius: 4px; background: var(--color-darker-1); color: var(--color-text-muted); flex: 0 0 auto; text-transform: uppercase; letter-spacing: 0.06em; }
.tag.warn { color: var(--text-yellow); }
.bar { height: 6px; border-radius: 4px; background: var(--color-darker-1); overflow: hidden; margin-top: 8px; }
.bar i { display: block; height: 100%; background: var(--color-green); transition: width 0.2s ease; }
.btn { height: 26px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--terminal-border-color); background: var(--color-darker-0); color: var(--color-text); font: inherit; font-size: 11px; font-weight: 500; cursor: pointer; white-space: nowrap; }
.btn:disabled { opacity: 0.5; cursor: default; }
.btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.btn.pri { background: var(--color-green); color: var(--on-fill-accent); border-color: var(--color-green); font-weight: 600; }
.btn.danger { background: var(--color-red); color: var(--on-fill-danger); border-color: var(--color-red); font-weight: 600; }
</style>
