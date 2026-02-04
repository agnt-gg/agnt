/**
 * DeepSeek Service
 *
 * DeepSeek AI models with reasoning capabilities
 * OpenAI-compatible API at https://api.deepseek.com/v1
 *
 * Documentation: https://api-docs.deepseek.com/
 */

import fetch from 'node-fetch';

class DeepSeekService {
  constructor() {
    this.baseURL = 'https://api.deepseek.com';
    this.modelsCache = null;
    this.cacheTimestamp = null;
    this.cacheTTL = 60 * 60 * 1000; // 1 hour in milliseconds
  }

  /**
   * Fetches available models from DeepSeek API
   * @param {string} apiKey - DeepSeek API key
   * @param {Object} options - Optional parameters
   * @returns {Promise<Array>} Array of model objects
   */
  async fetchModels(apiKey, options = {}) {
    const { useCache = true } = options;

    // Check cache first
    if (useCache && this.isCacheValid()) {
      console.log('Returning cached DeepSeek models');
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
        throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const models = this.transformModels(data.data || []);

      // Cache the results
      this.modelsCache = models;
      this.cacheTimestamp = Date.now();

      console.log(`Fetched ${models.length} models from DeepSeek API`);
      return models;
    } catch (error) {
      console.error('Failed to fetch DeepSeek models:', error.message);

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
   * Transforms DeepSeek model data to internal format
   * @param {Array} rawModels - Raw model data from DeepSeek API
   * @returns {Array} Transformed model objects
   */
  transformModels(rawModels) {
    return rawModels
      .filter((model) => model.id)
      .map((model) => ({
        id: model.id,
        name: model.id,
        description: model.description || `DeepSeek ${model.id}`,
        contextLength: model.context_length || 128000,
        maxOutput: model.max_output_tokens || 8192,
        features: model.features || ['chat', 'tool_calls'],
        type: 'production',
        ownedBy: model.owned_by || 'deepseek',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Gets model names only (for compatibility with existing system)
   * @param {string} apiKey - DeepSeek API key
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
   * Based on: https://api-docs.deepseek.com/quick_start/pricing
   * @returns {Array} Array of fallback model objects
   */
  getFallbackModels() {
    return [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat (V3.2)',
        description: 'DeepSeek-V3.2 Non-thinking Mode - Fast responses, 128K context',
        contextLength: 128000,
        maxOutput: 8192,
        features: ['json_output', 'tool_calls', 'chat_prefix_completion', 'fim_completion'],
        type: 'production',
        ownedBy: 'deepseek',
      },
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek Reasoner (V3.2)',
        description: 'DeepSeek-V3.2 Thinking Mode - Advanced reasoning, 128K context',
        contextLength: 128000,
        maxOutput: 65536,
        features: ['json_output', 'tool_calls', 'chat_prefix_completion'],
        type: 'production',
        ownedBy: 'deepseek',
      },
    ];
  }
}

// Export singleton instance
export default new DeepSeekService();
