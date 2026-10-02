/**
 * routingCandidates.js — assembles the pool DynamicChain scores.
 *
 * This is the impure half of the router, kept separate so DynamicChain.js can
 * stay dependency-free and exhaustively testable. Everything here reads
 * systems AGNT already had: the provider registry, live pricing, cache
 * economics, stored credentials, and the call ledger.
 *
 * ── WHY THE SUBSTRATE IS THE PRODUCT ─────────────────────────────────────
 * Commercial routers do not struggle with the ranking algorithm; they struggle
 * because they have no honest per-call ledger, no capability registry, and no
 * safe way to change what goes out on the wire. AGNT shipped all three before
 * this feature existed. This file is mostly plumbing between them, which is
 * exactly why the feature is small.
 * ─────────────────────────────────────────────────────────────────────────
 */

import * as ProviderRegistry from '../ai/ProviderRegistry.js';
import {
  getModelMetadata,
  getAllModelMetadata,
  getCacheEconomics,
  isSubscriptionProvider,
  notionalSeatCostPer1M,
  providerSupportsTools,
  getProviderConfig,
} from '../ai/providerConfigs.js';
import LlmCallModel from '../../models/LlmCallModel.js';
import { NOT_A_CHAT_MODEL, resolveDefaultModel } from '../ai/defaultModel.js';
import { providerHealth } from '../ai/providerHealth.js';
import { promptCacheTtlMs } from '../../utils/promptCacheTtl.js';

/**
 * The write multiplier a model pays to cache a new prefix. AGNT requests
 * Anthropic's 1-hour cache, whose writes cost 2x rather than 1.25x, so the
 * longer window's rate applies wherever the requested lifetime exceeds the
 * 5-minute tier.
 */
function cacheWriteMultOf(econ, providerKey, model) {
  const ttl = promptCacheTtlMs(providerKey, model) || 0;
  const mult = ttl > 5 * 60 * 1000 ? econ.write1hMult : econ.write5mMult;
  return Number.isFinite(mult) ? mult : 1.0;
}

/**
 * Providers that are never auto-routed TO.
 *
 * Not a quality judgement — these are one-shot CLI connectors driven by a
 * subprocess, or gateways whose behaviour under an unattended switch is not
 * characterised by the wire oracle. A user can still pin them explicitly; the
 * router simply will not move work onto them on its own initiative. Silently
 * relocating a turn onto a transport nobody chose is the failure mode that got
 * GPT-5's router criticised, and it is worse when the transport spawns a
 * process.
 */
export const NEVER_AUTO_ROUTE = new Set(['local']);

/**
 * Credential lookup is a DB read plus (in AuthManager) a remote call, so it is
 * cached briefly. Dynamic routing is opt-in, so only users who enabled it ever
 * pay for this at all.
 */
const CREDENTIAL_TTL_MS = 60_000;
const credentialCache = new Map(); // userId → { at, set }

/** Reliability is measured over a rolling window and changes slowly. */
const RELIABILITY_TTL_MS = 300_000;
const reliabilityCache = new Map(); // userId → { at, byKey }

/** Test seam — the caches are process-global, so suites must be able to reset. */
export function __resetRoutingCaches() {
  credentialCache.clear();
  reliabilityCache.clear();
}

/**
 * Which providers this user can actually call.
 *
 * Fails OPEN to an empty set, never to "assume everything works": routing to a
 * provider with no credential burns a turn on a guaranteed auth error before
 * the chain rolls forward. An empty set makes buildDynamicChain return the
 * user's own default, which is the correct degraded behaviour.
 */
export async function getCredentialedProviders(userId, authToken, authManager) {
  const cached = credentialCache.get(userId);
  if (cached && Date.now() - cached.at < CREDENTIAL_TTL_MS) return cached.set;

  let set = new Set();
  try {
    const apps = await authManager.getConnectedApps(userId, authToken);
    for (const entry of apps || []) {
      const id = typeof entry === 'string' ? entry : entry?.providerId;
      if (id) set.add(String(id).toLowerCase());
    }
  } catch (err) {
    console.warn('[Routing] Could not resolve connected providers:', err.message);
    set = new Set();
  }

  credentialCache.set(userId, { at: Date.now(), set });
  return set;
}

/**
 * Measured reliability per provider/model, from this user's own ledger.
 *
 * This is the ONLY quality signal the router treats as known, and it is
 * deliberately narrow: it measures whether calls SUCCEEDED, not whether the
 * answers were good. Labelling it honestly matters — a router that calls
 * reliability "quality" is making a claim its data cannot support, and
 * DynamicChain surfaces `qualityKnown` so the difference stays visible.
 *
 * Models with too few samples are omitted entirely rather than scored on
 * noise; they then take the explore path, which is how anything new ever gets
 * tried.
 */
export async function getMeasuredReliability(userId, { minSamples = 8, days = 14 } = {}) {
  const cached = reliabilityCache.get(userId);
  if (cached && Date.now() - cached.at < RELIABILITY_TTL_MS) return cached.byKey;

  const byKey = new Map();
  try {
    const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 19).replace('T', ' ');
    const rows = await LlmCallModel.reliabilityByModel(userId, { since });
    for (const r of rows || []) {
      if (!r.provider || !r.model || r.calls < minSamples) continue;
      byKey.set(`${String(r.provider).toLowerCase()}::${r.model}`, {
        reliability: r.calls > 0 ? r.ok_calls / r.calls : null,
        calls: r.calls,
        avgDurationMs: r.avg_duration_ms || null,
      });
    }
  } catch (err) {
    console.warn('[Routing] Could not read measured reliability:', err.message);
  }

  reliabilityCache.set(userId, { at: Date.now(), byKey });
  return byKey;
}

/** How many of a provider's cheapest priced models join its candidate set. */
export const CHEAPEST_PER_PROVIDER = 3;

/**
 * Which models of a provider are worth considering.
 *
 * Capped per provider because a gateway like OpenRouter publishes hundreds and
 * scoring all of them costs real CPU on the hot path for no benefit. But the
 * top of a provider's list is ordered by the VENDOR (usually flagship first),
 * so a cap on list position alone hid exactly the models a low-stake job
 * should land on. Three sources, de-duplicated:
 *
 *   - the first `limit` listed  (the vendor's recommended set)
 *   - the CHEAPEST_PER_PROVIDER cheapest with a published price
 *   - the provider's live default (resolveDefaultModel), which is confirmed
 *     against the vendor's current catalogue rather than a static guess
 *
 * Ids that cannot hold a conversation (whisper, tts, embeddings, guards) are
 * removed first — a cheap speech model is not a cheap chat model.
 */
export function modelsForProvider(providerKey, limit) {
  let models = [];
  try {
    models = ProviderRegistry.getTextModels(providerKey) || [];
  } catch {
    models = [];
  }
  if (models.length === 0) {
    const meta = getAllModelMetadata(providerKey);
    models = Object.keys(meta || {});
  }
  models = models.filter((id) => typeof id === 'string' && id && !NOT_A_CHAT_MODEL.test(id));

  const picks = new Set(models.slice(0, limit));

  const cheapest = models
    .map((id) => {
      const meta = getModelMetadata(providerKey, id) || {};
      const price = Number.isFinite(meta.inputCostPer1M) && Number.isFinite(meta.outputCostPer1M)
        ? meta.inputCostPer1M + meta.outputCostPer1M
        : null;
      return { id, price };
    })
    .filter((m) => m.price !== null)
    .sort((a, b) => a.price - b.price)
    .slice(0, CHEAPEST_PER_PROVIDER);
  for (const m of cheapest) picks.add(m.id);

  let liveDefault = null;
  try {
    liveDefault = resolveDefaultModel(providerKey);
  } catch {
    liveDefault = null;
  }
  if (liveDefault && !NOT_A_CHAT_MODEL.test(liveDefault)) picks.add(liveDefault);

  return [...picks];
}

/**
 * Build the candidate pool.
 *
 * @param {object} args
 * @param {string} args.userId
 * @param {string} [args.authToken]
 * @param {object} args.authManager      injected (AuthManager singleton)
 * @param {object} [args.intent]         from classifyIntent()
 * @param {number} [args.modelsPerProvider]
 * @returns {Promise<Array>} candidate objects shaped for DynamicChain
 */
export async function collectCandidates({
  userId,
  authToken = null,
  authManager,
  intent = {},
  modelsPerProvider = 6,
} = {}) {
  const credentialed = await getCredentialedProviders(userId, authToken, authManager);
  if (credentialed.size === 0) return [];

  const reliability = await getMeasuredReliability(userId);
  const candidates = [];

  for (const providerKey of Object.keys(ProviderRegistry.PROVIDER_CAPABILITIES || {})) {
    const lower = providerKey.toLowerCase();
    if (NEVER_AUTO_ROUTE.has(lower)) continue;
    if (!credentialed.has(lower)) continue;

    const cfg = getProviderConfig(lower);
    if (!cfg) continue;

    const subscription = isSubscriptionProvider(lower);
    // The notional $/M is what the ROUTER pretends this seat costs, so it
    // stops routing every turn to a subscription and burning weekly quotas as
    // if they were free. Null means UNKNOWN cost — not zero — for a seat we
    // haven't priced (see SUBSCRIPTION_NOTIONAL_USD_PER_1M).
    const seatNotional = subscription ? notionalSeatCostPer1M(lower) : null;
    const toolsOk = providerSupportsTools(lower);

    for (const model of modelsForProvider(lower, modelsPerProvider)) {
      const meta = getModelMetadata(lower, model) || {};
      const econ = getCacheEconomics(lower, model);
      const measured = reliability.get(`${lower}::${model}`) || null;

      // Vision is asked of the REGISTRY per model. supportsVision() answers
      // false for a model the registry has not learned yet, so this is only
      // ever used to EXCLUDE when the turn actually carries an image — never
      // to exclude a model from ordinary text work it can plainly do.
      let visionOk = meta.supportsVision === true;
      if (!visionOk) {
        try { visionOk = ProviderRegistry.supportsVision(lower, model); } catch { visionOk = false; }
      }

      candidates.push({
        provider: lower,
        model,
        credentialed: true,
        // Learned from this user's real calls (providerHealth). A cooling
        // provider is ineligible for the ROUTED picks; the composed chain
        // still carries the account's own tiers, demoted, never dropped.
        healthy: providerHealth.isAvailable(userId, lower),
        subscription,
        // Only set on subscription seats. Metered candidates leave this
        // undefined so estimateCost falls through to the normal in/out
        // metered path.
        notionalCostPer1M: seatNotional,

        inputCostPer1M: Number.isFinite(meta.inputCostPer1M) ? meta.inputCostPer1M : null,
        outputCostPer1M: Number.isFinite(meta.outputCostPer1M) ? meta.outputCostPer1M : null,
        contextWindow: Number.isFinite(meta.contextWindow) ? meta.contextWindow : null,
        maxOutputTokens: Number.isFinite(meta.maxOutputTokens) ? meta.maxOutputTokens : null,

        supportsVision: visionOk,
        supportsTools: meta.supportsTools === false ? false : toolsOk,
        reasoning: meta.reasoning === true,

        cacheReadMult: econ.readMult,
        cacheWriteMult: cacheWriteMultOf(econ, lower, model),
        cacheKnown: econ.known,

        // `quality` is left undefined unless measured — DynamicChain treats a
        // non-finite value as "unknown" and routes it down the explore path.
        // Writing a default number here is exactly the silent-default defect
        // this codebase already paid to remove from its pricing layer.
        quality: measured ? measured.reliability : undefined,
        latencyMs: measured ? measured.avgDurationMs : null,
      });
    }
  }

  return candidates;
}

/** SQLite CURRENT_TIMESTAMP is UTC 'YYYY-MM-DD HH:MM:SS'; Date.parse reads it as local. */
export function parseLedgerTimestamp(ts) {
  if (!ts) return null;
  const text = String(ts);
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Session state for the cache-affinity term: which model served this
 * conversation's last successful turn, how big the conversation is, and how
 * much of it is still warm.
 *
 *   promptTokens  the last turn's prompt size — the best estimate of the next
 *                 one, so a long conversation is priced as long everywhere
 *   cachedTokens  the same, but only while that provider's cache can still
 *                 hold it (promptCacheTtlMs); 0 once it has certainly expired.
 *                 An unknown lifetime is not assumed expired — the switch
 *                 cost is then gated by the provider's own known economics.
 *
 * Returns {} on any failure. A missing session makes the switch penalty 0 and
 * removes continuity, which degrades the router to a plain cost/quality
 * optimiser rather than making it wrong.
 */
export async function getSessionAffinity(userId, conversationId, { now = Date.now() } = {}) {
  if (!conversationId) return {};
  try {
    const last = await LlmCallModel.lastCallForConversation(userId, conversationId);
    if (!last || !last.provider) return {};
    const econ = getCacheEconomics(last.provider, last.model);
    const meta = getModelMetadata(last.provider, last.model) || {};
    const promptTokens = (last.cache_read_tokens || 0) + (last.input_tokens || 0);

    const servedAt = parseLedgerTimestamp(last.ts);
    const ttl = promptCacheTtlMs(last.provider, last.model);
    const expired = Number.isFinite(ttl) && servedAt !== null && now - servedAt > ttl;

    return {
      lastProvider: last.provider,
      lastModel: last.model,
      promptTokens,
      cachedTokens: expired ? 0 : promptTokens,
      cacheExpired: expired,
      lastCacheReadMult: econ.readMult,
      lastInputCostPer1M: Number.isFinite(meta.inputCostPer1M) ? meta.inputCostPer1M : null,
    };
  } catch (err) {
    console.warn('[Routing] Could not read session affinity:', err.message);
    return {};
  }
}

export default {
  NEVER_AUTO_ROUTE,
  __resetRoutingCaches,
  getCredentialedProviders,
  getMeasuredReliability,
  collectCandidates,
  getSessionAffinity,
};
