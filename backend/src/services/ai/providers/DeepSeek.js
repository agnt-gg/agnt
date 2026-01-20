/**
 * DeepSeek Service
 *
 * Note: DeepSeek does NOT have a /models API endpoint like OpenAI-compatible APIs.
 * Models are documented at: https://api-docs.deepseek.com/quick_start/pricing
 * This service returns the hardcoded list of available models.
 */

class DeepSeekService {
  constructor() {
    this.baseURL = 'https://api.deepseek.com';
    // DeepSeek doesn't have a models endpoint, so we use hardcoded models
    this.modelsCache = null;
    this.cacheTimestamp = null;
    this.cacheTTL = 60 * 60 * 1000; // 1 hour in milliseconds
  }

  /**
   * Returns available models from DeepSeek
   * Note: DeepSeek doesn't have a /models endpoint, so we return hardcoded models
   * based on their documentation: https://api-docs.deepseek.com/quick_start/pricing
   *
   * @param {string} apiKey - DeepSeek API key (not used for model listing)
   * @param {Object} options - Optional parameters
   * @returns {Promise<Array>} Array of model objects
   */
  async fetchModels(apiKey, options = {}) {
    // DeepSeek doesn't have a models endpoint - return hardcoded models
    console.log('Returning hardcoded DeepSeek models (no API endpoint available)');
    return this.getAvailableModels();
  }

  /**
   * Returns the list of available DeepSeek models
   * Based on documentation: https://api-docs.deepseek.com/quick_start/pricing
   *
   * Models:
   * - deepseek-chat: DeepSeek-V3.2 (Non-thinking Mode) - 128K context
   * - deepseek-reasoner: DeepSeek-V3.2 (Thinking Mode) - 128K context
   *
   * @returns {Array} Array of model objects
   */
  getAvailableModels() {
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

  /**
   * Gets model names only (for compatibility with existing system)
   * @param {string} apiKey - DeepSeek API key (not used)
   * @param {Object} options - Optional parameters
   * @returns {Promise<Array<string>>} Array of model IDs
   */
  async getModelNames(apiKey, options = {}) {
    const models = await this.fetchModels(apiKey, options);
    return models.map((model) => model.id);
  }

  /**
   * Checks if cached models are still valid
   * Note: For DeepSeek, we always return true since models are hardcoded
   * @returns {boolean} True if cache is valid
   */
  isCacheValid() {
    // Always return true since we use hardcoded models
    return true;
  }

  /**
   * Clears the models cache
   * Note: No-op for DeepSeek since models are hardcoded
   */
  clearCache() {
    // No-op - models are hardcoded
    console.log('DeepSeek cache clear requested (no-op - models are hardcoded)');
  }

  /**
   * Returns fallback models if needed
   * Note: For DeepSeek, this returns the same as getAvailableModels
   * @returns {Array} Array of fallback model objects
   */
  getFallbackModels() {
    return this.getAvailableModels();
  }
}

// Export singleton instance
export default new DeepSeekService();
