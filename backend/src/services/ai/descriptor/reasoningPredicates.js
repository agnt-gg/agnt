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
// Matches the whole 4-N family so Opus 4.9 / 4.10 / … are picked up on release
// rather than requiring an edit in (previously) seven places.
// The trailing (?:-|$) avoids matching legacy date-suffixed 4-0/4-5 ids such as
// `claude-opus-4-20250514`, where `2025…` would otherwise satisfy the
// multi-digit branch.
export const ANTHROPIC_VERSIONED_REASONING_RE = /^claude-(opus|sonnet)-4-([6-9]|[1-9]\d{1,2})(?:-|$)/;
export const ANTHROPIC_FAMILY_REASONING_RE = /^claude-(fable|mythos)-/;
export const ANTHROPIC_XHIGH_RE = /^claude-(opus-4-([7-9]|[1-9]\d{1,2})(?:-|$)|fable-|mythos-)/;

export function isAnthropicReasoningModel(modelId) {
  const m = lc(modelId);
  return ANTHROPIC_VERSIONED_REASONING_RE.test(m) || ANTHROPIC_FAMILY_REASONING_RE.test(m);
}

export function anthropicSupportsXHigh(modelId) {
  return ANTHROPIC_XHIGH_RE.test(lc(modelId));
}

/** Anthropic models driven by `thinking: { type: 'adaptive' }`. */
export function isAnthropicAdaptiveThinkingModel(modelId) {
  return isAnthropicReasoningModel(modelId);
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
export function supportsDeepSeekThinkingToggle(modelId) {
  const m = lc(modelId);
  return m === 'deepseek-chat' || m === 'deepseek-reasoner' || m.startsWith('deepseek-v4-');
}

// ── Groq ────────────────────────────────────────────────────────────────────
// startsWith, deliberately. Groq's model list is fetched live from the vendor,
// so an exact-id match is wrong the moment they publish a new size — which is
// exactly how the adapter copy drifted.
export function isGroqGptOssReasoningModel(modelId) {
  return lc(modelId).startsWith('openai/gpt-oss-');
}

export function isGroqQwenReasoningModel(modelId) {
  return lc(modelId).startsWith('qwen/qwen3-');
}

// ── Cerebras ────────────────────────────────────────────────────────────────
export function isCerebrasGptOssReasoningModel(modelId) {
  return lc(modelId) === 'gpt-oss-120b';
}

export function isCerebrasGlmReasoningModel(modelId) {
  return lc(modelId) === 'zai-glm-4.7';
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
