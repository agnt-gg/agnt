import { computed } from 'vue';
import { useRoutineRuns } from '@/composables/useRoutineRuns.js';
import { routinesWaitingForAnswer, goalsAwaitingReview } from './teamModel.js';

/**
 * Your own work that waits on you, outside any teamspace: routines whose newest
 * run stopped to ask you something, and goals waiting for your review. One
 * source for Home's "Needs you" and the rail badge, so the two never disagree.
 * Reads the shared routine runs and the goals store; `load` fetches what is
 * missing.
 */
export function usePersonalNeeds(store) {
  const routineRuns = useRoutineRuns(store);
  const waitingRoutines = computed(() => routinesWaitingForAnswer(routineRuns.runs.value));
  // A routine waiting for your answer runs a goal; that goal is not listed twice.
  const waitingGoalIds = computed(() => new Set(waitingRoutines.value.map((run) => String(run.run_target_id || run.target_id))));
  const reviewGoals = computed(() => goalsAwaitingReview(store.getters['goals/allGoals'], waitingGoalIds.value));
  const count = computed(() => waitingRoutines.value.length + reviewGoals.value.length);

  async function load() {
    const goalsMissing = !(store.getters['goals/allGoals'] || []).length;
    await Promise.all([
      routineRuns.loadRoutineRuns(),
      goalsMissing ? Promise.resolve(store.dispatch('goals/fetchGoals')).catch((error) => console.warn('[home] could not load goals:', error?.message || error)) : null,
    ]);
  }

  return { waitingRoutines, reviewGoals, count, load, runs: routineRuns.runs, runsLoaded: routineRuns.loaded };
}
