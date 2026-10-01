<template>
  <FocusedRoutine v-if="item || isNew" :key="item || 'new'" :schedule-id="item" />
  <FocusedPage v-else :title="page.title" :sub="page.sub" action-label="New routine" v-model:query="query" search-placeholder="Search scheduled tasks" @action="nav.go({ page: 'scheduled', isNew: true })">
    <p v-if="loading && !rows.length" class="focused-empty">Loading…</p>
    <p v-else-if="!rows.length" class="focused-empty">
      {{ query ? `Nothing scheduled matches “${query}”.` : 'When you ask AGNT to do something regularly, it shows up here.' }}
    </p>
    <ul v-else class="focused-list">
      <li v-for="r in rows" :key="r.id">
        <div class="focused-row" :class="{ paused: !r.enabled }">
          <button type="button" class="focused-row-main" @click="nav.go({ page: 'scheduled', item: String(r.id) })">
            <span class="focused-row-icon" aria-hidden="true"><i class="fas fa-redo"></i></span>
            <span class="focused-row-text">
              <strong>{{ r.label }}</strong>
              <small>{{ r.cadence }}<template v-if="!r.enabled"> · Paused</template><template v-else-if="r.next"> · Next {{ formatNext(r.next) }}</template></small>
            </span>
          </button>
          <button
            type="button"
            class="focused-switch"
            role="switch"
            :aria-checked="r.enabled ? 'true' : 'false'"
            :aria-label="(r.enabled ? 'Pause ' : 'Resume ') + r.label"
            @click="toggle(r)"
          ></button>
        </div>
      </li>
    </ul>
  </FocusedPage>
</template>

<script setup>
import { ref, computed, inject, onMounted } from 'vue';
import { useStore } from 'vuex';
import FocusedPage from './FocusedPage.vue';
import FocusedRoutine from './FocusedRoutine.vue';
import { FOCUSED_PAGES, scheduleRows } from './focusedModel.js';
import { formatNext } from './focusedTime.js';

defineProps({ item: { type: String, default: null }, isNew: { type: Boolean, default: false } });
const store = useStore();
const nav = inject('focusedNav');
const page = FOCUSED_PAGES.scheduled;
const query = ref('');
const loading = ref(false);

const rows = computed(() => scheduleRows(store.getters['schedules/allSchedules'], query.value, store.getters['goals/allGoals']));

async function toggle(r) {
  try {
    await store.dispatch('schedules/updateSchedule', { id: r.id, patch: { enabled: !r.enabled } });
    nav.toast(r.enabled ? 'Paused.' : 'Resumed.');
  } catch (e) {
    nav.toast('Couldn’t change it. ' + (e?.message || e));
  }
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
