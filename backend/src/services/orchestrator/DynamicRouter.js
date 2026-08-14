/**
 * DynamicRouter.js — the one call the orchestrator makes.
 *
 * Composes the four pieces (intent → candidates → chain → decision log) so the
 * wiring inside OrchestratorService stays a single branch. Everything here is
 * failure-tolerant by construction: routing is an OPTIMISATION, and an
 * optimisation that can fail a request is worse than no optimisation. Every
 * error path returns `null`, and the caller then uses the static chain it
 * would have used before this feature existed.
 */

import { classifyIntent } from './routingIntent.js';
import { buildDynamicChain, estimateCost } from './DynamicChain.js';
import { collectCandidates, getSessionAffinity } from './routingCandidates.js';
import { parseRoutingPolicy } from './routingMode.js';
import RoutingDecisionModel from '../../models/RoutingDecisionModel.js';
import { getModelMetadata } from '../ai/providerConfigs.js';

/**
 * What the account default would have cost for this same turn.
 *
 * The router is graded against this number, so it is computed from the SAME
 * estimator as the chosen model. Comparing an estimate to a measurement would
 * make every saving figure an artefact of the two methods disagreeing.
 */
function baselineCost(provider, model, intent) {
  const meta = getModelMetadata(provider, model) || {};
  return estimateCost(
    {
      provider,
      model,
      inputCostPer1M: Number.isFinite(meta.inputCostPer1M) ? meta.inputCostPer1M : null,
      outputCostPer1M: Number.isFinite(meta.outputCostPer1M) ? meta.outputCostPer1M : null,
    },
    intent
  );
}

/**
 * Build a routed provider chain for a turn.
 *
 * @param {object} args
 * @param {string}  args.userId
 * @param {string}  [args.authToken]
 * @param {object}  args.authManager        injected AuthManager singleton
 * @param {string}  [args.conversationId]
 * @param {string}  [args.origin]           LlmCallModel origin for this surface
 * @param {string}  args.hintProvider       account/agent default (the baseline)
 * @param {string}  args.hintModel
 * @param {object}  [args.policy]           parsed routing policy
 * @param {object}  [args.intentInput]      extra signals (hasImages, hasTools…)
 * @param {boolean} [args.shadow]           compute + record but do not execute
 * @returns {Promise<{chain: Array, decision: object}|null>} null ⇒ caller keeps
 *   its static chain. Never throws.
 */
export async function buildRoutedChain({
  userId,
  authToken = null,
  authManager,
  conversationId = null,
  origin = null,
  hintProvider,
  hintModel,
  policy = null,
  intentInput = {},
  shadow = false,
} = {}) {
  try {
    if (!userId || !authManager) return null;

    const resolvedPolicy = policy && Number.isFinite(policy.lambda)
      ? policy
      : parseRoutingPolicy(policy);

    const intent = classifyIntent({ origin, ...intentInput });

    const [candidates, session] = await Promise.all([
      collectCandidates({ userId, authToken, authManager, intent }),
      getSessionAffinity(userId, conversationId),
    ]);

    if (!candidates || candidates.length === 0) return null;

    const chain = buildDynamicChain({
      intent,
      candidates,
      policy: resolvedPolicy,
      session,
      hint: { provider: hintProvider, model: hintModel },
    });

    if (!Array.isArray(chain) || chain.length === 0) return null;

    const head = chain[0];

    // Nothing eligible — buildDynamicChain returned the hint untouched. That is
    // the correct degraded answer, but it is not a ROUTING decision, so it is
    // not recorded as one and the caller keeps its own chain.
    if (!head.provider || head.score === null) return null;

    const predicted = head.estimatedCostUsd;
    const baseline = baselineCost(hintProvider, hintModel, intent);

    const decision = {
      userId,
      conversationId,
      origin,
      mode: shadow ? 'shadow' : 'dynamic',
      policy: resolvedPolicy.mode,
      stake: intent.stake,
      verifiability: intent.verifiability,
      chosenProvider: head.provider,
      chosenModel: head.model,
      chosenReason: head.reason,
      baselineProvider: hintProvider,
      baselineModel: hintModel,
      predictedCostUsd: Number.isFinite(predicted) ? predicted : null,
      baselineCostUsd: Number.isFinite(baseline) ? baseline : null,
      candidatesConsidered: head.consideredCount ?? null,
      shadow,
      chain: chain.map((t) => ({ provider: t.provider, model: t.model, reason: t.reason })),
    };

    // Deliberately NOT awaited: the audit trail must never sit between the user
    // and their answer.
    RoutingDecisionModel.record(decision).catch(() => {});

    // Strip the audit fields before handing the chain to runWithFallback. It
    // consumes { provider, model, tier, primary }; anything extra just travels
    // into log lines and SSE payloads for no benefit. `reason` is kept because
    // the failover event surfaces it to the user.
    const executable = chain.map((t) => ({
      provider: t.provider,
      model: t.model,
      tier: t.tier,
      primary: t.primary,
      reason: t.reason,
    }));

    return { chain: executable, decision };
  } catch (err) {
    console.warn('[Routing] Dynamic chain build failed, using static chain:', err.message);
    return null;
  }
}

export default { buildRoutedChain };
