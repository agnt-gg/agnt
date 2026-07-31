/**
 * The one place estimated tokens become displayed tokens.
 *
 * WHY THIS EXISTS
 * ---------------
 * AGNT's token counts are estimates; `calibration` is the ratio between what
 * it estimates and what the provider actually bills, learned per
 * (provider, model) from real usage reports. The panel has to show the
 * calibrated number — a user once watched "62%" while Anthropic counted 100%
 * and rejected the request.
 *
 * That conversion used to happen in the backend, PER CONSUMER. The
 * `context_status` event was scaled; the `context_manifest` event was not;
 * `buildEconomics` received scaled bucket totals while `priceItems` priced raw
 * per-item tokens at the same rate. Every one of those decisions was locally
 * reasonable and the result was a single panel rendering "System 37.6k" beside
 * an inventory whose own sections summed to 24.9k, with a "recurring drivers"
 * table understating the floor cost directly above it by exactly 1.5x.
 *
 * A unit conversion applied in N places will disagree N ways. So the backend
 * now emits ONE unit (raw) plus the factor, and this module converts once, on
 * ingest, before anything renders. Components never see the factor and cannot
 * apply it a second time.
 *
 * IDEMPOTENCE IS THE SAFETY PROPERTY. Payloads are replayed on SSE reconnect
 * and restored from localStorage across reloads, so "convert exactly once" has
 * to survive being called again on its own output. It does: conversion is
 * gated on `unit === 'raw'` and stamps `unit: 'calibrated'`. Payloads written
 * before this change carry no `unit` at all and were already calibrated, so
 * they are left alone — the migration is a no-op in both directions.
 */

export const TOKEN_UNIT_RAW = 'raw';
export const TOKEN_UNIT_CALIBRATED = 'calibrated';

/**
 * Token counts render as integers, so they are rounded here rather than left
 * as floats for a formatter that would print "206.59599999999998" for anything
 * under 1k. Per-item rounding can leave a group total a token or two off the
 * sum of its rounded parts; both are honest roundings of the same underlying
 * float, and the panel's own resolution (0.1k) is three orders of magnitude
 * coarser than the discrepancy.
 */
function scaleTokens(value, factor) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * factor) : value;
}

/** Money and percentages must NOT be rounded — $0.0042 would become $0. */
function scaleExact(value, factor) {
  return typeof value === 'number' && Number.isFinite(value) ? value * factor : value;
}

/**
 * @returns {number|null} the factor to apply, or null when this payload must
 *          be left exactly as it is.
 */
function conversionFactor(payload) {
  if (!payload || typeof payload !== 'object') return null;
  // Anything not explicitly marked raw is already in display units.
  if (payload.unit !== TOKEN_UNIT_RAW) return null;
  const factor = Number(payload.calibration);
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

/**
 * Convert a `context_status` payload to display units.
 *
 * Scaled: everything derived from the text estimator.
 * NOT scaled, deliberately:
 *   - `tokenLimit`      the model's real context window, not an estimate
 *   - `outputBufferTokens` a fixed reserve held back for the reply
 *   - `calibration` / `residualDrift`  ratios, not quantities
 *   - `messagesCount` / `round`        counts
 *
 * The field list is an explicit allow-list rather than a recursive walk: a
 * blanket "multiply every number" would silently corrupt the two ratios above
 * the moment either moved, and a ratio scaled by itself is a plausible-looking
 * wrong answer instead of an obvious one.
 *
 * @returns {object} a new payload; the input is never mutated.
 */
export function calibrateContextStatus(status) {
  const factor = conversionFactor(status);
  if (factor === null) return status;

  const out = {
    ...status,
    unit: TOKEN_UNIT_CALIBRATED,
    currentTokens: scaleTokens(status.currentTokens, factor),
    utilizationPercent: scaleExact(status.utilizationPercent, factor),
  };

  if (status.breakdown && typeof status.breakdown === 'object') {
    const b = status.breakdown;
    out.breakdown = {
      ...b,
      systemTokens: scaleTokens(b.systemTokens, factor),
      toolTokens: scaleTokens(b.toolTokens, factor),
      messagesTokens: scaleTokens(b.messagesTokens, factor),
      totalRequestTokens: scaleTokens(b.totalRequestTokens, factor),
    };
  }

  return out;
}

/**
 * Price a scaled token count.
 *
 * Costs are re-derived from the DISPLAYED token count rather than scaled
 * independently, so that every row on screen multiplies out: "206 tokens at
 * this model's rate" is exactly the dollar figure beside it. Scaling the cost
 * separately would price the unrounded 206.596 and leave the two visible
 * numbers quietly inconsistent — a smaller version of the very defect this
 * module exists to remove.
 *
 * Falls back to scaling the original cost when the payload carries no rate
 * (an unpriceable model has no `economics` block at all, so this is belt and
 * braces rather than a live path).
 */
function priceScaled(tokens, rate, originalCost, factor) {
  if (originalCost === undefined || originalCost === null) return originalCost;
  if (rate != null && typeof tokens === 'number' && Number.isFinite(tokens)) return tokens * rate;
  return scaleExact(originalCost, factor);
}

/** Scale the `{ tokens, cost }` line items the manifest itemizes. */
function calibrateItems(items, factor, rate) {
  if (!Array.isArray(items)) return items;
  return items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const tokens = scaleTokens(item.tokens, factor);
    const out = { ...item, tokens };
    if ('cost' in item) out.cost = priceScaled(tokens, rate, item.cost, factor);
    return out;
  });
}

/**
 * Convert a `context_manifest` payload to display units.
 *
 * Costs scale with the same factor as the tokens they are priced from: the
 * per-token `rate` is a real price and stays untouched, so scaling the token
 * count is exactly what makes the money right.
 *
 * @returns {object} a new payload; the input is never mutated.
 */
export function calibrateManifest(manifest) {
  const factor = conversionFactor(manifest);
  if (factor === null) return manifest;

  const out = { ...manifest, unit: TOKEN_UNIT_CALIBRATED };

  // Real prices, in dollars per token. Never scaled — they are what makes the
  // scaled token counts into money.
  const rate = Number.isFinite(manifest.economics?.rate) ? manifest.economics.rate : null;
  const cachedRate = Number.isFinite(manifest.economics?.cachedRate) ? manifest.economics.cachedRate : null;

  if (manifest.system && typeof manifest.system === 'object') {
    out.system = {
      ...manifest.system,
      total: scaleTokens(manifest.system.total, factor),
      sections: calibrateItems(manifest.system.sections, factor, rate),
    };
  }

  if (manifest.tools && typeof manifest.tools === 'object') {
    out.tools = {
      ...manifest.tools,
      total: scaleTokens(manifest.tools.total, factor),
      items: calibrateItems(manifest.tools.items, factor, rate),
      // count / registryTotal / hiddenCount / droppedCount / deniedCount are
      // counts of tools, not tokens.
    };
  }

  if (manifest.messages && typeof manifest.messages === 'object') {
    out.messages = {
      ...manifest.messages,
      total: scaleTokens(manifest.messages.total, factor),
      reduction: scaleTokens(manifest.messages.reduction, factor),
    };
  }

  if (manifest.economics && typeof manifest.economics === 'object') {
    const e = manifest.economics;
    const floorTokens = scaleTokens(e.floorTokens, factor);
    out.economics = {
      ...e,
      // `rate` and `cachedRate` are dollars-per-token — real prices, untouched.
      floorTokens,
      systemTokens: scaleTokens(e.systemTokens, factor),
      toolTokens: scaleTokens(e.toolTokens, factor),
      floorCost: priceScaled(floorTokens, rate, e.floorCost, factor),
      // Stays null when the provider has no cached rate — "no claim" is not $0.
      floorCostCached: priceScaled(floorTokens, cachedRate, e.floorCostCached, factor),
    };
  }

  return out;
}
