/**
 * May this workflow go live for this owner?
 *
 * The one check every way a workflow starts listening goes through
 * (ProcessManager: a user switching it on, and the restore at boot). Before
 * 2026-10-21 nothing here checked a plan: `requiresPro` only drew a [PRO]
 * badge, and the free plan ran unlimited automatic workflows at any interval.
 *
 * A free plan (anything a verified licence does not prove paid):
 *   - may not use paid triggers (`requiresPro`: webhook, email);
 *   - may run timers daily or slower (planLimits.FREE_LIMITS.fastestTimer);
 *   - may have FREE_LIMITS.autonomousRoutines workflows live at once.
 * Workflows already live when these limits arrived get a grace period at
 * restore (planGrace.js): they keep running GRACE_DAYS, then only the
 * allowed number is restored. Switching a new one on never gets grace.
 *
 * Runs in the workflow process, which has no session to fetch a licence with,
 * so it verifies the licence the main backend cached (licence.js), offline.
 */
import { createRequire } from 'node:module';
import { isEnforcing, canRunScheduledGoals } from '../services/auth/planEntitlements.js';
import { readCachedLicence, verifySignedLicence } from '../services/auth/licence.js';
import { credentialUserId } from '../services/auth/tenantOwnership.js';
import { FREE_LIMITS, isAutonomous, timerSchedulesIn, timerTooFastForFree } from '../services/auth/planLimits.js';
import { graceActive } from '../services/auth/planGrace.js';

const require = createRequire(import.meta.url);
const library = require('../tools/toolLibrary.json');

/** Trigger types a free plan may not run. */
export const PAID_TRIGGERS = Object.freeze(new Set((library.triggers || []).filter((tool) => tool.requiresPro).map((tool) => tool.type)));

export function paidTriggersIn(workflow) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  return [...new Set(nodes.map((node) => node?.type).filter((type) => PAID_TRIGGERS.has(type)))];
}

/** Does this owner have any verified licence on disk (paid or free)? */
export function hasVerifiedLicence(userId) {
  if (process.env.AGNT_TENANT_SLUG && process.env.AGNT_TENANT_PLAN) return true;
  const owner = credentialUserId(userId);
  const cached = readCachedLicence(owner);
  return Boolean(cached && verifySignedLicence(cached, { userId: owner }).valid);
}

const refuse = (code, error, extra = {}) => ({ ok: false, code, error, ...extra });

/**
 * @param {object} workflow
 * @param {string} userId the workflow's owner
 * @param {object} [options]
 * @param {boolean} [options.restore] re-arming at boot. With no licence on disk
 *   yet (before the owner's first login after this shipped) it is restored
 *   PENDING, and licenceEnforcer applies the plan at that login.
 * @param {number} [options.liveAutonomous] this owner's OTHER live automatic workflows
 * @returns {Promise<{ok: true, pending?: boolean, grace?: boolean} | {ok: false, code: 'PLAN_REQUIRED'|'PLAN_LIMIT', error: string, triggers?: string[], limit?: string}>}
 */
export async function admitWorkflow(workflow, userId, {
  restore = false,
  liveAutonomous = 0,
  hasPaidPlan = (id) => canRunScheduledGoals(id, { network: false }),
  hasLicence = hasVerifiedLicence,
  inGrace = graceActive,
} = {}) {
  if (!isEnforcing() || !isAutonomous(workflow)) return { ok: true };
  if (await hasPaidPlan(userId)) return { ok: true };
  if (restore && !hasLicence(userId)) return { ok: true, pending: true };

  const triggers = paidTriggersIn(workflow);
  if (triggers.length) {
    return refuse('PLAN_REQUIRED', `${triggers.join(' and ')} ${triggers.length > 1 ? 'need' : 'needs'} a paid AGNT plan.`, { triggers });
  }
  const tooFast = timerSchedulesIn(workflow).filter(timerTooFastForFree);
  if (tooFast.length) {
    return refuse('PLAN_LIMIT', `The free plan runs timers ${FREE_LIMITS.fastestTimer.toLowerCase()} or slower; "${tooFast[0]}" needs a paid AGNT plan.`, { limit: 'fastestTimer' });
  }
  if (liveAutonomous >= FREE_LIMITS.autonomousRoutines) {
    // Already running when the limits arrived: keep it through the grace period.
    if (restore && inGrace(credentialUserId(userId))) return { ok: true, grace: true };
    return refuse('PLAN_LIMIT', `The free plan runs ${FREE_LIMITS.autonomousRoutines} automatic workflows at a time. Switch one off, or upgrade to run them all.`, { limit: 'autonomousRoutines' });
  }
  return { ok: true };
}
