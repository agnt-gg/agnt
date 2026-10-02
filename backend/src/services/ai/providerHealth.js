/**
 * providerHealth.js — is a provider worth calling right now?
 *
 * Learned from REAL calls, not from probes. The /models health monitor
 * (ProviderHealthCheck) only proves a catalogue endpoint answers; it says
 * nothing about whether a completion will succeed for this user's key, plan or
 * quota, and nothing ever started it. Every routed and chat call already tells
 * us the truth, so that is the signal: a circuit breaker per (user, provider).
 *
 *   closed   → calls go through.
 *   cooling  → a provider-wide failure happened; callers move this provider to
 *              the BACK of their chain until the cooldown ends. Never dropped:
 *              a chain must not end up empty because everything was briefly
 *              unhappy.
 *   trial    → the cooldown elapsed; the next call is the probe. Success closes
 *              the circuit, failure re-opens it with a longer cooldown.
 *
 * Only failures that say something about the PROVIDER open it. A 404 for one
 * model, a context-length error or an unparseable answer says nothing about
 * the provider's other models, so 'unknown' and 'invalid_output' are ignored.
 *
 * Keyed per user because the dominant failures — auth, quota caps — are
 * properties of a credential, not of the vendor.
 */

/** Cooldown per failure reason. Exponential from base, capped at max. */
export const COOLDOWN_POLICY = Object.freeze({
  auth: { baseMs: 30 * 60_000, maxMs: 30 * 60_000 },
  cap: { baseMs: 60 * 60_000, maxMs: 60 * 60_000 },
  rate_limit: { baseMs: 60_000, maxMs: 15 * 60_000 },
  overloaded: { baseMs: 30_000, maxMs: 10 * 60_000 },
  network: { baseMs: 20_000, maxMs: 5 * 60_000 },
});

/** Bounded so a long-lived process cannot grow this map without limit. */
export const MAX_TRACKED = 500;

function keyOf(userId, provider) {
  return `${userId || '*'}::${String(provider || '').trim().toLowerCase()}`;
}

/**
 * @param {{ now?: () => number, maxTracked?: number }} [options]
 *   `now` is injectable so cooldown arithmetic is testable without sleeping.
 */
export function createProviderHealth({ now = Date.now, maxTracked = MAX_TRACKED } = {}) {
  const entries = new Map(); // key → { failures, reason, openUntil, lastFailureAt }

  function recordFailure(userId, provider, reason) {
    const policy = COOLDOWN_POLICY[reason];
    if (!policy || !provider) return null;
    const key = keyOf(userId, provider);
    const previous = entries.get(key);
    const failures = (previous?.failures || 0) + 1;
    const cooldownMs = Math.min(policy.maxMs, policy.baseMs * 2 ** (failures - 1));
    const at = now();
    const entry = { failures, reason, openUntil: at + cooldownMs, lastFailureAt: at };
    // Delete-then-set keeps Map insertion order = recency, so eviction below
    // drops the least recently failed provider first.
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > maxTracked) entries.delete(entries.keys().next().value);
    return entry;
  }

  function recordSuccess(userId, provider) {
    if (provider) entries.delete(keyOf(userId, provider));
  }

  /** @returns {{state:'healthy'}|{state:'cooling'|'trial', reason:string, failures:number, until:number}} */
  function status(userId, provider) {
    const entry = entries.get(keyOf(userId, provider));
    if (!entry) return { state: 'healthy' };
    const state = now() < entry.openUntil ? 'cooling' : 'trial';
    return { state, reason: entry.reason, failures: entry.failures, until: entry.openUntil };
  }

  function isAvailable(userId, provider) {
    return status(userId, provider).state !== 'cooling';
  }

  /** The per-call view runWithFallback and the router consume. */
  function forUser(userId) {
    return {
      recordFailure: (provider, reason) => recordFailure(userId, provider, reason),
      recordSuccess: (provider) => recordSuccess(userId, provider),
      isAvailable: (provider) => isAvailable(userId, provider),
      status: (provider) => status(userId, provider),
    };
  }

  /** Diagnostic snapshot; never contains credentials. */
  function snapshot() {
    return [...entries.entries()].map(([key, entry]) => ({ key, ...entry }));
  }

  function reset() {
    entries.clear();
  }

  return { recordFailure, recordSuccess, status, isAvailable, forUser, snapshot, reset };
}

/** The process-wide tracker. Tests build their own with createProviderHealth. */
export const providerHealth = createProviderHealth();

export default providerHealth;
