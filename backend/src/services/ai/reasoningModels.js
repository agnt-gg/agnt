/**
 * Centralized reasoning-capability detection for Anthropic Claude models.
 *
 * Previously each call site hardcoded `startsWith('claude-opus-4-7')` /
 * `claude-opus-4-8`, which meant every new model release required ~7 edits
 * across backend + frontend. These regexes match the whole 4-N family so
 * Opus 4.9 / 4.10 / etc. get picked up automatically.
 *
 * NOTE: The frontend has a mirrored copy of these regexes in
 *   frontend/src/store/app/aiProvider.js
 * They must stay in sync. If you change a pattern here, update there too.
 */

// Anthropic Claude models that support extended thinking with effort controls.
//   - claude-opus-4-6, 4-7, 4-8, 4-9, 4-10, ...
//   - claude-sonnet-4-6+
// Trailing (?:-|$) avoids matching legacy date-suffixed 4-0/4-5 (e.g.
// `claude-opus-4-20250514`, where `2025...` would otherwise sneak in via
// the multi-digit branch).
const ANTHROPIC_VERSIONED_REASONING_RE = /^claude-(opus|sonnet)-4-([6-9]|[1-9]\d{1,2})(?:-|$)/;

// Family-stem models with always-on adaptive thinking (Fable / Mythos line).
const ANTHROPIC_FAMILY_REASONING_RE = /^claude-(fable|mythos)-/;

// Models that expose the xhigh ("Max") effort tier.
// Opus 4.7+ and all Fable / Mythos variants.
const ANTHROPIC_XHIGH_RE = /^claude-(opus-4-([7-9]|[1-9]\d{1,2})(?:-|$)|fable-|mythos-)/;

export function isAnthropicReasoningModel(modelId) {
  const m = String(modelId || '').toLowerCase();
  return ANTHROPIC_VERSIONED_REASONING_RE.test(m) || ANTHROPIC_FAMILY_REASONING_RE.test(m);
}

export function isOpenRouterAnthropicReasoningModel(modelId) {
  const m = String(modelId || '').toLowerCase();
  if (!m.startsWith('anthropic/')) return false;
  return isAnthropicReasoningModel(m.slice('anthropic/'.length));
}

export function anthropicSupportsXHigh(modelId) {
  return ANTHROPIC_XHIGH_RE.test(String(modelId || '').toLowerCase());
}
