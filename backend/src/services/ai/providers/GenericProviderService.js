import fetch from 'node-fetch';
import { EventEmitter } from 'events';
import { persistLastModels, getLastSuccessfulModels } from '../lastModelsCache.js';

/**
 * Generic model-fetching service for any OpenAI-compatible provider.
 * Handles: cache management, API fetching, model transformation, fallback resolution,
 * pagination, and model change detection (event emission).
 *
 * Replaces all 14 individual provider singleton files with a single configurable class.
 */
class GenericProviderService extends EventEmitter {
  /**
   * @param {Object} config
   * @param {string} config.name - Provider display name (e.g., 'OpenAI')
   * @param {string} config.baseURL - Base API URL (e.g., 'https://api.openai.com/v1')
   * @param {string[]} config.fallbackModels - Fallback model IDs if API is unavailable
   * @param {number} [config.cacheTTL=300000] - Cache time-to-live in ms (default 5 minutes).
   *   Model lists are small, infrequent to change but user-visible when stale.
   *   5 min balances first-paint speed with new-model discovery on the same day.
   *   Stale-while-revalidate (fetchModels) still serves cache instantly past this
   *   TTL if a background refresh is inflight.
   * @param {Object} [config.headers] - Extra headers to include in fetch requests
   * @param {string} [config.authScheme='bearer'] - Auth scheme: 'bearer', 'api-key', 'query-param'
   * @param {string} [config.modelsPath='/models'] - Path appended to baseURL for model listing
   * @param {string} [config.responseDataPath='data'] - JSON path to model array in response
   * @param {Function} [config.transformModel] - Custom model transform function (rawModel => internalModel)
   * @param {Function} [config.filterModel] - Custom filter predicate (rawModel => boolean)
   * @param {Object[]} [config.fallbackModelObjects] - Full fallback model objects (overrides fallbackModels)
   * @param {boolean} [config.supportsPagination=false] - If true, follows pagination links
   * @param {Object} [config.paginationConfig] - Pagination configuration
   */
  constructor(config) {
    super();
    this.name = config.name;
    this.baseURL = config.baseURL;
    this.fallbackModels = config.fallbackModels || [];
    this.fallbackModelObjects = config.fallbackModelObjects || null;
    this.cacheTTL = config.cacheTTL || 5 * 60 * 1000;
    // Half-life: past this age (but still within cacheTTL) we serve cached
    // instantly AND kick off a background revalidation. Zero perceived latency,
    // fresh data by the next tick. Emits 'models:added' / 'models:removed'
    // when the background result diverges from the served cache.
    this.staleWhileRevalidateMs = config.staleWhileRevalidateMs || Math.floor(this.cacheTTL / 2);
    this.extraHeaders = config.headers || {};
    this.authScheme = config.authScheme || 'bearer';
    this.modelsPath = config.modelsPath || '/models';
    this.responseDataPath = config.responseDataPath || 'data';
    this.transformModel = config.transformModel || this._defaultTransform;
    this.filterModel = config.filterModel || ((m) => !!m.id);
    this.recommendedModels = config.recommendedModels || [];
    this.supportsPagination = config.supportsPagination || false;
    this.paginationConfig = config.paginationConfig || {};

    // Cache state
    this.modelsCache = null;
    this.cacheTimestamp = null;
  }

  /**
   * Fetch models from the provider API with caching, error recovery, and fallbacks.
   * On first load (no cache), returns fallback models immediately and fetches from API in background.
   */
  async fetchModels(apiKey, options = {}) {
    const { useCache = true, force = false } = options;

    // Force bypass: caller (refresh endpoint, admin action) explicitly wants
    // a fresh network fetch. Never serves cache. Never rides a background.
    if (force || !useCache) {
      return this._fetchAndCacheOrFallback(apiKey);
    }

    if (this.isCacheValid()) {
      // Stale-while-revalidate: if we're past the half-life but still fresh,
      // kick off a background refresh. Callers get instant response, next
      // caller gets the new data. Concurrent SWR triggers coalesce onto the
      // existing background fetch.
      const age = Date.now() - (this.cacheTimestamp || 0);
      if (age > this.staleWhileRevalidateMs && !this._backgroundFetchInProgress) {
        this._backgroundFetchInProgress = true;
        this._fetchAndCache(apiKey)
          .catch((err) => {
            // Don't poison cache on background failure; just log.
            console.warn(`[${this.name}] Background revalidate failed: ${err.message}`);
          })
          .finally(() => { this._backgroundFetchInProgress = false; });
      }
      return this.modelsCache;
    }

    // Cache invalid — wait for network unless a background fetch is already inflight
    if (this._backgroundFetchInProgress && this.modelsCache) {
      return this.modelsCache;
    }

    return this._fetchAndCacheOrFallback(apiKey);
  }

  /**
   * Internal: fetch and cache with fallback on error. Used by force and
   * cache-miss paths.
   */
  async _fetchAndCacheOrFallback(apiKey) {
    try {
      return await this._fetchAndCache(apiKey);
    } catch (error) {
      console.error(`Failed to fetch ${this.name} models:`, error.message);

      if (this.modelsCache) {
        console.log(`Returning expired cached ${this.name} models due to API error`);
        return this.modelsCache;
      }

      console.log(`Returning fallback models for ${this.name}`);
      return this.getFallbackModels();
    }
  }

  /**
   * Internal: fetch models from API and update cache.
   */
  async _fetchAndCache(apiKey) {
    const allRawModels = await this._fetchAllPages(apiKey);
    console.log(`[${this.name}] Raw models from API: ${allRawModels.length}`);
    const filtered = allRawModels.filter(this.filterModel);
    console.log(`[${this.name}] After filter: ${filtered.length} (removed ${allRawModels.length - filtered.length})`);
    const recSet = new Set(this.recommendedModels);
    const models = filtered
      .map(this.transformModel)
      .sort((a, b) => {
        const aRec = recSet.has(a.id);
        const bRec = recSet.has(b.id);
        if (aRec && bRec) {
          return this.recommendedModels.indexOf(a.id) - this.recommendedModels.indexOf(b.id);
        }
        if (aRec) return -1;
        if (bRec) return 1;
        return (a.name || a.id || '').localeCompare(b.name || b.id || '');
      });

    // Refuse to cache/persist an empty list. A 200 with zero models is
    // upstream weirdness (wrong response shape, empty rollout, auth soft-fail)
    // — treating it as success would poison the cache and blank the dropdown.
    // Throwing routes the caller through the fallback ladder instead
    // (persisted last-successful → hardcoded list).
    if (models.length === 0) {
      throw new Error(`${this.name} API returned zero models — refusing to cache empty list`);
    }

    // Detect model changes before updating cache
    this._detectChanges(models);

    this.modelsCache = models;
    this.cacheTimestamp = Date.now();
    console.log(`[${this.name}] Cached ${models.length} models from API`);
    // Persist last-successful list to disk so a later degraded state
    // (network out, upstream 5xx) falls back to real data instead of the
    // hardcoded fallback list in providerConfigs.js.
    persistLastModels(this.name.toLowerCase(), models);
    return models;
  }

  /**
   * Internal: detect model additions/removals and emit events.
   */
  _detectChanges(newModels) {
    if (!this.modelsCache || this.modelsCache.length === 0) return;

    const previousIds = new Set(this.modelsCache.map((m) => m.id));
    const newIds = new Set(newModels.map((m) => m.id));

    const addedModels = newModels.filter((m) => !previousIds.has(m.id));
    const removedModels = this.modelsCache.filter((m) => !newIds.has(m.id));

    if (addedModels.length > 0) {
      console.log(`[${this.name}] New models detected: ${addedModels.map((m) => m.id).join(', ')}`);
      this.emit('models:added', { provider: this.name, models: addedModels });
    }

    if (removedModels.length > 0) {
      console.warn(`[${this.name}] Models removed: ${removedModels.map((m) => m.id).join(', ')}`);
      this.emit('models:removed', { provider: this.name, models: removedModels });
    }
  }

  /**
   * Internal: fetch all model pages (handles pagination if configured).
   */
  async _fetchAllPages(apiKey) {
    if (!this.supportsPagination) {
      return this._fetchPage(apiKey);
    }

    const allModels = [];
    let hasMore = true;
    let cursor = null;

    while (hasMore) {
      const { models, nextCursor, hasMorePages } = await this._fetchPaginatedPage(apiKey, cursor);
      allModels.push(...models);
      hasMore = hasMorePages;
      cursor = nextCursor;
    }

    return allModels;
  }

  /**
   * Internal: fetch a single page of models.
   */
  async _fetchPage(apiKey) {
    const url = this._buildUrl(apiKey);
    const headers = this._buildHeaders(apiKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, { headers, signal: controller.signal }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`${this.name} API error: ${response.status} ${response.statusText} - ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    return this._extractModels(data);
  }

  /**
   * Internal: fetch a paginated page of models.
   */
  async _fetchPaginatedPage(apiKey, afterId) {
    const url = new URL(`${this.baseURL}${this.modelsPath}`);
    const limitParam = this.paginationConfig.limitParam || 'limit';
    url.searchParams.set(limitParam, String(this.paginationConfig.pageSize || 100));
    if (afterId) {
      url.searchParams.set(this.paginationConfig.cursorParam || 'after_id', afterId);
    }

    // For query-param auth, add key to URL
    if (this.authScheme === 'query-param') {
      url.searchParams.append('key', apiKey);
    }

    const headers = this._buildHeaders(apiKey);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url.toString(), { headers, signal: controller.signal }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`${this.name} API error: ${response.status} ${response.statusText} - ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    const models = this._extractModels(data);
    const hasMoreField = this.paginationConfig.hasMoreField || 'has_more';
    const hasMoreValue = data[hasMoreField];
    // Support both boolean (Anthropic: has_more: true) and string tokens (Gemini: nextPageToken: "abc")
    const hasMorePages = hasMoreValue === true || (typeof hasMoreValue === 'string' && hasMoreValue.length > 0);
    // Use token value as cursor if it's a string, otherwise use last model ID (Anthropic-style)
    const nextCursor = hasMorePages
      ? (typeof hasMoreValue === 'string' ? hasMoreValue : (models.length > 0 ? models[models.length - 1].id : null))
      : null;

    return { models, nextCursor, hasMorePages };
  }

  /**
   * Internal: build the fetch URL based on auth scheme.
   */
  _buildUrl(apiKey) {
    const url = new URL(`${this.baseURL}${this.modelsPath}`);
    if (this.authScheme === 'query-param') {
      url.searchParams.append('key', apiKey);
    }
    return url.toString();
  }

  /**
   * Internal: build the request headers based on auth scheme.
   */
  _buildHeaders(apiKey) {
    const headers = {
      'Content-Type': 'application/json',
      ...this.extraHeaders,
    };

    if (this.authScheme === 'bearer' || this.authScheme === 'claude-code') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else if (this.authScheme === 'api-key') {
      headers['x-api-key'] = apiKey;
    }
    // 'query-param' handled in _buildUrl

    return headers;
  }

  /**
   * Internal: extract models array from response using configured path.
   */
  _extractModels(data) {
    if (this.responseDataPath === 'root') return Array.isArray(data) ? data : [];
    return data[this.responseDataPath] || [];
  }

  /**
   * Default model transform — maps standard OpenAI-format model objects.
   *
   * PRESERVES the pricing and context a provider publishes. This used to emit
   * only id/name/description/createdAt/ownedBy, which silently threw away the
   * one thing the ledger needs: every provider that ships rates in its own
   * /models response — Together AI publishes `pricing: { input, output }` in
   * dollars per million — had those rates discarded here, and then every one
   * of its models rendered as "unpriced" downstream. The data had arrived and
   * we deleted it before anyone could read it.
   *
   * Only the providers WITHOUT a custom modelTransform were affected, which is
   * why OpenRouter (which has one) looked fine and Together did not.
   *
   * Fields are emitted only when the provider actually sent them, so a
   * provider that publishes nothing produces exactly the same object as before
   * and no caller sees a shape change.
   */
  _defaultTransform(rawModel) {
    const out = {
      id: rawModel.id,
      name: rawModel.id,
      description: rawModel.description || '',
      createdAt: rawModel.created || null,
      ownedBy: rawModel.owned_by || null,
    };

    // Published rates, in whatever shape the provider uses. Passed through
    // verbatim: registerDynamicPricingFromModels owns the parsing, so this
    // stays correct when a new pricing spelling appears.
    if (rawModel.pricing && typeof rawModel.pricing === 'object') {
      out.pricing = rawModel.pricing;
    }

    // xAI is the next instance of exactly the loss described above, with a
    // third spelling: it publishes rates as FLAT top-level fields rather than
    // a nested `pricing` object — prompt_text_token_price,
    // cached_prompt_text_token_price, completion_text_token_price — on the
    // ordinary /v1/models response AGNT already fetches. Verified live
    // 2026-08-10. Because they sit outside `pricing`, the block above dropped
    // them, which is why 11 of 15 grokai models had no cached-read price and
    // billed cache hits at full rate.
    //
    // Copied verbatim under the same contract: the parser owns interpretation,
    // including the unit conversion.
    for (const field of [
      'prompt_text_token_price',
      'cached_prompt_text_token_price',
      'completion_text_token_price',
    ]) {
      if (typeof rawModel[field] === 'number') out[field] = rawModel[field];
    }

    const ctx = rawModel.context_length || rawModel.context_window || rawModel.max_model_len;
    if (ctx) out.contextLength = ctx;

    const maxOut = rawModel.max_output_length || rawModel.max_output_tokens;
    if (maxOut) out.maxOutputLength = maxOut;

    return out;
  }

  /**
   * Gets model names only (model IDs as strings).
   */
  async getModelNames(apiKey, options = {}) {
    const models = await this.fetchModels(apiKey, options);
    return models.map((model) => model.id);
  }

  /**
   * Checks if cached models are still valid.
   */
  isCacheValid() {
    // Coerced: the && chain yields null/undefined when either field is unset,
    // and a predicate named is* that answers `null` breaks any caller doing a
    // strict comparison or serialising the result.
    return Boolean(this.modelsCache && this.cacheTimestamp && Date.now() - this.cacheTimestamp < this.cacheTTL);
  }

  /**
   * Clears the models cache.
   */
  clearCache() {
    this.modelsCache = null;
    this.cacheTimestamp = null;
  }

  /**
   * Returns fallback models if API is unavailable.
   * Preference order: persisted last-successful fetch (real data from a
   * previous run) → configured fallbackModelObjects → hardcoded ID list.
   */
  getFallbackModels() {
    const persisted = getLastSuccessfulModels(this.name.toLowerCase());
    if (persisted) {
      console.log(`[${this.name}] Using persisted last-successful models (${persisted.length}) instead of hardcoded fallback`);
      return persisted;
    }
    if (this.fallbackModelObjects) return this.fallbackModelObjects;
    // Sort fallback models with recommended first
    const recSet = new Set(this.recommendedModels);
    const sorted = [
      ...this.recommendedModels.filter((id) => this.fallbackModels.includes(id)),
      ...this.fallbackModels.filter((id) => !recSet.has(id)),
    ];
    return sorted.map((id) => ({
      id,
      name: id,
      description: 'Fallback model (API unavailable)',
      createdAt: null,
      ownedBy: this.name.toLowerCase(),
    }));
  }
}

export default GenericProviderService;
