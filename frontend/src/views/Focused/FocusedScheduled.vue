<template>
  <!-- Free plan: the same header as every page, then what a routine is and
       the one way to get it (the backend refuses schedules on this plan). -->
  <section v-if="!paid" class="focused-page" :aria-label="page.title">
    <header class="focused-page-head"><div><h1>{{ page.title }}</h1><p>{{ page.sub }}</p></div></header>
    <UpgradePrompt title="Let Annie work on a schedule" description="Routines are included with paid plans. Ask once, like “every weekday at 7, brief me on my day”, and it runs on its own." />
  </section>
  <FocusedRoutine v-else-if="item || isNew" :key="item || 'new'" :schedule-id="item" />
  <FocusedPage v-else :title="page.title" :sub="page.sub" action-label="New routine" v-model:query="query" search-placeholder="Search routines" @action="nav.go({ page: 'scheduled', isNew: true })">
    <p v-if="loading && !rows.length" class="focused-empty">Loading…</p>
    <p v-else-if="!rows.length" class="focused-empty">
      {{ query ? `No routine matches “${query}”.` : 'When you ask Annie to do something regularly, it shows up here.' }}
    </p>
    <!-- Each routine is a widget: its number, its last runs, Run now. -->
    <div v-else class="focused-routine-grid">
      <FocusedRoutineCard v-for="r in rows" :key="r.id" :row="r" @open="nav.go({ page: 'scheduled', item: String(r.id) })" @toggle="toggle" />
    </div>
  </FocusedPage>
</template>

<script setup>
import UpgradePrompt from '@/components/UpgradePrompt.vue';
import { ref, computed, inject, watch } from 'vue';
import { useStore } from 'vuex';
import FocusedPage from './FocusedPage.vue';
import FocusedRoutine from './FocusedRoutine.vue';
import FocusedRoutineCard from './FocusedRoutineCard.vue';
import { FOCUSED_PAGES, scheduleRows } from './focusedModel.js';
import { canScheduleGoals } from '@/services/scheduledGoalsPlan.js';

defineProps({ item: { type: String, default: null }, isNew: { type: Boolean, default: false } });
const store = useStore();
const nav = inject('focusedNav');
const page = FOCUSED_PAGES.scheduled;
const paid = computed(() => canScheduleGoals(store.getters['userAuth/planType']));
const query = ref('');
const loading = ref(false);

const rows = computed(() => scheduleRows(store.getters['schedules/allSchedules'], query.value, store.getters['goals/allGoals']));

async function toggle(r) {
  if (!paid.value) return;
  try {
    await store.dispatch('schedules/updateSchedule', { id: r.id, patch: { enabled: !r.enabled } });
    nav.toast(r.enabled ? 'Paused.' : 'Resumed.');
  } catch (e) {
    nav.toast('Couldn’t change it. ' + (e?.message || e));
  }
}

watch(paid, async (enabled) => {
  if (!enabled) return;
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
}, { immediate: true });
</script>

<style scoped>
.focused-routine-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
</style>
