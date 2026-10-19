/**
 * Which plans include scheduled goals.
 *
 * The backend decides (services/auth/planEntitlements.js requireScheduledGoals
 * answers 403 "Upgrade required" otherwise); this is the frontend's one copy
 * of that answer, so a page can show the upgrade offer instead of asking, and
 * a background load never fires a request a free plan is refused.
 */
export const SCHEDULED_GOAL_PLANS = Object.freeze(['personal', 'always_on', 'business', 'enterprise']);

export function canScheduleGoals(planType) {
  return SCHEDULED_GOAL_PLANS.includes(String(planType || '').trim().toLowerCase());
}
