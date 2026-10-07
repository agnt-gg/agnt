import { API_CONFIG, DEPLOYMENT_CONFIG } from '@/tt.config.js';
import { fetchLocalStatus } from '@/services/localModelsService.js';
import { withFreshness } from '../_utils/withFreshness.js';
import { TTL } from '../_utils/freshnessConfig.js';
import { authSubject } from '../auth/licenseIdentity.js';

// SHARED PROVIDER DESCRIPTOR — the same module the backend imports.
//
// These twenty predicates used to be redefined in this file, with a comment
// asking whoever edited them to keep the regexes in sync with the backend by
// hand. They had already fallen out of sync: this store recognised a narrower
// set of OpenRouter Anthropic models than the wire accepted, and offered
// GLM-5.2 an on/off toggle for a control that model does not have.
//
// `@llm` is a Vite alias onto backend/src/services/ai/descriptor — no npm
// workspace, no new packaged artifact; Vite inlines it into dist/ at build
// time. See vite.config.js for why it is done that way.
import {
  normalizeReasoningValue,
  isReasoningEnabledValue,
  isOpenAIResponsesReasoningModel as isOpenAIReasoningModel,
  anthropicReasoningEfforts,
  effortOptionsFromList,
  isGemini3ReasoningModel,
  isGemini25ReasoningModel,
  supportsDeepSeekThinkingToggle as supportsDeepSeekThinking,
  isGroqGptOssReasoningModel,
  isGroqQwenReasoningModel,
  isCerebrasGptOssReasoningModel,
  isCerebrasGlmReasoningModel,
  isCerebrasQwenReasoningModel,
  supportsZaiThinkingToggle,
  supportsZaiReasoningEffort,
  supportsKimiReasoningToggle as supportsKimiToggle,
  isOpenRouterOpenAIReasoningModel,
  isOpenRouterAnthropicReasoningModel,
  isOpenRouterGeminiReasoningModel,
  isOpenRouterXaiReasoningModel,
  isTogetherGptOssReasoningModel,
  isChutesKimiReasoningModel,
  isChutesGlmReasoningModel,
  isChutesQwenReasoningModel,
} from '@llm/reasoningPredicates.js';

// ─────────────────────────── PROVIDER REGISTRY ───────────────────────────
// Single source of truth for all built-in provider metadata on the frontend.
// Derived from the same data as backend/src/services/ai/providerConfigs.js.

// Cache version fallback — used only if the backend's schema-version endpoint
// is unreachable on boot (offline, backend not started). The real invalidator
// is the schema hash returned by GET /api/models/schema-version, fetched on
// module load and compared against the stored value. Any change to metadata
// shape, recommended-model order, or fallback list auto-invalidates all
// per-provider localStorage caches. Kills the manual bump-the-integer footgun.
const MODEL_CACHE_VERSION_FALLBACK = 12;
(() => {
  const storedVersion = localStorage.getItem('model_cache_version');
  if (storedVersion !== String(MODEL_CACHE_VERSION_FALLBACK)) {
    for (const key of Object.keys(localStorage)) {
      if (key.endsWith('_models') || key.endsWith('_metadata')) {
        localStorage.removeItem(key);
      }
    }
    localStorage.setItem('model_cache_version', String(MODEL_CACHE_VERSION_FALLBACK));
    console.log('[aiProvider] Cleared stale model caches (fallback version upgrade)');
  }
})();

// Auto cache-bust via backend schema hash. Fetched once on module load and
// again on every explicit refresh action. Silent failure = keep whatever was
// cached; the 5-min SWR path below still keeps things fresh.
(async () => {
  try {
    const res = await fetch(`${API_CONFIG.BASE_URL}/models/schema-version`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data?.success || !data.version) return;
    const stored = localStorage.getItem('model_schema_hash');
    if (stored !== data.version) {
      for (const key of Object.keys(localStorage)) {
        if (key.endsWith('_models') || key.endsWith('_metadata')) {
          localStorage.removeItem(key);
        }
      }
      localStorage.setItem('model_schema_hash', data.version);
      console.log(`[aiProvider] Cleared stale model caches (backend schema hash changed to ${data.version})`);
    }
  } catch {
    // Backend not reachable on module load — fine, fallback version handles it.
  }
})();

// Display order is ENFORCED below, not by where entries are typed. The literal
// here was hand-alphabetized, so every new provider silently landed wherever
// its author appended it (PR #50 put Cursor between Grok-Build and Groq — the
// "Cursor is in the G's" bug). Sorting at the boundary makes insertion position
// irrelevant.
//
// The sort itself lives after PROVIDER_DISPLAY_NAMES, because it orders by the
// LABEL a user reads rather than by `displayName` — see `byProviderLabel`.
const BUILT_IN_PROVIDERS = [
  { key: 'agnt', displayName: 'AGNT' },
  { key: 'anthropic', displayName: 'Anthropic' },
  { key: 'antigravity', displayName: 'Antigravity' },
  { key: 'cerebras', displayName: 'Cerebras' },
  { key: 'chutes', displayName: 'Chutes' },
  { key: 'claude-code', displayName: 'Claude-Code' },
  { key: 'deepseek', displayName: 'DeepSeek' },
  { key: 'gemini', displayName: 'Gemini' },
  { key: 'gemini-cli', displayName: 'Gemini-CLI' },
  { key: 'grokai', displayName: 'GrokAI' },
  { key: 'grok-build', displayName: 'Grok-Build' },
  { key: 'cursor-cli', displayName: 'Cursor' },
  { key: 'groq', displayName: 'Groq' },
  { key: 'kimi', displayName: 'Kimi' },
  { key: 'kimi-code', displayName: 'Kimi-Code' },
  { key: 'local', displayName: 'Local' },
  { key: 'minimax', displayName: 'MiniMax' },
  { key: 'openai', displayName: 'OpenAI' },
  { key: 'openai-codex', displayName: 'OpenAI-Codex' },
  { key: 'openrouter', displayName: 'OpenRouter' },
  { key: 'togetherai', displayName: 'TogetherAI' },
  { key: 'zai', displayName: 'Z.AI' },
];

// ─────────────────────────── DERIVED EXPORTS ───────────────────────────

/**
 * Find the canonical identifier for a provider whose stored value differs
 * only by case ('claude-code' vs 'Claude-Code'). Returns the canonical name,
 * or null when the provider genuinely does not exist. Extracted so the
 * "unknown provider" cleanup can rescue case drift instead of nulling the
 * user's selection — a nulled selection is what armed the Anthropic-first
 * auto-select ladder.
 */
export function canonicalizeProviderCase(knownProviders, value) {
  if (typeof value !== 'string' || !value) return null;
  const lower = value.toLowerCase();
  return knownProviders.find((p) => p.toLowerCase() === lower) || null;
}

// Map internal provider keys to user-facing display names where they differ
export const PROVIDER_DISPLAY_NAMES = {};
for (const p of BUILT_IN_PROVIDERS) {
  // Only add entries where key-based capitalization != display name
  const defaultName = p.key.charAt(0).toUpperCase() + p.key.slice(1);
  if (p.displayName !== defaultName) {
    PROVIDER_DISPLAY_NAMES[p.displayName] = p.displayName;
    PROVIDER_DISPLAY_NAMES[p.key] = p.displayName;
  }
}

/**
 * Presentation-only overrides, applied last.
 *
 * `displayName` above is NOT a label — it is an identifier. It keys
 * PROVIDER_FETCH_ACTIONS (`OpenAI-Codex` → `fetchOpenAICodexModels`), the
 * `allModels` map, `state.providers`, and the localStorage model cache, and
 * resolveProviderKey matches on it. Renaming it to change a label would break
 * model fetching for the provider it renamed. So the label changes here, where
 * the only consumers are `label:` / `placeholder:` / rendered text.
 *
 * Why `openai-codex`: it is the ChatGPT subscription — the same OAuth sign-in
 * that powers Codex, voice, and chat. Users came here with a ChatGPT account
 * and looked for the word ChatGPT; "OpenAI-Codex" next to "OpenAI" read as a
 * second API product they had not bought.
 *
 * Why the rest: `displayName` is an identifier, so it is hyphenated the way a
 * key is, and the connect screen was rendering that hyphen at the user. Nobody
 * subscribes to "Claude-Code" or "Gemini-CLI" — they subscribe to Claude Code
 * and Gemini CLI. These are the SAME product, spelled the way its vendor spells
 * it, and each stays distinct from the metered sibling beside it (Claude Code
 * vs Anthropic, Gemini CLI vs Gemini), which is the distinction the two lanes
 * exist to draw.
 */
const PROVIDER_LABEL_OVERRIDES = {
  'openai-codex': 'ChatGPT',
  'claude-code': 'Claude Code',
  'gemini-cli': 'Gemini CLI',
  'grok-build': 'Grok Build',
  'kimi-code': 'Kimi Code',
};
for (const [key, label] of Object.entries(PROVIDER_LABEL_OVERRIDES)) {
  const provider = BUILT_IN_PROVIDERS.find((p) => p.key === key);
  PROVIDER_DISPLAY_NAMES[key] = label;
  if (provider) PROVIDER_DISPLAY_NAMES[provider.displayName] = label;
}

/**
 * The text a user actually reads for a provider.
 *
 * Accepts anything a call site happens to hold: a key ('openai-codex'), a
 * display name ('OpenAI-Codex'), or a provider object from either shape —
 * `{ key, displayName }` from this module, `{ id, name }` from the auth API.
 * Every one of those resolves to the same label, which is the point: a provider
 * must not be called two different things on two different screens.
 */
export function providerLabel(provider) {
  if (!provider) return '';
  if (typeof provider === 'string') return PROVIDER_DISPLAY_NAMES[provider] || provider;
  const { id, key, name, displayName } = provider;
  for (const identifier of [id, key, name, displayName]) {
    if (identifier && PROVIDER_DISPLAY_NAMES[identifier]) return PROVIDER_DISPLAY_NAMES[identifier];
  }
  return name || displayName || id || key || '';
}

/**
 * Sort providers the way the list is READ.
 *
 * Both provider lists used to sort by an identifier — this module by
 * `displayName`, the onboarding page by the auth API's `name` — while both
 * RENDERED a label. That worked only while the two strings happened to match.
 * The moment `openai-codex` was labelled "ChatGPT" it broke, and the entry
 * appeared under O, between the OpenAI providers, where nobody scanning for a
 * C would find it. Alphabetical means alphabetical by what is on screen.
 *
 * `sensitivity: 'base'` ignores case and punctuation at the primary strength,
 * so Grok-Build/GrokAI order by their letters rather than by the hyphen.
 */
export const byProviderLabel = (a, b) =>
  providerLabel(a).localeCompare(providerLabel(b), 'en', { sensitivity: 'base' });

/**
 * The AI providers to offer a user who has not connected one yet, in the order
 * they should be read.
 *
 * WHY THIS IS A FUNCTION AND NOT A COMPUTED IN EACH COMPONENT
 * ----------------------------------------------------------
 * Two screens ask this question — the onboarding modal and the setup card in an
 * empty chat — and they used to answer it with two copies of the same twelve
 * lines. Copies drift, and these did: the ChatGPT ordering and labelling fix
 * landed on the modal and the chat card kept sorting by the auth API's `name`
 * and rendering it raw, so the same provider was called "OpenAI Codex" and
 * filed under O on one screen and "ChatGPT" under C on the other. Same defect,
 * same session, one surface behind — which is the signature of duplicated logic
 * rather than of a missed edit.
 *
 * @param {Array<object>} providers  raw provider records from the auth API
 * @param {object} [opts]
 * @param {object} [opts.codexStatus]  store.state.appAuth.codexStatus
 * @returns {Array<object>} the same records, filtered and ordered
 */
export function connectableAiProviders(providers, { codexStatus } = {}) {
  if (!Array.isArray(providers)) return [];

  return providers
    .filter((p) => {
      /**
       * The ChatGPT provider is hidden only when its own service says it is
       * unusable — not when it is merely unconnected, which is the state every
       * provider on this screen is in.
       *
       * `available === true` is required: before the status has loaded it is
       * undefined, and treating that as "unusable" would hide the tile for the
       * first moments of every session.
       */
      if (
        p.id === 'openai-codex'
        && codexStatus?.available === true
        && codexStatus?.apiUsable !== true
      ) {
        return false;
      }

      // `categories` arrives as an array or as a JSON string, depending on
      // which endpoint served it.
      let categories = p.categories;
      if (!Array.isArray(categories)) {
        try {
          categories = categories ? JSON.parse(categories) : [];
        } catch {
          categories = [];
        }
      }
      return categories.some((c) => String(c).toLowerCase() === 'ai');
    })
    // By the LABEL, which is what these grids render. Sorting by the auth API's
    // `name` put ChatGPT under O, between the OpenAI providers.
    .sort(byProviderLabel);
}

/**
 * Providers billed by a flat subscription rather than per token.
 *
 * MIRROR OF backend/src/services/ai/providerConfigs.js SUBSCRIPTION_PROVIDERS.
 * The backend is the source of truth (it holds the per-entry evidence: auth
 * scheme, pricing, which CLI writes the session). The frontend cannot import
 * across the build boundary, so this copy is PINNED BY A CONTRACT TEST —
 * providerLanes.spec.js reads the backend file and fails if the two sets
 * diverge. Add a provider there and the frontend suite tells you to add it
 * here; there is no way to end up with two quietly different answers.
 *
 * NOT the same question as appAuth's CLI_PROVIDER_IDS, which asks "can I probe
 * this provider's credentials on the local filesystem?". Every locally-probed
 * provider is a subscription seat, but not every subscription seat is locally
 * probed — `kimi-code` is billed by seat and has no local auth manager. Merging
 * the two lists would either invent a probe that 404s or drop kimi-code into
 * the metered lane, and both were tried before this comment existed.
 */
export const SUBSCRIPTION_PROVIDER_IDS = new Set([
  'claude-code',
  'openai-codex',
  'gemini-cli',
  'antigravity',
  'kimi-code',
  'grok-build',
  'cursor-cli',
]);

/**
 * Subscriptions a first run uses without asking, best first. Every
 * SUBSCRIPTION_PROVIDER_IDS entry appears exactly once (pinned by
 * aiProvider.firstRunDefault.spec.js), so a new seat cannot be silently
 * skipped by first-run detection.
 */
export const FIRST_RUN_SUBSCRIPTION_ORDER = Object.freeze([
  'openai-codex',
  'claude-code',
  'gemini-cli',
  'antigravity',
  'grok-build',
  'cursor-cli',
  'kimi-code',
]);

/**
 * The subscriptions already usable on this account, in first-run order.
 * AGNT itself is never in the result: the connectedApps getter always adds it
 * for a signed-in account, which is exactly why "anything connected?" could
 * never tell a ready ChatGPT seat from nothing at all.
 */
export function detectedSubscriptions(connectedIds = []) {
  const connected = new Set((connectedIds || []).map((id) => String(id).toLowerCase()));
  return FIRST_RUN_SUBSCRIPTION_ORDER.filter((id) => connected.has(id));
}

/** Accepts an id string or any provider record shape. */
export function isSubscriptionProvider(provider) {
  const id = typeof provider === 'string' ? provider : provider?.id;
  return SUBSCRIPTION_PROVIDER_IDS.has(String(id || '').toLowerCase());
}

/**
 * The same vendor's OTHER product, across the billing divide.
 *
 * "OpenAI" (metered developer API) and "ChatGPT" (the subscription) are two
 * products with two balances, and a user who has one and picks the other hits a
 * dead end — the panel for the wrong one is where they find out. This map is
 * what lets each panel offer the other in one click, in both directions.
 */
export const PROVIDER_LANE_SIBLING = {
  'openai-codex': 'openai',
  openai: 'openai-codex',
  'claude-code': 'anthropic',
  anthropic: 'claude-code',
  'gemini-cli': 'gemini',
  gemini: 'gemini-cli',
};

/** Tiles shown per lane before the "+N more" expander. */
export const LANE_PREVIEW_COUNT = 4;

/**
 * Running a model on this machine.
 *
 * SYNTHESIZED HERE, NEVER FETCHED. Every other entry on the connect screen is
 * an account in the remote provider catalog, because every other entry is
 * something you sign into. `local` is not an account — it is a runtime already
 * on the user's disk, with no credential to store and nothing to authorize, so
 * there is no row for it at api.agnt.gg and there should not be one.
 *
 * Deriving the offer from that catalog is what made it disappear: the lane
 * split only ever saw providers the catalog returned, so the single option
 * that needs no network became the first one to vanish when the network was
 * unavailable — exactly backwards, and worst for the user with no accounts at
 * all, who is the one this option exists for.
 *
 * The rest of the app already treats local as a mode rather than a connection:
 * `handleProviderClick` selects it without an auth round trip, the chat and
 * settings pickers keep it enabled regardless of `connectedApps`, and the
 * workspace list includes it unconditionally. This makes the connect screen
 * agree with them.
 *
 * Frozen because it is a module-level singleton handed to every caller; one
 * component mutating it would change what every other screen renders.
 */
export const LOCAL_PROVIDER = Object.freeze({
  id: 'local',
  name: 'Local',
  icon: 'terminal',
  categories: ['AI'],
  // Not 'apikey' and not 'oauth': there is no credential to collect. The panel
  // branches on this, so naming it honestly keeps local out of both forms.
  connectionType: 'none',
});

/**
 * The connectable AI providers, split by WHAT THEY COST rather than by how they
 * authenticate.
 *
 * "OAuth vs API key" is our vocabulary. "Already paid for vs charges me per
 * token" is the user's, and it is the only distinction that changes what they
 * should click. A flat alphabetical wall put OpenAI and ChatGPT side by side
 * with nothing saying one bills per token and the other does not.
 *
 * ORDER WITHIN A LANE, in three stable passes over the label order:
 *   1. connected first — a connection must never hide behind "+N more"
 *   2. then the vendors that sell BOTH a plan and a metered API
 *   3. then everything else, alphabetically
 *
 * Rule 2 exists because a purely alphabetical preview showed Anthropic,
 * Cerebras, Chutes and DeepSeek while burying OpenAI and Google — the two keys
 * most people arrive holding — behind the expander. Rather than invent a
 * popularity list to maintain, it reuses PROVIDER_LANE_SIBLING: a vendor that
 * sells on both sides of the billing divide is by definition one a user might
 * arrive with either way, and those are the household names. It also keeps a
 * pair's two halves visible together, so the cross-sell link points at a tile
 * the user can see.
 *
 * Array#sort is stable, so label order survives within each group.
 *
 * @param {Array<object>} providers  raw provider records from the auth API
 * @param {object} [opts]
 * @param {object} [opts.codexStatus]  store.state.appAuth.codexStatus
 * @param {Array<string>} [opts.connectedIds]  store.state.appAuth.connectedApps
 * @returns {{subscription: object[], api: object[], local: object[]}}
 */
export function providerLanes(providers, { codexStatus, connectedIds } = {}) {
  const connected = new Set(
    (Array.isArray(connectedIds) ? connectedIds : []).map((id) => String(id).toLowerCase()),
  );
  const lanes = { subscription: [], api: [], local: [] };

  for (const provider of connectableAiProviders(providers, { codexStatus })) {
    const id = String(provider?.id || '').toLowerCase();
    // `local` is a runtime on this machine, not an account — it belongs to
    // neither billing lane and is offered as a footnote instead.
    if (id === 'local') lanes.local.push(provider);
    else if (SUBSCRIPTION_PROVIDER_IDS.has(id)) lanes.subscription.push(provider);
    else lanes.api.push(provider);
  }

  // Offered unconditionally — including when the catalog is empty, malformed,
  // or never arrived. A catalog record wins if one ever exists, so this can
  // never produce a duplicate. See LOCAL_PROVIDER for why it is not fetched.
  if (lanes.local.length === 0) lanes.local.push(LOCAL_PROVIDER);

  const rank = (provider) => {
    const id = String(provider?.id || '').toLowerCase();
    if (connected.has(id)) return 0;
    if (PROVIDER_LANE_SIBLING[id]) return 1;
    return 2;
  };
  const byRank = (a, b) => rank(a) - rank(b);

  // Safe to sort in place: connectableAiProviders returns a fresh array, so
  // this never reorders the Vuex state the caller passed in.
  lanes.subscription.sort(byRank);
  lanes.api.sort(byRank);

  return lanes;
}

// Ordered in place, so EVERY list derived below inherits it rather than each
// deriving its own order.
BUILT_IN_PROVIDERS.sort(byProviderLabel);

// Resolve any provider identifier (display name, key, or mixed case) to its canonical key.
// e.g. "Z.AI" → "zai", "Z-AI" → "zai", "GrokAI" → "grokai", "openai" → "openai"
const LISTING_SOURCES = new Set(['live', 'cache', 'persisted', 'fallback', 'static']);

/**
 * The provenance fields of a model-list response, or null for a backend that
 * does not send them (older build, custom provider). Never invents `stale`.
 */
export function listingFromResponse(data) {
  if (!data || !LISTING_SOURCES.has(data.source)) return null;
  return {
    source: data.source,
    stale: data.stale === true,
    fetchedAt: typeof data.fetchedAt === 'string' ? data.fetchedAt : null,
    upstreamError: typeof data.upstreamError === 'string' && data.upstreamError ? data.upstreamError : null,
  };
}

/** One sentence for a stale list: what is shown instead, and why. */
export function describeStaleListing(providerName, listing) {
  if (!listing?.stale) return '';
  let shown = 'built-in defaults, which may be out of date';
  if (listing.source === 'persisted' || listing.source === 'cache') {
    const when = listing.fetchedAt ? new Date(listing.fetchedAt) : null;
    shown = when && !Number.isNaN(when.getTime())
      ? `the list it last returned (${when.toLocaleString()})`
      : 'the list it last returned';
  }
  const reason = listing.upstreamError ? ` Reason: ${listing.upstreamError}` : '';
  return `${providerName} did not return its model list, so this shows ${shown}.${reason}`;
}

export function resolveProviderKey(identifier) {
  if (!identifier) return null;
  const lower = identifier.toLowerCase();
  // Direct key match
  const byKey = BUILT_IN_PROVIDERS.find((p) => p.key === lower);
  if (byKey) return byKey.key;
  // Display name match (case-insensitive)
  const byDisplay = BUILT_IN_PROVIDERS.find((p) => p.displayName.toLowerCase() === lower);
  if (byDisplay) return byDisplay.key;
  // Fuzzy match: strip non-alphanumeric chars (e.g. "Z-AI", "Z.AI" → "zai")
  const stripped = lower.replace(/[^a-z0-9]/g, '');
  const byFuzzy = BUILT_IN_PROVIDERS.find(
    (p) => p.key === stripped || p.displayName.toLowerCase().replace(/[^a-z0-9]/g, '') === stripped,
  );
  if (byFuzzy) return byFuzzy.key;
  // Not a built-in provider — return as-is (custom provider ID)
  return identifier;
}

// Single source of truth for AI providers that require API keys (excludes 'Local')
/**
 * The name the store keys a provider by ('claude-code' -> 'Claude-Code',
 * 'cursor-cli' -> 'Cursor'), from any identifier a screen holds. Unknown ids
 * (custom providers) come back unchanged.
 *
 * Replaces a hand-written map that each connect screen kept for itself. The
 * copies drifted: onboarding's had no subscription entries at all, so picking
 * Claude Code there fetched models under 'claude-code', a key nothing reads.
 */
export function providerStoreName(identifier) {
  const key = resolveProviderKey(String(identifier || ''));
  return BUILT_IN_PROVIDERS.find((p) => p.key === key)?.displayName || identifier;
}

export const AI_PROVIDERS_WITH_API = BUILT_IN_PROVIDERS.filter((p) => p.key !== 'local').map((p) => p.key);

// Mapping of provider display names to their fetch action names (auto-generated)
export const PROVIDER_FETCH_ACTIONS = {};
for (const p of BUILT_IN_PROVIDERS) {
  const actionSuffix = p.displayName.replace(/[-.]/g, '');
  PROVIDER_FETCH_ACTIONS[p.displayName] = `aiProvider/fetch${actionSuffix}Models`;
}

// Provider display names list (used by state.providers)
const PROVIDER_DISPLAY_LIST = BUILT_IN_PROVIDERS.map((p) => p.displayName);

// Initial allModels shape
const INITIAL_ALL_MODELS = {};
for (const p of BUILT_IN_PROVIDERS) {
  INITIAL_ALL_MODELS[p.displayName] = [];
}

function buildReasoningControl(kind, options, defaultValue = 'default') {
  return { kind, options, defaultValue };
}


// Exported (as well as exposed through the store getter) so the reasoning
// control it derives can be asserted directly against the shared descriptor,
// without standing up a store. It is pure: provider key + model id in, control
// descriptor out.
export function inferReasoningControl(providerKey, modelId) {
  const lowerProvider = String(providerKey || '').toLowerCase();
  const lowerModel = String(modelId || '').toLowerCase();

  if (!lowerProvider || !lowerModel) return null;

  if (lowerProvider === 'openai' || lowerProvider === 'openai-codex') {
    if (!isOpenAIReasoningModel(modelId)) return null;

    if (lowerModel.startsWith('gpt-5.4')) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'off', label: 'Off' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
        { value: 'xhigh', label: 'Max' },
      ]);
    }

    if (lowerProvider === 'openai-codex' && (lowerModel.startsWith('gpt-5.3') || lowerModel.startsWith('gpt-5.2'))) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
        { value: 'xhigh', label: 'Max' },
      ]);
    }

    if (lowerModel.startsWith('gpt-5.2') || lowerModel.startsWith('gpt-5.1')) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'off', label: 'Off' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
        { value: 'xhigh', label: 'Max' },
      ]);
    }

    if (lowerModel.startsWith('gpt-5')) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'minimal', label: 'Minimal' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ]);
    }

    if (/^o\d/.test(lowerModel)) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ]);
    }

    return null;
  }

  if (lowerProvider === 'anthropic' || lowerProvider === 'claude-code') {
    // Cold-start fallback only: once metadata loads, the server's control —
    // built from Anthropic's own catalog — takes precedence (see
    // selectedModelMetadata). Same rule and same builder as the backend.
    const options = effortOptionsFromList(anthropicReasoningEfforts(modelId));
    return options ? buildReasoningControl('effort', options) : null;
  }

  if (lowerProvider === 'gemini' || lowerProvider === 'gemini-cli' || lowerProvider === 'antigravity') {
    if (isGemini3ReasoningModel(modelId) || isGemini25ReasoningModel(modelId)) {
      const options = [{ value: 'default', label: 'Default' }];
      if (lowerModel.includes('flash')) {
        options.push({ value: 'off', label: 'Off' });
      }
      options.push(
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      );
      return buildReasoningControl('effort', options);
    }
    return null;
  }

  if (lowerProvider === 'deepseek') {
    if (!supportsDeepSeekThinking(modelId)) return null;
    return buildReasoningControl('effort', [
      { value: 'default', label: 'Default' },
      { value: 'off', label: 'Off' },
      { value: 'high', label: 'High' },
      { value: 'max', label: 'Max' },
    ]);
  }

  if (lowerProvider === 'groq') {
    if (isGroqGptOssReasoningModel(modelId)) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ]);
    }
    if (isGroqQwenReasoningModel(modelId)) {
      return buildReasoningControl('toggle', [
        { value: 'default', label: 'Default' },
        { value: 'off', label: 'Off' },
      ]);
    }
    return null;
  }

  if (lowerProvider === 'cerebras') {
    // Cerebras ids carry no vendor prefix ('gpt-oss-120b'), so the Groq
    // predicate ('openai/gpt-oss-') never matched and the UI showed no effort
    // control for a model the backend does send one for.
    if (isCerebrasGptOssReasoningModel(modelId)) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ]);
    }
    if (isCerebrasGlmReasoningModel(modelId) || isCerebrasQwenReasoningModel(modelId)) {
      return buildReasoningControl('toggle', [
        { value: 'default', label: 'Default' },
        { value: 'off', label: 'Off' },
      ]);
    }
    return null;
  }

  if (lowerProvider === 'openrouter') {
    if (isOpenRouterOpenAIReasoningModel(modelId) || isOpenRouterXaiReasoningModel(modelId)) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'off', label: 'Off' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
        { value: 'xhigh', label: 'Max' },
      ]);
    }
    if (isOpenRouterAnthropicReasoningModel(modelId) || isOpenRouterGeminiReasoningModel(modelId)) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'off', label: 'Off' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ]);
    }
    return null;
  }

  if (lowerProvider === 'togetherai') {
    if (isTogetherGptOssReasoningModel(modelId)) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ]);
    }
    return null;
  }

  if (lowerProvider === 'zai') {
    // GLM-5.2 takes an OpenAI-compatible `reasoning_effort` of high (default)
    // or max, and has no off — adaptive thinking is always on. This branch was
    // MISSING here while the backend had it, so the UI offered GLM-5.2 users an
    // on/off toggle for a control the model does not have. Found by adopting
    // the shared descriptor: its supportsZaiThinkingToggle excludes GLM-5.2,
    // which made the gap visible instead of silently mismatched.
    if (supportsZaiReasoningEffort(modelId)) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'high', label: 'High' },
        { value: 'max', label: 'Max' },
      ]);
    }
    if (!supportsZaiThinkingToggle(modelId)) return null;
    return buildReasoningControl('toggle', [
      { value: 'default', label: 'Default' },
      { value: 'off', label: 'Off' },
    ]);
  }

  if (lowerProvider === 'kimi' || lowerProvider === 'kimi-code') {
    if (!supportsKimiToggle(lowerProvider, modelId)) return null;
    return buildReasoningControl('toggle', [
      { value: 'default', label: 'Default' },
      { value: 'off', label: 'Off' },
    ]);
  }

  if (lowerProvider === 'chutes') {
    if (
      isChutesKimiReasoningModel(modelId) ||
      isChutesGlmReasoningModel(modelId) ||
      isChutesQwenReasoningModel(modelId)
    ) {
      return buildReasoningControl('toggle', [
        { value: 'default', label: 'Default' },
        { value: 'off', label: 'Off' },
      ]);
    }
    return null;
  }

  return null;
}

/**
 * The ONE write path for the account default provider/model.
 *
 * Rules, each of which a past bug violated:
 *   - Never an empty model. { provider, null } read back server-side as a
 *     hardcoded retired model, so every turn failed before falling over.
 *   - Never a null provider. The server used to take that as an erasure; a
 *     model-only write is sent instead and keeps the stored provider.
 *   - Always say who wrote it (`source`), so the server's change log can
 *     attribute the next unexpected switch.
 *
 * Returns true when a write was sent.
 */
export async function persistDefaultAi({ provider, model, source }) {
  if (typeof model !== 'string' || !model.trim()) {
    console.warn(`[aiProvider] Not saving default AI without a model (provider: ${provider || 'none'}, source: ${source}).`);
    return false;
  }
  const token = localStorage.getItem('token');
  if (!token) return false;
  const body = provider
    ? { selectedProvider: provider, selectedModel: model, changeSource: source }
    : { selectedModel: model, changeSource: source };
  try {
    const response = await fetch(`${API_CONFIG.BASE_URL}/users/settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      console.error('Failed to save default AI:', response.status, await response.text());
    }
  } catch (error) {
    console.error('Failed to save default AI:', error);
  }
  return true;
}

const STORED_REASONING_VALUE = normalizeReasoningValue(localStorage.getItem('reasoningValue'));
const INITIAL_REASONING_VALUE = STORED_REASONING_VALUE !== 'default'
  ? STORED_REASONING_VALUE
  : (localStorage.getItem('reasoningEnabled') === 'true' ? 'on' : 'default');

// One first-run decision at a time: two concurrent runs would both see "no
// provider" and could save two different defaults.
let _firstRunDefaultInFlight = null;

/** See the applyIncludedModelDefault action. */
async function applyFirstRunDefault({ dispatch, state, rootState, rootGetters }) {
  if (state.selectedProvider) return;
  if (!rootGetters['userAuth/isPremium'] && !rootGetters['userAuth/isAuthenticated']) return;

  if (!rootState?.appAuth?.connectedAppsSettled) {
    try {
      await dispatch('appAuth/fetchConnectedApps', undefined, { root: true });
    } catch (error) {
      console.warn('[aiProvider] Connections unavailable for the first-run default:', error?.message || error);
    }
  }
  // The user may have picked something while the list loaded; that wins.
  if (state.selectedProvider) return;

  for (const key of detectedSubscriptions(rootState?.appAuth?.connectedApps)) {
    const provider = state.providers.find((name) => resolveProviderKey(name) === key);
    if (provider && (await dispatch('useProvider', { provider, source: 'detected-default' }))) return;
  }
  await dispatch('selectAgntFlash', { source: 'included-default' });
}

const aiProviderModule = {
  namespaced: true,
  state: {
    providers: [...PROVIDER_DISPLAY_LIST],
    customProviders: [],
    allModels: { ...INITIAL_ALL_MODELS },
    modelMetadata: {},
    // Where each provider's current list came from, as reported by the backend
    // (services/ai/modelListing.js): { source, stale, fetchedAt, upstreamError }.
    // `stale` means the vendor did not answer and the list is a saved or
    // built-in one — which used to be indistinguishable from a fresh list.
    modelListing: {},
    selectedProvider: localStorage.getItem('selectedProvider') || null,
    selectedModel: localStorage.getItem('selectedModel') || null,
    // True while the first-run default is being decided. Onboarding shows
    // "checking" instead of an empty choice it is about to make for the user.
    firstRunDefaultPending: false,
    reasoningValue: INITIAL_REASONING_VALUE,
    reasoningEnabled: isReasoningEnabledValue(INITIAL_REASONING_VALUE),
    customInstructions: localStorage.getItem('customInstructions') || '',
    // Per-user "Async tool execution" toggle. Default FALSE — async tool
    // execution is currently an experimental opt-in feature. Users enable
    // it in Settings → AI Provider. localStorage is the source of truth on
    // the frontend so the toggle survives reloads; loadUserSettings()
    // reconciles it with the backend value on session start.
    asyncToolsEnabled: localStorage.getItem('asyncToolsEnabled') === 'true',
    // Per-user hard cap on tool result size returned to the LLM. Default
    // 100000 matches the historical OrchestratorService MAX_TOOL_RESULT_CHARS.
    // localStorage is the source of truth on the frontend so the value
    // survives reloads; loadUserSettings() reconciles with the backend.
    toolOutputCap: (() => {
      const raw = Number(localStorage.getItem('toolOutputCap'));
      return Number.isFinite(raw) && raw > 0 ? raw : 100000;
    })(),
    // Per-user cap on tool-loop rounds per chat turn. Default 100 matches the
    // historical orchestrator/agent/tool/widget/goal cap. When set, overrides
    // every chat surface uniformly (including workflow/artifact which default
    // to 25 server-side).
    maxToolRounds: (() => {
      const raw = Number(localStorage.getItem('maxToolRounds'));
      return Number.isFinite(raw) && raw > 0 ? raw : 100;
    })(),
    // Dynamic provider routing (account-wide). 'static' | 'dynamic'.
    //
    // Mirrored into localStorage so the chat selector can render the right
    // mode on first paint instead of flickering through "static" while the
    // settings fetch lands. loadUserSettings() reconciles with the backend,
    // which remains the source of truth.
    routingMode: localStorage.getItem('routingMode') === 'dynamic' ? 'dynamic' : 'static',
    // 'save' | 'balanced' | 'quality' — one λ in the routing objective.
    routingPolicy: ['save', 'balanced', 'quality'].includes(localStorage.getItem('routingPolicy'))
      ? localStorage.getItem('routingPolicy')
      : 'balanced',
    loadingModels: {},
    modelCache: {},
  },
  mutations: {
    SET_ROUTING_MODE(state, mode) {
      // Anything unrecognised means OFF. A typo must never enable routing.
      state.routingMode = mode === 'dynamic' ? 'dynamic' : 'static';
      localStorage.setItem('routingMode', state.routingMode);
    },
    SET_FIRST_RUN_DEFAULT_PENDING(state, pending) {
      state.firstRunDefaultPending = !!pending;
    },
    SET_ROUTING_POLICY(state, policy) {
      state.routingPolicy = ['save', 'balanced', 'quality'].includes(policy) ? policy : 'balanced';
      localStorage.setItem('routingPolicy', state.routingPolicy);
    },
    SET_SELECTED_PROVIDER(state, newProvider) {
      state.selectedProvider = newProvider;

      if (!newProvider) {
        localStorage.removeItem('selectedProvider');
        state.selectedModel = null;
        localStorage.removeItem('selectedModel');
        return;
      }

      localStorage.setItem('selectedProvider', newProvider);

      const availableModels = state.allModels[newProvider] || [];
      if (availableModels.length > 0) {
        state.selectedModel = availableModels[0];
        localStorage.setItem('selectedModel', availableModels[0]);
      } else {
        state.selectedModel = null;
        localStorage.removeItem('selectedModel');
      }
    },
    SET_SELECTED_MODEL(state, newModel) {
      state.selectedModel = newModel;

      if (!newModel) {
        localStorage.removeItem('selectedModel');
        return;
      }

      localStorage.setItem('selectedModel', newModel);
    },
    SET_REASONING_ENABLED(state, enabled) {
      state.reasoningValue = enabled ? 'on' : 'off';
      state.reasoningEnabled = enabled;
      localStorage.setItem('reasoningValue', state.reasoningValue);
      if (enabled) localStorage.setItem('reasoningEnabled', 'true');
      else localStorage.removeItem('reasoningEnabled');
    },
    SET_REASONING_VALUE(state, value) {
      state.reasoningValue = normalizeReasoningValue(value);
      state.reasoningEnabled = isReasoningEnabledValue(state.reasoningValue);
      if (state.reasoningValue === 'default') {
        localStorage.removeItem('reasoningValue');
      } else {
        localStorage.setItem('reasoningValue', state.reasoningValue);
      }
      if (state.reasoningEnabled) localStorage.setItem('reasoningEnabled', 'true');
      else localStorage.removeItem('reasoningEnabled');
    },
    SET_CUSTOM_INSTRUCTIONS(state, instructions) {
      const value = typeof instructions === 'string' ? instructions : '';
      state.customInstructions = value;
      if (value) {
        localStorage.setItem('customInstructions', value);
      } else {
        localStorage.removeItem('customInstructions');
      }
    },
    SET_ASYNC_TOOLS_ENABLED(state, enabled) {
      const value = Boolean(enabled);
      state.asyncToolsEnabled = value;
      // Persist explicitly even when true, so a deliberate "leave it on"
      // setting is preserved across reloads (rather than relying on the
      // localStorage-missing-key default and tripping over future default
      // changes).
      localStorage.setItem('asyncToolsEnabled', value ? 'true' : 'false');
    },
    SET_TOOL_OUTPUT_CAP(state, value) {
      const num = Number(value);
      const clean = Number.isFinite(num) && num > 0 ? Math.round(num) : 100000;
      state.toolOutputCap = clean;
      localStorage.setItem('toolOutputCap', String(clean));
    },
    SET_MAX_TOOL_ROUNDS(state, value) {
      const num = Number(value);
      const clean = Number.isFinite(num) && num > 0 ? Math.round(num) : 100;
      state.maxToolRounds = clean;
      localStorage.setItem('maxToolRounds', String(clean));
    },
    ENSURE_VALID_MODEL(state) {
      const availableModels = state.allModels[state.selectedProvider] || [];
      if (!state.selectedModel || !availableModels.includes(state.selectedModel)) {
        const defaultModel = availableModels[0];
        if (defaultModel) {
          state.selectedModel = defaultModel;
          localStorage.setItem('selectedModel', defaultModel);
        }
      }
    },
    SET_PROVIDER_MODELS(state, { provider, models }) {
      state.allModels[provider] = models;

      // Auto-select the first (recommended) model when:
      // - This is the currently selected provider, AND
      // - No model is selected, OR the current model isn't in the new model list
      if (state.selectedProvider === provider && models.length > 0) {
        if (!state.selectedModel || !models.includes(state.selectedModel)) {
          state.selectedModel = models[0];
          localStorage.setItem('selectedModel', models[0]);
        }
      }
    },
    SET_MODEL_METADATA(state, { provider, metadata }) {
      state.modelMetadata = { ...state.modelMetadata, [provider]: metadata };
    },
    SET_MODEL_LISTING(state, { provider, listing }) {
      state.modelListing = { ...state.modelListing, [provider]: listing };
    },
    SET_LOADING_MODELS(state, { provider, loading }) {
      if (!state.loadingModels) {
        state.loadingModels = {};
      }
      state.loadingModels[provider] = loading;
    },
    SET_CUSTOM_PROVIDERS(state, providers) {
      state.customProviders = providers;
    },
    ADD_CUSTOM_PROVIDER(state, provider) {
      state.customProviders.push(provider);
      state.allModels[provider.id] = [];
    },
    UPDATE_CUSTOM_PROVIDER(state, { id, updates }) {
      const index = state.customProviders.findIndex((p) => p.id === id);
      if (index !== -1) {
        state.customProviders[index] = { ...state.customProviders[index], ...updates };
      }
    },
    REMOVE_CUSTOM_PROVIDER(state, id) {
      state.customProviders = state.customProviders.filter((p) => p.id !== id);
      delete state.allModels[id];
    },
  },
  getters: {
    filteredModels(state) {
      return state.allModels[state.selectedProvider] || [];
    },
    modelListingFor: (state) => (provider) => state.modelListing[provider] || null,
    selectedModelMetadata(state) {
      if (!state.selectedProvider || !state.selectedModel) return null;
      const providerKey = resolveProviderKey(state.selectedProvider);
      const metadata = state.modelMetadata[state.selectedProvider]?.[state.selectedModel] || null;
      const inferredControl = inferReasoningControl(providerKey, state.selectedModel);
      if (metadata || inferredControl) {
        return inferredControl && !metadata?.reasoningControl
          ? { ...(metadata || {}), reasoningControl: inferredControl }
          : metadata;
      }
      return null;
    },
    selectedReasoningControl(state, getters) {
      return getters.selectedModelMetadata?.reasoningControl || null;
    },
    inferReasoningControl: () => (provider, model) => inferReasoningControl(resolveProviderKey(provider), model),
    filteredProviders(state) {
      return state.providers;
    },
    allProviders(state) {
      const customProviderNames = state.customProviders.map((p) => ({
        id: p.id,
        name: p.provider_name,
        isCustom: true,
      }));

      const builtInProviders = state.providers.map((p) => ({
        id: p,
        name: p,
        isCustom: false,
      }));

      return [...builtInProviders, ...customProviderNames];
    },
  },
  actions: {
    // Payload: either the provider string (legacy — persists as the account
    // default) or { provider, persist }. persist === false updates local UI
    // state only. Channel-scoped chat surfaces mirror THEIR pinned pair this
    // way, so mounting a once-pinned surface can never rewrite the database
    // default — persisting a transient choice is the documented cause of
    // provider drift in this codebase (see OrchestratorService's
    // write-back guard).
    //
    // A provider is never persisted without a model. Switching to a provider
    // whose models have not loaded used to save { provider, null }; the server
    // then read the missing model back as a hardcoded, retired default and
    // every turn failed over. So the models are loaded first, and the pair is
    // saved only once it is complete.
    async setProvider({ commit, dispatch, state }, payload) {
      const isObjectPayload = typeof payload === 'object' && payload !== null;
      const newProvider = isObjectPayload ? payload.provider : payload;
      const persist = !(isObjectPayload && payload.persist === false);
      const source = (isObjectPayload && payload.source) || 'set-provider';
      commit('SET_SELECTED_PROVIDER', newProvider);
      if (!persist || !newProvider) return;

      if ((state.allModels[newProvider] || []).length === 0) {
        try {
          await dispatch('fetchProviderModels', { provider: newProvider });
        } catch (error) {
          console.warn(`Could not load ${newProvider} models before saving the default:`, error);
        }
      }
      // A later selection made while the models loaded owns the save.
      if (state.selectedProvider !== newProvider) return;
      commit('ENSURE_VALID_MODEL');
      await persistDefaultAi({ provider: newProvider, model: state.selectedModel, source });
    },

    async setCustomInstructions({ commit }, newInstructions) {
      const value = typeof newInstructions === 'string' ? newInstructions : '';
      commit('SET_CUSTOM_INSTRUCTIONS', value);

      try {
        const token = localStorage.getItem('token');
        if (token) {
          const response = await fetch(`${API_CONFIG.BASE_URL}/users/settings`, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              customInstructions: value,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('Backend sync failed:', response.status, errorText);
          }
        }
      } catch (error) {
        console.error('Failed to sync custom instructions with backend:', error);
      }
    },

    /**
     * Turn dynamic routing on or off account-wide.
     *
     * Committed locally FIRST so the toggle responds instantly, then synced.
     * A failed sync is logged rather than silently reverted — but note the
     * backend is the source of truth on next load, so a persistent failure
     * self-corrects on reload instead of leaving the two disagreeing forever.
     */
    async setRoutingMode({ commit }, mode) {
      const value = mode === 'dynamic' ? 'dynamic' : 'static';
      commit('SET_ROUTING_MODE', value);
      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const response = await fetch(`${API_CONFIG.BASE_URL}/users/settings`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ routingMode: value }),
        });
        if (!response.ok) {
          console.error('Failed to persist routing mode:', response.status, await response.text());
        }
      } catch (error) {
        console.error('Failed to sync routing mode with backend:', error);
      }
    },

    async setRoutingPolicy({ commit }, policy) {
      const value = ['save', 'balanced', 'quality'].includes(policy) ? policy : 'balanced';
      commit('SET_ROUTING_POLICY', value);
      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const response = await fetch(`${API_CONFIG.BASE_URL}/users/settings`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ routingPolicy: value }),
        });
        if (!response.ok) {
          console.error('Failed to persist routing policy:', response.status, await response.text());
        }
      } catch (error) {
        console.error('Failed to sync routing policy with backend:', error);
      }
    },

    async setAsyncToolsEnabled({ commit }, enabled) {
      const value = Boolean(enabled);
      commit('SET_ASYNC_TOOLS_ENABLED', value);

      try {
        const token = localStorage.getItem('token');
        if (token) {
          const response = await fetch(`${API_CONFIG.BASE_URL}/users/settings`, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              asyncToolsEnabled: value,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('Backend sync failed:', response.status, errorText);
          }
        }
      } catch (error) {
        console.error('Failed to sync async tools toggle with backend:', error);
      }
    },

    async setToolOutputCap({ commit }, newCap) {
      // Clamp to the same window the backend validates against — keeps the
      // PUT from 400-ing on out-of-range values.
      const raw = Number(newCap);
      const clamped = Number.isFinite(raw)
        ? Math.max(25000, Math.min(500000, Math.round(raw)))
        : 100000;
      commit('SET_TOOL_OUTPUT_CAP', clamped);

      try {
        const token = localStorage.getItem('token');
        if (token) {
          const response = await fetch(`${API_CONFIG.BASE_URL}/users/settings`, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              toolOutputCap: clamped,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('Backend sync failed:', response.status, errorText);
          }
        }
      } catch (error) {
        console.error('Failed to sync tool output cap with backend:', error);
      }
    },

    async setMaxToolRounds({ commit }, newRounds) {
      // Clamp to the backend-validated [1, 999999] window.
      const raw = Number(newRounds);
      const clamped = Number.isFinite(raw)
        ? Math.max(1, Math.min(999999, Math.round(raw)))
        : 100;
      commit('SET_MAX_TOOL_ROUNDS', clamped);

      try {
        const token = localStorage.getItem('token');
        if (token) {
          const response = await fetch(`${API_CONFIG.BASE_URL}/users/settings`, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              maxToolRounds: clamped,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('Backend sync failed:', response.status, errorText);
          }
        }
      } catch (error) {
        console.error('Failed to sync max tool rounds with backend:', error);
      }
    },

    // Same transient contract as setProvider: a string persists,
    // { model, persist: false } updates local state only.
    async setModel({ commit, state }, payload) {
      const isObjectPayload = typeof payload === 'object' && payload !== null;
      const newModel = isObjectPayload ? payload.model : payload;
      const persist = !(isObjectPayload && payload.persist === false);
      const source = (isObjectPayload && payload.source) || 'set-model';
      commit('SET_SELECTED_MODEL', newModel);
      if (!persist) return;
      await persistDefaultAi({ provider: state.selectedProvider, model: newModel, source });
    },

    async loadUserSettings({ commit, dispatch, state }) {
      // True only when the server ANSWERED and holds no default. A failed read
      // says nothing about the stored default, so it must never trigger the
      // first-run fill — that would overwrite a real default the read missed.
      let serverHasNoDefault = false;
      try {
        const token = localStorage.getItem('token');
        if (token) {
          const response = await fetch(`${API_CONFIG.BASE_URL}/users/settings`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (response.ok) {
            const settings = await response.json();
            // Settings can hold lowercase server keys while providers/model
            // caches use canonical identifiers. Normalize before fetching or
            // committing so boot order cannot clear an otherwise valid model.
            // Custom-provider IDs remain opaque and must match exactly.
            const savedProvider = settings.selectedProvider;
            const isCustomProvider = state.customProviders.some((cp) => cp.id === savedProvider);
            const provider = isCustomProvider
              ? savedProvider
              : canonicalizeProviderCase(state.providers, savedProvider) || savedProvider;
            const model = settings.selectedModel;
            serverHasNoDefault = !provider;
            // localStorage belongs to the browser, not this account. A server
            // confirmed empty choice must not retain the previous user's pair.
            if (serverHasNoDefault) {
              commit('SET_SELECTED_PROVIDER', null);
              commit('SET_SELECTED_MODEL', null);
            }

            if (settings.customInstructions !== undefined) {
              commit('SET_CUSTOM_INSTRUCTIONS', settings.customInstructions || '');
            }

            if (settings.asyncToolsEnabled !== undefined) {
              commit('SET_ASYNC_TOOLS_ENABLED', settings.asyncToolsEnabled === true);
            }

            if (settings.toolOutputCap !== undefined && Number.isFinite(Number(settings.toolOutputCap))) {
              commit('SET_TOOL_OUTPUT_CAP', Number(settings.toolOutputCap));
            }

            if (settings.maxToolRounds !== undefined && Number.isFinite(Number(settings.maxToolRounds))) {
              commit('SET_MAX_TOOL_ROUNDS', Number(settings.maxToolRounds));
            }

            if (settings.routingMode !== undefined) {
              commit('SET_ROUTING_MODE', settings.routingMode);
            }

            if (settings.routingPolicy !== undefined) {
              commit('SET_ROUTING_POLICY', settings.routingPolicy);
            }

            if (provider) {
              if (provider === 'Local') {
                await dispatch('fetchLocalModels');
              } else if (isCustomProvider) {
                await dispatch('fetchCustomProviderModels', provider);
              } else if (state.providers.includes(provider)) {
                await dispatch('fetchProviderModels', { provider });
              }

              commit('SET_SELECTED_PROVIDER', provider);

              if (model) {
                const availableModels = state.allModels[provider] || [];
                if (availableModels.includes(model)) {
                  commit('SET_SELECTED_MODEL', model);
                }
              }

              // Ensure model is valid for this provider and sync any correction back to DB
              await dispatch('ensureValidModel');
            }
          }
        }
      } catch (error) {
        console.warn('Failed to load user settings from backend:', error);
      }
      if (serverHasNoDefault) await dispatch('applyIncludedModelDefault');
    },

    /**
     * The first-run default for a signed-in account with no provider chosen.
     *
     * 1. A subscription already usable on this machine (ChatGPT, Claude, ...)
     *    is used as-is: the user paid for it and AGNT already found it, so
     *    making them click through a connect screen to say so loses them.
     * 2. Otherwise AGNT Flash: paid plans include it, and free accounts get
     *    one-time trial credits, so a first run works before anything else is
     *    connected.
     *
     * Waits for the authoritative connection list first. Picking before it
     * arrives is how a ready ChatGPT seat lost to Flash: Flash was saved
     * while "not connected" still only meant "not loaded yet", and from then
     * on the account had a default nothing may replace.
     *
     * Only called once the server has CONFIRMED there is no default (see
     * loadUserSettings), and never overrides a selection the user made.
     */
    async applyIncludedModelDefault(context) {
      if (!_firstRunDefaultInFlight) {
        context.commit('SET_FIRST_RUN_DEFAULT_PENDING', true);
        _firstRunDefaultInFlight = applyFirstRunDefault(context).finally(() => {
          _firstRunDefaultInFlight = null;
          context.commit('SET_FIRST_RUN_DEFAULT_PENDING', false);
        });
      }
      return _firstRunDefaultInFlight;
    },

    /**
     * Make `provider` the saved default with its first model, in one write of
     * the complete pair. Returns whether it switched. Unlike selectAgntFlash
     * this is not guarded against an existing default: callers are the
     * first-run path above (already guarded) and explicit user picks.
     */
    async useProvider({ dispatch, state }, { provider, source = 'provider-pick' } = {}) {
      if (!provider) return false;
      try {
        await dispatch('fetchProviderModels', { provider });
      } catch (error) {
        console.warn(`[aiProvider] ${provider} models unavailable:`, error?.message || error);
        return false;
      }
      const models = state.allModels[provider] || [];
      const keepCurrent = state.selectedProvider === provider && models.includes(state.selectedModel);
      const model = keepCurrent ? state.selectedModel : models[0];
      if (!model) return false;
      await dispatch('setProvider', { provider, persist: false });
      await dispatch('setModel', { model, source });
      return true;
    },

    /**
     * Put an account with NO default on AGNT Flash. Returns whether it switched.
     *
     * Invariant: a saved global default is the user's, and no automatic path
     * may replace it. Only the user changes it (the pickers). An automatic
     * "provider looks disconnected" switch used to persist AGNT over a working
     * Claude-Code default on every restart (default_ai_changes source
     * 'flash-fallback'), so this refuses whenever any provider is selected.
     */
    async selectAgntFlash({ dispatch, state }, { source = 'included-default' } = {}) {
      if (state.selectedProvider) return false;
      // The provider list holds display names ('AGNT'). A literal 'agnt'
      // lookup never matched it, so this default silently never applied.
      const agntProvider = canonicalizeProviderCase(state.providers, 'agnt');
      if (!agntProvider) return false;
      try {
        await dispatch('fetchProviderModels', { provider: agntProvider });
        const models = state.allModels[agntProvider] || [];
        const model = models.includes('agnt-flash') ? 'agnt-flash' : models[0];
        if (!model) return false;
        // One write of the complete pair: the provider is staged locally, then
        // the model save carries both halves.
        await dispatch('setProvider', { provider: agntProvider, persist: false });
        await dispatch('setModel', { model, source });
        return true;
      } catch (error) {
        console.warn('AGNT Flash not selected:', error?.message || error);
        return false;
      }
    },

    // Generic function to fetch models for any provider.
    //
    // Stale-while-revalidate: if cache exists, commit it INSTANTLY for zero
    // paint latency and simultaneously fire a background network refresh.
    // If the fresh result diverges from cache, commit the update and overwrite
    // localStorage. Frontend cache is now display-only — never authoritative,
    // never blocks new-model discovery.
    //
    // forceRefresh: true — caller (RefreshModelsButton, provider reconnect)
    // awaits the network round-trip and skips the SWR early-return.
    async fetchProviderModels({ commit, state, dispatch }, { provider, forceRefresh = false } = {}) {
      if (!provider) return [];

      // Route non-built-in providers to their dedicated fetchers. Without this,
      // callers (ModelSelector, AgentForge) that pass 'Local' or a custom-provider
      // UUID hit /api/models/<id>/models, which only knows built-in keys and 400s.
      if (String(provider).toLowerCase() === 'local') {
        return dispatch('fetchLocalModels', { forceRefresh });
      }
      if (state.customProviders.some((cp) => cp.id === provider)) {
        return dispatch('fetchCustomProviderModels', provider);
      }

      if (state.loadingModels[provider] && !forceRefresh) {
        return state.allModels[provider];
      }

      const cacheKey = `${provider}_models`;
      const metaCacheKey = `${provider}_metadata`;

      // Step 1: Instant paint from cache if available. No TTL gate — cache is
      // for first-paint speed only, revalidation below always runs.
      let cachedModels = null;
      const rawCached = localStorage.getItem(cacheKey);
      if (rawCached) {
        try {
          const parsed = JSON.parse(rawCached);
          cachedModels = parsed.models;
          if (Array.isArray(cachedModels)) {
            commit('SET_PROVIDER_MODELS', { provider, models: cachedModels });
            const cachedMeta = localStorage.getItem(metaCacheKey);
            if (cachedMeta) {
              try {
                commit('SET_MODEL_METADATA', { provider, metadata: JSON.parse(cachedMeta) });
              } catch { /* ignore malformed meta */ }
            }
          }
        } catch {
          // Malformed cache — nuke it, treat as no cache
          localStorage.removeItem(cacheKey);
        }
      }

      // Step 2: revalidate. If we already painted from cache and forceRefresh
      // is false, run in background and return cached immediately. Otherwise
      // await the network.
      const providerLower = resolveProviderKey(provider);

      const revalidate = async () => {
        const token = localStorage.getItem('token');
        const isLocalProvider = providerLower === 'openai-codex' || providerLower === 'claude-code' || providerLower === 'gemini-cli' || providerLower === 'antigravity' || providerLower === 'grok-build' || providerLower === 'cursor-cli';
        if (!token && !isLocalProvider) {
          throw new Error(`Authentication required to fetch ${provider} models`);
        }

        const headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;

        const response = await fetch(`${API_CONFIG.BASE_URL}/models/${providerLower}/models`, { headers });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const models = data.models || [];
        const listing = listingFromResponse(data);
        if (listing) commit('SET_MODEL_LISTING', { provider, listing });

        // Only mutate Vuex + localStorage if the list actually changed. Prevents
        // pointless renders and lets model-selector components diff cleanly.
        const changed = !cachedModels
          || cachedModels.length !== models.length
          || JSON.stringify(cachedModels) !== JSON.stringify(models);

        if (changed) {
          commit('SET_PROVIDER_MODELS', { provider, models });
          localStorage.setItem(cacheKey, JSON.stringify({ models, timestamp: Date.now() }));
          if (cachedModels) {
            console.log(`[aiProvider] ${provider} model list changed on revalidate (${cachedModels.length} → ${models.length})`);
          }
        }

        // Metadata revalidation runs alongside models.
        try {
          const metaRes = await fetch(`${API_CONFIG.BASE_URL}/models/${providerLower}/metadata`);
          if (metaRes.ok) {
            const metaData = await metaRes.json();
            if (metaData.success && metaData.metadata) {
              commit('SET_MODEL_METADATA', { provider, metadata: metaData.metadata });
              localStorage.setItem(metaCacheKey, JSON.stringify(metaData.metadata));
            }
          }
        } catch { /* non-critical */ }

        return models;
      };

      // Fast-path: we have cache AND forceRefresh is false. Return cached
      // instantly, revalidate in background. Loading indicator not shown —
      // the user already sees a populated dropdown.
      if (cachedModels && !forceRefresh) {
        revalidate().catch((err) => {
          console.warn(`[aiProvider] Background revalidate failed for ${provider}:`, err.message);
        });
        return cachedModels;
      }

      // Slow-path: no cache OR forceRefresh. Await the network.
      commit('SET_LOADING_MODELS', { provider, loading: true });
      try {
        const models = await revalidate();
        console.log(`Fetched ${models.length} ${provider} models`);
        return models;
      } catch (error) {
        console.error(`Failed to fetch ${provider} models:`, error);
        // Last-resort fallback: any cached data is better than empty.
        if (cachedModels) return cachedModels;
        return state.allModels[provider] || [];
      } finally {
        commit('SET_LOADING_MODELS', { provider, loading: false });
      }
    },

    // Full three-layer bust (frontend localStorage + backend 60-min cache +
    // client-versions for CLI-subscription providers) followed by a fresh
    // dispatch so Vuex state ends up with the current model list. Used by the
    // RefreshModelsButton component.
    //
    // With SWR in fetchProviderModels this is now an emergency escape hatch,
    // not a routine action — normal use ships fresh models within one refresh
    // cycle without any manual button press.
    async hardRefreshProviderModels({ commit, dispatch }, { provider }) {
      if (!provider) throw new Error('provider required');
      const providerLower = resolveProviderKey(provider);
      if (!providerLower) throw new Error(`Unknown provider: ${provider}`);

      // 1. Clear frontend localStorage caches for BOTH the display-name and
      // lowercase spellings so no split-brain survives. Providers can be
      // referenced as 'OpenAI-Codex' (display) or 'openai-codex' (key) at
      // different call sites; belt-and-suspenders coverage kills that class.
      localStorage.removeItem(`${provider}_models`);
      localStorage.removeItem(`${provider}_metadata`);
      localStorage.removeItem(`${providerLower}_models`);
      localStorage.removeItem(`${providerLower}_metadata`);

      const token = localStorage.getItem('token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      // 2. Bust client-version cache for CLI-subscription providers so the
      //    subsequent /models call uses the freshest upstream CLI version.
      const CLI_KEYS = ['openai-codex', 'claude-code', 'kimi-code', 'grok-build', 'cursor-cli'];
      if (CLI_KEYS.includes(providerLower)) {
        try {
          await fetch(`${API_CONFIG.BASE_URL}/admin/client-versions/refresh`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ keys: [providerLower] }),
          });
        } catch (err) {
          console.warn(`[hardRefresh] client-version refresh failed for ${providerLower}:`, err.message);
        }
      }

      // 3. Bust the backend 60-minute in-process models cache and refetch.
      const refreshRes = await fetch(
        `${API_CONFIG.BASE_URL}/models/${providerLower}/models/refresh`,
        { method: 'POST', headers },
      );
      if (!refreshRes.ok) {
        const errBody = await refreshRes.json().catch(() => ({}));
        throw new Error(
          errBody?.error || `Backend refresh failed: HTTP ${refreshRes.status}`,
        );
      }
      const refreshed = await refreshRes.json().catch(() => ({}));
      const listing = listingFromResponse(refreshed);
      if (listing) commit('SET_MODEL_LISTING', { provider, listing });

      // 4. Re-dispatch the per-provider fetch with forceRefresh so Vuex state
      //    picks up the fresh list (frontend cache is already cleared above).
      const actionFullName = PROVIDER_FETCH_ACTIONS[provider];
      if (actionFullName) {
        const actionName = actionFullName.replace('aiProvider/', '');
        return dispatch(actionName, { forceRefresh: true });
      }
      return dispatch('fetchProviderModels', { provider, forceRefresh: true });
    },

    // Per-provider fetch actions (fetch<Name>Models, named by
    // PROVIDER_FETCH_ACTIONS) are generated below the module from
    // BUILT_IN_PROVIDERS, so a provider cannot exist without one. Hand-writing
    // them left AGNT, Antigravity, Cursor and Grok-Build without an action:
    // dispatching their name failed silently and their models never loaded.
    async refreshOpenRouterModels({ dispatch }) {
      return dispatch('fetchProviderModels', { provider: 'OpenRouter', forceRefresh: true });
    },

    async fetchLocalModels({ commit, state }, { forceRefresh = false } = {}) {
      const provider = 'Local';

      // Skip if local LLM is disabled (hosted environments)
      if (DEPLOYMENT_CONFIG.DISABLE_LOCAL_LLM) {
        console.log('Local LLM polling disabled (hosted mode)');
        return [];
      }

      // Check if already loading
      if (state.loadingModels[provider]) {
        return state.allModels[provider];
      }

      const cacheKey = `${provider}_models`;
      const cached = localStorage.getItem(cacheKey);
      if (!forceRefresh && cached) {
        try {
          const { models, timestamp } = JSON.parse(cached);
          const cacheAge = Date.now() - timestamp;
          const cacheExpiry = 5 * 60 * 1000;

          if (cacheAge < cacheExpiry) {
            commit('SET_PROVIDER_MODELS', { provider, models });
            return models;
          }
        } catch (e) {
          console.warn('Failed to parse cached Local models:', e);
        }
      }

      commit('SET_LOADING_MODELS', { provider, loading: true });

      try {
        // The backend knows every local server (LM Studio, Ollama, llama-server,
        // AGNT's own); the renderer used to ask LM Studio's port directly.
        const status = await fetchLocalStatus({ fresh: forceRefresh });
        if (!status) throw new Error('Local model status unavailable');
        const models = status.models || [];

        if (models.length === 0) {
          return state.allModels[provider] || [];
        }

        commit('SET_PROVIDER_MODELS', { provider, models });

        localStorage.setItem(
          cacheKey,
          JSON.stringify({
            models,
            timestamp: Date.now(),
          }),
        );

        console.log(`Fetched ${models.length} Local models (${status.server?.name || 'local'})`);
        return models;
      } catch (error) {
        console.error('Failed to fetch Local models:', error);

        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          try {
            const { models } = JSON.parse(cached);
            commit('SET_PROVIDER_MODELS', { provider, models });
            return models;
          } catch (e) {
            console.warn('Failed to parse expired cached Local models:', e);
          }
        }

        return state.allModels[provider] || [];
      } finally {
        commit('SET_LOADING_MODELS', { provider, loading: false });
      }
    },

    async refreshLocalModels({ dispatch }) {
      return dispatch('fetchLocalModels', { forceRefresh: true });
    },

    async setProviderWithModelFetch({ dispatch }, payload) {
      const { provider: newProvider, source } =
        typeof payload === 'object' && payload !== null ? payload : { provider: payload };
      if (newProvider === 'Local') {
        await dispatch('fetchLocalModels');
      } else {
        await dispatch('fetchProviderModels', { provider: newProvider });
      }

      await dispatch('setProvider', { provider: newProvider, source });

      // After models are loaded and provider is set, ensure model is valid and re-sync
      await dispatch('ensureValidModel');
    },

    async ensureValidModel({ commit, state }) {
      const oldModel = state.selectedModel;
      commit('ENSURE_VALID_MODEL');
      // If model changed, sync the corrected pair to the backend DB
      if (state.selectedModel !== oldModel) {
        await persistDefaultAi({ provider: state.selectedProvider, model: state.selectedModel, source: 'ensure-valid-model' });
      }
    },

    // Custom provider management actions
    fetchCustomProviders: withFreshness('aiProvider.fetchCustomProviders', async ({ commit, state }) => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication required');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/custom-providers`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch custom providers: ${response.statusText}`);
        }

        const data = await response.json();
        const providers = data.providers || [];
        commit('SET_CUSTOM_PROVIDERS', providers);

        if (state.selectedProvider) {
          const isBuiltIn = state.providers.includes(state.selectedProvider);
          const isCustom = providers.some((p) => p.id === state.selectedProvider);

          if (!isBuiltIn && !isCustom) {
            // Rescue case variants BEFORE clearing: the DB has held lowercase
            // keys ('claude-code') written back by the server from lowercased
            // turn values. That is the same provider as 'Claude-Code', and
            // clearing it handed the selection to the connected-provider
            // ladder — whose first rung is Anthropic. Canonicalize instead.
            const canonical = canonicalizeProviderCase(state.providers, state.selectedProvider);
            if (canonical) {
              commit('SET_SELECTED_PROVIDER', canonical);
            } else {
              console.warn(`Selected provider ${state.selectedProvider} no longer exists, clearing selection`);
              commit('SET_SELECTED_PROVIDER', null);
              commit('SET_SELECTED_MODEL', null);
            }
          }
        }

        return providers;
      } catch (error) {
        console.error('Error fetching custom providers:', error);
        return [];
      }
    }, {
      staleAfter: TTL.aiProviderFetchCustomProviders,
      // Custom providers are rows in the signed-in user's database. Scoping the
      // cache to the session means a sign-in as a different account cannot be
      // answered from the previous account's list.
      identity: (ctx) => authSubject(ctx.rootState?.userAuth?.token ?? null),
    }),

    async createCustomProvider({ commit }, providerData) {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication required');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/custom-providers`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(providerData),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.details || error.error || 'Failed to create custom provider');
        }

        const data = await response.json();
        commit('ADD_CUSTOM_PROVIDER', data.provider);
        return data.provider;
      } catch (error) {
        console.error('Error creating custom provider:', error);
        throw error;
      }
    },

    async updateCustomProvider({ commit }, { id, updates }) {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication required');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/custom-providers/${id}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updates),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.details || error.error || 'Failed to update custom provider');
        }

        const data = await response.json();
        commit('UPDATE_CUSTOM_PROVIDER', { id, updates: data.provider });
        return data.provider;
      } catch (error) {
        console.error('Error updating custom provider:', error);
        throw error;
      }
    },

    async deleteCustomProvider({ commit }, id) {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication required');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/custom-providers/${id}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.details || error.error || 'Failed to delete custom provider');
        }

        commit('REMOVE_CUSTOM_PROVIDER', id);
      } catch (error) {
        console.error('Error deleting custom provider:', error);
        throw error;
      }
    },

    async testCustomProviderConnection(_, { base_url, api_key }) {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication required');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/custom-providers/test`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ base_url, api_key }),
        });

        const data = await response.json();
        return data;
      } catch (error) {
        console.error('Error testing custom provider connection:', error);
        return { success: false, error: error.message };
      }
    },

    async fetchCustomProviderModels({ commit }, providerId) {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication required');
        }

        commit('SET_LOADING_MODELS', { provider: providerId, loading: true });

        const response = await fetch(`${API_CONFIG.BASE_URL}/custom-providers/${providerId}/models`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch models: ${response.statusText}`);
        }

        const data = await response.json();
        const models = data.models || [];

        commit('SET_PROVIDER_MODELS', { provider: providerId, models });
        return models;
      } catch (error) {
        console.error('Error fetching custom provider models:', error);
        return [];
      } finally {
        commit('SET_LOADING_MODELS', { provider: providerId, loading: false });
      }
    },
  },
};

// One fetch<Name>Models per built-in provider, delegating to the generic
// fetcher. Local keeps its hand-written action (it talks to LM Studio
// directly), so a hand-written action always wins over a generated one.
for (const [displayName, actionFullName] of Object.entries(PROVIDER_FETCH_ACTIONS)) {
  const actionName = actionFullName.replace('aiProvider/', '');
  if (aiProviderModule.actions[actionName]) continue;
  aiProviderModule.actions[actionName] = ({ dispatch }, { forceRefresh = false } = {}) =>
    dispatch('fetchProviderModels', { provider: displayName, forceRefresh });
}

export default aiProviderModule;
