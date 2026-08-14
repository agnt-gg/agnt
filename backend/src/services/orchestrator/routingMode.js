/**
 * routingMode.js — which routing strategy governs a turn.
 *
 * AGNT has four places a provider choice can live, from most to least
 * specific: the REQUEST, the CONVERSATION, the AGENT, and the USER's global
 * default. Before dynamic routing existed, only two outcomes were reachable:
 * the caller named a provider/model pair, or the resolution ladder in
 * OrchestratorService filled one in.
 *
 * That is the defect this module exists to fix. The frontend pins a concrete
 * pair on EVERY send, so "follow my global default" was not a state the system
 * could represent — the ladder was effectively dead code for chat turns, and a
 * chat that had ever been given a model could never be handed back. Dynamic
 * routing needs exactly that missing state, so both are expressed with one
 * tri-state field:
 *
 *   'pinned'   use this exact provider/model      (today's behaviour)
 *   'default'  defer to the next scope up         (revives the ladder)
 *   'dynamic'  let the router choose per request  (new)
 *
 * RESOLUTION IS A SEARCH, NOT A MERGE. The first scope that expresses an
 * opinion wins; 'default' is not an opinion, it is an instruction to keep
 * looking. The global setting is the floor and always answers.
 *
 * ── THE INVARIANT ────────────────────────────────────────────────────────
 * Dynamic routing never overrides a choice a human made. It only ever fills
 * the slot where the system was about to guess. A pin at any scope short-
 * circuits the search, and a legacy caller that names a provider/model pair
 * WITHOUT naming a mode is treated as a pin — which is what makes enabling
 * the feature safe for every existing integration (workflows, tools, the
 * public API) without touching one of them.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Pure and dependency-free on purpose: this is the one piece of the feature
 * that every other piece consults, so it must stay trivially testable.
 */

/** Global (account) routing modes — what the Settings toggle writes. */
export const GLOBAL_ROUTING_MODES = Object.freeze(['static', 'dynamic']);

/** Per-surface routing modes — what a chat/agent/conversation can express. */
export const SCOPE_ROUTING_MODES = Object.freeze(['default', 'dynamic', 'pinned']);

/** Policy presets. The only thing they change is λ, the cost weight. */
export const ROUTING_POLICIES = Object.freeze(['save', 'balanced', 'quality']);

/**
 * λ — how much a dollar is worth relative to a quality point.
 *
 * Deliberately NOT 0 or 1 at the extremes. 'quality' still prefers the cheaper
 * of two equally-good models (otherwise the mode would be "always burn the
 * most expensive thing", which nobody wants), and 'save' still refuses a model
 * that cannot do the job (eligibility is a hard filter, not a weight).
 */
export const POLICY_LAMBDA = Object.freeze({ save: 0.85, balanced: 0.5, quality: 0.2 });

export const DEFAULT_GLOBAL_MODE = 'static';
export const DEFAULT_POLICY = 'balanced';

/** Coerce anything to a valid global mode. Unknown/absent → 'static' (off). */
export function normalizeGlobalRoutingMode(value) {
  const v = String(value || '').trim().toLowerCase();
  return GLOBAL_ROUTING_MODES.includes(v) ? v : DEFAULT_GLOBAL_MODE;
}

/**
 * Coerce anything to a valid scope mode, or null when the scope is silent.
 *
 * null and 'default' are NOT the same thing to a caller writing the value
 * (null = "I have no opinion stored", 'default' = "I explicitly follow the
 * global"), but they resolve identically, which is what keeps every pre-
 * existing row working without a migration.
 */
export function normalizeScopeRoutingMode(value) {
  const v = String(value || '').trim().toLowerCase();
  return SCOPE_ROUTING_MODES.includes(v) ? v : null;
}

/** Coerce anything to a valid policy name. Unknown/absent → 'balanced'. */
export function normalizeRoutingPolicy(value) {
  const v = String(value || '').trim().toLowerCase();
  return ROUTING_POLICIES.includes(v) ? v : DEFAULT_POLICY;
}

/** The cost weight for a policy name. */
export function lambdaForPolicy(policy) {
  return POLICY_LAMBDA[normalizeRoutingPolicy(policy)];
}

/**
 * Parse the `routing_policy` column (TEXT holding JSON). Always returns a
 * usable object — a corrupt value must not break a turn, it must fall back to
 * the documented default.
 *
 * @returns {{mode: string, lambda: number}}
 */
export function parseRoutingPolicy(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return { mode: DEFAULT_POLICY, lambda: POLICY_LAMBDA[DEFAULT_POLICY] };
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { mode: DEFAULT_POLICY, lambda: POLICY_LAMBDA[DEFAULT_POLICY] };
    }
  }
  const mode = normalizeRoutingPolicy(parsed && typeof parsed === 'object' ? parsed.mode : parsed);
  return { mode, lambda: POLICY_LAMBDA[mode] };
}

/** Serialize a policy for storage. Invalid input collapses to the default. */
export function serializeRoutingPolicy(policy) {
  const mode = normalizeRoutingPolicy(
    policy && typeof policy === 'object' ? policy.mode : policy
  );
  return JSON.stringify({ mode });
}

/**
 * Decide how a turn is routed.
 *
 * @param {object} args
 * @param {string} [args.requestMode]       routingMode from the request body
 * @param {boolean} [args.requestHasPin]    request named BOTH provider and model
 * @param {string} [args.conversationMode]  conversation_settings.routing_mode
 * @param {string} [args.agentMode]         agents.routing_mode
 * @param {string} [args.globalMode]        users.routing_mode
 * @returns {{mode: 'static'|'dynamic', source: string, pinned: boolean}}
 *   `mode` is what the chain builder should do; `source` names the scope that
 *   decided, purely so the decision is explainable in logs and the UI.
 */
export function resolveRoutingMode({
  requestMode,
  requestHasPin = false,
  conversationMode,
  agentMode,
  globalMode,
} = {}) {
  const req = normalizeScopeRoutingMode(requestMode);

  // An explicit pin ends the search immediately, at every scope.
  if (req === 'pinned') return { mode: 'static', source: 'request', pinned: true };

  // BACKWARD COMPATIBILITY, and the reason this feature is safe to ship:
  // a caller that names a concrete provider AND model but says nothing about
  // routing is every pre-existing integration in the product. Treat it as the
  // pin it has always been. Only clients that opt in by sending a mode can be
  // routed, so enabling the global toggle can never hijack an API consumer.
  if (!req && requestHasPin) return { mode: 'static', source: 'request', pinned: true };

  if (req === 'dynamic') return { mode: 'dynamic', source: 'request', pinned: false };

  const conv = normalizeScopeRoutingMode(conversationMode);
  if (conv === 'pinned') return { mode: 'static', source: 'conversation', pinned: true };
  if (conv === 'dynamic') return { mode: 'dynamic', source: 'conversation', pinned: false };

  const agent = normalizeScopeRoutingMode(agentMode);
  if (agent === 'pinned') return { mode: 'static', source: 'agent', pinned: true };
  if (agent === 'dynamic') return { mode: 'dynamic', source: 'agent', pinned: false };

  const global = normalizeGlobalRoutingMode(globalMode);
  return {
    mode: global === 'dynamic' ? 'dynamic' : 'static',
    source: 'global',
    pinned: false,
  };
}

export default {
  GLOBAL_ROUTING_MODES,
  SCOPE_ROUTING_MODES,
  ROUTING_POLICIES,
  POLICY_LAMBDA,
  DEFAULT_GLOBAL_MODE,
  DEFAULT_POLICY,
  normalizeGlobalRoutingMode,
  normalizeScopeRoutingMode,
  normalizeRoutingPolicy,
  lambdaForPolicy,
  parseRoutingPolicy,
  serializeRoutingPolicy,
  resolveRoutingMode,
};
