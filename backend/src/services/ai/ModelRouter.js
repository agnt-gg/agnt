/**
 * ModelRouter.js — the one way background work picks and calls a model.
 *
 * Before this, every service that needed "one completion" (insights, goal
 * analysis, evaluation, re-planning, trace analysis, skill evolution) copied
 * the same twelve lines: read the account default, build ONE adapter, call
 * it. No fallback, no health, no ledger row, and no routing — so background
 * chores ran on the user's most expensive model and failed outright the moment
 * that one provider hiccuped. The dynamic router existed, but only chat used it.
 *
 * resolveChain() builds the ordered list of who to try:
 *
 *   pinned    the pair the caller named (a node's or a goal's own config)
 *   routed    the dynamic router's ranking: best value among the providers the
 *             user has CONNECTED, scored for this job's stake and size
 *   default   the account default — always present (chainComposer)
 *   fallback  the account fallback list, in the user's order
 *
 * High-stake origins (goal_eval, goal_task, compaction) put the account chain
 * first: routing adds resilience there, never a cheaper judge.
 *
 * Routing scope: CHAT surfaces follow the user's routing setting, exactly as
 * the chat handler does. Every other origin is background work and is always
 * routed — safe because the account default and fallbacks are always in the
 * chain, so routing can only add options, never remove the known-good one.
 *
 * complete() walks the list with runWithFallback: a provider-wide failure
 * skips that provider, an optional validator rolls a bad answer to the next
 * pick, every attempt feeds providerHealth, and every call writes one ledger
 * row attributed to the model that actually SERVED it.
 *
 * Every dependency that touches the database or the network is injectable and
 * loaded lazily, so this module is testable without either.
 */

import { classifyIntent } from '../orchestrator/routingIntent.js';
import { composeChain } from '../orchestrator/chainComposer.js';
import {
  buildProviderChain,
  createCustomProviderIdResolver,
  resolveProviderKey,
  resolveTierModel,
  runWithFallback,
} from '../orchestrator/ProviderFallback.js';
import { firstFallbackTier } from '../orchestrator/resolveTurnProvider.js';
import { normalizeGlobalRoutingMode, parseRoutingPolicy } from '../orchestrator/routingMode.js';
import { providerHealth } from './providerHealth.js';
import { resolveDefaultModel } from './defaultModel.js';
import { NoAiConfiguredError } from './accountAi.js';
import { CHAT_SURFACE_ORIGINS } from '../../models/LlmCallModel.js';

/** Origins whose routing follows the user's chat routing setting. */
const CHAT_SURFACES = new Set([...CHAT_SURFACE_ORIGINS, 'chat']);

export const defaultDeps = Object.freeze({
  loadUserSettings: async (userId) => (await import('../../models/UserModel.js')).default.getUserSettings(userId),
  loadCustomProviders: async (userId) => (await import('./CustomOpenAIProviderService.js')).default.getProvidersByUserId(userId),
  buildRoutedChain: async (args) => {
    const [{ buildRoutedChain }, { default: AuthManager }] = await Promise.all([
      import('../orchestrator/DynamicRouter.js'),
      import('../auth/AuthManager.js'),
    ]);
    return buildRoutedChain({ ...args, authManager: AuthManager });
  },
  createClient: async (provider, userId, options) => (await import('./LlmService.js')).createLlmClient(provider, userId, options),
  createAdapter: async (provider, client, model, options) =>
    (await import('../orchestrator/llmAdapters.js')).createLlmAdapter(provider, client, model, options),
  recordCall: async (row) => (await import('../execution/LedgerRecorder.js')).recordLlmCall(row),
  health: providerHealth,
});

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Registry key for a built-in provider; a custom provider's UUID, lowercased. */
export function canonicalProvider(provider) {
  return resolveProviderKey(provider) || String(provider || '').trim().toLowerCase();
}

/** The text of an adapter result, whatever shape its content came back in. */
export function extractText(result) {
  const content = result?.responseMessage?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((block) => (typeof block === 'string' ? block : block?.text || '')).join('');
  return '';
}

/** A tier with no model is unrunnable; ask the live catalogue before giving up. */
function withModel(tier) {
  if (tier.model) return tier;
  const key = canonicalProvider(tier.provider);
  let model = null;
  try {
    model = resolveDefaultModel(key) || resolveTierModel(key, null);
  } catch {
    model = null;
  }
  return { ...tier, model: model || null };
}

/**
 * The account's own chain: [default, ...fallbacks], or the fallback list alone
 * when no default is set. Same builder the chat path uses, so display-name
 * tiers, custom providers and de-duplication behave identically.
 */
async function accountChainFor(userId, settings, deps) {
  if (!settings) return [];
  const loadCustomIds = createCustomProviderIdResolver(
    () => deps.loadCustomProviders(userId),
    (err) => console.warn('[ModelRouter] Could not load custom providers:', err?.message || err),
  );

  const defaultProvider = nonEmpty(settings.selectedProvider);
  const defaultModel = nonEmpty(settings.selectedModel);
  let primary = defaultProvider && defaultModel ? { provider: defaultProvider, model: defaultModel } : null;
  if (!primary) primary = firstFallbackTier(settings);
  if (!primary) return [];

  return buildProviderChain({
    provider: canonicalProvider(primary.provider),
    model: primary.model,
    fallbackEnabled: !!settings.fallbackEnabled,
    fallbackProviders: settings.fallbackProviders,
    customProviderIds: await loadCustomIds(),
  });
}

/**
 * Decide who to try, in order.
 *
 * @param {object} args
 * @param {string} args.userId
 * @param {string} args.origin              LlmCallModel.ORIGINS entry
 * @param {{provider?:string, model?:string}} [args.requested]  a pin
 * @param {object} [args.intentInput]       classifyIntent signals
 *   (contextTokens, outputTokens, hasImages, hasTools, reasoningWanted)
 * @param {string} [args.conversationId]    cache affinity for the router
 * @param {string} [args.authToken]
 * @param {'auto'|'always'|'never'} [args.routing]
 * @param {Array<{provider:string, model?:string}>} [args.alsoTry]
 *   last-resort tiers after the account chain — e.g. the chat's own model for
 *   a side call, so it still works for an account with no default set. Unlike
 *   `requested`, these are never pinned ahead of the routed picks.
 * @returns {Promise<{chain: Array, intent: object, routed: boolean, decision: object|null}>}
 */
export async function resolveChain({
  userId,
  origin,
  requested = {},
  intentInput = {},
  conversationId = null,
  authToken = null,
  routing = 'auto',
  alsoTry = [],
} = {}, deps = defaultDeps) {
  const intent = classifyIntent({ origin, ...intentInput });
  const settings = userId ? await Promise.resolve().then(() => deps.loadUserSettings(userId)).catch(() => null) : null;

  const pinProvider = nonEmpty(requested?.provider);
  const pinned = pinProvider
    ? { provider: canonicalProvider(pinProvider), model: nonEmpty(requested?.model) }
    : null;

  const accountChain = await accountChainFor(userId, settings, deps).catch((err) => {
    console.warn('[ModelRouter] Could not build the account chain:', err?.message || err);
    return [];
  });

  const chatSurface = CHAT_SURFACES.has(String(origin || '').trim().toLowerCase());
  const routingOn = routing === 'always'
    || (routing === 'auto' && (!chatSurface || normalizeGlobalRoutingMode(settings?.routingMode) === 'dynamic'));

  let routed = [];
  let decision = null;
  if (routingOn && userId) {
    const hint = accountChain[0] || pinned || {};
    const routedResult = await Promise.resolve()
      .then(() => deps.buildRoutedChain({
        userId,
        authToken,
        conversationId,
        origin,
        hintProvider: hint.provider,
        hintModel: hint.model,
        policy: parseRoutingPolicy(settings?.routingPolicy),
        intentInput,
      }))
      .catch((err) => {
        console.warn('[ModelRouter] Routing failed; using the account chain:', err?.message || err);
        return null;
      });
    if (routedResult?.chain?.length) {
      routed = routedResult.chain;
      decision = routedResult.decision || null;
    }
  }

  const health = deps.health.forUser(userId);
  const lastResort = (Array.isArray(alsoTry) ? alsoTry : [])
    .filter((t) => nonEmpty(t?.provider))
    .map((t) => ({ provider: canonicalProvider(t.provider), model: nonEmpty(t.model) }));

  const chain = composeChain({
    pinned,
    routed,
    defaults: [...accountChain, ...lastResort],
    stake: intent.stake,
    isAvailable: (provider) => health.isAvailable(canonicalProvider(provider)),
    keyOf: canonicalProvider,
  })
    .map((t) => withModel({ ...t, provider: canonicalProvider(t.provider) }))
    .filter((t) => t.model)
    .map((t, i) => ({ ...t, tier: i, primary: i === 0 }));

  return { chain, intent, routed: routingOn, decision };
}

/**
 * One completion, across the chain, until a pick works.
 *
 * @param {object} args
 * @param {string} args.userId
 * @param {string} args.origin                    ledger + routing origin
 * @param {Array}  args.messages                  adapter-shaped messages
 * @param {Array}  [args.tools]
 * @param {(text:string)=>(true|string|false)} [args.validate]
 *   accept or reject an answer; anything but `true` tries the next pick
 * @param {{provider?:string, model?:string}} [args.requested]
 * @param {object} [args.intentInput]
 * @param {'auto'|'always'|'never'} [args.routing]
 * @param {string} [args.originId] [args.conversationId] [args.executionId] [args.authToken]
 * @param {object} [args.adapterOptions]
 * @param {boolean} [args.record]                 write ledger rows (default true)
 * @param {(usage:object, served:{provider,model})=>void} [args.onUsage]
 * @returns {Promise<{text:string, result:object, usage:object|null, provider:string, model:string, attempts:Array}>}
 * @throws {NoAiConfiguredError} when the account has nothing runnable
 * @throws {Error} code ALL_TIERS_FAILED | INVALID_OUTPUT, with `.attempts`
 */
export async function complete({
  userId,
  origin,
  originId = null,
  conversationId = null,
  executionId = null,
  messages,
  tools = [],
  requested = {},
  intentInput = {},
  validate = null,
  routing = 'auto',
  authToken = null,
  adapterOptions = {},
  record = true,
  onUsage = null,
  alsoTry = [],
} = {}, deps = defaultDeps) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new TypeError('ModelRouter.complete: messages must be a non-empty array');
  }

  const { chain } = await resolveChain({ userId, origin, requested, intentInput, conversationId, authToken, routing, alsoTry }, deps);
  if (chain.length === 0) throw new NoAiConfiguredError();

  const { result, tier, attempts } = await runWithFallback({
    chain,
    health: deps.health.forUser(userId),
    validate: typeof validate === 'function' ? (adapterResult) => validate(extractText(adapterResult)) : undefined,
    runOne: async (t) => {
      const startedAt = Date.now();
      const client = await deps.createClient(t.provider, userId, { authToken, conversationId });
      const adapter = await deps.createAdapter(t.provider, client, t.model, { conversationId, ...adapterOptions });
      const adapterResult = await adapter.call(messages, tools);
      const callFailed = adapterResult?.recoveredFromError === true;

      if (record) {
        Promise.resolve()
          .then(() => deps.recordCall({
            userId,
            executionId,
            origin,
            originId,
            conversationId,
            provider: t.provider,
            model: t.model,
            usage: adapterResult?.usage || null,
            durationMs: Date.now() - startedAt,
            status: callFailed ? 'error' : 'ok',
            error: callFailed ? String(adapterResult?.recoveredError || 'provider error').slice(0, 500) : null,
          }))
          .catch(() => { /* the ledger reports its own failures */ });
      }
      if (typeof onUsage === 'function' && adapterResult?.usage) {
        try {
          onUsage(adapterResult.usage, { provider: t.provider, model: t.model });
        } catch { /* a caller's accounting must not fail the call */ }
      }
      return adapterResult;
    },
  });

  if (!result || result.recoveredFromError || result.invalidOutput) {
    const summary = attempts.map((a) => `${a.provider}/${a.model}: ${a.reason || 'failed'}`).join('; ');
    const error = new Error(`No model produced a usable answer for '${origin}' (${summary})`);
    error.code = result?.invalidOutput ? 'INVALID_OUTPUT' : 'ALL_TIERS_FAILED';
    error.attempts = attempts;
    if (result?.recoveredError) error.cause = result.recoveredError;
    throw error;
  }

  return {
    text: extractText(result),
    result,
    usage: result.usage || null,
    provider: tier.provider,
    model: tier.model,
    attempts,
  };
}

export default { resolveChain, complete, extractText, canonicalProvider };
