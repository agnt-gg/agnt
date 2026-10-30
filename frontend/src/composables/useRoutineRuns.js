import { ref } from 'vue';
import { canScheduleGoals } from '@/services/scheduledGoalsPlan.js';
import { scheduleRows } from '@/views/Focused/focusedModel.js';

/**
 * Recent runs of every routine (schedules → goal runs), newest first, each
 * tagged with its routine's name. Read through the schedules store, so the
 * Routines page and Home share one source. Plans without routines get none.
 */
const runs = ref([]);
const loaded = ref(false);
let inflight = null;

export function useRoutineRuns(store) {
  async function loadRoutineRuns({ perRoutine = 5 } = {}) {
    if (!canScheduleGoals(store.getters['userAuth/planType'])) { runs.value = []; loaded.value = true; return; }
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        await store.dispatch('schedules/fetchSchedules');
        const rows = scheduleRows(store.getters['schedules/allSchedules'], '', store.getters['goals/allGoals']);
        const lists = await Promise.all(rows.map(async (row) => {
          try {
            const list = await store.dispatch('schedules/fetchRunHistory', { scheduleId: row.id, limit: perRoutine });
            return (Array.isArray(list) ? list : list?.runs || []).map((run) => ({ ...run, routineName: row.label, routineId: row.id }));
          } catch {
            return [];
          }
        }));
        runs.value = lists.flat().sort((a, b) => Date.parse(b.fired_at) - Date.parse(a.fired_at));
      } catch (error) {
        console.warn('[routines] could not load runs:', error.message);
      } finally {
        loaded.value = true;
        inflight = null;
      }
    })();
    return inflight;
  }
  return { runs, loaded, loadRoutineRuns };
}
