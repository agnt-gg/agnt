import fetch from 'node-fetch';

class OpenRouterService {
  constructor() {
    this.baseURL = 'https://openrouter.ai/api/v1';
    this.modelsCache = null;
    this.cacheTimestamp = null;
    this.cacheTTL = 60 * 60 * 1000; // 1 hour in milliseconds
  }

  /**
   * Fetches available models from OpenRouter API
   * @param {string} apiKey - OpenRouter API key
   * @param {Object} options - Optional parameters
   * @returns {Promise<Array>} Array of model objects
   */
  async fetchModels(apiKey, options = {}) {
    const { category, useCache = true } = options;

    // Check cache first
    if (useCache && this.isCacheValid()) {
      console.log('Returning cached OpenRouter models');
      return this.modelsCache;
    }

    try {
      const url = new URL(`${this.baseURL}/models`);
      if (category) {
        url.searchParams.append('category', category);
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const models = this.transformModels(data.data || []);

      // Cache the results
      this.modelsCache = models;
      this.cacheTimestamp = Date.now();

      console.log(`Fetched ${models.length} models from OpenRouter API`);
      return models;
    } catch (error) {
      console.error('Failed to fetch OpenRouter models:', error);

      // Return cached models if available, even if expired
      if (this.modelsCache) {
        console.log('Returning expired cached models due to API error');
        return this.modelsCache;
      }

      // Return fallback models if no cache available
      return this.getFallbackModels();
    }
  }

  /**
   * Transforms OpenRouter model data to internal format
   * @param {Array} rawModels - Raw model data from OpenRouter API
   * @returns {Array} Transformed model objects
   */
  transformModels(rawModels) {
    return rawModels
      .filter((model) => model.id && model.name)
      .map((model) => ({
        id: model.id,
        name: model.name,
        description: model.description || '',
        contextLength: model.context_length || model.top_provider?.context_length || 0,
        pricing: {
          prompt: parseFloat(model.pricing?.prompt || '0'),
          completion: parseFloat(model.pricing?.completion || '0'),
        },
        architecture: model.architecture || {},
        isModerated: model.top_provider?.is_moderated || false,
        maxCompletionTokens: model.top_provider?.max_completion_tokens || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Gets model names only (for compatibility with existing system)
   * @param {string} apiKey - OpenRouter API key
   * @param {Object} options - Optional parameters
   * @returns {Promise<Array<string>>} Array of model IDs
   */
  async getModelNames(apiKey, options = {}) {
    const models = await this.fetchModels(apiKey, options);
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
   * @returns {Array<string>} Array of fallback model names
   */
  getFallbackModels() {
    return [
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
      'anthropic/claude-3-5-sonnet-20241022',
      'anthropic/claude-3-haiku-20240307',
      'google/gemini-pro-1.5',
      'meta-llama/llama-3.1-70b-instruct',
      'mistralai/mixtral-8x7b-instruct',
    ].map((id) => ({
      id,
      name: id.split('/').pop(),
      description: 'Fallback model (API unavailable)',
      contextLength: 0,
      pricing: { prompt: 0, completion: 0 },
      architecture: {},
      isModerated: false,
      maxCompletionTokens: 0,
    }));
  }

  /**
   * Filters models by category or other criteria
   * @param {Array} models - Array of model objects
   * @param {Object} filters - Filter criteria
   * @returns {Array} Filtered models
   */
  filterModels(models, filters = {}) {
    let filtered = [...models];

    if (filters.category) {
      // This would require additional metadata from OpenRouter
      // For now, we'll implement basic filtering by model name patterns
      const categoryPatterns = {
        programming: ['code', 'instruct', 'chat'],
        creative: ['creative', 'story', 'write'],
        reasoning: ['reasoning', 'logic', 'math'],
      };

      const patterns = categoryPatterns[filters.category.toLowerCase()] || [];
      if (patterns.length > 0) {
        filtered = filtered.filter((model) =>
          patterns.some((pattern) => model.name.toLowerCase().includes(pattern) || model.description.toLowerCase().includes(pattern))
        );
      }
    }

    if (filters.maxPrice) {
      filtered = filtered.filter((model) => model.pricing.prompt <= filters.maxPrice && model.pricing.completion <= filters.maxPrice);
    }

    if (filters.minContextLength) {
      filtered = filtered.filter((model) => model.contextLength >= filters.minContextLength);
    }

    return filtered;
  }
}

// Export singleton instance
export default new OpenRouterService();
