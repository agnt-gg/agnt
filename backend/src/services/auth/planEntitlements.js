import axios from 'axios';
import fs from 'fs';
import pathManager from '../../utils/PathManager.js';
import { authHeader, getSessionToken } from './sessionTokenCache.js';

/**
 * What this install's user is entitled to.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Until now this backend had NO notion of a plan. Grep it: nothing reads
 * plan_type, nothing imports a license. Plan data lived only in the frontend's
 * Vuex store, which is why paid features here were enforced by hiding a button
 * — a control that survives exactly as long as nobody opens devtools.
 *
 * `/api/pairing/*` is the case that forced the issue. Phone pairing is a paid
 * capability, it is implemented entirely locally, and the cloud never sees the
 * request. So the check has to happen here, which means here has to know.
 *
 * ---------------------------------------------------------------------------
 * IT FAILS OPEN, ON PURPOSE
 * ---------------------------------------------------------------------------
 * Pairing a phone to your own desktop over your own LAN is a LOCAL operation.
 * Making it depend on a reachable cloud is a real cost, and the failure it
 * introduces is worse than the one it prevents:
 *
 *   fail closed -> api.agnt.gg has a bad hour, and a Personal Pro customer
 *                  cannot pair with the machine sitting in front of them.
 *   fail open   -> a free user pairs a phone during that same hour.
 *
 * The second is a rounding error against the first. Every unknown answer —
 * no token yet, network down, 500, malformed body — resolves to ENTITLED.
 * The only thing that denies is a successful lookup that says `free`.
 *
 * This mirrors `gatedFeature` on the API, which also calls next() when the
 * plan lookup throws. Same principle: a billing check must never become an
 * availability risk.
 *
 * ---------------------------------------------------------------------------
 * STAGED, LIKE EVERYTHING ELSE IN THIS MIGRATION
 * ---------------------------------------------------------------------------
 * Off unless ENFORCE_PLAN_GATES=true or a `.enforce-plan-gates` file exists in
 * the data directory — deliberately the same name and the same semantics as the
 * server-side sentinel, so one mental model covers both halves and an operator
 * flipping "plan gates" does not have to remember that local is different.
 */

/** Mirrors PLAN_DETAILS in the API's config/plans.js. Free is the only denier. */
const PAID_PLANS = new Set(['personal', 'business', 'enterprise']);

/**
 * Features this module can answer for. Kept explicit rather than mirroring the
 * whole server table: a typo'd feature name should be a loud failure at review
 * time, not a silent `undefined` that quietly denies a paying customer.
 */
const KNOWN_FEATURES = new Set(['remoteAccess', 'webhooks', 'emailServer', 'apiAccess', 'cloudSync']);

/**
 * A plan does not change between two requests seconds apart, and the pairing
 * panel polls /status on an interval. Long enough to be cheap, short enough
 * that an upgrade is honoured within a minute.
 */
const PLAN_CACHE_MS = 60_000;

/** Never let a slow cloud hold up a local request. Timeout => entitled. */
const LOOKUP_TIMEOUT_MS = 4000;

let cached = null; // { planType, at }
let inFlight = null;

function sentinelPath() {
  try {
    return pathManager.getDataPath('.enforce-plan-gates');
  } catch {
    return null;
  }
}

/** Are plan gates being enforced on this install right now? */
export function isEnforcing() {
  const flag = process.env.ENFORCE_PLAN_GATES;
  if (flag === 'true' || flag === '1') return true;
  if (flag === 'false' || flag === '0') return false;

  const file = sentinelPath();
  if (!file) return false;
  try {
    return fs.existsSync(file);
  } catch {
    // An unreadable sentinel is not permission to start refusing people.
    return false;
  }
}

/**
 * The user's plan type, or null when it cannot be determined.
 *
 * null is meaningfully different from 'free': it means "do not know", and every
 * caller treats it as entitled. Only a definite 'free' denies.
 */
export async function getPlanType({ force = false } = {}) {
  if (!force && cached && Date.now() - cached.at < PLAN_CACHE_MS) return cached.planType;

  // Collapse concurrent callers onto one request. The pairing panel can fire
  // /status and /code within the same tick.
  if (inFlight) return inFlight;

  const remoteUrl = process.env.REMOTE_URL;
  if (!remoteUrl || !getSessionToken()) return null;

  inFlight = (async () => {
    try {
      const response = await axios.get(`${remoteUrl}/license/status`, {
        headers: authHeader(),
        timeout: LOOKUP_TIMEOUT_MS,
      });

      // `authenticated: false` means the cloud did not recognise our token. That
      // is a "do not know", not a "free" — refusing a paying customer because
      // their token happened to be stale would be the exact failure this module
      // is written to avoid.
      if (response.data?.authenticated === false) return null;

      const planType = response.data?.planType;
      if (typeof planType !== 'string' || !planType) return null;

      cached = { planType, at: Date.now() };
      return planType;
    } catch (error) {
      console.warn('[planEntitlements] plan lookup failed, treating as entitled:', error.message);
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Is this install entitled to `feature`?
 *
 * Returns true whenever the answer is unknown. See the fail-open note above.
 */
export async function hasFeature(feature) {
  if (!KNOWN_FEATURES.has(feature)) {
    console.warn(`[planEntitlements] unknown feature '${feature}' — allowing`);
    return true;
  }
  const planType = await getPlanType();
  if (planType === null) return true;
  return PAID_PLANS.has(planType);
}

/**
 * Express guard for a paid LOCAL capability.
 *
 * 403 with `requiredFeature`, never 401. The frontend classifies that shape as
 * `plan_denied` and shows an upgrade prompt; a 401 would be read as "session
 * dead", log the user out, and return them to the same 403 after they log back
 * in — an unbreakable loop. See frontend/src/store/auth/userAuth.js.
 */
export function requirePaidFeature(feature) {
  return async function requirePaidFeatureMiddleware(req, res, next) {
    let entitled = true;
    try {
      entitled = await hasFeature(feature);
    } catch (error) {
      console.warn(`[planEntitlements] ${feature} check threw, allowing:`, error.message);
      return next();
    }

    if (entitled || !isEnforcing()) return next();

    return res.status(403).json({
      success: false,
      error: 'Feature not available',
      message: 'This feature is not available on your current plan',
      requiredFeature: feature,
    });
  };
}

/** Test seam. */
export function __resetPlanEntitlementsForTests() {
  cached = null;
  inFlight = null;
}
