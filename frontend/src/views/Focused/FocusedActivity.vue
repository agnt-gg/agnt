<!-- Activity (under More): every run, newest first. Tap one to open what ran. -->
<template>
  <FocusedPage :title="page.title" :sub="page.sub" v-model:query="query" search-placeholder="Search activity">
    <template #tabs>
      <div class="focused-tabs" role="tablist">
        <button
          v-for="k in ACTIVITY_KINDS"
          :key="k.id"
          type="button"
          role="tab"
          class="focused-tab"
          :class="{ active: kind === k.id }"
          :aria-selected="kind === k.id ? 'true' : 'false'"
          :data-kind="k.id"
          @click="kind = k.id"
        >{{ k.label }}</button>
      </div>
    </template>
    <p v-if="loading && !rows.length" class="focused-empty">Loading…</p>
    <p v-else-if="!rows.length" class="focused-empty">{{ query || kind !== 'all' ? 'Nothing matches.' : 'Nothing has run yet. Start a chat and it shows up here.' }}</p>
    <ul v-else class="focused-list" data-testid="activity-list">
      <li v-for="r in rows.slice(0, CAP)" :key="r.id">
        <button type="button" class="focused-row" :data-kind="r.kind" @click="nav.go({ page: 'activity', item: r.id })">
          <span class="focused-row-icon" aria-hidden="true"><i :class="r.icon"></i></span>
          <span class="focused-row-text">
            <strong>{{ r.title }}</strong>
            <small>{{ [ago(r.at), r.detail].filter(Boolean).join(' · ') }}</small>
          </span>
          <span class="focused-status-pill" :class="r.status.tone">{{ r.status.label }}</span>
          <i class="fas fa-chevron-right focused-row-go" aria-hidden="true"></i>
        </button>
      </li>
    </ul>
  </FocusedPage>
</template>

<script setup>
import { ref, computed, inject, onMounted } from 'vue';
import { useStore } from 'vuex';
import FocusedPage from './FocusedPage.vue';
import { FOCUSED_PAGES } from './focusedModel.js';
import { ACTIVITY_KINDS, activityRows } from './focusedActivity.js';

const store = useStore();
const nav = inject('focusedNav');
const page = FOCUSED_PAGES.activity;
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
