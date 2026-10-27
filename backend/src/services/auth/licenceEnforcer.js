/**
 * Keeps the verified licence current, and acts on it.
 *
 * Main backend only (it needs the session token, which lives in memory here).
 * When an account's session arrives, its signed licence is fetched and cached
 * (licence.js) for the workflow process to verify offline. If that licence
 * says free, the account's workflows with paid triggers are switched off:
 * that is what ends the "restored pending" state workflowAdmission allows at
 * boot, before anyone has logged in.
 */
import { subscribe } from './sessionTokenCache.js';
import { fetchLicence, hostedPlan, PAID_PLANS } from './licence.js';
import { isEnforcing } from './planEntitlements.js';
import { paidTriggersIn } from '../../workflow/workflowAdmission.js';
import { FREE_LIMITS, isAutonomous, timerSchedulesIn, timerTooFastForFree } from './planLimits.js';
import { graceActive } from './planGrace.js';
import { credentialUserId } from './tenantOwnership.js';

/**
 * Switch off this account's live workflows that use paid triggers.
 * @param {{ listActive: () => Promise<Array<{id: string, user_id: string, workflow_data: string}>>, deactivate: (id: string, userId: string) => Promise<unknown> }} deps
 */
export async function stopPaidTriggerWorkflows(userId, { listActive, deactivate }) {
  const stopped = [];
  for (const row of await listActive()) {
    if (String(row.user_id) !== String(userId)) continue;
    let workflow;
    try {
      workflow = JSON.parse(row.workflow_data);
    } catch {
      continue;
    }
    const triggers = paidTriggersIn(workflow);
    if (!triggers.length) continue;
    try {
      await deactivate(row.id, userId);
      stopped.push({ id: row.id, triggers });
      console.log(`[licence] switched off workflow ${row.id}: ${triggers.join(', ')} need a paid plan`);
    } catch (error) {
      console.error(`[licence] could not switch off workflow ${row.id}:`, error.message);
    }
  }
  return stopped;
}

/**
 * After the grace period: switch off this free account's automatic workflows
 * that break a limit (a timer faster than the free plan allows), then any
 * beyond the allowed number, keeping the most recently changed ones.
 */
export async function enforceFreeLimits(userId, { listActive, deactivate, inGrace = graceActive }) {
  const owner = credentialUserId(userId);
  const live = (await listActive())
    .filter((row) => credentialUserId(row.user_id) === owner)
    .map((row) => {
      try {
        return { row, workflow: JSON.parse(row.workflow_data) };
      } catch {
        return null;
      }
    })
    .filter((entry) => entry && isAutonomous(entry.workflow));
  const overLimit = live.length > FREE_LIMITS.autonomousRoutines || live.some((e) => timerSchedulesIn(e.workflow).some(timerTooFastForFree));
  if (!overLimit || inGrace(owner)) return [];
  const newestFirst = [...live].sort((a, b) => String(b.row.updated_at || '').localeCompare(String(a.row.updated_at || '')));
  const stopped = [];
  let kept = 0;
  for (const { row, workflow } of newestFirst) {
    const reason = timerSchedulesIn(workflow).some(timerTooFastForFree) ? 'timer faster than daily' : kept >= FREE_LIMITS.autonomousRoutines ? 'over the free limit' : null;
    if (!reason) {
      kept += 1;
      continue;
    }
    try {
      await deactivate(row.id, row.user_id);
      stopped.push({ id: row.id, reason });
      console.log(`[licence] switched off workflow ${row.id}: ${reason}`);
    } catch (error) {
      console.error(`[licence] could not switch off workflow ${row.id}:`, error.message);
    }
  }
  return stopped;
}

/** Check one account now: fetch its licence, and act if it is free. */
export async function enforceForAccount(userId, deps) {
  if (!userId || !isEnforcing()) return null;
  // A hosted instance runs on its own plan (verifiedPlan does the same). A free
  // member signing in to a Business instance must not have workflows checked
  // against their personal licence.
  const plan = hostedPlan();
  if (plan && PAID_PLANS.has(plan)) return { valid: true, paid: true, planType: plan, source: 'hosted' };
  const verdict = await fetchLicence(userId);
  if (!verdict?.valid || verdict.paid) return verdict;
  await stopPaidTriggerWorkflows(userId, deps);
  await enforceFreeLimits(userId, deps);
  return verdict;
}

let stop = null;
/** Start watching sessions. Idempotent. */
export function startLicenceEnforcer(deps) {
  if (stop) return stop;
  stop = subscribe(({ userId }) => {
    enforceForAccount(userId, deps).catch((error) => console.error('[licence] enforcement failed:', error.message));
  });
  return stop;
}
