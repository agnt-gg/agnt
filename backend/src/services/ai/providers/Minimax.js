/**
 * Minimax Service
 *
 * Minimax AI models with text, voice, and video capabilities
 * OpenAI-compatible API at https://api.minimax.io/v1
 *
 * Documentation: https://platform.minimax.io/docs
 */

import fetch from 'node-fetch';

class MinimaxService {
  constructor() {
    this.baseURL = 'https://api.minimax.io/v1'; // International endpoint
    this.modelsCache = null;
    this.cacheTimestamp = null;
    this.cacheTTL = 60 * 60 * 1000; // 1 hour in milliseconds
  }

  /**
   * Fetches available models from Minimax API
   * @param {string} apiKey - Minimax API key
   * @param {Object} options - Optional parameters
   * @returns {Promise<Array>} Array of model objects
   */
  async fetchModels(apiKey, options = {}) {
    const { useCache = true } = options;

    // Check cache first
    if (useCache && this.isCacheValid()) {
      console.log('Returning cached Minimax models');
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
        throw new Error(`Minimax API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const models = this.transformModels(data.data || []);

      // Cache the results
      this.modelsCache = models;
      this.cacheTimestamp = Date.now();

      console.log(`Fetched ${models.length} models from Minimax API`);
      return models;
    } catch (error) {
      console.error('Failed to fetch Minimax models:', error);

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
   * Transforms Minimax model data to internal format
   * @param {Array} rawModels - Raw model data from Minimax API
   * @returns {Array} Transformed model objects
   */
  transformModels(rawModels) {
    return rawModels
      .filter((model) => model.id)
      .map((model) => ({
        id: model.id,
        name: model.id,
        description: model.description || `Minimax ${model.id}`,
        contextLength: model.context_length || 200000,
        maxOutput: model.max_output_tokens || 8192,
        features: model.features || ['chat', 'tool_calls'],
        type: 'production',
        ownedBy: 'minimax',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Gets model names only (for compatibility with existing system)
   * @param {string} apiKey - Minimax API key
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
   * Based on: https://platform.minimax.io/docs
   * @returns {Array} Array of fallback model objects
   */
  getFallbackModels() {
    return [
      {
        id: 'MiniMax-M2.1',
        name: 'MiniMax-M2.1',
        description: 'MiniMax M2.1 - Latest reasoning model',
        contextLength: 200000,
        maxOutput: 8192,
        features: ['chat', 'tool_calls', 'reasoning'],
        type: 'production',
        ownedBy: 'minimax',
      },
      {
        id: 'MiniMax-M2',
        name: 'MiniMax-M2',
        description: 'MiniMax M2 - Elite coding and agentic model',
        contextLength: 200000,
        maxOutput: 8192,
        features: ['chat', 'tool_calls', 'coding'],
        type: 'production',
        ownedBy: 'minimax',
      },
    ];
  }
}

// Export singleton instance
export default new MinimaxService();
