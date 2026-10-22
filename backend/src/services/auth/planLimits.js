/**
 * The free plan's limits, enforced by this backend (decided 2026-10-21):
 *
 *   autonomousRoutines  2      workflows that run on their own (any trigger) live at once
 *   fastestTimer        Daily  a free timer may fire daily or slower
 *   connections         5      connected accounts (OAuth or key); AI model keys do not count
 *   historyDays         7      run history shown
 *
 * Free is "build anything, run it yourself"; paid is "AGNT works while you are
 * away". A paid plan (verified licence, planEntitlements) has none of these.
 * Paid-only triggers (webhook, email) are separate: workflowAdmission.
 */
export const FREE_LIMITS = Object.freeze({
  autonomousRoutines: 2,
  fastestTimer: 'Daily',
  connections: 5,
  historyDays: 7,
});

/** Timer schedules in the order of how often they fire, fastest first. */
export const TIMER_SCHEDULES = Object.freeze(['Every Minute', 'Every 5 Minutes', 'Every 15 Minutes', 'Every 30 Minutes', 'Hourly', 'Daily', 'Weekly', 'Monthly']);

/** Faster than the free plan allows? Unknown/custom schedules are treated as too fast. */
export function timerTooFastForFree(schedule) {
  const index = TIMER_SCHEDULES.indexOf(String(schedule || '').trim());
  return index === -1 || index < TIMER_SCHEDULES.indexOf(FREE_LIMITS.fastestTimer);
}

/** Does this workflow run on its own? Any trigger node (core or plugin). */
export function isAutonomous(workflow) {
  return (Array.isArray(workflow?.nodes) ? workflow.nodes : []).some((node) => node?.category === 'trigger' || /^trigger-|-listener$|^receive-/.test(String(node?.type || '')));
}

/**
 * How often each timer in this workflow fires, as a schedule name.
 *
 * Mirrors services/scheduler/timerSchedule.js resolveTimerSpec: scheduleType
 * defaults to Interval, whose `schedule` must be a known option (anything else
 * never fires, so calling it too fast refuses nothing that would run).
 * Specific Time is a time of day on chosen days: at most daily.
 */
export function timerSchedulesIn(workflow) {
  return (Array.isArray(workflow?.nodes) ? workflow.nodes : [])
    .filter((node) => node?.type === 'trigger-timer')
    .map((node) => {
      const parameters = node?.parameters || {};
      if ((parameters.scheduleType || 'Interval') === 'Specific Time') return 'Daily';
      return parameters.schedule || '(none)';
    });
}

/** Start of the window a free plan's history shows, as an ISO string. */
export function freeHistorySince(now = Date.now()) {
  return new Date(now - FREE_LIMITS.historyDays * 86_400_000).toISOString();
}
