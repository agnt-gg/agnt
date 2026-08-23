import db from '../../models/database/index.js';
import {
  setDynamicPricingPersistence,
  hydrateDynamicPricing,
  registerDynamicPricingFromModels,
} from './providerConfigs.js';

/**
 * Durability + boot hydration for the dynamic model-metadata cache (PRD-122).
 *
 * providerConfigs has always been able to LEARN prices at runtime —
 * ModelRoutes feeds registerDynamicPricingFromModels whenever a provider's
 * model list is fetched, and catalogs like OpenRouter include per-model
 * pricing in that response. What it could not do was REMEMBER: the cache was
 * process-local memory, so a restart forgot every price ever seen, the
 * workflow process never saw what the API process learned, and the boot-time
 * repricer — which runs before any client opens a model picker — always found
 * it empty.
 *
 * This module closes that loop with the smallest possible surface:
 *
 *   init()  — hydrate the in-memory cache from model_metadata_cache, then
 *             attach a write-through hook so everything learned from now on
 *             is persisted. Called once per process, right after dbReady.
 *   syncPublicModelCatalog() — fetch OpenRouter's public catalog (no auth)
 *             through the SAME registerDynamicPricingFromModels path the
 *             picker uses. One catalog covers x-ai, moonshotai, deepseek,
 *             z-ai, qwen, google and more, so a brand-new model prices itself
 *             the day the catalog lists it — no code change, no table edit.
 *
 * Everything here is fail-soft. Pricing metadata is an enrichment: a failed
 * fetch or a broken row must never block boot, a model fetch, or a turn.
 */

const dbAll = (q, p = []) => new Promise((res, rej) => db.all(q, p, (e, r) => (e ? rej(e) : res(r || []))));
const dbRun = (q, p = []) => new Promise((res, rej) => db.run(q, p, function (e) { e ? rej(e) : res(this); }));

let initialized = false;

/** Hydrate from the durable mirror, then write-through everything new. */
export async function initModelMetadataPersistence() {
  if (initialized) return { hydrated: 0, alreadyInitialized: true };
  initialized = true;

  let hydrated = 0;
  try {
    const rows = await dbAll(`SELECT provider, model, metadata FROM model_metadata_cache`);
    hydrated = hydrateDynamicPricing(
      rows.map((r) => {
        try {
          return { provider: r.provider, model: r.model, metadata: JSON.parse(r.metadata) };
        } catch {
          return null; // one corrupt row must not spoil the rest
        }
      }).filter(Boolean)
    );
    if (hydrated > 0) {
      // eslint-disable-next-line no-console
      console.log(`[ModelMetadata] Hydrated ${hydrated} persisted model metadata entrie(s)`);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[ModelMetadata] hydration failed (continuing without):', e?.message);
  }

  setDynamicPricingPersistence((provider, model, metadata) => {
    // Fire-and-forget by contract: a metadata write must never slow a fetch.
    dbRun(
      `INSERT INTO model_metadata_cache (cache_key, provider, model, metadata, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(cache_key) DO UPDATE SET
         metadata = excluded.metadata,
         updated_at = excluded.updated_at`,
      [`${provider}:${model}`, provider, model, JSON.stringify(metadata)]
    ).catch(() => { /* best-effort; the in-memory cache still has it */ });
  });

  return { hydrated, alreadyInitialized: false };
}

/**
 * Pull OpenRouter's public catalog into the dynamic cache.
 *
 * Public endpoint, no key. Routed through registerDynamicPricingFromModels so
 * the parse, the merge semantics and (via the hook above) the persistence are
 * identical to a picker-triggered fetch — one learning path, not two.
 */
export async function syncPublicModelCatalog({ timeoutMs = 10000 } = {}) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch('https://openrouter.ai/api/v1/models', { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const body = await res.json();
    const models = (body?.data || []).map((m) => ({
      id: m.id,
      contextLength: m.context_length,
      pricing: m.pricing,
      // Reasoning capability travels with the catalog row. This is the path
      // that runs at boot with NO api key, so a model's effort control is
      // available before the user has ever opened the picker.
      reasoning: m.reasoning,
      // FromModels parses prompt/completion itself; the cached-read rate is
      // pre-converted here because catalogs report it per token.
      inputCacheReadCostPer1M:
        m.pricing?.input_cache_read != null ? parseFloat(m.pricing.input_cache_read) * 1e6 : undefined,
    }));

    registerDynamicPricingFromModels('openrouter', models);
    return { synced: models.length };
  } catch (e) {
    // Offline or blocked is a normal condition for a local-first app. The
    // persisted cache from previous runs still applies; nothing degrades
    // beyond "new models stay unpriced until the next successful sync".
    // eslint-disable-next-line no-console
    console.log('[ModelMetadata] public catalog sync skipped:', e?.message);
    return { synced: 0, skipped: true };
  }
}

/** Test hook: lets an isolated suite re-init against its own database. */
export function _resetForTests() {
  initialized = false;
  setDynamicPricingPersistence(null);
}

export default { initModelMetadataPersistence, syncPublicModelCatalog, _resetForTests };
