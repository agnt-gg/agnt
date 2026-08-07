/**
 * Turn an entitlement refusal into something a human can act on.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * api.agnt.gg now refuses paid features to free accounts with:
 *
 *     403 { error: 'Feature not available', requiredFeature: 'emailServer' }
 *
 * Left alone, axios turns that into `Request failed with status code 403` and a
 * workflow node fails with exactly that string. The user is told a number.
 * Nothing tells them their plan is the reason, and nothing tells them what to
 * do — so the 403-not-401 design, which exists precisely so the product can
 * offer an upgrade instead of a logout, delivers nothing.
 *
 * The server already sends the useful part. This reads it.
 *
 * ---------------------------------------------------------------------------
 * WHY IT MATCHES ON SHAPE, NOT ON STATUS
 * ---------------------------------------------------------------------------
 * 403 means two unrelated things: "your account is forbidden" (suspended) and
 * "your plan does not include this". Only the second is an upgrade prompt, and
 * only the response BODY distinguishes them. Matching on the status code alone
 * would tell a suspended user to buy a subscription.
 *
 * This mirrors `isPlanDenial` in frontend/src/store/auth/userAuth.js — same
 * markers, same reasoning, applied to the backend's own outbound calls.
 */

/** Human-readable names for the entitlements a workflow can actually hit. */
const FEATURE_LABELS = {
  emailServer: 'Email',
  webhooks: 'Webhooks',
  apiAccess: 'API access',
  cloudSync: 'Cloud sync',
  multiUser: 'Team seats',
};

/**
 * Is this error the server saying "not on your plan"?
 *
 * @param {unknown} error an axios error, or a fetch Response-derived body
 * @returns {{ requiredFeature: string|null, requiredPlan: string|null } | null}
 */
export function readPlanDenial(error) {
  const response = error?.response;
  if (!response || response.status !== 403) return null;
  return readPlanDenialBody(response.data);
}

/**
 * Same test against a parsed body, for `fetch` call sites that do not produce
 * an axios-shaped error.
 */
export function readPlanDenialBody(body) {
  if (!body || typeof body !== 'object') return null;
  const isDenial =
    Boolean(body.requiredFeature) ||
    Boolean(body.requiredPlan) ||
    body.error === 'Feature not available' ||
    body.error === 'Upgrade required';
  if (!isDenial) return null;
  return {
    requiredFeature: body.requiredFeature || null,
    requiredPlan: body.requiredPlan || null,
  };
}

/**
 * The sentence to show the user. Names the feature, names the fix.
 *
 * @param {{ requiredFeature: string|null, requiredPlan: string|null }} denial
 * @param {string} [action] what they were trying to do, e.g. 'Send email'
 */
export function planDenialMessage(denial, action = 'This action') {
  const label = FEATURE_LABELS[denial?.requiredFeature] || denial?.requiredFeature;
  const feature = label ? `${label} is` : `${action} is`;
  const plan = denial?.requiredPlan ? ` (requires the ${denial.requiredPlan} plan or higher)` : '';
  return (
    `${feature} not included in your current AGNT plan${plan}. ` +
    `Upgrade in Settings > Billing to enable it.`
  );
}

/**
 * Convenience for a catch block: returns the upgrade sentence when the error is
 * an entitlement refusal, and null when it is anything else — so the caller
 * keeps its own handling for real failures.
 */
export function planDenialMessageFor(error, action) {
  const denial = readPlanDenial(error);
  return denial ? planDenialMessage(denial, action) : null;
}
