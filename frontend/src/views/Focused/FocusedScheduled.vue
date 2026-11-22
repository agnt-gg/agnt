<template>
  <!-- Free plan: the same header as every page, then what a routine is and
       the one way to get it (the backend refuses schedules on this plan). -->
  <section v-if="!paid" class="focused-page" :aria-label="page.title">
    <header class="focused-page-head"><div><h1>{{ page.title }}</h1><p>{{ page.sub }}</p></div></header>
    <UpgradePrompt title="Let Annie work on a schedule" description="Routines are included with paid plans. Ask once, like “every weekday at 7, brief me on my day”, and it runs on its own." />
  </section>
  <FocusedRoutine v-else-if="item || isNew" :key="item || 'new'" :schedule-id="item" />
  <!-- The approved mockup's Routines page: Mine, then each teamspace, every routine a widget card. -->
  <div v-else class="mk mk-page">
    <div class="content">
      <div class="page">
        <div class="page-head">
          <div><h1>Routines</h1><p>Tasks you approved to run again. Each run opens its own chat, and anything that sends or changes something asks you first.</p></div>
          <button type="button" class="primary" @click="nav.go({ page: 'scheduled', isNew: true })"><MkIcon name="plus" size="sm" />New routine</button>
        </div>
        <template v-for="section in sections" :key="section.key">
          <div class="sec-head"><h3><MkIcon v-if="!section.emoji" name="lock" size="xs" /><span v-else>{{ section.emoji }}</span> {{ section.title }}</h3></div>
          <ul v-if="loading && !rows.length" class="list"><li class="empty">Loading…</li></ul>
          <ul v-else-if="!section.rows.length" class="list"><li class="empty">{{ section.empty }}</li></ul>
          <div v-else class="tc-rgrid">
            <FocusedRoutineCard v-for="r in section.rows" :key="r.id" :row="r" :scope-label="section.scope" @open="nav.go({ page: 'scheduled', item: String(r.id) })" @toggle="toggle" @mode="switchMode" />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import UpgradePrompt from '@/components/UpgradePrompt.vue';
import { ref, computed, inject, watch } from 'vue';
import { useStore } from 'vuex';
import FocusedRoutine from './FocusedRoutine.vue';
import FocusedRoutineCard from './FocusedRoutineCard.vue';
import MkIcon from '@/views/One/mk/MkIcon.vue';
import { instanceTeam } from '@/utils/teamScopeTransport.js';
import { useTeam } from '@/views/One/team/useTeam.js';
import { spaceEmoji } from '@/views/One/team/teamModel.js';
import '@/views/One/mk/mk.css';
import '@/views/One/mk/mk-frame.css';
import { FOCUSED_PAGES, scheduleRows } from './focusedModel.js';
import { canScheduleGoals } from '@/services/scheduledGoalsPlan.js';

defineProps({ item: { type: String, default: null }, isNew: { type: Boolean, default: false } });
const store = useStore();
const nav = inject('focusedNav');
const page = FOCUSED_PAGES.scheduled;
const paid = computed(() => canScheduleGoals(store.getters['userAuth/planType']));
const query = ref('');
const loading = ref(false);
const team = useTeam(store);

const rows = computed(() => scheduleRows(store.getters['schedules/allSchedules'], query.value, store.getters['goals/allGoals']));
/**
 * The mockup's sections. On a team's instance the routines are the team's, and they run in its
 * main teamspace, so they sit under that teamspace (by its own name and emoji, never the
 * workspace's). Anywhere else they are yours alone: "Mine".
 */
const sections = computed(() => {
  const own = instanceTeam();
  const spaces = team.state.spaces || [];
  const home = own ? (spaces.find((s) => s.is_default) || spaces[0] || null) : null;
  if (!home) return [{ key: 'mine', title: 'Mine', emoji: '', scope: '', rows: rows.value, empty: 'No private routines. Finish a task in a chat and choose “Make it a routine”.' }];
  return [
    { key: 'mine', title: 'Mine', emoji: '', scope: '', rows: [], empty: 'No private routines. Make one from your own space.' },
    { key: home.id, title: home.name, emoji: spaceEmoji(home), scope: home.name, rows: rows.value, empty: 'None yet.' },
  ];
});

async function toggle(r) {
  if (!paid.value) return;
  try {
    await store.dispatch('schedules/updateSchedule', { id: r.id, patch: { enabled: !r.enabled } });
    nav.toast(r.enabled ? 'Paused.' : 'Resumed.');
  } catch (e) {
    nav.toast('Couldn’t change it. ' + (e?.message || e));
  }
}
async function switchMode(r) {
  const runMode = r.runMode === 'ask' ? 'auto' : 'ask';
  try {
    await store.dispatch('schedules/updateSchedule', { id: r.id, patch: { runMode } });
    nav.toast(runMode === 'ask' ? 'Every run now shows you what it will do and waits.' : 'Runs on its own now; each run posts its result.');
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
