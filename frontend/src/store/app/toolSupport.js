/**
 * Tool Support Information
 *
 * This file contains information about which providers/models support
 * function calling (tool use). This is used to display warnings in the UI
 * when a user selects a model that may not support tools.
 *
 * Note: This is a frontend-only solution for immediate warnings.
 * Runtime detection via 'tools_skipped' events provides additional coverage.
 */

/**
 * Provider-level warnings for providers where tool support varies or is unknown
 */
export const PROVIDER_TOOL_WARNINGS = {
  Local: 'Local models may not support function calling. Tool usage depends on the model loaded locally.',
  OpenRouter: 'Tool support varies by model. Some OpenRouter models do not support function calling.',
  TogetherAI: 'Tool support varies by model. Check model documentation for function calling support.',
};

/**
 * Models that are KNOWN to NOT support function calling
 * Format: { providerName: [modelId1, modelId2, ...] }
 */
export const MODELS_WITHOUT_TOOL_SUPPORT = {
  Cerebras: ['llama3.1-8b', 'llama-3.3-70b', 'qwen-3-32b', 'qwen-3-235b-a22b-instruct-2507'],
};

/**
 * Models that ARE KNOWN to support function calling (for providers with mixed support)
 * Format: { providerName: [modelId1, modelId2, ...] }
 */
export const MODELS_WITH_TOOL_SUPPORT = {
  Cerebras: ['gpt-oss-120b', 'zai-glm-4.6'],
};

/**
 * Providers that fully support function calling on all models
 */
export const PROVIDERS_WITH_FULL_TOOL_SUPPORT = ['Anthropic', 'OpenAI', 'Gemini', 'GrokAI', 'Groq', 'DeepSeek'];

/**
 * Get tool support warning for a provider/model combination
 * @param {string} provider - Provider name
 * @param {string} model - Model name (optional)
 * @returns {string|null} Warning message or null if no warning needed
 */
export function getToolSupportWarning(provider, model = null) {
  if (!provider) return null;

  // Providers with full tool support - no warning needed
  if (PROVIDERS_WITH_FULL_TOOL_SUPPORT.includes(provider)) {
    return null;
  }

  // Check if this specific model is known to NOT support tools
  const noToolModels = MODELS_WITHOUT_TOOL_SUPPORT[provider];
  if (model && noToolModels?.includes(model)) {
    return `"${model}" does not support function calling. AI tools and agents will not work with this model.`;
  }

  // Check if this specific model is known to support tools (for mixed providers)
  const toolModels = MODELS_WITH_TOOL_SUPPORT[provider];
  if (model && toolModels?.includes(model)) {
    return null; // This model supports tools
  }

  // Check for provider-level warnings (unknown/varies)
  if (PROVIDER_TOOL_WARNINGS[provider]) {
    return PROVIDER_TOOL_WARNINGS[provider];
  }

  // For custom providers, show a generic warning
  // Custom providers are identified by UUID format
  const isCustomProvider = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(provider);
  if (isCustomProvider) {
    return 'Custom providers may have limited function calling support. Tool usage depends on the underlying API.';
  }

  return null;
}

/**
 * Check if a model definitely does NOT support tools
 * @param {string} provider - Provider name
 * @param {string} model - Model name
 * @returns {boolean} True if model definitely doesn't support tools
 */
export function modelDefinitelyNoTools(provider, model) {
  if (!provider || !model) return false;
  const noToolModels = MODELS_WITHOUT_TOOL_SUPPORT[provider];
  return noToolModels?.includes(model) || false;
}

/**
 * Check if a model definitely supports tools
 * @param {string} provider - Provider name
 * @param {string} model - Model name
 * @returns {boolean} True if model definitely supports tools
 */
export function modelDefinitelyHasTools(provider, model) {
  if (!provider) return false;

  // Full support providers
  if (PROVIDERS_WITH_FULL_TOOL_SUPPORT.includes(provider)) {
    return true;
  }

  // Check specific model support
  if (model) {
    const toolModels = MODELS_WITH_TOOL_SUPPORT[provider];
    return toolModels?.includes(model) || false;
  }

  return false;
}

export default {
  PROVIDER_TOOL_WARNINGS,
  MODELS_WITHOUT_TOOL_SUPPORT,
  MODELS_WITH_TOOL_SUPPORT,
  PROVIDERS_WITH_FULL_TOOL_SUPPORT,
  getToolSupportWarning,
  modelDefinitelyNoTools,
  modelDefinitelyHasTools,
};
