class KimiCodeService {
  constructor() {
    this.models = ['kimi-for-coding'];
  }

  async fetchModels(_apiKey, options = {}) {
    const { useCache = true } = options;
    if (useCache && Array.isArray(this.models)) {
      return this.transformModels(this.models);
    }
    return this.transformModels(this.models);
  }

  transformModels(rawModels) {
    return rawModels.map((id) => ({
      id,
      name: id,
      description: 'Kimi Code model',
      createdAt: null,
      ownedBy: 'kimi-code',
    }));
  }

  async getModelNames(apiKey, options = {}) {
    const models = await this.fetchModels(apiKey, options);
    return models.map((model) => model.id);
  }

  isCacheValid() {
    return true;
  }

  clearCache() {
    // No-op; models are static for Kimi Code.
  }
}

export default new KimiCodeService();
