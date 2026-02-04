/**
 * Cerebras Service
 *
 * Cerebras inference API (OpenAI-compatible) at https://api.cerebras.ai/v1
 * Documentation: https://inference-docs.cerebras.ai/
 */

import fetch from 'node-fetch';

class CerebrasService {
  constructor() {
    this.baseURL = 'https://api.cerebras.ai/v1';
    this.modelsCache = null;
    this.cacheTimestamp = null;
    this.cacheTTL = 60 * 60 * 1000; // 1 hour in milliseconds
  }

  /**
   * Fetches available models from Cerebras API
   * @param {string} apiKey - Cerebras API key
   * @param {Object} options - Optional parameters
   * @returns {Promise<Array>} Array of model objects
   */
  async fetchModels(apiKey, options = {}) {
    const { useCache = true } = options;

    if (useCache && this.isCacheValid()) {
      console.log('Returning cached Cerebras models');
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
        throw new Error(`Cerebras API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const models = this.transformModels(data.data || []);

      this.modelsCache = models;
      this.cacheTimestamp = Date.now();

      console.log(`Fetched ${models.length} models from Cerebras API`);
      return models;
    } catch (error) {
      console.error('Failed to fetch Cerebras models:', error.message);

      if (this.modelsCache) {
        console.log('Returning expired cached models due to API error');
        return this.modelsCache;
      }

      return this.getFallbackModels();
    }
  }

  /**
   * Transforms Cerebras model data to internal format
   */
  transformModels(rawModels) {
    return rawModels
      .filter((model) => model.id)
      .map((model) => ({
        id: model.id,
        name: model.id,
        description: model.description || `Cerebras ${model.id}`,
        type: 'production',
        ownedBy: model.owned_by || 'cerebras',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Returns the list of available Cerebras models
   * Based on documentation: https://inference-docs.cerebras.ai/
   *
   * Production Models:
   * - llama3.1-8b (8B params, ~2200 tokens/s)
   * - llama-3.3-70b (70B params, ~2100 tokens/s)
   * - gpt-oss-120b (120B params, ~3000 tokens/s)
   * - qwen-3-32b (32B params, ~2600 tokens/s)
   *
   * Preview Models:
   * - qwen-3-235b-a22b-instruct-2507 (235B params, ~1400 tokens/s)
   * - zai-glm-4.6 (357B params, ~1000 tokens/s)
   *
   * @returns {Array} Array of model objects
   */
  getAvailableModels() {
    return [
      // Production Models
      {
        id: 'llama3.1-8b',
        name: 'Llama 3.1 8B',
        description: 'Meta Llama 3.1 8B - Fast inference at ~2200 tokens/s',
        parameters: '8 billion',
        speed: '~2200 tokens/s',
        type: 'production',
        ownedBy: 'meta-llama',
      },
      {
        id: 'llama-3.3-70b',
        name: 'Llama 3.3 70B',
        description: 'Meta Llama 3.3 70B - High quality at ~2100 tokens/s',
        parameters: '70 billion',
        speed: '~2100 tokens/s',
        type: 'production',
        ownedBy: 'meta-llama',
      },
      {
        id: 'gpt-oss-120b',
        name: 'OpenAI GPT OSS 120B',
        description: 'OpenAI GPT OSS 120B - Fastest large model at ~3000 tokens/s',
        parameters: '120 billion',
        speed: '~3000 tokens/s',
        type: 'production',
        ownedBy: 'openai',
      },
      {
        id: 'qwen-3-32b',
        name: 'Qwen 3 32B',
        description: 'Qwen 3 32B - Balanced performance at ~2600 tokens/s',
        parameters: '32 billion',
        speed: '~2600 tokens/s',
        type: 'production',
        ownedBy: 'qwen',
      },
      // Preview Models
      {
        id: 'qwen-3-235b-a22b-instruct-2507',
        name: 'Qwen 3 235B Instruct (Preview)',
        description: 'Qwen 3 235B - Large model at ~1400 tokens/s (Preview - not for production)',
        parameters: '235 billion',
        speed: '~1400 tokens/s',
        type: 'preview',
        ownedBy: 'qwen',
      },
      {
        id: 'zai-glm-4.6',
        name: 'Z.ai GLM 4.6 (Preview)',
        description: 'Z.ai GLM 4.6 - 357B model at ~1000 tokens/s (Preview - not for production)',
        parameters: '357 billion',
        speed: '~1000 tokens/s',
        type: 'preview',
        ownedBy: 'zai',
      },
    ];
  }

  /**
   * Gets model names only (for compatibility with existing system)
   * @param {string} apiKey - Cerebras API key
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
   * @returns {Array} Array of fallback model objects
   */
  getFallbackModels() {
    return this.getAvailableModels();
  }
}

// Export singleton instance
export default new CerebrasService();
