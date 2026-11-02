import { getSessionUserId } from './sessionTokenCache.js';
import { credentialUserId } from './tenantOwnership.js';
import { verifiedPlan, PAID_PLANS, LOCAL_PLANS } from './licence.js';

/**
 * What this install's user is entitled to, from a VERIFIED licence.
 *
 * Until 2026-10-21 this module asked GET /license/status (an unsigned answer),
 * treated every unknown as entitled, and enforced nothing unless an operator
 * had created a `.enforce-plan-gates` file, which no install had. The
 * frontend's own licence check never ran either (it called a preload bridge
 * that does not exist and returned true). Net effect: nothing on the desktop
 * enforced a plan.
 *
 * Now:
 *   - The plan is what a licence signed by api.agnt.gg says (licence.js),
 *     verified here with the public key, bound to the user, unexpired. The
 *     signed licence is cached, so a paying customer offline keeps their plan
 *     until it expires.
 *   - Unknown is NOT paid. A paid capability needs proof.
 *   - Enforcement is ON. ENFORCE_PLAN_GATES=false turns it off for tests and
 *     development only; a missing setting means on.
 *
 * Two questions, never mixed:
 *   - hasFeature / hasPaidPlan: PAID. Anything that costs AGNT money (hosted
 *     services, relays, remote access, paid triggers) needs a paid plan.
 *   - liftsFreeLimits: PAID OR TRIAL. The free plan's local limits
 *     (planLimits.FREE_LIMITS: agents, workflows, automations, timers,
 *     connections, history, scheduled goals) run on this machine and cost
 *     nothing, so the referral trial lifts them too.
 */

/** Features this module answers for. A typo should fail loudly in review, not deny or grant silently. */
const KNOWN_FEATURES = new Set([
  'remoteAccess', 'webhooks', 'emailServer', 'apiAccess', 'cloudSync',
  // Hosted services, included with every paid plan (`services` in the API's PLAN_DETAILS).
  'models', 'search', 'sandbox', 'mail', 'hostedWebhooks', 'mobile',
]);

/** Are plan gates enforced? Yes, unless explicitly switched off. */
export function isEnforcing() {
  const flag = String(process.env.ENFORCE_PLAN_GATES ?? '').trim().toLowerCase();
  return !(flag === 'false' || flag === '0' || flag === 'off');
}

/**
 * The plan a verified licence proves for this account, or null when none does.
 * null is "not proven", and callers deny paid capabilities on it.
 */
export async function getPlanType({ userId, network = true, token } = {}) {
  const account = userId || getSessionUserId();
  if (!account) return null;
  return verifiedPlan(account, token ? { network, token } : { network });
}

/** The bearer token a request carries, if any. */
function bearerOf(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization || '';
  return /^Bearer\s+(.+)$/i.exec(String(header))?.[1]?.trim() || undefined;
}

/** Is the current account entitled to a paid feature? Only with a verified paid licence. */
export async function hasFeature(feature, { userId, token } = {}) {
  if (!KNOWN_FEATURES.has(feature)) {
    console.warn(`[planEntitlements] unknown feature '${feature}' — denying`);
    return false;
  }
  if (!isEnforcing()) return true;
  return PAID_PLANS.has(await getPlanType({ userId, token }));
}

/**
 * Express guard for a paid LOCAL capability.
 *
 * 403 with `requiredFeature`, never 401: the frontend shows an upgrade prompt
 * for that shape, while a 401 would log the user out into the same 403
 * forever (frontend/src/store/auth/userAuth.js).
 */
export function requirePaidFeature(feature) {
  return async function requirePaidFeatureMiddleware(req, res, next) {
    let entitled = false;
    try {
      entitled = await hasFeature(feature, { userId: req.user?.userId || req.user?.id, token: bearerOf(req) });
    } catch (error) {
      console.warn(`[planEntitlements] ${feature} check failed, denying:`, error.message);
    }
    if (entitled) return next();
    return res.status(403).json({
      success: false,
      error: 'Feature not available',
      message: 'This feature needs a paid AGNT plan.',
      requiredFeature: feature,
    });
  };
}

/** Test seam (kept for callers; the cache now lives in licence.js on disk). */
export function __resetPlanEntitlementsForTests() {}

/**
 * Is this OWNER on a proven paid plan? For what costs AGNT money and has no
 * request to carry a token (paid triggers at workflow admission).
 * A team workspace has no plan of its own; it runs on the instance owner's.
 */
export async function hasPaidPlan(userId, { network = true } = {}) {
  if (!userId) return false;
  if (!isEnforcing()) return true;
  return PAID_PLANS.has(await getPlanType({ userId: credentialUserId(userId), network }));
}

/**
 * Are the free plan's local limits lifted for this OWNER: a proven paid plan
 * or a running trial? Decided for the owner, never whichever account
 * authenticated most recently.
 */
export async function liftsFreeLimits(userId, { network = true } = {}) {
  if (!userId) return false;
  if (!isEnforcing()) return true;
  return LOCAL_PLANS.has(await getPlanType({ userId: credentialUserId(userId), network }));
}

/** Scheduled goals run local agents on the user's own keys: a local limit. */
export async function canRunScheduledGoals(userId, options) {
  return liftsFreeLimits(userId, options);
}
export async function requireScheduledGoals(req, res, next) {
  // Downgraded accounts must still be able to stop or remove existing jobs.
  if (req.method === 'DELETE' || (req.method === 'PATCH' && req.body?.enabled === false && Object.keys(req.body).every(k => k === 'enabled'))) return next();
  if (await canRunScheduledGoals(req.user?.userId || req.user?.id)) return next();
  return res.status(403).json({ error: 'Upgrade required', requiredFeature: 'scheduledGoals', message: 'Scheduled goals need AGNT Pro.' });
}
