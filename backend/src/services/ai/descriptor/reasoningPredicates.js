/**
 * SHARED PROVIDER DESCRIPTOR — reasoning capability predicates.
 *
 * ============================================================================
 * THIS FILE MUST STAY ISOMORPHIC. No `fs`, no `path`, no `process`, no SDK,
 * no import of anything that reaches them. It is bundled into the browser by
 * Vite (alias `@llm`) AND imported by the Node backend.
 * Enforced by descriptor.purity.test.js.
 * ============================================================================
 *
 * WHY THIS FILE EXISTS
 *
 * "Is this a reasoning model?" was answered in three places that could not see
 * each other:
 *
 *   backend/services/ai/providerConfigs.js   -> decided what the UI is TOLD
 *   backend/services/orchestrator/llmAdapters.js -> decided what the WIRE carries
 *   frontend/store/app/aiProvider.js         -> decided what the UI DRAWS
 *
 * Two of them had already drifted. For Groq, providerConfigs matched
 * startsWith('openai/gpt-oss-') while llmAdapters matched three exact ids, so a
 * newly listed model in the gap rendered a reasoning toggle that silently sent
 * nothing — the user pays for the request and nothing changes. Nobody notices,
 * because a capability that does nothing looks identical to a model that does
 * not support it.
 *
 * The frontend copy even carried the comment "MIRROR of
 * backend/src/services/ai/reasoningModels.js — keep regexes in sync", which is
 * a maintenance instruction where a shared module belongs.
 *
 * The reason the third copy existed is structural, not sloppiness: the frontend
 * cannot import backend modules, because there is no npm workspace. This file
 * resolves that WITHOUT touching packaging: it lives under backend/src (already
 * shipped by electron-builder) and the frontend reaches it through a Vite alias,
 * so the browser bundle inlines it at build time. No new package, no new
 * build artifact, no change to what gets shipped.
 *
 * INVARIANT I1 — declare once, consume twice. A model-matching rule is written
 * here and nowhere else. UI and transport both read it.
 */

const lc = (v) => String(v || '').toLowerCase();

// ── Anthropic ───────────────────────────────────────────────────────────────
// The AUTHORITATIVE answer is the vendor's own catalog: Anthropic's /v1/models
// publishes capabilities.effort.<level>.supported and
// capabilities.thinking.types.<type>.supported per model, and
// registerDynamicPricingFromModels records it. Everything below is the
// FALLBACK for when that catalog has not been fetched yet (cold start, offline,
// the browser before metadata arrives).
//
// It is a GENERATION rule, for the same reason as OpenAI's below. The regex it
// replaced was /^claude-(opus|sonnet)-4-…/ — a prediction that Claude 5 would
// never ship. It shipped, and claude-opus-5 / claude-sonnet-5 / -5-5 lost their
// reasoning selector AND had every effort the user picked silently dropped on
// the wire, because the transport asks the same question.
//
// Facts encoded (platform.claude.com/docs build-with-claude/effort + /thinking,
// read 2026-10):
//   adaptive effort  Opus/Sonnet >= 4.6, every Fable/Mythos. (Opus 4.5 takes
//                    effort only alongside budget_tokens and rejects
//                    `adaptive`, so it stays out.)
//   max              every model above.
//   xhigh            Opus >= 4.7, Sonnet >= 5, versioned Fable/Mythos (not
//                    Mythos Preview).
//   thinking off     Opus/Sonnet below 5.5 only. Opus 5.5, Sonnet 5.5 and all
//                    Fable/Mythos answer `thinking: disabled` with HTTP 400.
//                    Off is withheld for anything newer: an option that is
//                    missing until the catalog loads is recoverable; one that
//                    fails every request is not.

// `(?=-|$)` after an optional 1-2 digit minor keeps legacy date-suffixed ids
// (claude-opus-4-20250514) parsing as 4.0 rather than 4.20250514.
const ANTHROPIC_MODEL_RE = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?=-|$)/;
const ANTHROPIC_UNVERSIONED_RE = /^claude-(fable|mythos)-[a-z]/; // claude-mythos-preview

/** `{ line, major, minor }`, `{ line, major: null }` for named previews, or null. */
export function parseAnthropicModelId(modelId) {
  const m = lc(modelId);
  const versioned = ANTHROPIC_MODEL_RE.exec(m);
  if (versioned) {
    return { line: versioned[1], major: Number(versioned[2]), minor: Number(versioned[3] || 0) };
  }
  const unversioned = ANTHROPIC_UNVERSIONED_RE.exec(m);
  return unversioned ? { line: unversioned[1], major: null, minor: 0 } : null;
}

const versionAtLeast = (parsed, major, minor) =>
  parsed.major > major || (parsed.major === major && parsed.minor >= minor);

/**
 * Effort levels this Anthropic model accepts under adaptive thinking, in the
 * same vocabulary as a published catalog: `none` present means thinking may be
 * turned off. Null when the model has no adaptive-effort control.
 */
export function anthropicReasoningEfforts(modelId) {
  const parsed = parseAnthropicModelId(modelId);
  if (!parsed) return null;

  const { line } = parsed;
  const alwaysThinking = line === 'fable' || line === 'mythos';
  if (!alwaysThinking && !(line === 'opus' || line === 'sonnet')) return null;
  if (!alwaysThinking && !versionAtLeast(parsed, 4, 6)) return null;

  const efforts = ['low', 'medium', 'high', 'max'];
  const xhigh = alwaysThinking
    ? parsed.major !== null
    : line === 'opus'
      ? versionAtLeast(parsed, 4, 7)
      : versionAtLeast(parsed, 5, 0);
  if (xhigh) efforts.push('xhigh');
  if (!alwaysThinking && !versionAtLeast(parsed, 5, 5)) efforts.push('none');
  return efforts;
}

export function isAnthropicReasoningModel(modelId) {
  return anthropicReasoningEfforts(modelId) !== null;
}

export function anthropicSupportsXHigh(modelId) {
  return anthropicReasoningEfforts(modelId)?.includes('xhigh') === true;
}

/** Anthropic models driven by `thinking: { type: 'adaptive' }`. */
export function isAnthropicAdaptiveThinkingModel(modelId) {
  return isAnthropicReasoningModel(modelId);
}

// ── Effort list -> selector options ─────────────────────────────────────────
// One builder for every effort list, published or derived, so the browser and
// the backend cannot label or order the same list differently.

/**
 * Canonical weakest-to-strongest order. Catalogs list efforts strongest-first
 * and inconsistently; a selector has to read one way every time. `none` is not
 * a grade, it is the off switch, and is handled separately.
 */
export const EFFORT_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

const EFFORT_LABELS = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Very High',
  max: 'Max',
};

/**
 * Selector options for an effort list (`none` = may be turned off), or null
 * when the list grades nothing. Every option offered is one the list names, so
 * the UI can never render a choice the endpoint rejects.
 */
export function effortOptionsFromList(efforts) {
  if (!Array.isArray(efforts) || !efforts.length) return null;
  const available = new Set(efforts.map(lc));
  const graded = EFFORT_ORDER.filter((e) => available.has(e));
  if (!graded.length) return null;

  const options = [{ value: 'default', label: 'Default' }];
  if (available.has('none')) options.push({ value: 'off', label: 'Off' });
  for (const effort of graded) {
    options.push({
      value: effort,
      // Hand-written lists label `xhigh` "Max" where it is the ceiling; once a
      // real `max` exists that name belongs to it.
      label: effort === 'xhigh' && !available.has('max') ? 'Max' : EFFORT_LABELS[effort],
    });
  }
  return options;
}

// ── OpenAI ──────────────────────────────────────────────────────────────────
// OpenAI encodes the generation in the model id, and every gate that meant
// "modern OpenAI" was written as startsWith('gpt-5'). A prefix test like that
// is also a prediction that GPT-6 will never ship. It shipped: `gpt-6-astra`
// failed the openai-codex dispatch gate in llmAdapters, so the adapter refused
// to construct at all and every request was silently demoted to the failover
// provider — the user picks Astra in settings and quietly gets something else.
//
// These are GENERATION tests. The `(?:[.\-]|$)` tail means only a version
// separator or end-of-string may follow the generation digit, which keeps
// gpt-4o, gpt-4.1 and gpt-image out while admitting gpt-6, gpt-6-astra,
// gpt-7.2 and (via \d{2,}) gpt-10 without another edit.
//
// Two boundaries, because they answer different questions:
//   GEN5+  — does this speak the Responses API at all?
//   GEN6+  — does it use the modern reasoning-effort contract? The original
//            un-decimalled gpt-5 uses the legacy 'minimal' set, so it must
//            NOT be swept into the modern branch.
export const OPENAI_GEN5_OR_LATER_RE = /^gpt-(?:[5-9]|\d{2,})(?:[.\-]|$)/;
export const OPENAI_GEN6_OR_LATER_RE = /^gpt-(?:[6-9]|\d{2,})(?:[.\-]|$)/;

export function isOpenAIGen5OrLater(modelId) {
  return OPENAI_GEN5_OR_LATER_RE.test(lc(modelId));
}

export function isOpenAIGen6OrLater(modelId) {
  return OPENAI_GEN6_OR_LATER_RE.test(lc(modelId));
}

export function isOpenAIResponsesReasoningModel(modelId) {
  const m = lc(modelId);
  return isOpenAIGen5OrLater(m) || /^o\d/.test(m);
}

// ── Gemini ──────────────────────────────────────────────────────────────────
export function isGemini3ReasoningModel(modelId) {
  return lc(modelId).startsWith('gemini-3');
}

export function isGemini25ReasoningModel(modelId) {
  return lc(modelId).startsWith('gemini-2.5');
}

// ── DeepSeek ────────────────────────────────────────────────────────────────
// Family-wide, deliberately. Every model DeepSeek's API serves takes the same
// `thinking` toggle and `reasoning_effort` (api-docs.deepseek.com/guides/
// thinking_mode, 2026-09-30). The exact-id list this replaced named
// deepseek-chat / deepseek-reasoner / deepseek-v4-*, so deepseek-flash — the
// model DeepSeek now leads with — got no reasoning control at all.
export function supportsDeepSeekThinkingToggle(modelId) {
  // DeepSeek's own ids only: other hosts' 'deepseek-ai/...' slugs are not
  // DeepSeek's API and do not take its thinking parameter.
  return /^deepseek-[^/]+$/.test(lc(modelId));
}

// ── Groq ────────────────────────────────────────────────────────────────────
// startsWith, deliberately. Groq's model list is fetched live from the vendor,
// so an exact-id match is wrong the moment they publish a new size — which is
// exactly how the adapter copy drifted.
export function isGroqGptOssReasoningModel(modelId) {
  return lc(modelId).startsWith('openai/gpt-oss-');
}

// Matches qwen3-* and qwen3.x-*: Groq's current Qwen is qwen/qwen3.8-27b, which
// takes reasoning_effort none/default (console.groq.com/docs/reasoning), and
// the old 'qwen/qwen3-' prefix gave it no control at all.
export function isGroqQwenReasoningModel(modelId) {
  return /^qwen\/qwen3[-.]/.test(lc(modelId));
}

// ── Cerebras ────────────────────────────────────────────────────────────────
// Family prefixes, like Groq above: Cerebras's list is live and turns over
// (2026-09-30 it serves gpt-oss-120b and qwen-3.8-27b; zai-glm-4.7 is gone).
export function isCerebrasGptOssReasoningModel(modelId) {
  return lc(modelId).startsWith('gpt-oss-');
}

export function isCerebrasGlmReasoningModel(modelId) {
  return lc(modelId).startsWith('zai-glm-');
}

// Reasoning on by default; `reasoning_effort: 'none'` turns it off
// (inference-docs.cerebras.ai/models/qwen-3.8-27b). Same control as GLM.
export function isCerebrasQwenReasoningModel(modelId) {
  return lc(modelId).startsWith('qwen-3');
}

// ── Z.AI ────────────────────────────────────────────────────────────────────
// GLM-5.2 moved from the enabled/disabled thinking toggle to an
// OpenAI-compatible `reasoning_effort` accepting only `high` (default) and
// `max` (docs.z.ai/guides/llm/glm-5.2). Matches the bare id and the `[1m]`
// long-context variant.
export function supportsZaiReasoningEffort(modelId) {
  return lc(modelId).startsWith('glm-5.2');
}

export function supportsZaiThinkingToggle(modelId) {
  const m = lc(modelId);
  // GLM-5.2 must fall through to the effort branch, not the legacy toggle.
  if (supportsZaiReasoningEffort(modelId)) return false;
  return m.startsWith('glm-5') || m.startsWith('glm-4.7') || m.startsWith('glm-4.6') || m.startsWith('glm-4.5');
}

// ── Kimi / Moonshot ─────────────────────────────────────────────────────────
export function supportsKimiReasoningToggle(providerKey, modelId) {
  const p = lc(providerKey);
  const m = lc(modelId);
  if (p === 'kimi-code') return m === 'kimi-for-coding';
  return m.startsWith('kimi-k2') && !m.includes('thinking');
}

// ── OpenRouter (routes by the vendor named in the slug) ─────────────────────
// Delegates to the direct-OpenAI predicate rather than repeating the family
// rule with a vendor prefix glued on — that duplication is why the same
// gpt-6 gap would otherwise have to be fixed twice.
export function isOpenRouterOpenAIReasoningModel(modelId) {
  const m = lc(modelId);
  if (!m.startsWith('openai/')) return false;
  return isOpenAIResponsesReasoningModel(m.slice('openai/'.length));
}

// Intentionally broader than isAnthropicReasoningModel: OpenRouter exposes
// reasoning on the whole 4.x line and on 3.7, which the direct-Anthropic
// predicate deliberately excludes.
export function isOpenRouterAnthropicReasoningModel(modelId) {
  const m = lc(modelId);
  return (
    m.startsWith('anthropic/claude-opus-4') ||
    m.startsWith('anthropic/claude-sonnet-4') ||
    m.startsWith('anthropic/claude-3.7')
  );
}

export function isOpenRouterGeminiReasoningModel(modelId) {
  const m = lc(modelId);
  return m.startsWith('google/gemini-3') || m.startsWith('google/gemini-2.5');
}

export function isOpenRouterXaiReasoningModel(modelId) {
  const m = lc(modelId);
  return m.startsWith('x-ai/') || m.startsWith('xai/');
}

// ── TogetherAI ──────────────────────────────────────────────────────────────
export function isTogetherGptOssReasoningModel(modelId) {
  return lc(modelId).startsWith('openai/gpt-oss-');
}

// ── Chutes (TEE-hosted upstreams; routes by underlying family) ──────────────
export function isChutesKimiReasoningModel(modelId) {
  return /^moonshotai\/kimi-k2/i.test(String(modelId || ''));
}

export function isChutesGlmReasoningModel(modelId) {
  return /^zai-org\/glm-5/i.test(String(modelId || ''));
}

export function isChutesQwenReasoningModel(modelId) {
  return /^qwen\/qwen3/i.test(String(modelId || ''));
}

// ── Shared value helpers (UI and transport must agree on these too) ─────────
export function normalizeReasoningValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : 'default';
}

export function isReasoningEnabledValue(value) {
  const v = normalizeReasoningValue(value);
  return v !== 'default' && v !== 'off' && v !== 'none';
}
