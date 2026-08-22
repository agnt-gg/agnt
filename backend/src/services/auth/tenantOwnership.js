/**
 * WHO IS ALLOWED ON THIS INSTANCE.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS CLOSES
 * ---------------------------------------------------------------------------
 * Authentication and authorization were the same question here, and they are
 * not the same question.
 *
 * A hosted tenant cannot verify a cloud token locally — it deliberately holds
 * no copy of the issuer's signing key — so it asks api.agnt.gg. The issuer
 * answers the only question it was asked: "is this token genuine?" It says yes
 * for EVERY account it has ever issued. routes/Middleware.js then treated that
 * yes as permission, called syncRemoteUserToLocal(), and let the caller in.
 *
 * Measured on 2026-08-21 against a live $49 tenant: an account created seconds
 * earlier, owning nothing, was admitted on 5 of 5 routes. Signup is open, so
 * the population able to do that was everyone on the internet, not merely the
 * 637 existing accounts.
 *
 * Data did not leak — every row query scopes by user_id, so the stranger saw
 * their own empty workspace. What they got was a session on somebody else's
 * paid machine: the node identity and worker fleet from /api/cluster/nodes, a
 * local user row, disk on the owner's quota, and one further consequence worth
 * naming because it is not obvious. services/auth/sessionTokenCache.js holds a
 * SINGLE slot and empties itself permanently when it sees a second user id —
 * correct behaviour, since using the wrong identity is worse than using none —
 * so one stranger request disables the owner's background pollers until the
 * container restarts. A denial of service costing one HTTP call.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SLUG DECIDES, NOT THE MEMBER LIST
 * ---------------------------------------------------------------------------
 * The obvious rule — "empty list means let everyone in" — silently reopens the
 * hole the first time tenant.sh has a bug. The opposite rule — "empty list
 * means let nobody in" — locks a paying customer out of their own instance
 * over a typo. Both failures are bad and neither is detectable at a glance.
 *
 * So a third signal decides which mode this process is in, and it is one that
 * cannot be set by accident: AGNT_TENANT_SLUG. tenant.sh has always passed it
 * (the application simply never read it), and nothing else in AGNT sets it. A
 * cloud tenant always has one; a desktop install never does.
 *
 *   no slug                  desktop        no ownership check at all
 *   slug + members           cloud, bound   enforce
 *   slug + NO members        cloud, broken  REFUSE TO BOOT
 *
 * The third row is the important one. Misconfiguration becomes a container
 * that exits and a `tenant create` that fails its health poll within seconds —
 * loud, immediate, and impossible to mistake for working. It can neither
 * silently admit strangers nor silently lock out an owner, because there is
 * nothing running to do either.
 *
 * ---------------------------------------------------------------------------
 * A LIST FROM THE FIRST LINE, NOT AN OWNER
 * ---------------------------------------------------------------------------
 * The immediate need is one owner per instance. The product is Business Cloud:
 * three seats included, more at $25 up to a hundred. Shipping owner-equality
 * now would mean tearing it out within weeks, so the check is membership from
 * the start and today's list simply has one entry.
 *
 * The next change replaces where the list COMES FROM — api.agnt.gg gaining a
 * tenant_members table, answered on the /users/auth/status call this backend
 * already makes for every token, so membership costs no extra round trip and
 * inherits that call's stale-grace window. This env list stays underneath as
 * the floor that holds while the issuer is unreachable. `isPermittedUser` does
 * not change again.
 */

/** Names in one place so tenant.sh, the docs and the code cannot drift. */
export const TENANT_SLUG_ENV = 'AGNT_TENANT_SLUG';
export const TENANT_OWNER_ENV = 'AGNT_TENANT_OWNER';
export const TENANT_MEMBERS_ENV = 'AGNT_TENANT_MEMBERS';

/** The refusal a caller sees. Distinct from an auth failure — see isPermittedUser. */
export const NOT_A_MEMBER = 'not_tenant_member';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

/** This instance's tenant slug, or '' on a desktop install. */
export function tenantSlug() {
  return clean(process.env[TENANT_SLUG_ENV]);
}

/**
 * Is this process a hosted tenant?
 *
 * Only tenant.sh sets the slug, so this cannot become true by accident — which
 * is the entire reason it, rather than the member list, decides the mode.
 */
export function isTenantInstance() {
  return tenantSlug() !== '';
}

/** The account that owns this instance, or '' if unset. Used for role checks. */
export function tenantOwnerId() {
  return clean(process.env[TENANT_OWNER_ENV]);
}

/**
 * Everyone allowed on this instance.
 *
 * The owner is always a member, whether or not the list repeats them, so an
 * operator cannot lock the owner out by editing only the members variable.
 * Deduplicated, blanks dropped: a trailing comma is a typo, not a member.
 */
export function tenantMemberIds() {
  const ids = new Set();
  const owner = tenantOwnerId();
  if (owner) ids.add(owner);
  for (const part of clean(process.env[TENANT_MEMBERS_ENV]).split(',')) {
    const id = part.trim();
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * May this user use this instance?
 *
 * AUTHENTICATION IS A SEPARATE QUESTION AND IS UNCHANGED. This runs only after
 * a token has already been proven genuine; a caller with no token, or a forged
 * one, is still refused by the auth layer with a 401 exactly as before. This
 * answers the second question — whether being a real AGNT user entitles you to
 * THIS machine — and the answer used to be an unconditional yes.
 *
 * On a desktop install there is no tenant, so there is nothing to be a member
 * of and this is inert. That is what keeps every existing install bit-for-bit
 * unchanged, and it is the property most worth protecting here: a wrong answer
 * costs a mass lockout of people who are not even affected by the defect.
 *
 * ---------------------------------------------------------------------------
 * TWO SOURCES, AND WHICH ONE WINS
 * ---------------------------------------------------------------------------
 * The env list is written into the container when it is created. It is correct
 * at that instant and goes stale the moment somebody is invited or removed,
 * and refreshing it means recreating the container.
 *
 * api.agnt.gg holds the live answer and returns it on the /users/auth/status
 * call this backend already makes for every token. So when the issuer has an
 * answer, that answer decides — an invitation takes effect within the cache
 * TTL instead of at the next redeploy, and a removal takes effect just as
 * fast, which is the half that actually matters.
 *
 * WHEN IT HAS NO ANSWER, THE ENV LIST IS THE FLOOR. Three cases reach that
 * branch and none of them may open the instance up: the issuer is unreachable
 * and the grace window has lapsed, this server has no record of the slug, or
 * the deployed issuer predates the parameter entirely. All three mean "no
 * information", and answering "admit everyone" to no information is the
 * original defect. The list the container booted with is a floor, never a
 * ceiling to be raised by silence.
 *
 * `serving` is deliberately NOT consulted. A suspended or resuming instance
 * that is nonetheless running should still answer to its own members — gating
 * admission on it would lock an owner out of their own machine during the
 * provisioning window of a resume, which is the exact moment they are most
 * likely to be looking.
 *
 * @param {string|null|undefined} userId  an ALREADY-AUTHENTICATED user id
 * @param {object|null} [verdict]  the issuer's answer for this tenant, if any
 * @returns {boolean}
 */
export function isPermittedUser(userId, verdict = null) {
  if (!isTenantInstance()) return true;
  const id = clean(userId);
  if (!id) return false;

  if (verdict && verdict.known === true) return verdict.isMember === true;

  return tenantMemberIds().includes(id);
}

/**
 * Refuse to start a tenant that would admit anyone.
 *
 * Called once at boot. Returns a reason rather than throwing, so the caller
 * decides how to die and the whole thing stays unit-testable without spawning
 * a process.
 *
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function assertTenantBinding() {
  if (!isTenantInstance()) return { ok: true };
  if (tenantMemberIds().length === 0) {
    return {
      ok: false,
      reason:
        `${TENANT_SLUG_ENV}=${tenantSlug()} makes this a hosted tenant, but neither ` +
        `${TENANT_OWNER_ENV} nor ${TENANT_MEMBERS_ENV} names anyone. Starting would ` +
        `admit every AGNT account. Recreate with: tenant create ${tenantSlug()} --owner <userId>`,
    };
  }
  return { ok: true };
}

export default {
  isPermittedUser,
  isTenantInstance,
  tenantSlug,
  tenantOwnerId,
  tenantMemberIds,
  assertTenantBinding,
  NOT_A_MEMBER,
};
