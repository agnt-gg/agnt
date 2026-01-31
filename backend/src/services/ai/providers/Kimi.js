/**
 * Kimi (Moonshot AI) Service
 *
 * Moonshot AI's Kimi models with long context support (256K tokens)
 * OpenAI-compatible API at https://api.moonshot.ai/v1
 *
 * Documentation: https://platform.moonshot.ai/docs/guide/start-using-kimi-api
 */

import fetch from 'node-fetch';

class KimiService {
  constructor() {
    this.baseURL = 'https://api.moonshot.ai/v1';
    this.modelsCache = null;
    this.cacheTimestamp = null;
    this.cacheTTL = 60 * 60 * 1000; // 1 hour in milliseconds
  }

  /**
   * Fetches available models from Kimi API
   * @param {string} apiKey - Kimi API key
   * @param {Object} options - Optional parameters
   * @returns {Promise<Array>} Array of model objects
   */
  async fetchModels(apiKey, options = {}) {
    const { useCache = true } = options;

    // Check cache first
    if (useCache && this.isCacheValid()) {
      console.log('Returning cached Kimi models');
      return this.modelsCache;
    }

    try {
      const response = await fetch(`${this.baseURL}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Kimi API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const models = this.transformModels(data.data || []);

      // Cache the results
      this.modelsCache = models;
      this.cacheTimestamp = Date.now();

      console.log(`Fetched ${models.length} models from Kimi API`);
      return models;
    } catch (error) {
      console.error('Failed to fetch Kimi models:', error);

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
   * Transforms Kimi model data to internal format
   * @param {Array} rawModels - Raw model data from Kimi API
   * @returns {Array} Transformed model objects
   */
  transformModels(rawModels) {
    return rawModels
      .filter((model) => model.id && model.id.startsWith('moonshot-'))
      .map((model) => ({
        id: model.id,
        name: model.id,
        description: `Moonshot AI ${model.id} - Long context support (256K)`,
        contextLength: 256000,
        maxOutput: 8192,
        features: ['long_context', 'tool_calls', 'chat'],
        type: 'production',
        ownedBy: 'moonshot-ai',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Gets model names only (for compatibility with existing system)
   * @param {string} apiKey - Kimi API key
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
   * Based on: https://platform.moonshot.ai/docs/introduction
   * @returns {Array} Array of fallback model objects
   */
  getFallbackModels() {
    return [
      {
        id: 'moonshot-v1-8k',
        name: 'moonshot-v1-8k',
        description: 'Moonshot AI v1 - 8K context window',
        contextLength: 8000,
        maxOutput: 2048,
        features: ['chat', 'tool_calls'],
        type: 'production',
        ownedBy: 'moonshot-ai',
      },
      {
        id: 'moonshot-v1-32k',
        name: 'moonshot-v1-32k',
        description: 'Moonshot AI v1 - 32K context window',
        contextLength: 32000,
        maxOutput: 4096,
        features: ['chat', 'tool_calls'],
        type: 'production',
        ownedBy: 'moonshot-ai',
      },
      {
        id: 'moonshot-v1-128k',
        name: 'moonshot-v1-128k',
        description: 'Moonshot AI v1 - 128K context window',
        contextLength: 128000,
        maxOutput: 8192,
        features: ['long_context', 'chat', 'tool_calls'],
        type: 'production',
        ownedBy: 'moonshot-ai',
      },
    ];
  }
}

// Export singleton instance
export default new KimiService();
