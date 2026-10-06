<!-- EscalationQueue — what Annie was not allowed to do alone, waiting for you.
     Accept or reject one, a selection, or everything shown. Bulk verbs ask
     once before they run; accepting walks the queue in batches with progress
     and a stop. Clicking a row opens its detail in the right panel. -->
<template>
  <section class="queue" aria-label="Waiting for you">
    <div class="queue-toolbar">
      <label class="check-all" :class="{ disabled: !shown.length }">
        <input
          type="checkbox"
          :checked="allShownChecked"
          :indeterminate.prop="someShownChecked && !allShownChecked"
          :disabled="!shown.length || busy"
          aria-label="Select all shown"
          @change="toggleAllShown"
        />
      </label>
      <div class="search">
        <i class="fas fa-search" aria-hidden="true"></i>
        <input v-model="query" type="search" placeholder="Search waiting actions" aria-label="Search waiting actions" />
      </div>
      <div class="bulk">
        <template v-if="checked.size">
          <button class="btn btn-primary" :disabled="busy" @click="ask('accept', checkedIds)">Accept {{ checked.size }}</button>
          <button class="btn btn-quiet" :disabled="busy" @click="ask('reject', checkedIds)">Reject {{ checked.size }}</button>
        </template>
        <template v-else>
          <button class="btn btn-primary" :disabled="busy || !shown.length" @click="ask('accept', shownIds)">Accept all{{ shownSuffix }}</button>
          <button class="btn btn-quiet" :disabled="busy || !shown.length" @click="ask('reject', shownIds)">Reject all{{ shownSuffix }}</button>
        </template>
      </div>
    </div>

    <div v-if="pending" class="confirm" role="alertdialog" aria-live="polite">
      <span>
        {{ pending.verb === 'accept' ? 'Accept' : 'Reject' }} {{ pending.ids.length }}
        {{ pending.ids.length === 1 ? 'action' : 'actions' }}?
        <small>{{ pending.verb === 'accept' ? 'Each one is applied to its agent, skill, workflow or tool.' : 'They leave the queue and are not applied.' }}</small>
      </span>
      <button class="btn" :class="pending.verb === 'accept' ? 'btn-primary' : 'btn-danger'" @click="confirm">Confirm</button>
      <button class="btn btn-quiet" @click="pending = null">Cancel</button>
    </div>

    <div v-if="progress" class="progress" aria-live="polite">
      <div class="progress-row">
        <span>{{ progress.verb }} {{ progress.done }} of {{ progress.total }}…</span>
        <button v-if="progress.stoppable" class="btn btn-quiet" :disabled="progress.stopping" @click="$emit('stop')">
          {{ progress.stopping ? 'Stopping…' : 'Stop' }}
        </button>
      </div>
      <div class="progress-bar"><span :style="{ width: percentDone + '%' }"></span></div>
    </div>

    <ul v-if="shown.length" class="rows">
      <li
        v-for="item in shown"
        :key="item.id"
        class="row"
        :class="{ chosen: item.id === selectedId, checked: checked.has(item.id) }"
        @click="$emit('select', item)"
      >
        <input
          type="checkbox"
          class="row-check"
          :checked="checked.has(item.id)"
          :disabled="busy"
          :aria-label="'Select ' + label(item)"
          @click.stop
          @change="toggle(item.id)"
        />
        <div class="row-main">
          <div class="row-top">
            <span class="kind-tag">{{ item.target_type || 'change' }}</span>
            <span class="row-title">{{ label(item) }}</span>
          </div>
          <p v-if="item.description" class="row-desc">{{ item.description }}</p>
          <div class="row-meta">
            <span v-if="item.confidence != null">{{ Math.round(item.confidence * 100) }}% confidence</span>
            <span v-if="item.autonomy_reason">{{ item.autonomy_reason }}</span>
          </div>
        </div>
        <div class="row-actions">
          <button class="btn btn-quiet" :disabled="busy" @click.stop="$emit('reject', [item.id])">Reject</button>
          <button class="btn btn-primary" :disabled="busy" @click.stop="$emit('accept', [item.id])">Accept</button>
        </div>
      </li>
    </ul>
    <div v-else class="queue-empty">
      <span class="empty-mark">✓</span>
      <h3>{{ items.length ? 'Nothing matches your search.' : 'Nothing is waiting for you.' }}</h3>
      <p>{{ items.length ? 'Clear the search to see every waiting action.' : 'When Annie needs your permission for a change, it waits here.' }}</p>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

const props = defineProps({
  items: { type: Array, required: true },
  busy: Boolean,
  /** { verb, done, total, stoppable?, stopping? } while a bulk run is going. */
  progress: { type: Object, default: null },
  selectedId: { type: String, default: '' },
});
const emit = defineEmits(['accept', 'reject', 'select', 'stop']);

const query = ref('');
const checked = ref(new Set());
const pending = ref(null);

const label = (item) => item.title || item.summary || 'Untitled change';
const haystack = (item) => [item.title, item.description, item.target_type, item.category, item.autonomy_reason].join(' ').toLowerCase();

const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q ? props.items.filter((item) => haystack(item).includes(q)) : props.items;
});
const shownIds = computed(() => shown.value.map((item) => item.id));
const checkedIds = computed(() => [...checked.value]);
const shownSuffix = computed(() => (shown.value.length ? ` (${shown.value.length})` : ''));
const allShownChecked = computed(() => shown.value.length > 0 && shown.value.every((item) => checked.value.has(item.id)));
const someShownChecked = computed(() => shown.value.some((item) => checked.value.has(item.id)));
const percentDone = computed(() => (props.progress?.total ? Math.round((100 * props.progress.done) / props.progress.total) : 0));

function toggle(id) {
  const next = new Set(checked.value);
  next.has(id) ? next.delete(id) : next.add(id);
  checked.value = next;
}
function toggleAllShown() {
  const next = new Set(checked.value);
  if (allShownChecked.value) shownIds.value.forEach((id) => next.delete(id));
  else shownIds.value.forEach((id) => next.add(id));
  checked.value = next;
}
function ask(verb, ids) {
  if (ids.length) pending.value = { verb, ids: [...ids] };
}
function confirm() {
  const { verb, ids } = pending.value;
  pending.value = null;
  emit(verb, ids);
}

// Ids that left the queue (accepted, rejected, or handled elsewhere) are no
// longer selectable; keeping them would count actions that no longer exist.
watch(
  () => props.items,
  (items) => {
    const live = new Set(items.map((item) => item.id));
    const kept = [...checked.value].filter((id) => live.has(id));
    if (kept.length !== checked.value.size) checked.value = new Set(kept);
  },
);
</script>

<style scoped>
.queue { display: flex; flex-direction: column; gap: 12px; width: 100%; }

.queue-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.check-all { display: inline-flex; align-items: center; padding: 0 4px; cursor: pointer; }
.check-all.disabled { cursor: default; opacity: 0.5; }
.search {
  flex: 1 1 220px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 9px;
  color: var(--color-light-med-navy);
}
.search:focus-within { border-color: rgba(var(--primary-rgb), 0.55); }
.search input { flex: 1; min-width: 0; background: transparent; border: 0; outline: none; color: var(--color-text); font: inherit; font-size: 0.92em; }
.bulk { display: flex; gap: 8px; margin-left: auto; }

/* Buttons: the page's own (LearningBoard / Settings › Data). */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 8px 14px; border: 1px solid transparent; border-radius: 9px; font: inherit; font-size: 0.88em; cursor: pointer; white-space: nowrap; transition: opacity 0.15s ease, border-color 0.15s ease; }
.btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.btn:disabled { opacity: 0.5; cursor: default; }
.btn-primary { background: var(--color-primary); color: var(--on-fill-accent); font-weight: 600; }
.btn-primary:hover:not(:disabled) { opacity: 0.9; }
.btn-quiet { background: transparent; border-color: var(--terminal-border-color); color: var(--color-text); }
.btn-quiet:hover:not(:disabled) { border-color: rgba(var(--primary-rgb), 0.55); }
.btn-danger { background: var(--color-red); color: var(--on-fill-danger); font-weight: 600; }

.confirm,
.progress {
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  padding: 12px 16px;
  background: var(--color-darker-0);
}
.confirm { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.confirm > span { flex: 1; min-width: 200px; }
.confirm small { display: block; margin-top: 2px; color: var(--color-light-med-navy); }
.progress-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; font-size: 0.9em; }
.progress-bar { height: 4px; background: var(--terminal-border-color); border-radius: 4px; margin-top: 10px; overflow: hidden; }
.progress-bar span { display: block; height: 100%; background: var(--color-green); transition: width 0.2s ease; }

.rows { list-style: none; margin: 0; padding: 0; border: 1px solid var(--terminal-border-color); border-radius: 12px; overflow: hidden; }
.row { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; cursor: pointer; background: var(--color-darker-0); transition: background 0.15s ease; }
.row + .row { border-top: 1px solid var(--terminal-border-color); }
.row:hover { background: rgba(var(--primary-rgb), 0.05); }
.row.chosen { background: rgba(var(--green-rgb), 0.08); box-shadow: inset 3px 0 0 var(--color-green); }
.row-check { margin-top: 3px; flex: 0 0 auto; cursor: pointer; }
.row-main { flex: 1; min-width: 0; }
.row-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.kind-tag { flex: 0 0 auto; font-size: 0.7em; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: var(--color-light-med-navy); border: 1px solid var(--terminal-border-color); border-radius: 999px; padding: 2px 8px; }
.row-title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-desc { margin: 6px 0 0; color: var(--color-light-med-navy); font-size: 0.88em; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.row-meta { display: flex; gap: 14px; margin-top: 6px; font-size: 0.78em; color: var(--color-light-med-navy); }
.row-meta span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-actions { display: flex; gap: 6px; flex: 0 0 auto; }

.queue-empty { text-align: center; padding: 56px 24px; }
.empty-mark { display: inline-grid; place-items: center; width: 42px; height: 42px; border: 1px solid var(--terminal-border-color); border-radius: 50%; color: var(--text-green); }
.queue-empty h3 { font-size: 1.2em; font-weight: 500; margin: 20px 0 8px; }
.queue-empty p { color: var(--color-light-med-navy); line-height: 1.5; margin: 0; }

@media (max-width: 700px) {
  .bulk { margin-left: 0; width: 100%; }
  .bulk .btn { flex: 1; }
  .row { flex-wrap: wrap; }
  .row-actions { width: 100%; justify-content: flex-end; }
  .btn { min-height: 44px; }
}
</style>
