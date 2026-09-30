/**
 * The context window of a model, from the metadata the backend publishes for
 * the provider's LIVE list (GET /api/models/:provider/metadata, loaded into the
 * aiProvider store alongside the models).
 *
 * This replaces a 40-entry map hand-copied from the backend into Chat.vue. It
 * covered no current model on several providers, so the context meter rendered
 * with no ceiling, and its prefix matching gave `k3-256k` the 1M window of
 * `k3`. The backend's per-model data covers every listed model (verified
 * 2026-09-30: 13/13 Anthropic, 12/12 Groq, 464/464 OpenRouter).
 *
 * Returns 0 when unknown, which the meter renders as "unknown" rather than as
 * a wrong limit.
 */

// A dated or aliased build of a model is the same model: claude-x-20260101,
// claude-x@20260101, gpt-x-2026-01-01, x-latest. A different SIZE or TIER
// (k3 vs k3-256k, flash vs flash-lite) is not, so only these suffixes may fall
// back to the base id.
const VERSION_SUFFIX = /^[-@](?:\d{6,8}|\d{4}-\d{2}-\d{2}|latest|default)$/;

export function contextWindowFromMetadata(metadataByProvider, provider, model) {
  if (!provider || !model) return 0;
  const byModel = metadataByProvider?.[provider];
  if (!byModel || typeof byModel !== 'object') return 0;

  const exact = Number(byModel[model]?.contextWindow);
  if (Number.isFinite(exact) && exact > 0) return exact;

  let best = 0;
  let bestLength = 0;
  for (const [id, meta] of Object.entries(byModel)) {
    if (!model.startsWith(id) || !VERSION_SUFFIX.test(model.slice(id.length))) continue;
    const window = Number(meta?.contextWindow);
    if (Number.isFinite(window) && window > 0 && id.length > bestLength) {
      best = window;
      bestLength = id.length;
    }
  }
  return best;
}
