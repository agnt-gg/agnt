/**
 * Z.AI Service
 *
 * Z.AI (International version of ZhipuAI) GLM models
 * OpenAI-compatible API at https://api.z.ai/api/paas/v4
 *
 * Documentation: https://docs.z.ai/api-reference/introduction
 * API Keys: https://z.ai/manage-apikey/apikey-list
 */

import fetch from 'node-fetch';

class ZAIService {
  constructor() {
    this.baseURL = 'https://api.z.ai/api/paas/v4';
    this.codingBaseURL = 'https://api.z.ai/api/coding/paas/v4';
    this.modelsCache = null;
    this.cacheTimestamp = null;
    this.cacheTTL = 60 * 60 * 1000; // 1 hour in milliseconds
  }

  /**
   * Fetches available models from Z.AI API
   * Note: Z.AI may not have a models endpoint, so this returns hardcoded models
   * @param {string} apiKey - Z.AI API key
   * @param {Object} options - Optional parameters
   * @returns {Promise<Array>} Array of model objects
   */
  async fetchModels(apiKey, options = {}) {
    const { useCache = true } = options;

    // Check cache first
    if (useCache && this.isCacheValid()) {
      console.log('Returning cached Z.AI models');
      return this.modelsCache;
    }

    // Try to fetch models from API, but fall back to hardcoded list
    try {
      const response = await fetch(`${this.baseURL}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        const models = this.transformModels(data.data || []);

        // Cache the results
        this.modelsCache = models;
        this.cacheTimestamp = Date.now();

        console.log(`Fetched ${models.length} models from Z.AI API`);
        return models;
      } else {
        throw new Error('Models endpoint not available');
      }
    } catch (error) {
      console.log('Z.AI API does not have models endpoint, using hardcoded models');

      // Return hardcoded models
      const models = this.getAvailableModels();
      this.modelsCache = models;
      this.cacheTimestamp = Date.now();
      return models;
    }
  }

  /**
   * Transforms Z.AI model data to internal format
   * @param {Array} rawModels - Raw model data from Z.AI API
   * @returns {Array} Transformed model objects
   */
  transformModels(rawModels) {
    return rawModels
      .filter((model) => model.id && model.id.startsWith('glm-'))
      .map((model) => ({
        id: model.id,
        name: model.id,
        description: model.description || `Z.AI ${model.id}`,
        contextLength: model.context_length || 128000,
        maxOutput: model.max_output_tokens || 8192,
        features: model.features || ['chat', 'vision', 'tool_calls'],
        type: 'production',
        ownedBy: 'z.ai',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Returns the list of available Z.AI models
   * Based on documentation: https://docs.z.ai/api-reference/introduction
   *
   * Primary Model:
   * - glm-4.7: Latest GLM model with multimodal capabilities
   *
   * @returns {Array} Array of model objects
   */
  getAvailableModels() {
    return [
      {
        id: 'glm-4.7',
        name: 'GLM-4.7',
        description: 'Z.AI GLM-4.7 - Latest multimodal model with vision and tool calling',
        contextLength: 128000,
        maxOutput: 8192,
        features: ['chat', 'vision', 'tool_calls', 'multimodal', 'coding'],
        type: 'production',
        ownedBy: 'z.ai',
      },
      {
        id: 'glm-4-plus',
        name: 'GLM-4 Plus',
        description: 'Z.AI GLM-4 Plus - Enhanced flagship model',
        contextLength: 128000,
        maxOutput: 8192,
        features: ['chat', 'vision', 'tool_calls', 'multimodal'],
        type: 'production',
        ownedBy: 'z.ai',
      },
      {
        id: 'glm-4',
        name: 'GLM-4',
        description: 'Z.AI GLM-4 - Flagship multimodal model',
        contextLength: 128000,
        maxOutput: 8192,
        features: ['chat', 'vision', 'tool_calls', 'multimodal'],
        type: 'production',
        ownedBy: 'z.ai',
      },
      {
        id: 'glm-4-air',
        name: 'GLM-4 Air',
        description: 'Z.AI GLM-4 Air - Lightweight and efficient',
        contextLength: 128000,
        maxOutput: 4096,
        features: ['chat', 'tool_calls'],
        type: 'production',
        ownedBy: 'z.ai',
      },
      {
        id: 'glm-4-flash',
        name: 'GLM-4 Flash',
        description: 'Z.AI GLM-4 Flash - Ultra-fast inference',
        contextLength: 128000,
        maxOutput: 4096,
        features: ['chat', 'tool_calls'],
        type: 'production',
        ownedBy: 'z.ai',
      },
    ];
  }

  /**
   * Gets model names only (for compatibility with existing system)
   * @param {string} apiKey - Z.AI API key
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
   * Returns fallback models if needed
   * For Z.AI, this returns the same as getAvailableModels
   * @returns {Array} Array of model objects
   */
  getFallbackModels() {
    return this.getAvailableModels();
  }
}

// Export singleton instance
export default new ZAIService();
