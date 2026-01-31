import fetch from 'node-fetch';

class ClaudeCodeService {
  constructor() {
    this.baseURL = 'https://api.anthropic.com/v1';
    this.modelsCache = null;
    this.cacheTimestamp = null;
    this.cacheTTL = 60 * 60 * 1000; // 1 hour in milliseconds
  }

  /**
   * Fetches available models from Anthropic API using OAuth Bearer auth.
   * Handles pagination to retrieve ALL available models.
   * @param {string} oauthToken - Claude Code OAuth token
   * @param {Object} options - Optional parameters
   * @returns {Promise<Array>} Array of model objects
   */
  async fetchModels(oauthToken, options = {}) {
    const { useCache = true } = options;

    // Check cache first
    if (useCache && this.isCacheValid()) {
      console.log('[ClaudeCode] Returning cached models');
      return this.modelsCache;
    }

    try {
      const allRawModels = [];
      let hasMore = true;
      let afterId = null;

      const headers = {
        Authorization: `Bearer ${oauthToken}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
        'user-agent': 'claude-cli/2.1.2 (external, cli)',
        'x-app': 'cli',
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json',
      };

      // Paginate through all model pages
      while (hasMore) {
        const url = new URL(`${this.baseURL}/models`);
        url.searchParams.set('limit', '100');
        if (afterId) {
          url.searchParams.set('after_id', afterId);
        }

        const response = await fetch(url.toString(), { headers });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          console.error(`[ClaudeCode] Models API error: ${response.status} ${response.statusText}`, errorBody);
          throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const pageModels = data.data || [];
        allRawModels.push(...pageModels);

        console.log(`[ClaudeCode] Fetched page: ${pageModels.length} models (total so far: ${allRawModels.length}), has_more: ${data.has_more}`);

        // Check for more pages
        hasMore = data.has_more === true;
        if (hasMore && pageModels.length > 0) {
          afterId = pageModels[pageModels.length - 1].id;
        } else {
          hasMore = false;
        }
      }

      console.log(`[ClaudeCode] All model IDs from API:`, allRawModels.map((m) => m.id));

      const models = this.transformModels(allRawModels);

      // Cache the results
      this.modelsCache = models;
      this.cacheTimestamp = Date.now();

      console.log(`[ClaudeCode] Total: ${models.length} models available`);
      return models;
    } catch (error) {
      console.error('[ClaudeCode] Failed to fetch models:', error);

      // Return cached models if available, even if expired
      if (this.modelsCache) {
        console.log('[ClaudeCode] Returning expired cached models due to API error');
        return this.modelsCache;
      }

      // Return fallback models if no cache available
      return this.getFallbackModels();
    }
  }

  /**
   * Transforms Anthropic model data to internal format
   * @param {Array} rawModels - Raw model data from Anthropic API
   * @returns {Array} Transformed model objects
   */
  transformModels(rawModels) {
    return rawModels
      .filter((model) => model.id)
      .map((model) => ({
        id: model.id,
        name: model.display_name || model.id,
        description: model.description || '',
        contextLength: model.max_tokens || 0,
        createdAt: model.created_at,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Gets model names only (for compatibility with existing system)
   * @param {string} oauthToken - Claude Code OAuth token
   * @param {Object} options - Optional parameters
   * @returns {Promise<Array<string>>} Array of model IDs
   */
  async getModelNames(oauthToken, options = {}) {
    const models = await this.fetchModels(oauthToken, options);
    return models.map((model) => model.id);
  }

  /**
   * Checks if cached models are still valid
   * @returns {boolean} True if cache is valid
   */
  isCacheValid() {
    return this.modelsCache && this.cacheTimestamp && Date.now() - this.cacheTimestamp < this.cacheTTL;
  }

  /**
   * Clears the models cache
   */
  clearCache() {
    this.modelsCache = null;
    this.cacheTimestamp = null;
  }

  /**
   * Returns fallback models if API is unavailable
   * @returns {Array} Array of fallback model objects
   */
  getFallbackModels() {
    return [
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-3-5-sonnet-20241022',
    ].map((id) => ({
      id,
      name: id,
      description: 'Fallback model (API unavailable)',
      contextLength: 0,
      createdAt: null,
    }));
  }
}

// Export singleton instance
export default new ClaudeCodeService();
