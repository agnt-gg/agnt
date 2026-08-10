/**
 * The adapter factory and the module's public surface.
 *
 * The transports themselves live in ./transports — one file per wire protocol
 * rather than seven classes in one 7,100-line module. This file keeps every
 * name it previously exported, so all 39 importing modules are untouched.
 */
import CustomOpenAIProviderService from '../ai/CustomOpenAIProviderService.js';
import { getProviderConfig, getReasoningControl } from '../ai/providerConfigs.js';

import { BaseAdapter } from './transports/BaseAdapter.js';
import { OpenAiLikeAdapter, CerebrasAdapter } from './transports/chatCompletions.js';
import { AnthropicAdapter } from './transports/anthropicMessages.js';
import { GeminiAdapter } from './transports/gemini.js';
import { OpenAIResponsesAdapter, CodexResponsesAdapter } from './transports/openaiResponses.js';
import {
  requiresResponsesApi,
  buildOpenAiLikeReasoningExtraBody,
  normalizeReasoningValue,
} from './transports/_shared.js';

export async function createLlmAdapter(provider, client, model, options = {}) {
  // Check if this is a custom provider (UUID format)
  const isCustom = await CustomOpenAIProviderService.isCustomProvider(provider);
  if (isCustom) {
    console.log(`[LLM Adapter] Using OpenAI-like adapter for custom provider: ${provider}`);
    return new OpenAiLikeAdapter(client, model, { provider });
  }

  // Resolve provider key (handles display names like "Z-AI" → "zai")
  const config = getProviderConfig(provider);
  const lowerCaseProvider = config ? config.key : provider.toLowerCase();

  switch (lowerCaseProvider) {
    case 'claude-code':
    case 'anthropic':
      return new AnthropicAdapter(client, model, lowerCaseProvider, options);

    case 'gemini':
    case 'gemini-cli':
    case 'antigravity':
      return new GeminiAdapter(client, model, options);

    case 'cerebras': {
      console.log(`[LLM Adapter] Using CerebrasAdapter for model: ${model}`);
      const extraBody = buildOpenAiLikeReasoningExtraBody('cerebras', model, options.reasoningValue);
      return new CerebrasAdapter(client, model, { provider: lowerCaseProvider, ...(extraBody ? { extraBody } : {}) });
    }

    case 'openai':
      // Check if this model requires the new Responses API (GPT-5, o-series)
      if (requiresResponsesApi(model)) {
        console.log(`[LLM Adapter] Using OpenAIResponsesAdapter for model: ${model} (Responses API)`);
        return new OpenAIResponsesAdapter(client, model, options);
      }
      return new OpenAiLikeAdapter(client, model, { provider: lowerCaseProvider });

    case 'openai-codex':
      // Codex models use the ChatGPT backend Responses API (different from standard OpenAI).
      // The Codex OAuth client points at chatgpt.com/backend-api/codex, which only
      // exposes /responses — falling through to OpenAiLikeAdapter (which calls
      // /chat/completions) silently produces 4xx/5xx errors. Surface the misconfig
      // instead of papering over it.
      if (!requiresResponsesApi(model)) {
        throw new Error(
          `openai-codex provider requires a Responses-API model (gpt-5* or o-series); got "${model}". ` +
          `Pick a Codex-supported model in settings or switch providers.`
        );
      }
      console.log(`[LLM Adapter] Using CodexResponsesAdapter for codex model: ${model} (ChatGPT backend)`);
      return new CodexResponsesAdapter(client, model, options);

    case 'deepseek':
    case 'grokai':
    case 'grok-build':
    case 'cursor-cli':
    case 'groq':
    case 'kimi':
    case 'kimi-code':
    case 'chutes':
    case 'local':
    case 'minimax':
    case 'openrouter':
    case 'togetherai': {
      const extraBody = buildOpenAiLikeReasoningExtraBody(lowerCaseProvider, model, options.reasoningValue);
      // Pass provider key for Kimi/Kimi Code so their strict Moonshot schema validator
      // gets pre-sanitized tool parameters (array fields require an `items` definition).
      const adapterOptions = { provider: lowerCaseProvider };
      if (extraBody) adapterOptions.extraBody = extraBody;
      // OpenRouter uses this as its sticky-routing key so a conversation keeps
      // hitting the upstream endpoint that holds its cached prefix.
      if (options.conversationId) adapterOptions.conversationId = options.conversationId;
      return new OpenAiLikeAdapter(client, model, adapterOptions);
    }

    case 'zai': {
      // Z.AI GLM-5 has optional thinking mode.
      // Only send the thinking param when explicitly enabling it — omitting it
      // lets the API use its default behavior without risking rejection.
      const extraBody = buildOpenAiLikeReasoningExtraBody('zai', model, options.reasoningValue);
      if (getReasoningControl('zai', model)) {
        console.log(`[LLM Adapter] Z.AI reasoning model: ${model}, selection: ${normalizeReasoningValue(options.reasoningValue)}`);
      }
      return new OpenAiLikeAdapter(client, model, { provider: lowerCaseProvider, ...(extraBody ? { extraBody } : {}) });
    }

    default:
      throw new Error(`Unsupported provider for LLM adapter: ${provider}`);
  }
}

// The public surface, unchanged. 39 modules import from this file; keeping
// every previously-exported name here is what makes the split invisible to
// them and reviewable on its own terms.
export {
  GeminiAdapter,
  buildOpenAiLikeReasoningExtraBody,
  BaseAdapter,
  OpenAiLikeAdapter,
  AnthropicAdapter,
  OpenAIResponsesAdapter,
  CodexResponsesAdapter,
  requiresResponsesApi,
};
