<template>
  <!-- Goals: what Annie is working on for you, once or on repeat, grouped by
       what each one needs from you. A goal opens its full detail; a repeating
       goal opens its routine. -->
  <div class="mk mk-page" data-testid="focused-goals">
    <div class="content">
      <div class="page">
        <div class="page-head">
          <div><h1>Goals</h1><p>What Annie is working on for you, once or on repeat.</p></div>
          <div class="row-gap">
            <button type="button" class="primary" data-action="new-goal" @click="nav.ask('Help me with a goal: ')"><MkIcon name="plus" size="sm" />New goal</button>
          </div>
        </div>

        <div class="v2-toolbar">
          <span class="v2-toolbar-fill"></span>
          <label class="v2-search"><MkIcon name="find" size="sm" /><input v-model="query" type="text" placeholder="Search goals" aria-label="Search goals" autocomplete="off" spellcheck="false" /></label>
        </div>

        <ul v-if="loading && !sections.length" class="list"><li class="empty">Loading…</li></ul>
        <div v-else-if="!sections.length" class="v2-empty" data-testid="goals-empty">
          <p>{{ query ? `No goals match “${query}”.` : filter === 'all' ? 'No goals yet. Tell Annie what you want done and it becomes a goal you can follow here.' : 'Nothing here right now.' }}</p>
          <button v-if="!query && filter === 'all'" type="button" class="primary" @click="nav.ask('Help me with a goal: ')">Ask Annie</button>
        </div>

        <section v-for="section in sections" :key="section.id" class="v2-section" :data-section="section.id">
          <div class="v2-sec-head">
            <h2>{{ section.title }}<span class="v2-sec-count">{{ section.rows.length }}</span></h2>
            <button v-if="section.id === 'done' && filter === 'all'" type="button" class="btn ghost sm" :aria-expanded="String(showDone)" @click="showDone = !showDone">{{ showDone ? 'Hide' : 'Show' }}</button>
            <button v-if="section.id === 'repeating' && paid" type="button" class="link" data-action="new-repeating" @click="nav.go({ page: 'scheduled', isNew: true })">+ New routine</button>
          </div>
          <ul v-if="section.id !== 'done' || filter !== 'all' || showDone" class="list">
            <template v-if="section.kind === 'goal'">
              <li v-for="g in section.rows" :key="g.id">
                <div class="r clickable" role="button" tabindex="0" :data-goal="g.id" @click="openGoal(g)" @keydown.enter="openGoal(g)">
                  <span class="r-icon" :class="'v2-tone-' + section.id"><MkIcon :name="section.id === 'done' ? 'check' : 'task'" /></span>
                  <span class="r-text"><strong>{{ g.title || 'Untitled goal' }}</strong><small>{{ goalLine(g) }}</small></span>
                  <span v-if="goalProgress(g) !== null && section.id !== 'done' && section.id !== 'needs'" class="v2-progress"><span class="v2-bar" :aria-label="`${Math.round(goalProgress(g) * 100)}% done`"><i :style="{ width: Math.round(goalProgress(g) * 100) + '%' }"></i></span><small>{{ goalSteps(g) }}</small></span>
                  <button v-if="section.id === 'needs'" type="button" class="primary sm" data-action="goal-act" @click.stop="openGoal(g)">{{ goalAction(g) }}</button>
                  <span v-else-if="section.id === 'done'" class="v2-link">View result ›</span>
                  <MkIcon v-else name="chev" size="sm" class="v2-go" />
                </div>
              </li>
            </template>
            <template v-else>
              <li v-for="r in section.rows" :key="r.id">
                <div class="r clickable" role="button" tabindex="0" :data-routine="r.id" @click="openRoutine(r)" @keydown.enter="openRoutine(r)">
                  <span class="r-icon" :class="isWaiting(r) ? 'v2-tone-needs' : 'v2-tone-repeating'"><MkIcon name="routines" /></span>
                  <span class="r-text"><strong>{{ r.label }}</strong><small>{{ routineLine(r) }}</small></span>
                  <button v-if="isWaiting(r)" type="button" class="primary sm" @click.stop="openRoutine(r)">Answer Annie</button>
                  <span v-else-if="r.lastStatus" class="v2-link" @click.stop="openRoutine(r)">See latest ›</span>
                  <span class="v2-onoff">{{ r.enabled ? 'On' : 'Paused' }}</span>
                  <button type="button" class="switch" :class="{ on: r.enabled }" role="switch" :aria-checked="String(r.enabled)" :aria-label="`${r.enabled ? 'Pause' : 'Resume'} ${r.label}`" @click.stop="toggle(r)"></button>
                </div>
              </li>
            </template>
          </ul>
        </section>

        <p v-if="!paid && (filter === 'all' || filter === 'repeating')" class="v2-note" data-testid="goals-repeating-upgrade">Routines, goals that repeat like “every weekday at 7, brief me on my day”, come with paid plans.</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue';
import { useStore } from 'vuex';
import MkIcon from '@/views/One/mk/MkIcon.vue';
import '@/views/One/mk/mk.css';
import '@/views/One/mk/mk-frame.css';
import { scheduleRows } from './focusedModel.js';
import { formatNextRun } from './focusedTime.js';
import { goalSections, goalLine, goalProgress, goalAction, goalSteps } from './focusedGoals.js';
import { canScheduleGoals } from '@/services/scheduledGoalsPlan.js';
import { usePersonalNeeds } from '@/views/One/team/usePersonalNeeds.js';

const store = useStore();
const nav = inject('focusedNav');
const paid = computed(() => canScheduleGoals(store.getters['userAuth/planType']));
const filter = ref('all');
const query = ref('');
const loading = ref(false);
const showDone = ref(false);

const goals = computed(() => store.getters['goals/allGoals'] || []);
const routines = computed(() => (paid.value ? scheduleRows(store.getters['schedules/allSchedules'], '', goals.value) : []));
const sections = computed(() => goalSections({ goals: goals.value, routines: routines.value, filter: filter.value, query: query.value }));

// Routines whose newest run stopped to ask you something (the same source as Home and the rail badge).
const personal = usePersonalNeeds(store);
const waitingIds = computed(() => new Set(personal.waitingRoutines.value.map((run) => String(run.routineId))));

/** A routine whose newest run asked you something: from the run history, or its own last status. */
const isWaiting = (r) => waitingIds.value.has(String(r.id)) || /^needs_(input|review)$/.test(String(r.lastStatus || ''));
function routineLine(r) {
  if (isWaiting(r)) return `${r.cadence} \u00b7 waiting for your answer`;
  if (!r.enabled) return r.cadence;
  const next = r.next ? `next: ${formatNextRun(r.next)}` : '';
  const last = r.lastStatus ? `last run: ${String(r.lastStatus).replace(/_/g, ' ')}` : '';
  return [r.cadence, next, last].filter(Boolean).join(' \u00b7 ');
}
function openGoal(g) {
  nav.openScreen('GoalsScreen', { select: { kind: 'goal', id: g.id } });
}
function openRoutine(r) {
  nav.go({ page: 'scheduled', item: String(r.id) });
}
async function toggle(r) {
  try {
    await store.dispatch('schedules/updateSchedule', { id: r.id, patch: { enabled: !r.enabled } });
    nav.toast(r.enabled ? `${r.label} is off.` : `${r.label} is on.`);
  } catch (e) {
    nav.toast('Couldn’t change it. ' + (e?.message || e));
  }
}

async function load() {
  loading.value = true;
  try {
    await Promise.all([
      store.dispatch('goals/fetchGoals'),
      paid.value ? store.dispatch('schedules/fetchSchedules') : null,
      personal.load(),
    ]);
  } catch (e) {
    console.warn('[Goals] could not load:', e?.message || e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
// The plan can arrive after mount (the subscription loads in the background).
watch(paid, (yes) => { if (yes) store.dispatch('schedules/fetchSchedules').catch((e) => console.warn('[Goals] schedules:', e?.message || e)); });
</script>
