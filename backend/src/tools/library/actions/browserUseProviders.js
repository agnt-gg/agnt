/**
 * How every AGNT provider reaches browser-use.
 *
 * browser-use ships its own chat classes; it does not know AGNT exists. This
 * module is the single place that says, for each provider, WHICH class to build
 * and HOW to feed it credentials. Everything else about the browser tool reads
 * from here.
 *
 * Three routes, in order of preference:
 *
 *   native        browser-use has a purpose-built class for this vendor
 *                 (ChatAnthropic, ChatGoogle, ChatGroq…). Best fidelity —
 *                 vendor-specific usage accounting, retries and quirks.
 *
 *   openai-compat ChatOpenAI pointed at the vendor's OpenAI-shaped endpoint
 *                 via `base_url`. Covers every vendor that speaks
 *                 /chat/completions, including user-defined custom providers.
 *
 *   gateway       routed back through AGNT's own OpenAI-compatible endpoint
 *                 (routes/LlmGatewayRoutes.js), which then uses the normal
 *                 llmAdapters path. This is the ONLY route that can carry
 *                 OAuth/subscription credentials (Claude Code, Codex, Gemini
 *                 CLI, Antigravity, Grok Build, Cursor) or a bespoke transport
 *                 (Chutes E2EE), because those are not API keys that a third
 *                 party SDK can be handed.
 *
 * WHY A ROUTE IS DECLARED FOR ALL 20 AND NOT INFERRED
 * ---------------------------------------------------
 * The predecessor of this file was an if/else over three provider names whose
 * `else` branch silently fell through to OpenAI. A user who picked DeepSeek got
 * an OpenAI client with a DeepSeek key and an error that named neither. Silence
 * is the defect. So: every built-in provider MUST appear in ROUTING, a
 * conformance test fails the build when providerConfigs.js grows a provider
 * this file has not classified, and an unclassified provider throws by name at
 * run time rather than degrading to a default.
 */

import {
  getAllProviderConfigs,
  getProviderConfig,
  isSubscriptionProvider,
} from '../../../services/ai/providerConfigs.js';

/** @enum {string} */
export const ROUTE = {
  NATIVE: 'native',
  OPENAI_COMPAT: 'openai-compat',
  GATEWAY: 'gateway',
};

/**
 * Provider key → browser-use routing.
 *
 * `chatClass` is the symbol imported from `browser_use.llm`. `baseUrlOverride`
 * is only set where the vendor's OpenAI-compatible URL differs from the
 * `baseURL` already in providerConfigs (it never does today, but Chutes and
 * friends make the field worth keeping explicit).
 *
 * `note` is surfaced verbatim to the user when a route cannot be taken, so the
 * failure explains itself instead of needing this file open next to it.
 */
const ROUTING = {
  // ── native classes ────────────────────────────────────────────────
  openai: { route: ROUTE.NATIVE, chatClass: 'ChatOpenAI' },
  anthropic: { route: ROUTE.NATIVE, chatClass: 'ChatAnthropic' },
  gemini: { route: ROUTE.NATIVE, chatClass: 'ChatGoogle' },
  groq: { route: ROUTE.NATIVE, chatClass: 'ChatGroq' },
  deepseek: { route: ROUTE.NATIVE, chatClass: 'ChatDeepSeek' },
  openrouter: { route: ROUTE.NATIVE, chatClass: 'ChatOpenRouter' },
  cerebras: { route: ROUTE.NATIVE, chatClass: 'ChatCerebras' },

  // ── OpenAI-compatible, keyed on providerConfigs.baseURL ───────────
  grokai: { route: ROUTE.OPENAI_COMPAT, chatClass: 'ChatOpenAI' },
  togetherai: { route: ROUTE.OPENAI_COMPAT, chatClass: 'ChatOpenAI' },
  kimi: { route: ROUTE.OPENAI_COMPAT, chatClass: 'ChatOpenAI' },
  minimax: { route: ROUTE.OPENAI_COMPAT, chatClass: 'ChatOpenAI' },
  zai: { route: ROUTE.OPENAI_COMPAT, chatClass: 'ChatOpenAI' },

  // ── must come back through AGNT ───────────────────────────────────
  // Subscription credentials: not API keys. The token is minted per request by
  // an auth manager that also refreshes it, spoofs a CLI user-agent, or drives
  // a local CLI session. Handing any of that to a third-party Python SDK is not
  // possible, so these route through our own adapters.
  'claude-code': {
    route: ROUTE.GATEWAY,
    reason: 'Claude Code is a subscription session, not an API key.',
  },
  'openai-codex': {
    route: ROUTE.GATEWAY,
    reason: 'Codex talks to the ChatGPT backend Responses API, not /chat/completions.',
  },
  'gemini-cli': {
    route: ROUTE.GATEWAY,
    reason: 'Gemini CLI OAuth only works against the Code Assist endpoint.',
  },
  antigravity: {
    route: ROUTE.GATEWAY,
    reason: 'Antigravity OAuth only works against the Code Assist endpoint.',
  },
  'grok-build': {
    route: ROUTE.GATEWAY,
    reason: 'Grok Build authenticates with a local grok CLI OIDC session.',
  },
  // Kimi Code does hold a bearer token, so it LOOKS like it could take the
  // direct route — but its endpoint only answers to a spoofed Kimi CLI
  // User-Agent, resolved per request by clientVersions.js. Reproducing that
  // header inside a Python SDK would be a second copy of a value that already
  // drifts; the gateway uses the client that is known to work.
  'kimi-code': {
    route: ROUTE.GATEWAY,
    reason: 'Kimi Code requires the Kimi CLI client identity header that AGNT resolves per request.',
  },
  'cursor-cli': {
    route: ROUTE.GATEWAY,
    reason: 'Cursor authenticates with a local cursor-agent CLI session.',
  },
  chutes: {
    route: ROUTE.GATEWAY,
    reason: 'Chutes requires AGNT\'s end-to-end-encrypted transport.',
  },
};

/**
 * Providers whose reasoning-model defaults make a 50-step browser loop
 * needlessly slow or expensive, where a cheaper sibling is strictly better for
 * automation. Kept deliberately short: every entry is a claim that the
 * providerConfigs-derived default is WRONG here, not merely pricier.
 */
const DEFAULT_MODEL_OVERRIDES = {
  // gemini's vision list leads with a *-preview pro model; browser automation
  // wants the fast, generally-available one for a loop this long.
  gemini: 'gemini-2.5-flash',
};

/**
 * The model a provider gets when the user does not name one.
 *
 * Derived from providerConfigs so the browser tool cannot drift from the rest
 * of the app the way a hardcoded 'gpt-4o' did. Vision models come first
 * because browser-use is a screenshot-driven agent.
 */
export function defaultModelFor(providerKey) {
  if (DEFAULT_MODEL_OVERRIDES[providerKey]) return DEFAULT_MODEL_OVERRIDES[providerKey];
  const config = getProviderConfig(providerKey);
  if (!config) return null;
  return (
    config.fallbackVisionModels?.[0]
    || config.recommendedModels?.[0]
    || config.fallbackModels?.[0]
    || null
  );
}

/**
 * Whether this provider can see screenshots. browser-use runs blind but much
 * worse without vision, so the tool defaults `useVision` to this rather than
 * to an optimistic `true` that produces silently degraded runs.
 */
export function supportsVision(providerKey) {
  const config = getProviderConfig(providerKey);
  return Boolean(config?.capabilities?.vision);
}

/**
 * Resolve one provider to everything the Python runner needs.
 *
 * @param {string} providerKey  Provider key or display name ('DeepSeek', 'zai'…).
 * @returns {{key:string,name:string,route:string,chatClass:string|null,baseUrl:string|null,defaultModel:string|null,visionCapable:boolean,reason:string|null}}
 * @throws {Error} when the provider is unknown to providerConfigs, or known to
 *   providerConfigs but unclassified here. Both are loud on purpose.
 */
export function resolveBrowserUseProvider(providerKey) {
  const config = getProviderConfig(providerKey);
  if (!config) {
    throw new Error(
      `Unknown AI provider "${providerKey}". `
      + 'Pick one of the providers listed in the Browser Agent node, or connect it first in Settings → Providers.',
    );
  }

  const routing = ROUTING[config.key];
  if (!routing) {
    // A provider exists in providerConfigs that nobody taught this file about.
    // Refuse rather than guess — guessing is what shipped a DeepSeek key to
    // OpenAI for a year.
    throw new Error(
      `Provider "${config.name}" has no Browser Agent routing declared. `
      + 'Add an entry to browserUseProviders.js (the conformance test that '
      + 'should have caught this is browserUseProviders.test.js).',
    );
  }

  return {
    key: config.key,
    name: config.name,
    route: routing.route,
    chatClass: routing.chatClass || null,
    baseUrl: routing.baseUrlOverride || config.baseURL || null,
    defaultModel: defaultModelFor(config.key),
    visionCapable: supportsVision(config.key),
    reason: routing.reason || null,
  };
}

/**
 * Routing for a user-defined custom provider (UUID key, or one of the 18
 * PROVIDER_TEMPLATES the user has instantiated: Mistral, Fireworks, Ollama,
 * LM Studio, DeepInfra, Perplexity, SambaNova, Novita, Nebius, NVIDIA NIM,
 * Scaleway, Hyperbolic, Meta Llama, Cohere, Lambda, Lepton, vLLM, Jan).
 *
 * They are OpenAI-compatible by construction — that is the only kind of
 * provider AGNT's custom-provider system can create — so they all take the
 * same route, and no per-vendor entry is needed for any of them.
 */
export function customProviderRouting(baseUrl, name) {
  return {
    key: null,
    name: name || 'Custom provider',
    route: ROUTE.OPENAI_COMPAT,
    chatClass: 'ChatOpenAI',
    baseUrl,
    defaultModel: null,
    // Unknowable for an arbitrary endpoint. Left to the user's `useVision`
    // choice rather than assumed either way.
    visionCapable: true,
    reason: null,
  };
}

/**
 * Display-name list for the node's provider dropdown, in providerConfigs order.
 * Generated, so the dropdown cannot fall out of step with what the tool can
 * actually run — the old hand-written ['OpenAI','Gemini','DeepSeek'] listed two
 * providers that were broken and omitted seventeen that were not.
 */
export function browserUseProviderOptions() {
  return getAllProviderConfigs()
    .filter((config) => ROUTING[config.key])
    .map((config) => config.name);
}

/** Provider keys that must come back through the AGNT gateway. */
export function gatewayRoutedProviders() {
  return Object.entries(ROUTING)
    .filter(([, routing]) => routing.route === ROUTE.GATEWAY)
    .map(([key]) => key);
}

/**
 * Every subscription provider must be gateway-routed: by definition none of
 * them has an API key to hand to browser-use. Exported so the conformance test
 * asserts the relationship rather than restating the list.
 */
export function subscriptionProvidersAreGatewayRouted() {
  return getAllProviderConfigs()
    .filter((config) => isSubscriptionProvider(config.key))
    .every((config) => ROUTING[config.key]?.route === ROUTE.GATEWAY);
}

export const BROWSER_USE_ROUTING = ROUTING;
