import LlmCallModel from '../../models/LlmCallModel.js';

/**
 * May more work start?
 *
 * ---------------------------------------------------------------------------
 * A CLAIM IS THE ADMISSION POINT, AND THE ONLY ONE
 * ---------------------------------------------------------------------------
 * The check happens where work BEGINS, never while it runs. That is not a
 * simplification — it is the rule:
 *
 *   NEVER KILL A RUNNING UNIT OF WORK FOR A BILLING REASON.
 *
 * Stopping a forty-minute agent turn at minute thirty-nine destroys the work,
 * the tokens already paid for, and the user's afternoon, to save the tail of
 * one task. The overage is cheaper than the interruption every time. So a
 * ceiling that is crossed mid-task is crossed; the next claim is where it
 * takes effect.
 *
 * ---------------------------------------------------------------------------
 * THIS FAILS CLOSED. planEntitlements FAILS OPEN. BOTH ARE CORRECT.
 * ---------------------------------------------------------------------------
 * services/auth/planEntitlements.js resolves every unknown to ENTITLED, and
 * its reasoning is right: "a billing check must never become an availability
 * risk". An unknown plan costs a rounding error.
 *
 * The mirror image of that argument does NOT hold here, and copying the
 * pattern by reflex would be the bug. An entitlement check that fails open
 * risks giving away a feature. A SPEND check that fails open risks a node
 * holding live provider credentials with no ceiling and no observer — the
 * failure is unbounded and denominated in real money.
 *
 * So: no limit configured is not a failure, it is an absent policy, and work
 * proceeds. A limit that is configured but cannot be EVALUATED stops new
 * claims. Different question, opposite answer.
 *
 * ---------------------------------------------------------------------------
 * TWO CEILINGS, NEVER THREE
 * ---------------------------------------------------------------------------
 *   soft — log it and keep going. The value of this is warning, not control.
 *   hard — stop admitting NEW work. In-flight work always finishes.
 *
 * A third tier invariably becomes the one nobody can define, and every
 * operator ends up guessing which of them actually stops anything.
 */

const HARD_LIMIT_ENV = 'AGNT_SPEND_LIMIT_USD';
const SOFT_LIMIT_ENV = 'AGNT_SPEND_SOFT_LIMIT_USD';

/** Soft-limit warnings are logged once per window, not once per claim. */
let softWarnedForDay = null;

function numericEnv(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Local midnight as a UTC string matching the `ts` column.
 *
 * Copied in shape from LedgerRoutes.startOfLocalDay deliberately: a budget
 * that measured a rolling 24 hours while the dashboard showed calendar days
 * would disagree with the page the operator is looking at, and they would
 * reasonably conclude one of the two was broken.
 */
function startOfLocalDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * @param {string} userId
 * @returns {Promise<{admit: boolean, reason: string, spentUsd: number|null, hardLimitUsd: number|null}>}
 */
export async function checkSpendAdmission(userId) {
  const hardLimitUsd = numericEnv(HARD_LIMIT_ENV);
  const softLimitUsd = numericEnv(SOFT_LIMIT_ENV);

  // No policy at all: the overwhelmingly common case, and the one that must
  // cost nothing. No query, no latency, no new way for a single-node install
  // to stop working.
  if (hardLimitUsd === null && softLimitUsd === null) {
    return { admit: true, reason: 'no_limit_configured', spentUsd: null, hardLimitUsd: null };
  }

  let spentUsd;
  try {
    const totals = await LlmCallModel.summary(userId, { since: startOfLocalDay() });
    // Charged money only. Notional spend is a subscription the operator has
    // already paid for; counting it against a dollar ceiling would stop a
    // Claude Code user who is costing nothing per call.
    spentUsd = Number(totals?.costUsd) || 0;
  } catch (error) {
    // FAIL CLOSED. A limit exists and we cannot tell whether it has been
    // crossed, so the safe answer is to stop starting new work.
    return {
      admit: false,
      reason: 'budget_unreadable',
      error: error.message,
      spentUsd: null,
      hardLimitUsd,
    };
  }

  if (softLimitUsd !== null && spentUsd >= softLimitUsd) {
    const today = startOfLocalDay();
    if (softWarnedForDay !== today) {
      softWarnedForDay = today;
      console.warn(
        `[cluster/budget] soft limit reached: $${spentUsd.toFixed(4)} of $${softLimitUsd.toFixed(2)} today. ` +
          'Work continues; this is a warning, not a stop.'
      );
    }
  }

  if (hardLimitUsd !== null && spentUsd >= hardLimitUsd) {
    return { admit: false, reason: 'hard_limit_reached', spentUsd, hardLimitUsd };
  }

  return { admit: true, reason: 'within_budget', spentUsd, hardLimitUsd };
}

/** Test seam: drop the once-per-day soft warning latch. */
export function __resetAdmissionForTests() {
  softWarnedForDay = null;
}
