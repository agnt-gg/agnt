import fetch from 'node-fetch';
import { EventEmitter } from 'events';

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
   * @param {number} [config.cacheTTL=3600000] - Cache time-to-live in ms (default 1 hour)
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
    this.cacheTTL = config.cacheTTL || 60 * 60 * 1000;
    this.extraHeaders = config.headers || {};
    this.authScheme = config.authScheme || 'bearer';
    this.modelsPath = config.modelsPath || '/models';
    this.responseDataPath = config.responseDataPath || 'data';
    this.transformModel = config.transformModel || this._defaultTransform;
    this.filterModel = config.filterModel || ((m) => !!m.id);
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
    const { useCache = true } = options;

    if (useCache && this.isCacheValid()) {
      return this.modelsCache;
    }

    // If we have no cache yet, return fallbacks immediately and fetch in background
    if (!this.modelsCache && !this._backgroundFetchInProgress) {
      this._backgroundFetchInProgress = true;
      this._fetchAndCache(apiKey)
        .catch((err) => console.error(`[${this.name}] Background model fetch failed:`, err.message))
        .finally(() => {
          this._backgroundFetchInProgress = false;
        });
      return this.getFallbackModels();
    }

    // If a background fetch is already running, return what we have
    if (this._backgroundFetchInProgress) {
      return this.modelsCache || this.getFallbackModels();
    }

    // Cache expired — try to fetch fresh models
    try {
      return await this._fetchAndCache(apiKey);
    } catch (error) {
      console.error(`Failed to fetch ${this.name} models:`, error.message);

      if (this.modelsCache) {
        console.log(`Returning expired cached ${this.name} models due to API error`);
        return this.modelsCache;
      }

      return this.getFallbackModels();
    }
  }

  /**
   * Internal: fetch models from API and update cache.
   */
  async _fetchAndCache(apiKey) {
    const allRawModels = await this._fetchAllPages(apiKey);
    const models = allRawModels
      .filter(this.filterModel)
      .map(this.transformModel)
      .sort((a, b) => (a.name || a.id || '').localeCompare(b.name || b.id || ''));

    // Detect model changes before updating cache
    this._detectChanges(models);

    this.modelsCache = models;
    this.cacheTimestamp = Date.now();
    console.log(`Fetched ${models.length} models from ${this.name} API`);
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

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`${this.name} API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return this._extractModels(data);
  }

  /**
   * Internal: fetch a paginated page of models.
   */
  async _fetchPaginatedPage(apiKey, afterId) {
    const url = new URL(`${this.baseURL}${this.modelsPath}`);
    url.searchParams.set('limit', String(this.paginationConfig.pageSize || 100));
    if (afterId) {
      url.searchParams.set(this.paginationConfig.cursorParam || 'after_id', afterId);
    }

    // For query-param auth, add key to URL
    if (this.authScheme === 'query-param') {
      url.searchParams.append('key', apiKey);
    }

    const headers = this._buildHeaders(apiKey);
    const response = await fetch(url.toString(), { headers });

    if (!response.ok) {
      throw new Error(`${this.name} API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const models = this._extractModels(data);
    const hasMorePages = data[this.paginationConfig.hasMoreField || 'has_more'] === true;
    const nextCursor = hasMorePages && models.length > 0 ? models[models.length - 1].id : null;

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
   */
  _defaultTransform(rawModel) {
    return {
      id: rawModel.id,
      name: rawModel.id,
      description: rawModel.description || '',
      createdAt: rawModel.created || null,
      ownedBy: rawModel.owned_by || null,
    };
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
    return this.modelsCache && this.cacheTimestamp && Date.now() - this.cacheTimestamp < this.cacheTTL;
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
   */
  getFallbackModels() {
    if (this.fallbackModelObjects) return this.fallbackModelObjects;
    return this.fallbackModels.map((id) => ({
      id,
      name: id,
      description: 'Fallback model (API unavailable)',
      createdAt: null,
      ownedBy: this.name.toLowerCase(),
    }));
  }
}

export default GenericProviderService;
