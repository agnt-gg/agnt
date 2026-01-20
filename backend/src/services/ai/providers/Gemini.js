import fetch from 'node-fetch';

class GeminiService {
  constructor() {
    this.baseURL = 'https://generativelanguage.googleapis.com/v1beta';
    this.modelsCache = null;
    this.cacheTimestamp = null;
    this.cacheTTL = 60 * 60 * 1000; // 1 hour in milliseconds
  }

  /**
   * Fetches available models from Gemini API
   * @param {string} apiKey - Gemini API key
   * @param {Object} options - Optional parameters
   * @returns {Promise<Array>} Array of model objects
   */
  async fetchModels(apiKey, options = {}) {
    const { useCache = true } = options;

    // Check cache first
    if (useCache && this.isCacheValid()) {
      console.log('Returning cached Gemini models');
      return this.modelsCache;
    }

    try {
      const url = new URL(`${this.baseURL}/models`);
      url.searchParams.append('key', apiKey);

      const response = await fetch(url.toString(), {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const models = this.transformModels(data.models || []);

      // Cache the results
      this.modelsCache = models;
      this.cacheTimestamp = Date.now();

      console.log(`Fetched ${models.length} models from Gemini API`);
      return models;
    } catch (error) {
      console.error('Failed to fetch Gemini models:', error);

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
   * Transforms Gemini model data to internal format
   * @param {Array} rawModels - Raw model data from Gemini API
   * @returns {Array} Transformed model objects
   */
  transformModels(rawModels) {
    return rawModels
      .filter((model) => model.name && model.supportedGenerationMethods && model.supportedGenerationMethods.includes('generateContent'))
      .map((model) => ({
        id: model.name.replace('models/', ''),
        name: model.displayName || model.name.replace('models/', ''),
        description: model.description || '',
        contextLength: model.inputTokenLimit || 0,
        outputTokenLimit: model.outputTokenLimit || 0,
        baseModelId: model.baseModelId,
        version: model.version,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Gets model names only (for compatibility with existing system)
   * @param {string} apiKey - Gemini API key
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
    return ['gemini-3-pro-preview', 'gemini-2.5-pro', 'gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash'].map((id) => ({
      id,
      name: id,
      description: 'Fallback model (API unavailable)',
      contextLength: 0,
      outputTokenLimit: 0,
      baseModelId: '',
      version: '',
    }));
  }
}

// Export singleton instance
export default new GeminiService();
