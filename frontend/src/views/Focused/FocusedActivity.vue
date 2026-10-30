<!-- Activity (under More): every run, newest first. Tap one to open what ran. -->
<template>
  <!-- The approved mockup's Activity page, on every real run. -->
  <div class="mk mk-page">
    <div class="content">
      <div class="page">
        <div class="page-head"><div><h1>Activity</h1><p>Everything people and agents did that you can see.</p></div></div>
        <nav class="tabs" role="tablist" aria-label="Show">
          <button
            v-for="k in ACTIVITY_KINDS"
            :key="k.id"
            type="button"
            role="tab"
            class="tab focused-tab"
            :class="{ 'is-active': kind === k.id, active: kind === k.id }"
            :aria-selected="kind === k.id ? 'true' : 'false'"
            :data-kind="k.id"
            @click="kind = k.id"
          >{{ k.label }}</button>
        </nav>
        <ul v-if="loading && !rows.length" class="list"><li class="empty">Loading…</li></ul>
        <ul v-else-if="!rows.length" class="list"><li class="empty">{{ kind !== 'all' ? 'Nothing matches.' : 'No activity yet. Start a chat and it shows up here.' }}</li></ul>
        <ul v-else class="list" data-testid="activity-list" data-tour-id="traces.list">
          <li v-for="r in rows.slice(0, CAP)" :key="r.id">
            <button type="button" class="r" :data-kind="r.kind" @click="nav.go({ page: 'activity', item: r.id })">
              <span class="av agent lg"><img src="/images/agnt-logo-mark.svg" alt="" /></span>
              <span class="r-text">
                <strong style="white-space: normal">{{ r.title }} <span style="font-weight: 400; color: var(--text-secondary)">{{ r.detail }}</span></strong>
                <small>{{ ago(r.at) }}</small>
              </span>
              <span class="tag" :class="TONE[r.status.tone] || ''">{{ r.status.label }}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, inject, onMounted } from 'vue';
import { useStore } from 'vuex';
import '@/views/One/mk/mk.css';
import '@/views/One/mk/mk-frame.css';
import { ACTIVITY_KINDS, activityRows } from './focusedActivity.js';

const store = useStore();
const nav = inject('focusedNav');
// The mockup's tag tones for each run outcome.
const TONE = Object.freeze({ ok: 'green', success: 'green', done: 'green', running: 'blue', live: 'blue', warn: 'amber', error: 'amber', failed: 'amber', stopped: '' });
const CAP = 200;
const query = ref('');
const kind = ref('all');
const loading = ref(false);

const rows = computed(() => activityRows(store.getters['executionHistory/getExecutions'] || [], { kind: kind.value, query: query.value }));


function ago(at) {
  if (!at) return '';
  const s = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(at).toLocaleDateString();
}

onMounted(async () => {
  loading.value = true;
  try {
    await Promise.all([
      store.dispatch('executionHistory/fetchExecutions', { forceRefresh: true }),
      (store.getters['contentOutputs/outputs'] || []).length ? null : store.dispatch('contentOutputs/fetchOutputs').catch(() => {}),
    ]);
  } finally {
    loading.value = false;
  }
});
</script>
