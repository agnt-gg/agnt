<template>
  <FocusedPage
    :title="page.title"
    :sub="page.sub"
    action-label="New task"
    v-model:query="query"
    search-placeholder="Search scheduled tasks"
    @action="$emit('ask', 'Every weekday at 9am, ')"
  >
    <p v-if="loading && !rows.length" class="focused-empty">Loading…</p>
    <p v-else-if="!rows.length" class="focused-empty">
      {{ query ? `Nothing scheduled matches “${query}”.` : 'When you ask AGNT to do something regularly, it shows up here.' }}
    </p>
    <ul v-else class="focused-list">
      <li v-for="r in rows" :key="r.id">
        <button type="button" class="focused-row" :class="{ paused: !r.enabled }" @click="$emit('run', r.action)">
          <span class="focused-row-icon" aria-hidden="true"><i class="fas fa-redo"></i></span>
          <span class="focused-row-text">
            <strong>{{ r.label }}</strong>
            <small>{{ r.cadence }}<template v-if="!r.enabled"> · Paused</template><template v-else-if="r.next"> · Next {{ formatNext(r.next) }}</template></small>
          </span>
          <i class="fas fa-chevron-right focused-row-go" aria-hidden="true"></i>
        </button>
      </li>
    </ul>
  </FocusedPage>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import FocusedPage from './FocusedPage.vue';
import { FOCUSED_PAGES, scheduleRows } from './focusedModel.js';

defineEmits(['run', 'ask']);
const store = useStore();
const page = FOCUSED_PAGES.scheduled;
const query = ref('');
const loading = ref(false);

const rows = computed(() =>
  scheduleRows(store.getters['schedules/allSchedules'], query.value, store.getters['goals/allGoals']),
);

function formatNext(ms) {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

onMounted(async () => {
  loading.value = true;
  try {
    // Names come from the goals a schedule runs; load them if boot has not.
    const goalsReady = (store.getters['goals/allGoals'] || []).length ? null : store.dispatch('goals/fetchGoals');
    await Promise.all([store.dispatch('schedules/fetchSchedules'), goalsReady]);
  } catch (e) {
    console.warn('[Focused] could not load schedules:', e?.message || e);
  } finally {
    loading.value = false;
  }
});
</script>
