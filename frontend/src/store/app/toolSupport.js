/**
 * Tool Support Information
 *
 * Whether the selected model can call tools, shown as a warning in the model
 * pickers. Runtime detection via 'tools_skipped' events provides additional
 * coverage.
 *
 * PER-MODEL FACTS COME FROM THE BACKEND, NOT FROM HERE. The model metadata the
 * store loads for each provider's live list carries `supportsTools` wherever
 * the vendor publishes it (OpenRouter per model via `supported_parameters`,
 * Chutes via `supported_features`, curated entries otherwise). This file used
 * to hardcode Cerebras model lists instead; every id in them had been retired
 * by 2026-09-30 (Cerebras serves gpt-oss-120b and qwen-3.8-27b), so the lists
 * could only ever be wrong. What remains here is provider-level policy for
 * models the metadata says nothing about.
 */

/**
 * Provider-level warnings, used only when the model's own metadata does not
 * say whether it supports tools.
 */
export const PROVIDER_TOOL_WARNINGS = {
  Local: 'Local models may not support function calling. Tool usage depends on the model loaded locally.',
  OpenRouter: 'Tool support varies by model. Some OpenRouter models do not support function calling.',
  TogetherAI: 'Tool support varies by model. Check model documentation for function calling support.',
};

/** Providers that support function calling on every model they serve. */
export const PROVIDERS_WITH_FULL_TOOL_SUPPORT = ['Anthropic', 'OpenAI', 'Gemini', 'GrokAI', 'Groq', 'DeepSeek'];

const CUSTOM_PROVIDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Get tool support warning for a provider/model combination.
 * @param {string} provider - Provider name
 * @param {string} [model] - Model id
 * @param {Object} [modelMeta] - The model's metadata from the store
 *   (aiProvider.modelMetadata[provider][model]); its `supportsTools` wins.
 * @returns {string|null} Warning message or null if no warning needed
 */
export function getToolSupportWarning(provider, model = null, modelMeta = null) {
  if (!provider) return null;

  if (model && modelMeta?.supportsTools === false) {
    return `"${model}" does not support function calling. AI tools and agents will not work with this model.`;
  }
  if (model && modelMeta?.supportsTools === true) return null;

  if (PROVIDERS_WITH_FULL_TOOL_SUPPORT.includes(provider)) return null;
  if (PROVIDER_TOOL_WARNINGS[provider]) return PROVIDER_TOOL_WARNINGS[provider];
  if (CUSTOM_PROVIDER_ID.test(provider)) {
    return 'Custom providers may have limited function calling support. Tool usage depends on the underlying API.';
  }
  return null;
}

/** True only when the model's metadata says it cannot call tools. */
export function modelDefinitelyNoTools(provider, model, modelMeta = null) {
  return Boolean(provider && model && modelMeta?.supportsTools === false);
}

/** True when the model's metadata, or its provider's policy, says it can. */
export function modelDefinitelyHasTools(provider, model = null, modelMeta = null) {
  if (!provider) return false;
  if (modelMeta?.supportsTools === false) return false;
  if (modelMeta?.supportsTools === true) return true;
  return PROVIDERS_WITH_FULL_TOOL_SUPPORT.includes(provider);
}

export default {
  PROVIDER_TOOL_WARNINGS,
  PROVIDERS_WITH_FULL_TOOL_SUPPORT,
  getToolSupportWarning,
  modelDefinitelyNoTools,
  modelDefinitelyHasTools,
};
