/**
 * googleModelCatalog.js — turns Google's live subscription-gateway payloads
 * into the model lists AGNT offers. Pure functions only: no I/O, no auth.
 *
 * WHY THIS EXISTS
 * Antigravity and Gemini CLI (OAuth) have no public `/models` endpoint, so
 * their lists used to be hand-maintained arrays that went stale the day Google
 * shipped a model. Both gateways DO publish the account's live catalog — just
 * in private shapes — so the list is derived from those payloads instead:
 *
 *   Antigravity  POST {gateway}:fetchAvailableModels  → { models, agentModelSorts, tieredModelIds, ... }
 *   Gemini CLI   POST {codeAssist}:retrieveUserQuota  → { buckets: [{ modelId, remainingFraction, ... }] }
 *
 * Nothing in here names a model. If a rule below needs a model id to work,
 * the rule is wrong.
 */

/**
 * Which Antigravity models to offer for chat, derived from the payload alone.
 *
 * The raw `models` map is NOT the answer: verified live 2026-09-30 it holds 27
 * entries, including autocomplete/tab models that reject generateContent,
 * retired ids that still answer with a canned "no longer available" message
 * and carry no flag saying so, and old ids aliased onto newer models under a
 * duplicate display name. No per-model field separates those from real models.
 *
 * So this mirrors Google's own model picker, which is the one signal Google
 * keeps current:
 *   1. `agentModelSorts` — the "Recommended" list the Antigravity IDE shows.
 *   2. `tieredModelIds`  — Google's pointers to the CURRENT flash / pro /
 *      flash-lite. This is how a new generation (gemini-3.8-flash-tiered on
 *      2026-09-30) appears before it is promoted into the sort.
 * then drops anything Google marks deprecated, internal, tab-only, or out of
 * quota.
 *
 * @param {object} payload fetchAvailableModels response body
 * @returns {Array<{id,name,maxTokens,maxOutputTokens,supportsImages,supportsThinking,quotaRemaining,quotaResetTime}>}
 */
export function selectAntigravityChatModels(payload) {
  const models = payload?.models || {};
  const deprecated = new Set(Object.keys(payload?.deprecatedModelIds || {}));
  const tabOnly = new Set(payload?.tabModelIds || []);

  const orderedIds = [];
  const add = (id) => {
    if (typeof id === 'string' && id && !orderedIds.includes(id)) orderedIds.push(id);
  };
  for (const sort of payload?.agentModelSorts || []) {
    for (const group of sort?.groups || []) {
      for (const id of group?.modelIds || []) add(id);
    }
  }
  for (const ids of Object.values(payload?.tieredModelIds || {})) {
    for (const id of Array.isArray(ids) ? ids : []) add(id);
  }

  return orderedIds
    .filter((id) => {
      const model = models[id];
      return model
        && !deprecated.has(id)
        && !tabOnly.has(id)
        && model.isInternal !== true
        && model.quotaInfo?.isExhausted !== true;
    })
    .map((id) => {
      const model = models[id];
      return {
        id,
        name: model.displayName || humanizeModelId(id),
        maxTokens: model.maxTokens ?? null,
        maxOutputTokens: model.maxOutputTokens ?? null,
        supportsImages: model.supportsImages ?? false,
        supportsThinking: model.supportsThinking ?? false,
        quotaRemaining: model.quotaInfo?.remainingFraction ?? null,
        quotaResetTime: model.quotaInfo?.resetTime ?? null,
      };
    });
}

/**
 * Remaining-quota fractions for the selected models, for the soft-floor
 * cooldown check. Unknown quota is omitted rather than treated as zero.
 */
export function antigravityQuotaFractions(selectedModels) {
  return (selectedModels || [])
    .map((m) => m.quotaRemaining)
    .filter((f) => typeof f === 'number' && Number.isFinite(f));
}

/**
 * Shape selected Antigravity models for registerDynamicPricingFromModels, so a
 * model discovered at runtime gets Google's real context window and
 * capabilities instead of an inferred default. Antigravity is
 * subscription-included, hence zero per-token cost.
 */
export function antigravityMetadataRecords(selectedModels) {
  return (selectedModels || []).map((m) => ({
    id: m.id,
    contextWindow: m.maxTokens ?? undefined,
    maxOutputLength: m.maxOutputTokens ?? undefined,
    supportsVision: m.supportsImages,
    reasoning: m.supportsThinking,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
  }));
}

/**
 * Model ids the account is entitled to on Gemini Code Assist, from
 * retrieveUserQuota. Google's own CLI types this as
 * `{ buckets?: [{ modelId?, remainingFraction?, resetTime?, tokenType? }] }`
 * (packages/core/src/code_assist/types.ts); one model can have several
 * buckets (one per token type), so ids are de-duplicated in first-seen order.
 */
export function parseGeminiCliQuotaModels(payload) {
  const ids = [];
  for (const bucket of payload?.buckets || []) {
    const id = typeof bucket?.modelId === 'string' ? bucket.modelId.trim().replace(/^models\//, '') : '';
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Classify a Code Assist error. `unlicensed` means the account has no Code
 * Assist entitlement at all — every generateContent will 403 too — which is a
 * permanent state, not a transient failure to paper over with a static list.
 * Google reports it as HTTP 403 "You do not have a valid license of this
 * product ... (#3501)" (verified live 2026-09-30 on a consumer account).
 */
export function classifyCodeAssistError(error) {
  const status = error?.response?.status ?? null;
  const body = error?.response?.data?.error || {};
  const message = String(body.message || error?.message || '');
  const unlicensed = status === 403
    && (/valid license/i.test(message) || /#3501/.test(message) || body.status === 'PERMISSION_DENIED');
  return { status, unlicensed, message: message.slice(0, 300) };
}

/** "gemini-3.8-flash-tiered" → "Gemini 3.8 Flash". Only used when Google sends no displayName. */
export function humanizeModelId(id) {
  return String(id || '')
    .replace(/-tiered$/, '')
    .split('-')
    .filter(Boolean)
    .map((word) => (/^[a-z]/.test(word) ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}
