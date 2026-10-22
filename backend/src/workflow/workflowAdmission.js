/**
 * May this workflow go live for this owner?
 *
 * The one check every way a workflow starts listening goes through
 * (ProcessManager: a user switching it on, and the restore at boot). Triggers
 * marked `requiresPro` in the tool library (today the webhook listener and the
 * email trigger) are paid features, and until 2026-10-21 nothing read that flag:
 * it only drew a [PRO] badge in the editor.
 *
 * Runs in the workflow process, which has no session to fetch a licence with,
 * so it verifies the licence the main backend cached (licence.js), offline.
 */
import { createRequire } from 'node:module';
import { isEnforcing, canRunScheduledGoals } from '../services/auth/planEntitlements.js';
import { readCachedLicence, verifySignedLicence } from '../services/auth/licence.js';
import { credentialUserId } from '../services/auth/tenantOwnership.js';

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

/**
 * @param {object} workflow
 * @param {string} userId the workflow's owner
 * @param {{ restore?: boolean }} [options] restore: re-arming at boot. With no
 *   licence on disk yet (the first boot after this shipped, before any login),
 *   the workflow is restored PENDING; licenceEnforcer switches it off at the
 *   owner's first login if the licence says free. A licence that exists decides
 *   now.
 * @returns {Promise<{ok: true, pending?: boolean} | {ok: false, code: 'PLAN_REQUIRED', triggers: string[], error: string}>}
 */
export async function admitWorkflow(workflow, userId, { restore = false, hasPaidPlan = (id) => canRunScheduledGoals(id, { network: false }), hasLicence = hasVerifiedLicence } = {}) {
  const triggers = paidTriggersIn(workflow);
  if (!triggers.length || !isEnforcing()) return { ok: true };
  if (await hasPaidPlan(userId)) return { ok: true };
  if (restore && !hasLicence(userId)) return { ok: true, pending: true };
  return {
    ok: false,
    code: 'PLAN_REQUIRED',
    triggers,
    error: `${triggers.join(' and ')} ${triggers.length > 1 ? 'need' : 'needs'} a paid AGNT plan.`,
  };
}
