class OpenAICodexCliService {
  constructor() {
    this.models = ['gpt-5-codex', 'gpt-5'];
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
      description: 'Codex CLI model',
      createdAt: null,
      ownedBy: 'openai-codex-cli',
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
    // No-op; models are static.
  }
}

export default new OpenAICodexCliService();
