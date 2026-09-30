/**
 * Limits that exist because a hosted instance SLEEPS.
 *
 * Personal Cloud (plan `personal`) stops when idle and has a daily runtime
 * budget; every timer fire wakes it, and that runtime counts against the
 * budget. A one- or five-minute timer can therefore never actually sleep and
 * would spend the whole day's budget by mid-morning, after which nothing runs
 * until midnight. So those intervals need a plan that never sleeps.
 *
 * The plan comes from the fleet (tenant.sh passes AGNT_TENANT_PLAN, and a plan
 * change recreates the container), NOT from the signed-in user's subscription:
 * the same `personal` subscription on a desktop runs on the user's own machine,
 * which never sleeps, and must keep every option.
 *
 * Unknown plan => no limit. This mirrors planEntitlements' fail-open rule: a
 * container that was not told its plan behaves exactly as it did before.
 */

export const SLEEPING_PLANS = new Set(['personal']);

const UPGRADE_HINT = 'Needs Pro + Always-On. Your instance sleeps between runs, so timers can run every 15 minutes or slower.';

export function hostedPlan(env = process.env) {
  if (!env.AGNT_TENANT_SLUG) return null;
  const plan = String(env.AGNT_TENANT_PLAN || '').trim();
  return plan || null;
}

/** { [scheduleOption]: reason } for Timer Trigger schedules this instance may not use. */
export function lockedTimerSchedules(env = process.env) {
  if (!SLEEPING_PLANS.has(hostedPlan(env))) return {};
  return { 'Every Minute': UPGRADE_HINT, 'Every 5 Minutes': UPGRADE_HINT };
}

/**
 * The workflow-tools catalog as THIS instance may use it: the static manifest
 * plus `lockedOptions` on anything its plan cannot use, so the editor can grey
 * those options out and say why instead of hiding them.
 *
 * Never mutates its input — the manifest is cached and shared across requests.
 */
export function applyPlanLocks(catalog, env = process.env) {
  const locked = lockedTimerSchedules(env);
  if (!Object.keys(locked).length || !Array.isArray(catalog?.triggers)) return catalog;
  return {
    ...catalog,
    triggers: catalog.triggers.map((entry) => {
      if (entry?.type !== 'trigger-timer' || !entry.parameters?.schedule) return entry;
      return {
        ...entry,
        parameters: { ...entry.parameters, schedule: { ...entry.parameters.schedule, lockedOptions: locked } },
      };
    }),
  };
}
