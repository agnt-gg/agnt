/**
 * ProviderFallback.js — automatic cross-provider failover for AGNT.
 *
 * Phase 1 (this file): pure, side-effect-free helpers that decide
 *   1. WHICH providers to try, in order (buildProviderChain), and
 *   2. WHETHER an adapter result means "give up on this provider, roll to
 *      the next one" (shouldFailover).
 *
 * The orchestrator wraps its `createLlmAdapter(...) → adapter.call(...)` step
 * with `runWithFallback()` so that when the default provider's own internal
 * retries are exhausted (adapter returns `{ recoveredFromError: true }`),
 * we transparently try the next configured fallback instead of surfacing the
 * "⚠️ API Error" card as the assistant's answer.
 *
 * DESIGN CONTRACTS (verified against the live code, 2026-07-30):
 *   - Each adapter already self-retries up to `maxRetries` (3) with backoff
 *     and, on final failure, RETURNS (does not throw) a recovery response:
 *         { responseMessage, toolCalls: [], recoveredFromError: true,
 *           recoveredError: <string> }
 *     That `recoveredFromError === true` is our failover signal.
 *   - User cancellation is SACRED. Adapters never mark an abort as
 *     `recoveredFromError` (see `_isTransientNetworkError`), and we
 *     additionally guard against it here so a cancelled turn is never
 *     re-run on a fallback provider.
 *   - This module must NOT persist anything. The fallback provider is used
 *     for the CURRENT TURN ONLY. Persisting it would corrupt the account
 *     default (OrchestratorService line ~871 already syncs the default, and
 *     that side-effect has historically caused provider drift — see project
 *     memory). runWithFallback therefore never calls updateUserSettings.
 *
 * Depends only on the provider registry + its config table so this stays
 * trivially unit-testable.
 */

import * as ProviderRegistry from '../ai/ProviderRegistry.js';
import { getProviderConfig } from '../ai/providerConfigs.js';

/** Hard ceiling on fallback tiers (excludes the primary). */
export const MAX_FALLBACKS = 3;

/**
 * Parse the raw `fallback_providers` column (TEXT holding a JSON array) into a
 * clean, de-duplicated, validated array of { provider, model } tiers.
 *
 * Accepts either already-parsed arrays or JSON strings. Silently drops:
 *   - malformed entries (missing provider),
 *   - entries whose provider is not in the ProviderRegistry,
 *   - duplicates of the primary or of an earlier fallback (same provider+model),
 *   - anything beyond MAX_FALLBACKS.
 *
 * @param {string|Array|null|undefined} raw
 * @returns {{provider: string, model: string|null}[]}
 */
export function parseFallbackList(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      list = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];

  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const provider = typeof entry.provider === 'string' ? entry.provider.trim() : '';
    if (!provider) continue;
    const model =
      typeof entry.model === 'string' && entry.model.trim() ? entry.model.trim() : null;
    out.push({ provider, model });
  }
  return out;
}

/**
 * True if a provider key is known to the registry (case-insensitive).
 * Unknown providers would throw "Unsupported provider for LLM client factory"
 * in LlmService, so we filter them out of the chain up front.
 *
 * Custom OpenAI-compatible providers are keyed by UUID and live in the
 * `custom_openai_providers` table, NOT in ProviderRegistry — so the registry
 * lookup alone rejects them. `createLlmAdapter` already resolves them at
 * runtime (llmAdapters.js: `CustomOpenAIProviderService.isCustomProvider`), so
 * the only thing that ever blocked them as failover tiers was this check.
 *
 * That lookup is a DB call and this function is synchronous and on the hot path
 * (every turn), so callers pass the user's active custom-provider IDs in
 * instead. Omit the argument and behavior is exactly as before.
 *
 * @param {string} provider
 * @param {Iterable<string>} [customProviderIds]  active custom provider UUIDs
 */
export function isKnownProvider(provider, customProviderIds) {
  if (!provider || typeof provider !== 'string') return false;
  const lower = provider.toLowerCase();
  if (customProviderIds) {
    for (const id of customProviderIds) {
      if (typeof id === 'string' && id.trim().toLowerCase() === lower) return true;
    }
  }
  return resolveProviderKey(provider) !== null;
}

/**
 * Resolve any accepted spelling of a built-in provider to its canonical
 * registry key, or null if the registry does not know it.
 *
 * The UI stores a fallback tier's provider as its DISPLAY NAME
 * (FallbackProviders.vue: `{ provider: <displayName> }`), while every backend
 * lookup is keyed by the registry KEY. For 18 of the 20 built-ins the display
 * name lowercases to exactly the key, so the mismatch is invisible. For the
 * other two it was fatal and silent:
 *
 *   "Cursor" -> cursor-cli        "Z.AI" -> zai
 *
 * Those tiers saved fine, rendered in the UI as configured, and were dropped
 * from every chain that was ever built.
 *
 * `getProviderConfig` already resolves both spellings — it falls back to a
 * strip-non-alphanumerics match against the config's `name` — which is why the
 * EXECUTOR has always accepted display names (`createLlmAdapter` calls it).
 * Only the chain builder was stricter than the thing it feeds.
 *
 * The result is gated on PROVIDER_CAPABILITIES membership rather than returned
 * raw. Admitting a provider the capability registry does not know would trade a
 * tier that is silently dropped for one that is silently DEAD — strictly worse,
 * because the chain would then claim a depth it cannot deliver.
 */
export function resolveProviderKey(provider) {
  if (!provider || typeof provider !== 'string') return null;
  const lower = provider.trim().toLowerCase();
  if (!lower) return null;

  const capKeys = Object.keys(ProviderRegistry.PROVIDER_CAPABILITIES || {});
  const direct = capKeys.find((k) => k.toLowerCase() === lower);
  if (direct) return direct;

  let config;
  try {
    config = getProviderConfig(provider);
  } catch {
    return null;
  }
  if (!config || !config.key) return null;
  return capKeys.find((k) => k.toLowerCase() === String(config.key).toLowerCase()) || null;
}

/**
 * Build a lazy, memoized resolver for a user's active custom-provider ids.
 *
 * `buildProviderChain` needs these ids, but fetching them is a SQLite query and
 * both turn paths call the builder at TWO sites (the agent chain and the user
 * chain). Resolving eagerly costs a query on EVERY turn, including the common
 * case where failover is switched off and no chain is ever built; resolving at
 * each call site would instead double the query. Hence: call it only where a
 * chain is actually being built, and pay at most once per turn.
 *
 * The fetch is INJECTED rather than imported so this module keeps its "no
 * dependencies beyond ProviderRegistry" property and stays trivially testable.
 *
 * Fails safe: any lookup error resolves to [], which `buildProviderChain`
 * treats as "no custom providers" — exactly the pre-feature behaviour. The
 * failure is cached too, so a broken lookup is not retried at the second call
 * site.
 *
 * @param {() => Promise<Array<{id: string}>>} fetchProviders
 * @param {(err: Error) => void} [onError]  optional reporter for the caller's log
 * @returns {() => Promise<string[]>}
 */
export function createCustomProviderIdResolver(fetchProviders, onError) {
  let cache = null;
  return async () => {
    if (cache !== null) return cache;
    try {
      const providers = await fetchProviders();
      cache = (providers || []).map((p) => p.id);
    } catch (err) {
      if (typeof onError === 'function') onError(err);
      cache = [];
    }
    return cache;
  };
}

/**
 * Pick a usable model for a fallback tier. If the configured model is falsy or
 * doesn't belong to the provider's text-model set, fall back to the provider's
 * first text model. Returns null if the provider exposes no text models
 * (caller should then skip the tier).
 */
export function resolveTierModel(provider, model) {
  let textModels = [];
  try {
    textModels = ProviderRegistry.getTextModels(provider) || [];
  } catch {
    textModels = [];
  }
  if (model && textModels.some((m) => m === model)) return model;
  if (model && textModels.length === 0) return model; // trust caller for CLI providers w/o static list
  if (textModels.length > 0) return textModels[0];
  return model || null;
}

/**
 * Build the ordered provider chain for a turn.
 *
 *   tier 0 = primary (the resolved default / request provider)
 *   tier 1..3 = fallbacks, in configured order
 *
 * Rules:
 *   - The primary is ALWAYS first and never dropped (even if validation is
 *     imperfect — we must still attempt the user's chosen provider).
 *   - Fallbacks are included only when `fallbackEnabled` is true.
 *   - Unknown providers are dropped; duplicates (same provider+model as an
 *     earlier tier) are dropped; capped at MAX_FALLBACKS.
 *   - A built-in tier is normalized to its canonical registry key, so the
 *     display name the UI stored ("Cursor") reaches the executor as the key it
 *     looks up ("cursor-cli"). Custom providers are already keyed by UUID and
 *     pass through untouched.
 *
 * @param {object} args
 * @param {string} args.provider         primary provider (already resolved)
 * @param {string} args.model            primary model
 * @param {boolean} args.fallbackEnabled
 * @param {string|Array} args.fallbackProviders  raw column value or array
 * @param {Iterable<string>} [args.customProviderIds]  active custom provider
 *   UUIDs for this user. Omit and custom providers are dropped from the chain
 *   (the pre-existing behavior).
 * @returns {{provider: string, model: string|null, tier: number, primary: boolean}[]}
 */
export function buildProviderChain({ provider, model, fallbackEnabled, fallbackProviders, customProviderIds }) {
  const primaryProviderLc = String(provider || '').toLowerCase();
  // Compare tiers by canonical identity, not by whatever string each one
  // happens to be spelled with. The primary arrives lowercased from the
  // orchestrator ("cursor"), a tier arrives as a display name ("Cursor"), and
  // both mean cursor-cli — so a raw string compare would fail to notice they
  // are the same provider and cheerfully build a chain that fails Cursor over
  // to Cursor. Falls back to the raw lowercase for a custom-provider UUID,
  // which has no registry key.
  const primaryCanonical = (resolveProviderKey(provider) || primaryProviderLc).toLowerCase();
  const chain = [{ provider, model: model || null, tier: 0, primary: true }];
  const seen = new Set([`${primaryCanonical}::${model || ''}`]);

  if (!fallbackEnabled) return chain;

  const customIdSet = new Set(
    (customProviderIds ? Array.from(customProviderIds) : [])
      .filter((id) => typeof id === 'string' && id.trim())
      .map((id) => id.trim().toLowerCase())
  );

  const candidates = parseFallbackList(fallbackProviders);
  let tier = 1;
  for (const cand of candidates) {
    if (chain.length - 1 >= MAX_FALLBACKS) break;

    const candLc = String(cand.provider || '').trim().toLowerCase();
    const isCustom = customIdSet.has(candLc);
    // A custom provider IS its UUID; a built-in is its registry key. Null means
    // the registry has never heard of it — drop the tier.
    const canonical = isCustom ? cand.provider : resolveProviderKey(cand.provider);
    if (!canonical) continue;

    // Never fail over to the SAME provider we just exhausted — a different
    // model on the same down provider will almost certainly fail too.
    if (canonical.toLowerCase() === primaryCanonical) continue;

    // Deliberately passed the ORIGINAL spelling, not `canonical`.
    //
    // resolveTierModel snaps an unrecognised model to the provider's first
    // STATIC model, and for a CLI provider that static list is a stale floor
    // rather than an authority — the UI offers models fetched live from the CLI
    // that the hardcoded list has never heard of. Handing it the canonical key
    // would make it "recognise" cursor-cli and silently rewrite a live,
    // user-chosen model (cursor-grok-4.6-medium-fast) to a hardcoded one
    // (cursor-grok-4.5-high) — turning a fix for a dropped tier into a config
    // rewrite nobody asked for. The original spelling keeps the
    // trust-the-caller branch, which is the right answer for a provider whose
    // real model list is resolved at runtime.
    //
    // A tier with NO model configured still gets a default: the executor
    // resolves one from the canonical key pushed below
    // (OrchestratorService: getTextModels(String(tier.provider).toLowerCase())).
    const usableModel = resolveTierModel(cand.provider, cand.model);

    // A custom provider has no static model list to draw a default from, so an
    // unset model would reach OpenAiLikeAdapter as `model: null` and fail the
    // request at runtime. Drop the tier instead of shipping a dead one.
    if (isCustom && !usableModel) continue;

    const key = `${canonical.toLowerCase()}::${usableModel || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    chain.push({ provider: canonical, model: usableModel, tier, primary: false });
    tier += 1;
  }

  return chain;
}

/**
 * Classify a failed adapter result / error into a coarse reason so callers can
 * log and (optionally) decide whether the NEXT provider is even worth trying.
 * (An auth error on provider A tells us nothing about provider B, so we still
 * fail over; but a well-formed-request 400 that's purely a client bug would
 * fail everywhere — kept here for observability + future policy.)
 *
 * @param {string} recoveredError  the adapter's recoveredError string
 * @returns {'auth'|'rate_limit'|'overloaded'|'network'|'cap'|'unknown'}
 */
export function classifyFailure(recoveredError) {
  const s = String(recoveredError || '').toLowerCase();
  if (!s) return 'unknown';
  if (
    s.includes('401') ||
    s.includes('403') ||
    s.includes('unauthorized') ||
    s.includes('forbidden') ||
    s.includes('api key') ||
    s.includes('oauth') ||
    s.includes('token not found') ||
    // The exact wording LlmService throws when no credential is stored:
    // "Missing access token for provider: <key>". Before the primary tier was
    // moved inside the failover boundary this string never reached the
    // classifier, so nothing noticed it was unlisted. It classified as
    // 'unknown' — a plainly diagnosable auth fault reported as a shrug, in the
    // log line and the provider_fallback event a user is shown.
    s.includes('access token') ||
    s.includes('authentication')
  ) {
    return 'auth';
  }
  if (s.includes('429') || s.includes('rate limit') || s.includes('rate-limit')) return 'rate_limit';
  if (
    s.includes('extra usage') || // Claude Max cap 400 ("draw from your extra usage")
    s.includes('usage limit') ||
    s.includes('quota')
  ) {
    return 'cap';
  }
  if (
    s.includes('overloaded') ||
    s.includes('temporarily unavailable') ||
    s.includes('500') ||
    s.includes('502') ||
    s.includes('503') ||
    s.includes('504') ||
    s.includes('529')
  ) {
    return 'overloaded';
  }
  if (
    s.includes('connection error') ||
    s.includes('network error') ||
    s.includes('fetch failed') ||
    s.includes('socket hang up') ||
    s.includes('econn') ||
    s.includes('etimedout') ||
    s.includes('timeout')
  ) {
    return 'network';
  }
  return 'unknown';
}

/**
 * Decide whether an adapter result means "roll over to the next provider".
 *
 * The adapter result is the object returned by `adapter.call(...)`:
 *   { responseMessage, toolCalls, recoveredFromError?, recoveredError? }
 *
 * @param {object} result
 * @returns {boolean}
 */
export function shouldFailover(result) {
  if (!result || typeof result !== 'object') return false;
  // The one and only signal the adapters give us for exhausted retries.
  return result.recoveredFromError === true;
}

/**
 * True if an error/result represents a deliberate user cancellation, which must
 * NEVER be retried on a fallback provider. Adapters already avoid marking these
 * as recoveredFromError, but callers that catch raw errors can use this guard.
 */
export function isCancellation(errorOrResult) {
  if (!errorOrResult) return false;
  const name =
    errorOrResult.name ||
    errorOrResult.constructor?.name ||
    (errorOrResult.recoveredError && '') ||
    '';
  if (name === 'APIUserAbortError' || name === 'AbortError') return true;
  const msg = String(errorOrResult.message || errorOrResult.recoveredError || '').toLowerCase();
  return msg.includes('aborted') || msg.includes('cancelled') || msg.includes('canceled');
}

/**
 * Run a per-provider async operation across the provider chain, rolling over on
 * failover. The caller supplies `runOne(tier)` which must build the client +
 * adapter for that tier and return the adapter result object. runWithFallback
 * inspects the result and, if `shouldFailover` is true and another tier exists,
 * calls the next tier.
 *
 * This helper is intentionally provider-agnostic and does NOT touch the DB,
 * emit SSE, or persist settings — the orchestrator supplies those via the
 * `onFallback` callback so this stays pure and unit-testable.
 *
 * @param {object} args
 * @param {Array} args.chain  output of buildProviderChain
 * @param {(tier:object)=>Promise<object>} args.runOne  builds+calls adapter for a tier
 * @param {(info:object)=>void} [args.onFallback]  notified before each rollover
 * @returns {Promise<{result: object, tier: object, attempts: object[]}>}
 */
export async function runWithFallback({ chain, runOne, onFallback }) {
  if (!Array.isArray(chain) || chain.length === 0) {
    throw new Error('runWithFallback: empty provider chain');
  }

  const attempts = [];
  let lastResult = null;
  let lastTier = null;

  for (let i = 0; i < chain.length; i++) {
    const tier = chain[i];
    lastTier = tier;

    let result;
    try {
      result = await runOne(tier);
    } catch (err) {
      // A thrown error (rather than a recovery card) — treat like a failover
      // signal UNLESS it's a cancellation, which must propagate untouched.
      if (isCancellation(err)) throw err;
      result = {
        responseMessage: null,
        toolCalls: [],
        recoveredFromError: true,
        recoveredError: err?.message || String(err),
        _threw: true,
      };
    }

    lastResult = result;
    const failed = shouldFailover(result);
    attempts.push({
      tier: tier.tier,
      provider: tier.provider,
      model: tier.model,
      failed,
      reason: failed ? classifyFailure(result.recoveredError) : null,
    });

    if (!failed) {
      return { result, tier, attempts };
    }

    const next = chain[i + 1];
    if (next && typeof onFallback === 'function') {
      try {
        onFallback({
          from: tier,
          to: next,
          reason: classifyFailure(result.recoveredError),
          recoveredError: result.recoveredError,
        });
      } catch {
        /* onFallback must never break the loop */
      }
    }
    // else: no more tiers — fall through and return the last (failed) result.
  }

  // All tiers exhausted — return the last failed result so the caller can
  // surface the recovery card exactly as today (last resort).
  return { result: lastResult, tier: lastTier, attempts };
}

export default {
  MAX_FALLBACKS,
  parseFallbackList,
  isKnownProvider,
  resolveProviderKey,
  createCustomProviderIdResolver,
  resolveTierModel,
  buildProviderChain,
  classifyFailure,
  shouldFailover,
  isCancellation,
  runWithFallback,
};
