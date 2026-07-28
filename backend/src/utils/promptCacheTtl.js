/**
 * How long a provider keeps a prompt prefix cached.
 *
 * This is NOT a universal constant, and treating it as one is how the panel
 * came to tell users their cache had expired when it demonstrably had not.
 * Anthropic's *default* ephemeral TTL is 5 minutes, but AGNT does not use the
 * default: llmAdapters.js explicitly requests `{ type: 'ephemeral', ttl: '1h' }`
 * on every cache_control breakpoint. Hardcoding the documented default instead
 * of reading what we actually ask for was wrong by a factor of twelve.
 *
 * The rule here: a number is only listed when it can be traced to something
 * concrete — a parameter we send, or vendor documentation. Everything else is
 * null, because "we don't know" is a better answer than a confident guess about
 * someone's money.
 */

// Anthropic-family. We REQUEST this explicitly; it is not the vendor default.
// Kept in lockstep with llmAdapters.js by promptCacheTtl.test.js, which reads
// the adapter source and fails if the two ever disagree.
export const ANTHROPIC_REQUESTED_CACHE_TTL_MS = 60 * 60 * 1000;

// OpenAI caches automatically with no TTL parameter to send. The documented
// behaviour is eviction after "5-10 minutes of inactivity", extending to an
// hour off-peak. We take the floor of that range: being early makes us
// understate savings, which is the safe direction to be wrong about cost.
export const OPENAI_IDLE_EVICTION_MS = 5 * 60 * 1000;

const TTL_BY_PROVIDER = {
  anthropic: ANTHROPIC_REQUESTED_CACHE_TTL_MS,
  'claude-code': ANTHROPIC_REQUESTED_CACHE_TTL_MS,
  openai: OPENAI_IDLE_EVICTION_MS,
  'openai-codex': OPENAI_IDLE_EVICTION_MS,
};

/**
 * @param {string} provider
 * @returns {number|null} TTL in ms, or null when the provider's caching
 *          behaviour is not known well enough to make a claim about it.
 */
export function promptCacheTtlMs(provider) {
  if (typeof provider !== 'string' || !provider) return null;
  return TTL_BY_PROVIDER[provider.toLowerCase()] ?? null;
}
