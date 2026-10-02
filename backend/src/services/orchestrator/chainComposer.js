/**
 * chainComposer.js — one ordered list of "who to try", from every source.
 *
 * The router ranks what the user CAN run by value. The account says what the
 * user CHOSE to run (default) and what they want next (fallbacks). Before this
 * module, a routed chain REPLACED the account's chain: the user's default only
 * came back when nothing at all was eligible, and their fallback list was
 * ignored. A routed pick that failed could exhaust the chain without ever
 * trying the one model the user knows works.
 *
 *   pinned   explicitly requested pair — always first, the caller asked for it
 *   routed   the router's ranking (best value for this job)
 *   default  the account default — NEVER dropped, not even by the cap
 *   fallback the account's fallback list, in the user's order
 *
 * High-stake work (goal evaluation, goal tasks, compaction) puts the account
 * chain BEFORE the routed picks: routing then only adds resilience and can
 * never hand a judgement to a weaker model to save money.
 *
 * Health reorders, it never removes: tiers whose provider is cooling move to
 * the back (stable), so a briefly unhappy account still has a chain.
 *
 * Duplicates (same provider+model) keep their earliest position. The SAME
 * provider may appear twice with different models — run time, not build time,
 * decides whether that second tier is worth trying (PROVIDER_WIDE_FAILURES in
 * ProviderFallback.js).
 *
 * Pure and dependency-free, like DynamicChain.js.
 */

export const MAX_COMPOSED_TIERS = 6;

const defaultKeyOf = (provider) => String(provider || '').trim().toLowerCase();

/**
 * @param {object} args
 * @param {{provider:string, model?:string|null}|null} [args.pinned]
 * @param {Array<{provider:string, model?:string|null, reason?:string}>} [args.routed]
 * @param {Array<{provider:string, model?:string|null}>} [args.defaults]
 *   account chain: [default, ...fallbacks] (buildProviderChain output fits)
 * @param {'low'|'normal'|'high'} [args.stake]
 * @param {(provider:string)=>boolean} [args.isAvailable]  provider health
 * @param {(provider:string)=>string} [args.keyOf]  canonical provider key
 * @param {number} [args.maxTiers]
 * @returns {Array<{provider:string, model:string|null, tier:number, primary:boolean, source:string, reason:string}>}
 */
export function composeChain({
  pinned = null,
  routed = [],
  defaults = [],
  stake = 'normal',
  isAvailable = () => true,
  keyOf = defaultKeyOf,
  maxTiers = MAX_COMPOSED_TIERS,
} = {}) {
  const valid = (t) => t && typeof t.provider === 'string' && t.provider.trim() !== '';
  const tag = (t, source, reason) => ({
    provider: t.provider,
    model: t.model || null,
    source,
    reason: t.reason || reason,
  });

  const head = valid(pinned) ? [tag(pinned, 'pinned', 'requested')] : [];
  const routedTiers = (Array.isArray(routed) ? routed : []).filter(valid).map((t) => tag(t, 'routed', 'routed'));
  const accountTiers = (Array.isArray(defaults) ? defaults : []).filter(valid)
    .map((t, i) => (i === 0 ? tag(t, 'default', 'account default') : tag(t, 'fallback', 'account fallback')));
  const body = stake === 'high' ? [...accountTiers, ...routedTiers] : [...routedTiers, ...accountTiers];

  const seen = new Set();
  const unique = [];
  for (const t of [...head, ...body]) {
    const key = `${keyOf(t.provider)}::${String(t.model || '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(t);
  }

  // The pin keeps its place even when cooling: the caller named it.
  const pinnedTiers = unique.filter((t) => t.source === 'pinned');
  const rest = unique.filter((t) => t.source !== 'pinned');
  const safeAvailable = (provider) => {
    try {
      return isAvailable(provider) !== false;
    } catch {
      return true;
    }
  };
  const ordered = [
    ...pinnedTiers,
    ...rest.filter((t) => safeAvailable(t.provider)),
    ...rest.filter((t) => !safeAvailable(t.provider)),
  ];

  const cap = Math.max(1, Number.isFinite(maxTiers) ? Math.floor(maxTiers) : MAX_COMPOSED_TIERS);
  const capped = ordered.slice(0, cap);
  const accountDefault = ordered.find((t) => t.source === 'default');
  if (accountDefault && !capped.includes(accountDefault)) {
    // The cap may trim picks; it may not trim the one model the user chose.
    // It takes the LAST non-pinned slot — a pin is just as non-negotiable.
    const replaceAt = capped.findLastIndex((t) => t.source !== 'pinned');
    if (replaceAt >= 0) capped[replaceAt] = accountDefault;
  }

  return capped.map((t, i) => ({ ...t, tier: i, primary: i === 0 }));
}

export default { MAX_COMPOSED_TIERS, composeChain };
