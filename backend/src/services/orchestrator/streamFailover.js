/**
 * streamFailover.js — reusable streaming-call failover driver.
 *
 * Wraps a single round-0 streaming LLM call across a provider chain so that if
 * the primary tier exhausts its retries (adapter returns recoveredFromError, or
 * throws a non-cancellation error), the call transparently rolls over to the
 * next configured tier. Shared by OrchestratorService (main chat) and
 * AutonomousMessageService (goals / agent autonomous loop).
 *
 * This is a thin orchestration layer over ProviderFallback.runWithFallback that
 * additionally rebuilds the client+adapter per tier via injected builders, so
 * it stays testable (no direct LlmService dependency).
 *
 * CONTRACTS:
 *   - Any streaming call the caller wraps (round 0, tool loop, follow-up)
 *     can fail over. OrchestratorService uses streamAcrossChain for all of them.
 *   - The adapter only returns recoveredFromError when ZERO tokens were emitted,
 *     so a failed tier never streams partial output → clean rollover.
 *   - Cancellations propagate untouched (never failover a cancelled turn).
 *   - No settings persistence. The winning tier is used for THIS TURN ONLY.
 */

import { runWithFallback } from './ProviderFallback.js';

/**
 * @param {object} args
 * @param {Array}  args.chain       output of buildProviderChain (>=1 tier)
 * @param {(tier)=>Promise<{client:any, adapter:any}>} args.buildAdapter
 *        Builds (or reuses) the client+adapter for a tier. Called once per tier.
 * @param {(adapter, tier)=>Promise<object>} args.callAdapter
 *        Performs the streaming call with the tier's adapter, returns the
 *        adapter result object ({responseMessage, toolCalls, recoveredFromError, ...}).
 * @param {(info)=>void} [args.onFallback]  notified before each rollover
 * @param {(tier, adapter, client)=>void} [args.onTierActive]
 *        Called with the WINNING tier's adapter+client so the caller can adopt
 *        them for the rest of the turn (tool loop).
 * @returns {Promise<{result: object, tier: object, attempts: object[]}>}
 */
export async function runStreamWithFallback({ chain, buildAdapter, callAdapter, onFallback, onTierActive }) {
  let activeAdapter = null;
  let activeClient = null;
  let activeTier = null;

  const outcome = await runWithFallback({
    chain,
    onFallback,
    runOne: async (tier) => {
      const built = await buildAdapter(tier);
      activeAdapter = built.adapter;
      activeClient = built.client;
      activeTier = tier;
      return callAdapter(built.adapter, tier);
    },
  });

  // Let the caller adopt the winning tier's adapter/client for subsequent rounds.
  if (typeof onTierActive === 'function' && activeTier) {
    try { onTierActive(activeTier, activeAdapter, activeClient); } catch { /* never break */ }
  }

  return outcome;
}

export default { runStreamWithFallback };
