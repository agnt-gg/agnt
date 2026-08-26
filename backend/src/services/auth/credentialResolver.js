/**
 * credentialResolver — one ordered cascade for "where is this CLI's session?"
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * Six local providers had six hand-rolled resolvers, each hard-coded to one
 * vendor's storage layout. Storage layout is a private implementation detail
 * that moves — Claude Code went file → keychain and every one of those six
 * would break the same way in turn, each needing its own patch, each failing
 * in the worst possible mode: provider looks DEAD, not degraded.
 *
 * A cascade with named tiers replaces "read this exact file" with "find the
 * session, wherever this version of the CLI decided to keep it".
 *
 * THE TIERS, in precedence order
 * ------------------------------
 *   agnt-store    Credentials AGNT obtained itself. Ours: refreshable, and
 *                 deletable on disconnect. Wins over everything because an
 *                 explicit in-app connect is the strongest statement of intent.
 *   env           OPENAI_API_KEY, XAI_API_KEY, … Deliberate operator override,
 *                 so it outranks anything merely discovered on disk.
 *   vendor-file   The CLI's own dotfile. READ-ONLY adoption.
 *   secret-store  The OS keychain. READ-ONLY adoption.
 *   cli-probe     Ask the binary. Yields a sentinel, not a real token.
 *
 * OWNERSHIP IS THE LOAD-BEARING PART
 * ----------------------------------
 * Every resolved credential carries `ownedByAgnt`. It gates two operations that
 * were previously performed unconditionally on credentials belonging to another
 * program:
 *
 *   REFRESH — an OAuth refresh ROTATES the refresh token. Refreshing a
 *   credential we merely discovered can invalidate the user's terminal session
 *   as a side effect of AGNT's own background timer. Guarded now.
 *
 *   DELETE — "Disconnect" must not reach into a vendor's store and revoke a
 *   session AGNT never created. We remove ours and say plainly what remains.
 */

export const TIER = {
  AGNT_STORE: 'agnt-store',
  ENV: 'env',
  VENDOR_FILE: 'vendor-file',
  SECRET_STORE: 'secret-store',
  CLI_PROBE: 'cli-probe',
};

/** Tiers whose credentials AGNT may refresh and delete. */
const OWNED_TIERS = new Set([TIER.AGNT_STORE, TIER.ENV]);

/**
 * Walk candidates in order and return the first that yields a token.
 *
 * A candidate's `read()` may throw; a throwing tier is skipped rather than
 * allowed to take down the cascade. That matters because tiers touch the
 * filesystem and spawn processes — the flakiest things in the system — and a
 * lower tier is very often still a correct answer.
 *
 * @param {Array<{
 *   tier: string,
 *   source: string,
 *   ownedByAgnt?: boolean,
 *   read: () => ({ token: string, [key: string]: any } | string | null)
 * }>} candidates
 * @returns {{
 *   token: string, tier: string, source: string, ownedByAgnt: boolean,
 *   [key: string]: any
 * } | null}
 */
export function resolveFirst(candidates) {
  if (!Array.isArray(candidates)) return null;

  for (const candidate of candidates) {
    if (!candidate || typeof candidate.read !== 'function') continue;

    let result;
    try {
      result = candidate.read();
    } catch {
      continue;
    }
    if (!result) continue;

    const normalized = typeof result === 'string' ? { token: result } : result;
    const token = typeof normalized.token === 'string' ? normalized.token.trim() : '';
    if (!token) continue;

    // Precedence, most specific first:
    //   1. what read() actually found  — only it can inspect the credential's
    //      SHAPE, which is how Claude tells its own legacy ~/.claude block
    //      apart from the CLI's,
    //   2. a static per-candidate declaration,
    //   3. the tier default.
    // Deriving this from the tier alone silently discarded (1) and marked every
    // legacy AGNT credential unrefreshable — which would have stranded existing
    // users at their next token expiry.
    const ownedByAgnt = typeof normalized.ownedByAgnt === 'boolean'
      ? normalized.ownedByAgnt
      : typeof candidate.ownedByAgnt === 'boolean'
        ? candidate.ownedByAgnt
        : OWNED_TIERS.has(candidate.tier);

    return {
      ...normalized,
      token,
      tier: candidate.tier,
      source: candidate.source || candidate.tier,
      ownedByAgnt,
    };
  }

  return null;
}

/**
 * First non-empty string among the named environment variables.
 * Returns the VARIABLE NAME alongside the value so the UI can tell the user
 * which one is winning — "connected via XAI_API_KEY" is actionable in a way
 * that "connected via env" is not.
 */
export function readEnvToken(envKeys, env = process.env) {
  if (!Array.isArray(envKeys)) return null;
  for (const key of envKeys) {
    const value = typeof env[key] === 'string' ? env[key].trim() : '';
    if (value) return { token: value, envKey: key };
  }
  return null;
}

/**
 * Human-readable label for a resolved credential.
 * Used by the status endpoint and the discovery sweep so the UI can distinguish
 * "you connected this in AGNT" from "we found your terminal's session" — which
 * is exactly the distinction that makes Disconnect honest.
 */
export function describeSource(resolved) {
  if (!resolved) return 'not connected';
  switch (resolved.tier) {
    case TIER.AGNT_STORE:
      return 'connected in AGNT';
    case TIER.ENV:
      return `environment (${resolved.envKey || 'env'})`;
    case TIER.VENDOR_FILE:
      return resolved.ownedByAgnt ? 'AGNT credentials file' : 'CLI credentials file';
    case TIER.SECRET_STORE:
      return 'CLI session in OS keychain';
    case TIER.CLI_PROBE:
      return 'CLI reports signed in';
    default:
      return resolved.source || 'unknown';
  }
}
