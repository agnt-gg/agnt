/**
 * SINGLE SOURCE OF TRUTH for all AI provider configurations.
 *
 * To add a new provider: add one object to the PROVIDER_CONFIGS array.
 * Everything else (LlmService, ProviderRegistry, ModelRoutes) reads from here.
 *
 * To update a provider: change it here and only here.
 */

import { isAnthropicReasoningModel, anthropicSupportsXHigh } from './reasoningModels.js';
// The GPT-5.6 family boundary. Defined once in promptCacheTtl, which uses it
// to pick the retention control; reused here because the same boundary decides
// whether cache writes bill at 1.25x.
import { OPENAI_GPT56_OR_LATER as GPT_56_OR_LATER } from '../../utils/promptCacheTtl.js';

// Reasoning predicates live in the SHARED DESCRIPTOR (invariant I1). That
// module is isomorphic — the Vue frontend imports the very same file through a
// Vite alias — which is what finally removes the third copy of this knowledge.
// Imported for local use and re-exported so existing consumers (llmAdapters,
// tests) keep their current import paths.
import {
  isOpenAIResponsesReasoningModel,
  isAnthropicAdaptiveThinkingModel,
  isGemini3ReasoningModel,
  isGemini25ReasoningModel,
  supportsDeepSeekThinkingToggle,
  isGroqGptOssReasoningModel,
  isGroqQwenReasoningModel,
  isCerebrasGptOssReasoningModel,
  isCerebrasGlmReasoningModel,
  supportsZaiThinkingToggle,
  supportsZaiReasoningEffort,
  supportsKimiReasoningToggle,
  isOpenRouterOpenAIReasoningModel,
  isOpenRouterAnthropicReasoningModel,
  isOpenRouterGeminiReasoningModel,
  isOpenRouterXaiReasoningModel,
  isTogetherGptOssReasoningModel,
  isChutesKimiReasoningModel,
  isChutesGlmReasoningModel,
  isChutesQwenReasoningModel,
} from './descriptor/reasoningPredicates.js';

export {
  isOpenAIResponsesReasoningModel,
  isAnthropicAdaptiveThinkingModel,
  isGemini3ReasoningModel,
  isGemini25ReasoningModel,
  supportsDeepSeekThinkingToggle,
  isGroqGptOssReasoningModel,
  isGroqQwenReasoningModel,
  isCerebrasGptOssReasoningModel,
  isCerebrasGlmReasoningModel,
  supportsZaiThinkingToggle,
  supportsZaiReasoningEffort,
  supportsKimiReasoningToggle,
  isOpenRouterOpenAIReasoningModel,
  isOpenRouterAnthropicReasoningModel,
  isOpenRouterGeminiReasoningModel,
  isOpenRouterXaiReasoningModel,
  isTogetherGptOssReasoningModel,
  isChutesKimiReasoningModel,
  isChutesGlmReasoningModel,
  isChutesQwenReasoningModel,
};

// ─────────────────────────── PROVIDER CONFIGS ───────────────────────────

const PROVIDER_CONFIGS = [
  // ─────────────────────────── OPENAI ───────────────────────────
  {
    key: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    sdkType: 'openai',
    authScheme: 'bearer',
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
      // DALL-E IS GONE. Verified live 2026-08-11 against the account's own
      // /v1/models: `dall-e-3` returns 400 "The model 'dall-e-3' does not
      // exist", and the image models actually served are the gpt-image family.
      // Image generation was therefore failing outright for every OpenAI user,
      // with a misleading "Unknown parameter: 'response_format'" because that
      // error surfaces before the model is validated.
      //
      // chatgpt-image-latest is deliberately omitted: it exists but returns
      // 403 "your organization must be verified", so advertising it would
      // offer a choice that cannot work.
      imageGen: {
        models: ['gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini', 'gpt-image-2'],
        operations: ['generate', 'edit'],
        defaultModel: 'gpt-image-1',
        supportedSizes: {
          'gpt-image-1': ['1024x1024', '1536x1024', '1024x1536', 'auto'],
          'gpt-image-1-mini': ['1024x1024', '1536x1024', '1024x1536', 'auto'],
          'gpt-image-1.5': ['1024x1024', '1536x1024', '1024x1536', 'auto'],
          'gpt-image-2': ['1024x1024', '1536x1024', '1024x1536', 'auto'],
        },
        // The gpt-image family ALWAYS returns base64 and rejects an explicit
        // response_format, so there is no format to choose.
        supportedFormats: ['b64_json'],
        maxImages: 10,
        supportsQuality: true,
        supportsStyle: false,
      },
    },
    recommendedModels: ['gpt-5.6', 'gpt-5.5', 'o4-mini', 'gpt-4.1'],
    fallbackModels: ['gpt-5.6', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2', 'gpt-5.2-codex', 'gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'o4-mini', 'o3', 'o3-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini'],
    fallbackVisionModels: ['gpt-5.2', 'gpt-4.1'],    modelMetadata: {
      // gpt-5.6-sol: capped at 272k (not the true 400k window) because OpenAI
      // bills 2x input / 1.5x output on the ENTIRE request once tokenized input
      // exceeds 272,000. Keeping contextWindow at the cliff makes compression
      // trigger well below it ((272k - 32k reasoning buffer) * 0.93 ≈ 223k),
      // so requests never enter the long-context pricing tier.
      'gpt-5.6-sol': { contextWindow: 272000, maxOutputTokens: 128000, inputCostPer1M: 1.25, outputCostPer1M: 10.0, supportsVision: true, supportsTools: true, reasoning: true },
      'gpt-5.2': { contextWindow: 400000, maxOutputTokens: 128000, inputCostPer1M: 1.75, outputCostPer1M: 14.0, supportsVision: true, supportsTools: true, reasoning: true },
      'gpt-5.1': { contextWindow: 400000, maxOutputTokens: 128000, inputCostPer1M: 1.25, outputCostPer1M: 10.0, supportsVision: true, supportsTools: true, reasoning: false },
      'gpt-5': { contextWindow: 400000, maxOutputTokens: 128000, inputCostPer1M: 1.25, outputCostPer1M: 10.0, supportsVision: true, supportsTools: true, reasoning: false },
      'gpt-5-mini': { contextWindow: 400000, maxOutputTokens: 128000, inputCostPer1M: 0.25, outputCostPer1M: 2.0, supportsVision: true, supportsTools: true, reasoning: false },
      'gpt-5-nano': { contextWindow: 400000, maxOutputTokens: 128000, inputCostPer1M: 0.05, outputCostPer1M: 0.4, supportsVision: true, supportsTools: true, reasoning: false },
      'o4-mini': { contextWindow: 200000, maxOutputTokens: 100000, inputCostPer1M: 1.1, outputCostPer1M: 4.4, supportsVision: true, supportsTools: true, reasoning: true },
      'o3': { contextWindow: 200000, maxOutputTokens: 100000, inputCostPer1M: 2.0, outputCostPer1M: 8.0, supportsVision: true, supportsTools: true, reasoning: true },
      'o3-mini': { contextWindow: 200000, maxOutputTokens: 100000, inputCostPer1M: 1.1, outputCostPer1M: 4.4, supportsVision: true, supportsTools: true, reasoning: true },
      'gpt-4.1': { contextWindow: 1000000, maxOutputTokens: 32768, inputCostPer1M: 2.0, outputCostPer1M: 8.0, supportsVision: true, supportsTools: true, reasoning: false },
      'gpt-4.1-mini': { contextWindow: 1000000, maxOutputTokens: 32768, inputCostPer1M: 0.4, outputCostPer1M: 1.6, supportsVision: true, supportsTools: true, reasoning: false },
      'gpt-4.1-nano': { contextWindow: 1000000, maxOutputTokens: 32768, inputCostPer1M: 0.1, outputCostPer1M: 0.4, supportsVision: true, supportsTools: true, reasoning: false },
      'gpt-4o': { contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 2.5, outputCostPer1M: 10.0, supportsVision: true, supportsTools: true, reasoning: false },
      'gpt-4o-mini': { contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0.15, outputCostPer1M: 0.6, supportsVision: true, supportsTools: true, reasoning: false },
      'gpt-4': { contextWindow: 128000, maxOutputTokens: 4096, inputCostPer1M: 30.0, outputCostPer1M: 60.0, supportsVision: false, supportsTools: true, reasoning: false },
      'gpt-3.5-turbo': { contextWindow: 16385, maxOutputTokens: 4096, inputCostPer1M: 0.5, outputCostPer1M: 1.5, supportsVision: false, supportsTools: true, reasoning: false },
      'dall-e-3': { contextWindow: 4096, maxOutputTokens: 4096, inputCostPer1M: 40.0, outputCostPer1M: 80.0, supportsVision: false, supportsTools: false },
      'dall-e-2': { contextWindow: 4096, maxOutputTokens: 4096, inputCostPer1M: 20.0, outputCostPer1M: 40.0, supportsVision: false, supportsTools: false },
      'dall-e': { contextWindow: 4096, maxOutputTokens: 4096, inputCostPer1M: 20.0, outputCostPer1M: 40.0, supportsVision: false, supportsTools: false },
      'gpt-image': { contextWindow: 4096, maxOutputTokens: 4096, inputCostPer1M: 40.0, outputCostPer1M: 80.0, supportsVision: false, supportsTools: false },
      'gpt-image-1': { contextWindow: 4096, maxOutputTokens: 4096, inputCostPer1M: 40.0, outputCostPer1M: 80.0, supportsVision: false, supportsTools: false },
      'gpt-5.6-luna': { contextWindow: 400000, maxOutputTokens: 128000, inputCostPer1M: 1.75, outputCostPer1M: 14.0, supportsVision: true, supportsTools: true, reasoning: true },
      'gpt-5.6-terra': { contextWindow: 400000, maxOutputTokens: 128000, inputCostPer1M: 1.75, outputCostPer1M: 14.0, supportsVision: true, supportsTools: true, reasoning: true },
      'gpt-5.4': { contextWindow: 400000, maxOutputTokens: 128000, inputCostPer1M: 1.0, outputCostPer1M: 5.0, supportsVision: true, supportsTools: true, reasoning: false },
      'gpt-5.4-mini': { contextWindow: 400000, maxOutputTokens: 128000, inputCostPer1M: 0.15, outputCostPer1M: 0.6, supportsVision: true, supportsTools: true, reasoning: false },
      'gpt-5.3-codex-spark': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 0.5, outputCostPer1M: 2.0, supportsVision: true, supportsTools: true, reasoning: true },
      // Deep Research: OpenAI publishes these as their own SKUs — $10/$40 and
      // $2/$8 per million (platform.openai.com/docs/pricing).
      'o3-deep-research': { contextWindow: 200000, maxOutputTokens: 100000, inputCostPer1M: 10.0, outputCostPer1M: 40.0, supportsVision: true, supportsTools: true, reasoning: true },
      'o4-mini-deep-research': { contextWindow: 200000, maxOutputTokens: 100000, inputCostPer1M: 2.0, outputCostPer1M: 8.0, supportsVision: true, supportsTools: true, reasoning: true },
      // 'chat-latest' is OpenAI's rolling alias for the current ChatGPT model,
      // billed at the flagship rate it currently points at.
      'chat-latest': { contextWindow: 400000, maxOutputTokens: 128000, inputCostPer1M: 1.25, outputCostPer1M: 10.0, supportsVision: true, supportsTools: true, reasoning: false },
    },
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── OPENAI CODEX ───────────────────────────
  {
    key: 'openai-codex',
    name: 'OpenAI Codex',
    baseURL: 'https://chatgpt.com/backend-api/codex',
    sdkType: 'openai',
    authScheme: 'codex',
    codexModelFetch: true,
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      // gpt-5.2-codex / 5.3-codex / 5.5 accept input_image via the Codex
      // backend's Responses endpoint. Without this declaration the orchestrator
      // and adapter would silently drop uploaded images for Codex sessions.
      // https://openai.com/index/introducing-gpt-5-2-codex/
      vision: { supportsStreaming: true },
    },
    // Fallback used only when Codex upstream is unreachable AND we have no
    // last-successful cache on disk (see codex-last-models.json / persistent
    // fallback in ModelRoutes). Bumped 2026-07 to include gpt-5.6 variants so
    // a degraded state doesn't hide the currently-shipping models.
    fallbackModels: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark', 'gpt-5.2-codex'],
    fallbackVisionModels: ['gpt-5.6-sol', 'gpt-5.5', 'gpt-5.2-codex'],
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── ANTHROPIC ───────────────────────────
  {
    key: 'anthropic',
    name: 'Anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    sdkType: 'anthropic',
    authScheme: 'api-key',
    fetchHeaders: {
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31,extended-cache-ttl-2025-04-11',
    },
    sdkOptions: {
      defaultHeaders: {
        'anthropic-beta': 'prompt-caching-2024-07-31,extended-cache-ttl-2025-04-11',
      },
    },
    pagination: {
      enabled: true,
      pageSize: 100,
      cursorParam: 'after_id',
      hasMoreField: 'has_more',
    },
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
    },
    recommendedModels: [
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-5-20250929',
    ],
    fallbackModels: [
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-5-20250929',
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
    ],
    fallbackVisionModels: ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6'],
    modelMetadata: {
      'claude-fable-5': { contextWindow: 1000000, maxOutputTokens: 128000, inputCostPer1M: 10.0, outputCostPer1M: 50.0, supportsVision: true, supportsTools: true, reasoning: true },
      'claude-mythos-5': { contextWindow: 1000000, maxOutputTokens: 128000, inputCostPer1M: 10.0, outputCostPer1M: 50.0, supportsVision: true, supportsTools: true, reasoning: true },
      'claude-mythos-preview': { contextWindow: 1000000, maxOutputTokens: 128000, inputCostPer1M: 10.0, outputCostPer1M: 50.0, supportsVision: true, supportsTools: true, reasoning: true },
      // Claude 5 flagship pair (GA 2026-06-09 per platform.claude.com/docs).
      // Both 1M context, 128k output, adaptive thinking always on.
      'claude-opus-5': { contextWindow: 1000000, maxOutputTokens: 128000, inputCostPer1M: 5.0, outputCostPer1M: 25.0, supportsVision: true, supportsTools: true, reasoning: true },
      // claude-sonnet-5 introductory pricing is $2/$10 through 2026-08-31,
      // reverting to the standard $3/$15 after. We record the standard rate
      // so cost estimates aren't understated once the promo ends.
      'claude-sonnet-5': { contextWindow: 1000000, maxOutputTokens: 128000, inputCostPer1M: 3.0, outputCostPer1M: 15.0, supportsVision: true, supportsTools: true, reasoning: true },
      'claude-opus-4-8': { contextWindow: 1000000, maxOutputTokens: 128000, inputCostPer1M: 5.0, outputCostPer1M: 25.0, supportsVision: true, supportsTools: true, reasoning: true },
      'claude-opus-4-7': { contextWindow: 1000000, maxOutputTokens: 128000, inputCostPer1M: 5.0, outputCostPer1M: 25.0, supportsVision: true, supportsTools: true, reasoning: true },
      'claude-opus-4-6': { contextWindow: 200000, maxOutputTokens: 128000, inputCostPer1M: 5.0, outputCostPer1M: 25.0, supportsVision: true, supportsTools: true, reasoning: true },
      'claude-sonnet-4-6': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 3.0, outputCostPer1M: 15.0, supportsVision: true, supportsTools: true, reasoning: true },
      'claude-opus-4-5-20251101': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 5.0, outputCostPer1M: 25.0, supportsVision: true, supportsTools: true, reasoning: true },
      'claude-sonnet-4-5-20250929': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 3.0, outputCostPer1M: 15.0, supportsVision: true, supportsTools: true, reasoning: true },
      'claude-haiku-4-5-20251001': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 1.0, outputCostPer1M: 5.0, supportsVision: true, supportsTools: true, reasoning: false },
      'claude-sonnet-4-20250514': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 3.0, outputCostPer1M: 15.0, supportsVision: true, supportsTools: true, reasoning: false },
      'claude-opus-4-20250514': { contextWindow: 200000, maxOutputTokens: 32000, inputCostPer1M: 15.0, outputCostPer1M: 75.0, supportsVision: true, supportsTools: true, reasoning: false },
      'claude-3-7-sonnet': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 3.0, outputCostPer1M: 15.0, inputCacheReadCostPer1M: 0.3, supportsVision: true, supportsTools: true, reasoning: true },
      'claude-3-7-sonnet-20250219': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 3.0, outputCostPer1M: 15.0, inputCacheReadCostPer1M: 0.3, supportsVision: true, supportsTools: true, reasoning: true },
      'claude-3-5-sonnet-20241022': { contextWindow: 200000, maxOutputTokens: 8192, inputCostPer1M: 3.0, outputCostPer1M: 15.0, inputCacheReadCostPer1M: 0.3, supportsVision: true, supportsTools: true },
      'claude-3-5-sonnet-20240620': { contextWindow: 200000, maxOutputTokens: 8192, inputCostPer1M: 3.0, outputCostPer1M: 15.0, inputCacheReadCostPer1M: 0.3, supportsVision: true, supportsTools: true },
      'claude-3-5-haiku-20241022': { contextWindow: 200000, maxOutputTokens: 8192, inputCostPer1M: 1.0, outputCostPer1M: 5.0, inputCacheReadCostPer1M: 0.1, supportsVision: true, supportsTools: true },
      'claude-3-haiku-20240307': { contextWindow: 200000, maxOutputTokens: 4096, inputCostPer1M: 0.25, outputCostPer1M: 1.25, inputCacheReadCostPer1M: 0.03, supportsVision: true, supportsTools: true },
      'claude-3-opus-20240229': { contextWindow: 200000, maxOutputTokens: 4096, inputCostPer1M: 15.0, outputCostPer1M: 75.0, inputCacheReadCostPer1M: 1.5, supportsVision: true, supportsTools: true },
      'claude-3-sonnet-20240229': { contextWindow: 200000, maxOutputTokens: 4096, inputCostPer1M: 3.0, outputCostPer1M: 15.0, inputCacheReadCostPer1M: 0.3, supportsVision: true, supportsTools: true },
      'claude-sonnet-4-5': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 3.0, outputCostPer1M: 15.0, inputCacheReadCostPer1M: 0.3, supportsVision: true, supportsTools: true },
      'claude-haiku-4-5': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 1.0, outputCostPer1M: 5.0, inputCacheReadCostPer1M: 0.1, supportsVision: true, supportsTools: true },
      'claude-opus-4-5': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 5.0, outputCostPer1M: 25.0, inputCacheReadCostPer1M: 0.5, supportsVision: true, supportsTools: true },
      'claude-sonnet-4-0': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 3.0, outputCostPer1M: 15.0, inputCacheReadCostPer1M: 0.3, supportsVision: true, supportsTools: true },
      'claude-opus-4-0': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 5.0, outputCostPer1M: 25.0, inputCacheReadCostPer1M: 0.5, supportsVision: true, supportsTools: true },
      'claude-opus-4-1': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 5.0, outputCostPer1M: 25.0, inputCacheReadCostPer1M: 0.5, supportsVision: true, supportsTools: true },
      'claude-opus-4-1-20250805': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 5.0, outputCostPer1M: 25.0, inputCacheReadCostPer1M: 0.5, supportsVision: true, supportsTools: true },
      'claude-opus-4': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 5.0, outputCostPer1M: 25.0, inputCacheReadCostPer1M: 0.5, supportsVision: true, supportsTools: true },
      'claude-sonnet-4': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 3.0, outputCostPer1M: 15.0, inputCacheReadCostPer1M: 0.3, supportsVision: true, supportsTools: true },
      'claude-3': { contextWindow: 200000, maxOutputTokens: 4096, inputCostPer1M: 3.0, outputCostPer1M: 15.0, inputCacheReadCostPer1M: 0.3, supportsVision: true, supportsTools: true },
    },
    modelTransform: (raw) => ({
      id: raw.id,
      name: raw.display_name || raw.id,
      description: raw.description || '',
      // Anthropic's /v1/models returns max_input_tokens (true context window)
      // and max_tokens (max output). Prefer max_input_tokens; keep the
      // legacy max_tokens fallback for older API responses.
      contextLength: raw.max_input_tokens || raw.max_tokens || 0,
      maxOutputTokens: raw.max_tokens || 0,
      createdAt: raw.created_at,
    }),
    modelFilter: (m) => m.id && m.display_name,
    compat: {},
  },

  // ─────────────────────────── CLAUDE CODE ───────────────────────────
  {
    key: 'claude-code',
    name: 'Claude Code',
    baseURL: 'https://api.anthropic.com/v1',
    sdkType: 'anthropic',
    authScheme: 'claude-code',
    fetchHeaders: {
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
      'user-agent': 'claude-cli/2.1.2 (external, cli)',
      'x-app': 'cli',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    sdkOptions: {
      defaultHeaders: {
        // TODO(PRD-082): All beta tokens here are from 2024-2025; Fable 5 /
        // Mythos 5 shipped June 2026 with always-on adaptive thinking. If
        // Phase 1 diagnostic logs show `stop_reason=end_turn + blocks={} +
        // tiny output_tokens`, refresh this header with the current 2026
        // beta tokens documented at platform.claude.com (and/or mirrored in
        // the Claude Code GitHub source).
        'anthropic-beta':
          'claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14,prompt-caching-2024-07-31,extended-cache-ttl-2025-04-11',
        'user-agent': 'claude-cli/2.1.2 (external, cli)',
        'x-app': 'cli',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    },
    pagination: {
      enabled: true,
      pageSize: 100,
      cursorParam: 'after_id',
      hasMoreField: 'has_more',
    },
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
    },
    recommendedModels: [
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-5-20250929',
    ],
    fallbackModels: [
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-5-20250929',
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
    ],
    fallbackVisionModels: ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6'],
    modelTransform: (raw) => ({
      id: raw.id,
      name: raw.display_name || raw.id,
      description: raw.description || '',
      // Prefer max_input_tokens (true context window). max_tokens is max
      // output; kept as legacy fallback for older API responses.
      contextLength: raw.max_input_tokens || raw.max_tokens || 0,
      maxOutputTokens: raw.max_tokens || 0,
      createdAt: raw.created_at,
    }),
    compat: {},
  },

  // ─────────────────────────── GEMINI ───────────────────────────
  {
    key: 'gemini',
    name: 'Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    sdkType: 'gemini',
    authScheme: 'query-param',
    responseDataPath: 'models',
    pagination: {
      enabled: true,
      pageSize: 100,
      limitParam: 'pageSize',
      cursorParam: 'pageToken',
      hasMoreField: 'nextPageToken',
    },
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
      imageGen: {
        models: ['gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview'],
        operations: ['generate'],
        defaultModel: 'gemini-3.1-flash-image-preview',
        supportedAspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
        supportedResolutions: ['1K', '2K', '4K'],
        supportsGoogleSearch: true,
      },
    },
    recommendedModels: ['gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'],
    fallbackModels: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    fallbackVisionModels: ['gemini-3.1-pro-preview', 'gemini-2.5-pro'],
    modelMetadata: {
      'gemini-3.1-pro-preview': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 2.0, outputCostPer1M: 12.0, supportsVision: true, supportsTools: true, reasoning: true },
      'gemini-3-flash-preview': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0.5, outputCostPer1M: 3.0, supportsVision: true, supportsTools: true, reasoning: false },
      'gemini-2.5-pro': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 1.25, outputCostPer1M: 10.0, supportsVision: true, supportsTools: true, reasoning: true },
      'gemini-2.5-flash': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0.3, outputCostPer1M: 2.5, supportsVision: true, supportsTools: true, reasoning: true },
      'gemini-2.5-flash-lite': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0.1, outputCostPer1M: 0.4, supportsVision: true, supportsTools: true, reasoning: false },
      // Gemini 3 Pro (preview): $2 in / $12 out, cached reads $0.20 (≤200k tier)
      // per ai.google.dev/gemini-api/docs/pricing, as of 2026-08-01. Also the
      // notional rate for gemini-cli seat usage via PROVIDER_METADATA_FALLBACK.
      'gemini-3-pro-preview': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 2.0, outputCostPer1M: 12.0, inputCacheReadCostPer1M: 0.2, supportsVision: true, supportsTools: true, reasoning: true },
      'gemini-1.5-flash': { contextWindow: 1048576, maxOutputTokens: 8192, inputCostPer1M: 0.075, outputCostPer1M: 0.3, inputCacheReadCostPer1M: 0.01875, supportsVision: true, supportsTools: true },
      'gemini-1.5-pro': { contextWindow: 2097152, maxOutputTokens: 8192, inputCostPer1M: 1.25, outputCostPer1M: 5.0, inputCacheReadCostPer1M: 0.3125, supportsVision: true, supportsTools: true },
      'gemini-2.0-flash': { contextWindow: 1048576, maxOutputTokens: 8192, inputCostPer1M: 0.1, outputCostPer1M: 0.4, inputCacheReadCostPer1M: 0.025, supportsVision: true, supportsTools: true },
      'gemini-2.0-flash-exp': { contextWindow: 1048576, maxOutputTokens: 8192, inputCostPer1M: 0.1, outputCostPer1M: 0.4, inputCacheReadCostPer1M: 0.025, supportsVision: true, supportsTools: true },
      'gemini-2.5-flash-image': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0.15, outputCostPer1M: 0.6, supportsVision: true, supportsTools: true },
      'gemini-3.1-flash-image-preview': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0.5, outputCostPer1M: 3.0, supportsVision: true, supportsTools: true },
      'gemini-3.5-flash': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0.35, outputCostPer1M: 2.1, supportsVision: true, supportsTools: true },
      'gemini-3.6-flash-high': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0.5, outputCostPer1M: 3.0, supportsVision: true, supportsTools: true },
      'gemini-3.6-flash-medium': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0.5, outputCostPer1M: 3.0, supportsVision: true, supportsTools: true },
      'gemini-3.6-flash-low': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0.5, outputCostPer1M: 3.0, supportsVision: true, supportsTools: true },
      'gemini-3-flash': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0.5, outputCostPer1M: 3.0, supportsVision: true, supportsTools: true },
      'gemini-pro': { contextWindow: 32768, maxOutputTokens: 8192, inputCostPer1M: 0.5, outputCostPer1M: 1.5, supportsVision: true, supportsTools: true },
      'gemini-3-pro': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 2.0, outputCostPer1M: 12.0, inputCacheReadCostPer1M: 0.2, supportsVision: true, supportsTools: true },
      'gemini-2.5-pro-exp-03-25': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 1.25, outputCostPer1M: 10.0, supportsVision: true, supportsTools: true },
      'gemini-2.5-flash-thinking': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0.15, outputCostPer1M: 0.60, supportsVision: true, supportsTools: true },
      'gemini-3': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0.5, outputCostPer1M: 3.0, supportsVision: true, supportsTools: true },
      'gemini-2.5': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0.3, outputCostPer1M: 2.5, supportsVision: true, supportsTools: true },
      // Published rates, ai.google.dev/gemini-api/docs/pricing (2026-08-01).
      'gemini-2.0-flash-lite': { contextWindow: 1048576, maxOutputTokens: 8192, inputCostPer1M: 0.075, outputCostPer1M: 0.3, supportsVision: true, supportsTools: true, reasoning: false },
      'gemini-flash-lite-latest': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0.1, outputCostPer1M: 0.4, supportsVision: true, supportsTools: true, reasoning: false },
      'gemini-omni-flash-preview': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0.3, outputCostPer1M: 2.5, supportsVision: true, supportsTools: true, reasoning: false },
      // Google publishes no SEPARATE per-token rate for the Antigravity IDE
      // build or the Deep Research products — they are metered as the Gemini 3
      // Pro tier they run on, so that is the rate recorded here rather than a
      // number invented for them.
      'antigravity-preview-05-2026': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 2.0, outputCostPer1M: 12.0, inputCacheReadCostPer1M: 0.2, supportsVision: true, supportsTools: true, reasoning: true },
      'deep-research-pro-preview-12-2025': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 2.0, outputCostPer1M: 12.0, supportsVision: true, supportsTools: true, reasoning: true },
      'deep-research-max-preview-04-2026': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 2.0, outputCostPer1M: 12.0, supportsVision: true, supportsTools: true, reasoning: true },
    },
    modelTransform: (raw) => ({
      id: raw.name?.replace('models/', '') || raw.id,
      name: raw.displayName || raw.name?.replace('models/', '') || raw.id,
      description: raw.description || '',
      contextLength: raw.inputTokenLimit || 0,
      outputTokenLimit: raw.outputTokenLimit || 0,
    }),
    modelFilter: (m) => m.name && m.supportedGenerationMethods?.includes('generateContent'),
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── GEMINI CLI ───────────────────────────
  {
    key: 'gemini-cli',
    name: 'Gemini CLI',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    sdkType: 'gemini',
    authScheme: 'gemini-cli',
    responseDataPath: 'models',
    pagination: {
      enabled: true,
      pageSize: 100,
      limitParam: 'pageSize',
      cursorParam: 'pageToken',
      hasMoreField: 'nextPageToken',
    },
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
    },
    recommendedModels: ['gemini-3-pro-preview', 'gemini-3-flash-preview'],
    fallbackModels: ['gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    fallbackVisionModels: ['gemini-2.5-pro'],
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── ANTIGRAVITY ───────────────────────────
  // Google's unified gateway (folded Gemini CLI into Antigravity, I/O 2026).
  // OAuth-only, multi-vendor: Gemini 3.x + Claude 4.6 + GPT-OSS through one
  // Google login. Routes through the GeminiAdapter via AntigravityOAuthProxy.
  // ⚠️ ToS-gated — connect popup shows a consent warning (customPrompt). PRD-107.
  {
    key: 'antigravity',
    name: 'Antigravity',
    // Informational/default model-plane URL. Antigravity OAuth transport uses
    // its dedicated proxy and can be overridden with ANTIGRAVITY_MODEL_GATEWAY.
    baseURL: process.env.ANTIGRAVITY_MODEL_GATEWAY
      || 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal',
    sdkType: 'gemini',
    authScheme: 'antigravity',
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
    },
    // Model IDs are the gateway's REAL ids from :fetchAvailableModels (its
    // "Recommended" agent sort, 2026-07-03). Do NOT invent ids here — the
    // gateway 404s unknown models. Display names differ from ids (e.g.
    // 'gemini-pro-agent' renders as "Gemini 3.1 Pro (High)"). Dynamic listing
    // in ModelRoutes refreshes this live; this static list is the fallback.
    recommendedModels: [
      'gemini-3.6-flash-high',
      'gemini-3.6-flash-medium',
      'gemini-3.6-flash-low',
    ],
    fallbackModels: [
      'gemini-3.6-flash-high',
      'gemini-3.6-flash-medium',
      'gemini-3.6-flash-low',
      'gemini-3.5-flash-low',
      'gemini-3-flash-agent',
      'gemini-3.5-flash-extra-low',
      'gemini-3.1-pro-low',
      'gemini-pro-agent',
      'claude-sonnet-4-6',
      'claude-opus-4-6-thinking',
      'gpt-oss-120b-medium',
    ],
    fallbackVisionModels: [
      'gemini-3.6-flash-high',
      'gemini-3.6-flash-medium',
      'gemini-3.6-flash-low',
      'gemini-pro-agent',
      'gemini-3.5-flash-low',
    ],
    // Antigravity is subscription-included — no per-token cost to the user.
    // contextWindow/maxOutputTokens mirror the live endpoint's maxTokens/maxOutputTokens.
    modelMetadata: {
      'gemini-3.6-flash-high': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0, outputCostPer1M: 0, supportsVision: true, supportsTools: true, reasoning: true },
      'gemini-3.6-flash-medium': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0, outputCostPer1M: 0, supportsVision: true, supportsTools: true, reasoning: true },
      'gemini-3.6-flash-low': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0, outputCostPer1M: 0, supportsVision: true, supportsTools: true, reasoning: true },
      'gemini-3.5-flash-low': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0, outputCostPer1M: 0, supportsVision: true, supportsTools: true, reasoning: true },
      'gemini-3-flash-agent': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0, outputCostPer1M: 0, supportsVision: true, supportsTools: true, reasoning: true },
      'gemini-3.5-flash-extra-low': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0, outputCostPer1M: 0, supportsVision: true, supportsTools: true, reasoning: true },
      'gemini-3.1-pro-low': { contextWindow: 1048576, maxOutputTokens: 65535, inputCostPer1M: 0, outputCostPer1M: 0, supportsVision: true, supportsTools: true, reasoning: true },
      'gemini-pro-agent': { contextWindow: 1048576, maxOutputTokens: 65535, inputCostPer1M: 0, outputCostPer1M: 0, supportsVision: true, supportsTools: true, reasoning: true },
      'claude-sonnet-4-6': { contextWindow: 250000, maxOutputTokens: 64000, inputCostPer1M: 0, outputCostPer1M: 0, supportsVision: true, supportsTools: true, reasoning: true },
      'claude-opus-4-6-thinking': { contextWindow: 250000, maxOutputTokens: 64000, inputCostPer1M: 0, outputCostPer1M: 0, supportsVision: true, supportsTools: true, reasoning: true },
      'gpt-oss-120b-medium': { contextWindow: 131072, maxOutputTokens: 32768, inputCostPer1M: 0, outputCostPer1M: 0, supportsVision: false, supportsTools: true, reasoning: true },
      'gemini-2.5-pro': { contextWindow: 1048576, maxOutputTokens: 65535, inputCostPer1M: 0, outputCostPer1M: 0, supportsVision: true, supportsTools: true, reasoning: true },
      'gemini-3-flash': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0, outputCostPer1M: 0, supportsVision: true, supportsTools: true, reasoning: true },
    },
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── GROKAI (xAI) ───────────────────────────
  {
    key: 'grokai',
    name: 'Grok AI',
    baseURL: 'https://api.x.ai/v1',
    sdkType: 'openai',
    authScheme: 'bearer',
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
      imageGen: {
        models: ['grok-imagine-image-pro', 'grok-imagine-image'],
        operations: ['generate'],
        defaultModel: 'grok-imagine-image-pro',
        supportedFormats: ['url', 'b64_json'],
        maxImages: 10,
        supportsRevisedPrompt: true,
      },
    },
    recommendedModels: ['grok-4-0709', 'grok-4-1-fast-reasoning'],
    fallbackModels: ['grok-4-0709', 'grok-4-1-fast-reasoning', 'grok-code-fast-1', 'grok-3', 'grok-3-mini'],
    fallbackVisionModels: ['grok-4-0709'],
    modelMetadata: {
      'grok-4-0709': { contextWindow: 256000, maxOutputTokens: 131072, inputCostPer1M: 3.0, outputCostPer1M: 15.0, supportsVision: true, supportsTools: true, reasoning: true },
      'grok-4-1-fast-reasoning': { contextWindow: 2000000, maxOutputTokens: 131072, inputCostPer1M: 0.2, outputCostPer1M: 0.5, supportsVision: false, supportsTools: true, reasoning: true },
      'grok-code-fast-1': { contextWindow: 256000, maxOutputTokens: 131072, inputCostPer1M: 0.2, outputCostPer1M: 1.5, supportsVision: false, supportsTools: true, reasoning: true },
      'grok-3': { contextWindow: 131072, maxOutputTokens: 131072, inputCostPer1M: 3.0, outputCostPer1M: 15.0, supportsVision: false, supportsTools: true, reasoning: false },
      'grok-3-mini': { contextWindow: 131072, maxOutputTokens: 131072, inputCostPer1M: 0.3, outputCostPer1M: 0.5, supportsVision: false, supportsTools: true, reasoning: true },
      'grok-4.3': { contextWindow: 131072, maxOutputTokens: 131072, inputCostPer1M: 0.30, outputCostPer1M: 1.00, inputCacheReadCostPer1M: 0.03, supportsVision: true, supportsTools: true, reasoning: true },
      'grok-4.20': { contextWindow: 1000000, maxOutputTokens: 131072, inputCostPer1M: 1.25, outputCostPer1M: 2.50, inputCacheReadCostPer1M: 0.20, supportsVision: true, supportsTools: true, reasoning: true },
      'grok-4.20-0309-non-reasoning': { contextWindow: 1000000, maxOutputTokens: 131072, inputCostPer1M: 1.25, outputCostPer1M: 2.50, inputCacheReadCostPer1M: 0.20, supportsVision: true, supportsTools: true, reasoning: false },
      'grok-4.20-0309-reasoning': { contextWindow: 1000000, maxOutputTokens: 131072, inputCostPer1M: 1.25, outputCostPer1M: 2.50, inputCacheReadCostPer1M: 0.20, supportsVision: true, supportsTools: true, reasoning: true },
      'grok-beta': { contextWindow: 131072, maxOutputTokens: 8192, inputCostPer1M: 2.00, outputCostPer1M: 6.00, supportsVision: true, supportsTools: true },
      'grok-4': { contextWindow: 131072, maxOutputTokens: 131072, inputCostPer1M: 2.00, outputCostPer1M: 6.00, supportsVision: true, supportsTools: true },
      'grok-2-image': { contextWindow: 131072, maxOutputTokens: 8192, inputCostPer1M: 5.00, outputCostPer1M: 15.00, supportsVision: true, supportsTools: false },
      'grok-imagine-image': { contextWindow: 131072, maxOutputTokens: 8192, inputCostPer1M: 5.00, outputCostPer1M: 15.00, supportsVision: true, supportsTools: false },
      'grok-imagine-image-pro': { contextWindow: 131072, maxOutputTokens: 8192, inputCostPer1M: 5.00, outputCostPer1M: 15.00, supportsVision: true, supportsTools: false },
      'grok-ai': { contextWindow: 131072, maxOutputTokens: 131072, inputCostPer1M: 2.00, outputCostPer1M: 6.00, supportsVision: true, supportsTools: true },
    },
    compat: {},
    sdkOptions: {},
  },


  // ─────────────────────────── GROK BUILD CLI ───────────────────────────
  {
    key: 'grok-build',
    name: 'Grok Build',
    // LIVE endpoint. The local `grok` CLI authenticates against this proxy and
    // AGNT reuses that session over HTTP (see LlmService) rather than spawning
    // the CLI — same borrowed-OAuth pattern as openai-codex / claude-code.
    baseURL: 'https://cli-chat-proxy.grok.com/v1',
    sdkType: 'openai',
    authScheme: 'grok-build',
    capabilities: {
      // Verified live 2026-07-27 against the proxy: /chat/completions accepts
      // `tools` and returns tool_calls with finish_reason 'tool_calls', and
      // reports prompt_tokens_details.cached_tokens. Full AGNT tool registry.
      text: { supportsStreaming: true, supportsTools: true },
    },
    recommendedModels: ['grok-4.5'],
    fallbackModels: ['grok-4.5'],
    modelMetadata: {
      'grok-4.5': {
        contextWindow: 512000,
        maxOutputTokens: 65536,
        inputCostPer1M: 0,
        outputCostPer1M: 0,
        supportsVision: false,
        supportsTools: true, // HTTP proxy transport — see capabilities.text above
        reasoning: true,
      },
    },
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── CURSOR AGENT CLI ───────────────────────────
  {
    key: 'cursor-cli',
    name: 'Cursor',
    baseURL: 'https://api2.cursor.sh/v1',
    sdkType: 'openai',
    authScheme: 'cursor-cli',
    capabilities: {
      // supportsTools FALSE: `cursor-agent -p` is a subprocess that prints a
      // result and exposes no function-calling interface, so CursorCliClient
      // cannot forward schemas. Unlike grok-build there is no reachable HTTP
      // endpoint to borrow — the auth manager can read no token from the
      // session (apiStatus 401), so the subprocess is the only transport.
      // The orchestrator reads this via providerSupportsTools() below.
      text: { supportsStreaming: true, supportsTools: false },
    },
    recommendedModels: ['cursor-grok-4.5-high', 'composer-2.5', 'auto'],
    fallbackModels: ['cursor-grok-4.5-high', 'composer-2.5', 'auto', 'gpt-5.2', 'claude-opus-5-high'],
    // Cursor bills a flat subscription and exposes ~190 routing aliases
    // (every model × reasoning level × -fast). None of them meter per token, so
    // $0 charged is the truthful figure for all of them — the same convention
    // the enumerated entries below already use. Without this, each new alias
    // Cursor ships silently becomes an "unpriced" call.
    defaultModelMetadata: {
      contextWindow: 256000,
      maxOutputTokens: 65536,
      inputCostPer1M: 0,
      outputCostPer1M: 0,
      supportsVision: false,
      supportsTools: false, // CLI transport — see capabilities.text above
      reasoning: true,
    },
    modelMetadata: {
      // The DEFAULT model. Cursor does not publish per-model context limits
      // for its proxy; composer parity (256k) is a conservative floor. Without
      // an entry the generic 128k fallback applied — halving the tool/context
      // budget of the model every cursor-cli chat starts on.
      'cursor-grok-4.5-high': {
        contextWindow: 256000,
        maxOutputTokens: 65536,
        inputCostPer1M: 0,
        outputCostPer1M: 0,
        supportsVision: false,
        supportsTools: false, // CLI transport — see capabilities.text above
        reasoning: true,
      },
      'composer-2.5': {
        contextWindow: 256000,
        maxOutputTokens: 65536,
        inputCostPer1M: 0,
        outputCostPer1M: 0,
        supportsVision: false,
        supportsTools: false, // CLI transport — see capabilities.text above
        reasoning: true,
      },
      // Same deliberate 0/0 as the entries above: Cursor is a flat
      // subscription with no per-token metering exposed, so $0 charged is the
      // truthful figure (SUBSCRIPTION_PROVIDERS documents the convention).
      // Without these two entries the remaining offered models priced as
      // NULL — unknown — which is a different and wrong claim.
      auto: {
        contextWindow: 256000,
        maxOutputTokens: 65536,
        inputCostPer1M: 0, // router id — underlying model composition unknowable
        outputCostPer1M: 0,
        supportsVision: false,
        supportsTools: false, // CLI transport — see capabilities.text above
        reasoning: true,
      },
      'claude-opus-5-high': {
        contextWindow: 200000,
        maxOutputTokens: 65536,
        inputCostPer1M: 0,
        outputCostPer1M: 0,
        supportsVision: false,
        supportsTools: false, // CLI transport — see capabilities.text above
        reasoning: true,
      },
    },
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── GROQ ───────────────────────────
  {
    key: 'groq',
    name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    sdkType: 'openai',
    authScheme: 'bearer',
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      // Llama-4 (Scout & Maverick) on Groq are natively multimodal and accept
      // image_url in chat completions. https://console.groq.com/docs/vision
      vision: { supportsStreaming: true },
    },
    recommendedModels: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'],
    fallbackModels: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen/qwen3-32b', 'meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct'],
    fallbackVisionModels: ['meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct'],
    modelMetadata: {
      'openai/gpt-oss-120b': { contextWindow: 131072, maxOutputTokens: 65536, inputCostPer1M: 0.15, outputCostPer1M: 0.6, supportsVision: false, supportsTools: true, reasoning: false },
      'openai/gpt-oss-20b': { contextWindow: 131072, maxOutputTokens: 65536, inputCostPer1M: 0.075, outputCostPer1M: 0.3, supportsVision: false, supportsTools: true, reasoning: false },
      'llama-3.3-70b-versatile': { contextWindow: 131072, maxOutputTokens: 32768, inputCostPer1M: 0.59, outputCostPer1M: 0.79, supportsVision: false, supportsTools: true, reasoning: false },
      'llama-3.1-8b-instant': { contextWindow: 131072, maxOutputTokens: 131072, inputCostPer1M: 0.05, outputCostPer1M: 0.08, supportsVision: false, supportsTools: true, reasoning: false },
      'qwen/qwen3-32b': { contextWindow: 131072, maxOutputTokens: 32768, inputCostPer1M: 0.29, outputCostPer1M: 0.59, supportsVision: false, supportsTools: true, reasoning: false },
      'meta-llama/llama-4-scout-17b-16e-instruct': { contextWindow: 131072, maxOutputTokens: 32768, inputCostPer1M: 0.11, outputCostPer1M: 0.34, supportsVision: true, supportsTools: true, reasoning: false },
      'meta-llama/llama-4-maverick-17b-128e-instruct': { contextWindow: 131072, maxOutputTokens: 32768, inputCostPer1M: 0.20, outputCostPer1M: 0.60, supportsVision: true, supportsTools: true, reasoning: false },
      'llama-3.1-70b-versatile': { contextWindow: 131072, maxOutputTokens: 8192, inputCostPer1M: 0.59, outputCostPer1M: 0.79, supportsVision: false, supportsTools: true },
      'llama-3.1-70b': { contextWindow: 131072, maxOutputTokens: 8192, inputCostPer1M: 0.59, outputCostPer1M: 0.79, supportsVision: false, supportsTools: true },
      'llama-3.3-70b': { contextWindow: 131072, maxOutputTokens: 32768, inputCostPer1M: 0.59, outputCostPer1M: 0.79, supportsVision: false, supportsTools: true },
      'llama-3.2-1b-instruct': { contextWindow: 131072, maxOutputTokens: 8192, inputCostPer1M: 0.05, outputCostPer1M: 0.08, supportsVision: false, supportsTools: true },
      'moonshotai/kimi-k2-instruct': { contextWindow: 131072, maxOutputTokens: 8192, inputCostPer1M: 0.60, outputCostPer1M: 2.50, supportsVision: false, supportsTools: true },
      'mistralai/mixtral-8x7b-instruct': { contextWindow: 32768, maxOutputTokens: 4096, inputCostPer1M: 0.60, outputCostPer1M: 1.80, supportsVision: false, supportsTools: true },
      'mistral-large-latest': { contextWindow: 128000, maxOutputTokens: 8192, inputCostPer1M: 2.00, outputCostPer1M: 6.00, supportsVision: false, supportsTools: true },
      // Compound is an agentic SYSTEM: Groq bills it at the rates of the models
      // it routes to, which are the Llama tiers below. Recording those is the
      // closest thing to a published figure that exists for it.
      'groq/compound': { contextWindow: 131072, maxOutputTokens: 32768, inputCostPer1M: 0.59, outputCostPer1M: 0.79, supportsVision: false, supportsTools: true },
      'groq/compound-mini': { contextWindow: 131072, maxOutputTokens: 32768, inputCostPer1M: 0.05, outputCostPer1M: 0.08, supportsVision: false, supportsTools: true },
      'allam-2-7b': { contextWindow: 4096, maxOutputTokens: 4096, inputCostPer1M: 0.05, outputCostPer1M: 0.08, supportsVision: false, supportsTools: false },
    },
    modelTransform: (raw) => ({
      id: raw.id,
      name: raw.id,
      description: '',
      createdAt: raw.created,
      ownedBy: raw.owned_by,
      contextWindow: raw.context_window || 0,
      active: raw.active,
    }),
    modelFilter: (m) => m.id && m.active !== false,
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── DEEPSEEK ───────────────────────────
  {
    key: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    sdkType: 'openai',
    authScheme: 'bearer',
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
    },
    recommendedModels: ['deepseek-chat', 'deepseek-reasoner'],
    fallbackModels: ['deepseek-chat', 'deepseek-reasoner'],
    modelMetadata: {
      'deepseek-chat': { contextWindow: 128000, maxOutputTokens: 8192, inputCostPer1M: 0.28, outputCostPer1M: 0.42, supportsVision: false, supportsTools: true, reasoning: false },
      'deepseek-reasoner': { contextWindow: 128000, maxOutputTokens: 64000, inputCostPer1M: 0.28, outputCostPer1M: 0.42, supportsVision: false, supportsTools: true, reasoning: true },
      'deepseek-v4-flash': { contextWindow: 128000, maxOutputTokens: 8192, inputCostPer1M: 0.14, outputCostPer1M: 0.28, inputCacheReadCostPer1M: 0.014, supportsVision: false, supportsTools: true },
    },
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── OPENROUTER ───────────────────────────
  // App attribution headers per https://openrouter.ai/docs/app-attribution.
  // Sent on every OpenRouter request (chat/completions AND model listing) so
  // all AGNT instances aggregate under one app on OpenRouter leaderboards.
  {
    key: 'openrouter',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    sdkType: 'openai',
    authScheme: 'bearer',
    // Send BOTH `X-Title` (legacy backward-compat) and `X-OpenRouter-Title`
    // (newer name). OpenRouter's docs are inconsistent about which one
    // currently controls the rankings/analytics title; sending both costs
    // nothing and guarantees the app shows as "AGNT" (or $OPENROUTER_APP_TITLE)
    // regardless of which header OpenRouter actually reads.
    sdkOptions: {
      defaultHeaders: {
        'HTTP-Referer': process.env.OPENROUTER_APP_REFERER || 'https://agnt.gg',
        'X-Title': process.env.OPENROUTER_APP_TITLE || 'AGNT',
        'X-OpenRouter-Title': process.env.OPENROUTER_APP_TITLE || 'AGNT',
        'X-OpenRouter-Categories':
          process.env.OPENROUTER_APP_CATEGORIES || 'cli-agent,personal-agent',
      },
    },
    fetchHeaders: {
      'HTTP-Referer': process.env.OPENROUTER_APP_REFERER || 'https://agnt.gg',
      'X-Title': process.env.OPENROUTER_APP_TITLE || 'AGNT',
      'X-OpenRouter-Title': process.env.OPENROUTER_APP_TITLE || 'AGNT',
      'X-OpenRouter-Categories':
        process.env.OPENROUTER_APP_CATEGORIES || 'cli-agent,personal-agent',
    },
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
    },
    recommendedModels: ['openai/gpt-5.2', 'anthropic/claude-sonnet-4-6', 'google/gemini-2.5-pro'],
    fallbackModels: [
      'openai/gpt-5.2',
      'openai/gpt-4.1',
      'openai/o4-mini',
      'anthropic/claude-sonnet-4-6',
      'anthropic/claude-haiku-4-5-20251001',
      'google/gemini-2.5-pro',
      'google/gemini-2.5-flash',
      'x-ai/grok-4-1-fast-reasoning',
      'deepseek/deepseek-chat',
      'meta-llama/llama-3.3-70b-instruct',
    ],
    fallbackVisionModels: [
      'openai/gpt-5.2',
      'openai/gpt-4.1',
      'anthropic/claude-sonnet-4-6',
      'google/gemini-2.5-pro',
    ],
    modelMetadata: {
      'meta-llama/llama-3.3-70b-instruct': { contextWindow: 131072, maxOutputTokens: 8192, inputCostPer1M: 0.59, outputCostPer1M: 0.79, supportsVision: false, supportsTools: true },
      'meta-llama/llama-3.1-70b-instruct': { contextWindow: 131072, maxOutputTokens: 8192, inputCostPer1M: 0.59, outputCostPer1M: 0.79, supportsVision: false, supportsTools: true },
      'mistralai/mixtral-8x7b-instruct': { contextWindow: 32768, maxOutputTokens: 4096, inputCostPer1M: 0.60, outputCostPer1M: 1.80, supportsVision: false, supportsTools: true },
      'openrouter/owl-alpha': { contextWindow: 131072, maxOutputTokens: 8192, inputCostPer1M: 0.50, outputCostPer1M: 2.00, supportsVision: false, supportsTools: true },
      'adamo1139/Hermes-3-Llama-3.1-8B-FP8-Dynamic': { contextWindow: 131072, maxOutputTokens: 8192, inputCostPer1M: 0.20, outputCostPer1M: 0.20, supportsVision: false, supportsTools: true },
      'Qwen/Qwen3-235B-A22B-Instruct-2507': { contextWindow: 131072, maxOutputTokens: 8192, inputCostPer1M: 0.80, outputCostPer1M: 2.40, supportsVision: false, supportsTools: true },
      'deepseek-ai/DeepSeek-V3.1': { contextWindow: 128000, maxOutputTokens: 8192, inputCostPer1M: 0.14, outputCostPer1M: 0.28, inputCacheReadCostPer1M: 0.014, supportsVision: false, supportsTools: true },
    },
    modelTransform: (raw) => ({
      id: raw.id,
      name: raw.name || raw.id,
      description: raw.description || '',
      contextLength: raw.context_length || raw.top_provider?.context_length || 0,
      pricing: {
        prompt: parseFloat(raw.pricing?.prompt || '0'),
        completion: parseFloat(raw.pricing?.completion || '0'),
        // Cache rates, per token, exactly as OpenRouter publishes them.
        // Dropping these was why an OpenRouter cache read was priced at the
        // full input rate: with no published rate to prefer, getModelCost fell
        // through to the generic 1.0x multiplier and reported a saving of zero
        // on traffic that was genuinely 90% cheaper. 183 of 337 live models
        // publish a read rate, 58 a write rate, 21 a 1-hour write rate.
        //
        // `null` when absent, never 0 — a missing rate means "unknown", and
        // coercing it to free would under-report cost, which is a worse lie
        // than the over-report it replaces.
        input_cache_read: raw.pricing?.input_cache_read != null
          ? parseFloat(raw.pricing.input_cache_read) : null,
        input_cache_write: raw.pricing?.input_cache_write != null
          ? parseFloat(raw.pricing.input_cache_write) : null,
        input_cache_write_1h: raw.pricing?.input_cache_write_1h != null
          ? parseFloat(raw.pricing.input_cache_write_1h) : null,
      },
    }),
    modelFilter: (m) => m.id && m.name,
    compat: {},
  },

  // ─────────────────────────── TOGETHERAI ───────────────────────────
  {
    key: 'togetherai',
    name: 'Together AI',
    baseURL: 'https://api.together.xyz/v1',
    sdkType: 'openai',
    authScheme: 'bearer',
    responseDataPath: 'root',
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      // Llama-4 Scout & Maverick on Together accept image_url via chat completions.
      // https://docs.together.ai/docs/llama4-quickstart
      vision: { supportsStreaming: true },
    },
    recommendedModels: ['deepseek-ai/DeepSeek-V3', 'moonshotai/Kimi-K2.5'],
    fallbackModels: [
      'deepseek-ai/DeepSeek-V3',
      'moonshotai/Kimi-K2.5',
      'MiniMaxAI/MiniMax-M2.5',
      'Qwen/Qwen3-235B-A22B-Thinking-2507',
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
      'meta-llama/Llama-4-Scout-17B-16E-Instruct',
    ],
    fallbackVisionModels: [
      'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
      'meta-llama/Llama-4-Scout-17B-16E-Instruct',
    ],
    modelMetadata: {
      'deepseek-ai/DeepSeek-V3': { contextWindow: 131072, maxOutputTokens: 16384, inputCostPer1M: 0.30, outputCostPer1M: 0.88, supportsVision: false, supportsTools: true, reasoning: false },
      'deepseek-ai/DeepSeek-R1': { contextWindow: 131072, maxOutputTokens: 16384, inputCostPer1M: 0.75, outputCostPer1M: 2.19, supportsVision: false, supportsTools: true, reasoning: true },
      'moonshotai/Kimi-K2.5': { contextWindow: 131072, maxOutputTokens: 16384, inputCostPer1M: 0.20, outputCostPer1M: 0.88, supportsVision: false, supportsTools: true, reasoning: true },
      'MiniMaxAI/MiniMax-M2.5': { contextWindow: 1000000, maxOutputTokens: 131072, inputCostPer1M: 0.30, outputCostPer1M: 1.20, supportsVision: false, supportsTools: true, reasoning: true },
      'Qwen/Qwen3-235B-A22B-Thinking-2507': { contextWindow: 131072, maxOutputTokens: 32768, inputCostPer1M: 0.50, outputCostPer1M: 1.50, supportsVision: false, supportsTools: true, reasoning: true },
      'Qwen/Qwen3-235B-A22B-Instruct-2507': { contextWindow: 131072, maxOutputTokens: 32768, inputCostPer1M: 0.80, outputCostPer1M: 2.40, supportsVision: false, supportsTools: true, reasoning: false },
      'Qwen/Qwen3-235B-A22B-Instruct-2507-tput': { contextWindow: 131072, maxOutputTokens: 32768, inputCostPer1M: 0.80, outputCostPer1M: 2.40, supportsVision: false, supportsTools: true, reasoning: false },
      'meta-llama/Llama-3.3-70B-Instruct-Turbo': { contextWindow: 131072, maxOutputTokens: 32768, inputCostPer1M: 0.18, outputCostPer1M: 0.34, supportsVision: false, supportsTools: true, reasoning: false },
      'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8': { contextWindow: 1048576, maxOutputTokens: 32768, inputCostPer1M: 0.27, outputCostPer1M: 0.35, supportsVision: true, supportsTools: true, reasoning: false },
      'meta-llama/Llama-4-Scout-17B-16E-Instruct': { contextWindow: 524288, maxOutputTokens: 32768, inputCostPer1M: 0.18, outputCostPer1M: 0.30, supportsVision: true, supportsTools: true, reasoning: false },
    },
    modelFilter: (m) => m.id && m.type === 'chat',
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── CEREBRAS ───────────────────────────
  {
    key: 'cerebras',
    name: 'Cerebras',
    baseURL: 'https://api.cerebras.ai/v1',
    sdkType: 'cerebras',
    authScheme: 'bearer',
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      // Cerebras vision is available on the shared tier ONLY with gemma-4-31b
      // (plus image-capable models on Dedicated Endpoints). The previous
      // fallbackVisionModels entry for llama-4-scout-17b-16e-instruct was stale:
      // that model is not served on the shared Cerebras Inference API and a
      // live /v1/models probe against the shared tier returns only
      // gemma-4-31b, zai-glm-4.7 and gpt-oss-120b.
      // https://inference-docs.cerebras.ai/capabilities/image-inputs
      vision: { supportsStreaming: true },
    },
    // Verified live against GET https://api.cerebras.ai/v1/models: the shared
    // tier serves exactly these three. llama3.1-8b and qwen-3-235b-a22b-instruct-2507
    // were listed here but both return HTTP 404 ("Model does not exist or you do
    // not have access to it") - llama3.1-8b was the FIRST recommended model, so it
    // was the default AGNT offered for Cerebras. Their metadata is retained below
    // for anyone on a Dedicated Endpoint that still serves them, but they are no
    // longer advertised. These lists are only a FALLBACK: ModelRoutes fetches
    // /v1/models live and prefers that result.
    recommendedModels: ['gemma-4-31b', 'gpt-oss-120b', 'zai-glm-4.7'],
    fallbackModels: ['gemma-4-31b', 'gpt-oss-120b', 'zai-glm-4.7'],
    fallbackVisionModels: ['gemma-4-31b'],
    modelMetadata: {
      'gpt-oss-120b': { contextWindow: 131072, maxOutputTokens: 65536, inputCostPer1M: 0.35, outputCostPer1M: 0.75, supportsVision: false, supportsTools: true, reasoning: false },
      // NOT served on the shared tier (404 as of 2026-07-25); kept for Dedicated Endpoints.
      'llama3.1-8b': { contextWindow: 131072, maxOutputTokens: 131072, inputCostPer1M: 0.1, outputCostPer1M: 0.1, supportsVision: false, supportsTools: true, reasoning: false },
      // NOT served on the shared tier (404 as of 2026-07-25); kept for Dedicated Endpoints.
      'qwen-3-235b-a22b-instruct-2507': { contextWindow: 131072, maxOutputTokens: 65536, inputCostPer1M: 0.6, outputCostPer1M: 1.2, supportsVision: false, supportsTools: true, reasoning: false },
      'zai-glm-4.7': { contextWindow: 131072, maxOutputTokens: 65536, inputCostPer1M: 2.25, outputCostPer1M: 2.75, supportsVision: false, supportsTools: true, reasoning: false },
      // Gemma 4 31B is the only Cerebras shared-tier model that accepts image
      // input. Pricing and context window verified from Cerebras docs:
      // https://inference-docs.cerebras.ai/models/gemma-4-31b
      'gemma-4-31b': { contextWindow: 131072, maxOutputTokens: 65536, inputCostPer1M: 0.99, outputCostPer1M: 1.49, supportsVision: true, supportsTools: true, reasoning: true },
    },
    compat: {},
    sdkOptions: { warmTCPConnection: false },
  },

  // ─────────────────────────── KIMI ───────────────────────────
  {
    key: 'kimi',
    name: 'Kimi',
    baseURL: 'https://api.moonshot.ai/v1',
    sdkType: 'openai',
    authScheme: 'bearer',
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
    },
    // kimi-k3 leads: it is the current flagship and the only model still
    // offered to newly-registered Moonshot accounts. kimi-k2.5 and the whole
    // moonshot-v1 series are closed to new users and fully sunset 2026-08-31;
    // the kimi-k2 series was discontinued 2026-05-25. They stay in
    // modelMetadata so existing sessions keep correct context/pricing, but
    // they are no longer recommended. https://platform.kimi.ai/docs/models
    recommendedModels: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6', 'kimi-k2.5'],
    fallbackModels: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2.6', 'kimi-k2.5'],
    // Every current Kimi multimodal model takes image input. k3 / k2.6 /
    // k2.7-code / k2.7-code-highspeed also take video.
    // https://platform.kimi.ai/docs/guide/use-kimi-vision-model
    fallbackVisionModels: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2.6', 'kimi-k2.5'],
    modelMetadata: {
      // Kimi K3: 2.8T params, native visual understanding, 1M context.
      // Pricing per https://platform.kimi.ai/docs/pricing/chat-k3
      'kimi-k3': { contextWindow: 1048576, maxOutputTokens: 16384, inputCostPer1M: 3.0, outputCostPer1M: 15.0, inputCacheReadCostPer1M: 0.30, supportsVision: true, supportsTools: true, reasoning: true },
      // K2.7 Code pair: text + image + video input.
      // Pricing per https://platform.kimi.ai/docs/pricing/chat-k27-code
      'kimi-k2.7-code': { contextWindow: 262144, maxOutputTokens: 16384, inputCostPer1M: 0.95, outputCostPer1M: 4.0, inputCacheReadCostPer1M: 0.19, supportsVision: true, supportsTools: true, reasoning: true },
      'kimi-k2.7-code-highspeed': { contextWindow: 262144, maxOutputTokens: 16384, inputCostPer1M: 1.90, outputCostPer1M: 8.0, inputCacheReadCostPer1M: 0.38, supportsVision: true, supportsTools: true, reasoning: true },
      'kimi-k2.6': { contextWindow: 256000, maxOutputTokens: 16384, inputCostPer1M: 0.6, outputCostPer1M: 2.5, supportsVision: true, supportsTools: true, reasoning: true },
      'kimi-k2.5': { contextWindow: 256000, maxOutputTokens: 16384, inputCostPer1M: 0.6, outputCostPer1M: 2.5, supportsVision: true, supportsTools: true, reasoning: true },
      'kimi-k2-thinking': { contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0.6, outputCostPer1M: 2.5, supportsVision: false, supportsTools: true, reasoning: true },
      'kimi-k2': { contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0.5, outputCostPer1M: 2.0, supportsVision: false, supportsTools: true, reasoning: false },
      'moonshot-v1-128k': { contextWindow: 131072, maxOutputTokens: 4096, inputCostPer1M: 8.5, outputCostPer1M: 8.5, supportsVision: false, supportsTools: true, reasoning: false },
      'moonshot-v1-32k': { contextWindow: 32768, maxOutputTokens: 4096, inputCostPer1M: 1.7, outputCostPer1M: 1.7, supportsVision: false, supportsTools: true, reasoning: false },
    },
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── KIMI CODE (subscription CLI) ───────────────────────────
  {
    key: 'kimi-code',
    name: 'Kimi Code',
    baseURL: 'https://api.kimi.com/coding/v1',
    sdkType: 'openai',
    authScheme: 'bearer',
    // /models endpoint EXISTS upstream (verified 2026-07-09: returns 401 without
    // auth, not 404). Dynamic-first: fetch live when a token is available; the
    // fallback list below is the last resort. keyOptional keeps the dropdown
    // populated for users who haven't connected yet.
    modelListingKeyOptional: true,
    fetchHeaders: { 'User-Agent': 'KimiCLI/1.38.0' },
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true, supportsReasoning: true },
      // Every Kimi Code model accepts image input (k3 / kimi-for-coding /
      // kimi-for-coding-highspeed also accept video; k3-256k is image-only).
      // Verified live against api.kimi.com/coding/v1 on 2026-07-24: all four
      // IDs returned HTTP 200 and correctly described a synthetic two-band
      // test image, while the same prompt without an image hallucinated a
      // different answer. Source of truth:
      // https://www.kimi.com/code/docs/en/kimi-code/models.html ("Multimodal
      // input" row) and https://platform.kimi.ai/docs/guide/use-kimi-vision-model
      // Without this block getProviderCapabilities().vision is null, so
      // ProviderRegistry.supportsVision() returns false for EVERY model and
      // the orchestrator silently drops uploaded images.
      vision: { supportsStreaming: true },
    },
    recommendedModels: ['kimi-for-coding', 'k3', 'k3-256k', 'kimi-for-coding-highspeed'],
    fallbackModels: ['kimi-for-coding', 'k3', 'k3-256k', 'kimi-for-coding-highspeed'],
    fallbackVisionModels: ['kimi-for-coding', 'k3', 'k3-256k', 'kimi-for-coding-highspeed'],
    modelMetadata: {
      // Notional (seat-value) rates, following the claude-code convention:
      // SUBSCRIPTION_PROVIDERS keeps these from ever being billed as money,
      // but "what this would have cost on the metered API" is exactly what
      // the spend ledger reports for seats. Rates are Moonshot's published
      // metered prices for the models each seat id serves (OpenRouter
      // moonshotai/* catalog + platform.kimi.ai, as of 2026-08-01).
      'kimi-for-coding': {
        contextWindow: 256000,
        maxOutputTokens: 16384,
        // Serves the K2.x line (K2.5-era rate: $0.57/$2.85, cache read $0.095)
        inputCostPer1M: 0.57,
        outputCostPer1M: 2.85,
        inputCacheReadCostPer1M: 0.095,
        supportsVision: true, // K2.7 Code: image + video input
        supportsTools: true,
        reasoning: true,
      },
      // Kimi K3 flagship: up to 1M context (Allegretto+ plans; Moderato caps
      // K3 at 256K server-side). Kimi docs instruct third-party tools to set
      // 1048576. https://www.kimi.com/code/docs/en/kimi-code/models.html
      k3: {
        contextWindow: 1048576,
        maxOutputTokens: 16384,
        // Moonshot K3 metered: $3 in (cache miss) / $0.30 cached / $15 out
        inputCostPer1M: 3.0,
        outputCostPer1M: 15.0,
        inputCacheReadCostPer1M: 0.3,
        supportsVision: true, // K3: native image + video input
        supportsTools: true,
        reasoning: true,
      },
      // K3 pinned to a 256K window - same model, lower quota burn. Accepts
      // images but NOT video (per the Kimi Code model table).
      'k3-256k': {
        contextWindow: 256000,
        maxOutputTokens: 16384,
        // Same model as k3, so the same metered rate
        inputCostPer1M: 3.0,
        outputCostPer1M: 15.0,
        inputCacheReadCostPer1M: 0.3,
        supportsVision: true, // image only (no video on this variant)
        supportsTools: true,
        reasoning: true,
      },
      'kimi-for-coding-highspeed': {
        contextWindow: 256000,
        maxOutputTokens: 16384,
        // Serves K2.7 Code ($0.73/$3.50, cache read $0.15)
        inputCostPer1M: 0.73,
        outputCostPer1M: 3.5,
        inputCacheReadCostPer1M: 0.15,
        supportsVision: true, // K2.7 Code HighSpeed: image + video input
        supportsTools: true,
        reasoning: true,
      },
    },
    compat: { mapDeveloperRole: true },
    sdkOptions: {
      // Matches the current kimi-cli release so the endpoint recognizes us as
      // an approved coding agent. Bump when kimi-cli publishes a new version
      // (https://github.com/MoonshotAI/kimi-cli/releases).
      defaultHeaders: { 'User-Agent': 'KimiCLI/1.38.0' },
    },
  },

  // ─────────────────────────── MINIMAX ───────────────────────────
  {
    key: 'minimax',
    name: 'MiniMax',
    baseURL: 'https://api.minimax.io/v1',
    sdkType: 'openai',
    authScheme: 'bearer',
    // /models endpoint EXISTS upstream now (verified 2026-07-09: 401 without
    // auth, not 404 — the old "no /models endpoint" note from GitHub issue #60
    // is stale). Dynamic-first with the list below as last resort.
    modelListingKeyOptional: true,
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
    },
    recommendedModels: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed'],
    fallbackModels: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.1', 'MiniMax-M2.1-highspeed'],
    modelMetadata: {
      'MiniMax-M2.7': { contextWindow: 1000000, maxOutputTokens: 131072, inputCostPer1M: 0.3, outputCostPer1M: 1.2, supportsVision: false, supportsTools: true, reasoning: true },
      'MiniMax-M2.7-highspeed': { contextWindow: 200000, maxOutputTokens: 131072, inputCostPer1M: 0.3, outputCostPer1M: 2.4, supportsVision: false, supportsTools: true, reasoning: true },
      'MiniMax-M2.5': { contextWindow: 1000000, maxOutputTokens: 131072, inputCostPer1M: 0.3, outputCostPer1M: 1.2, supportsVision: false, supportsTools: true, reasoning: true },
      'MiniMax-M2.5-highspeed': { contextWindow: 200000, maxOutputTokens: 131072, inputCostPer1M: 0.3, outputCostPer1M: 2.4, supportsVision: false, supportsTools: true, reasoning: true },
      'MiniMax-M2.1': { contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0.3, outputCostPer1M: 1.2, supportsVision: false, supportsTools: true, reasoning: false },
      'MiniMax-M2.1-highspeed': { contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0.15, outputCostPer1M: 0.6, supportsVision: false, supportsTools: true, reasoning: false },
    },
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── ZAI ───────────────────────────
  {
    key: 'zai',
    name: 'Z.AI',
    baseURL: 'https://api.z.ai/api/paas/v4',
    sdkType: 'openai',
    authScheme: 'bearer',
    // /models endpoint EXISTS upstream now (verified 2026-07-09: 401 without
    // auth, not 404 — the old "Z.AI has no /models endpoint" note is stale).
    // Dynamic-first with the list below as last resort.
    modelListingKeyOptional: true,
    fetchHeaders: { 'Accept-Language': 'en-US,en' }, // Required per Z.AI docs
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
    },
    recommendedModels: ['glm-5.2', 'glm-5.1', 'glm-5'],
    fallbackModels: ['glm-5.2', 'glm-5.2[1m]', 'glm-5.1', 'glm-5-turbo', 'glm-5v-turbo', 'glm-5', 'glm-4.7', 'glm-4.7-flash', 'glm-4.6v', 'glm-4.6v-flash', 'glm-4.5-flash'],
    fallbackVisionModels: ['glm-5v-turbo', 'glm-4.6v', 'glm-4.6v-flash'],
    modelMetadata: {
      // GLM-5.2: launched 2026-06-13. Default ID has a 1M-token context per
      // Z.AI's official model page; the `[1m]` suffix is a third-party-tool
      // notation (Claude Code / OpenClaw) that also routes to the 1M variant.
      // Reasoning uses OpenAI-compatible `reasoning_effort` with `high`
      // (default) and `max` only — see supportsZaiReasoningEffort below.
      'glm-5.2': { contextWindow: 1000000, maxOutputTokens: 131072, inputCostPer1M: 1.4, inputCacheReadCostPer1M: 0.26, outputCostPer1M: 4.4, supportsVision: false, supportsTools: true, reasoning: true },
      'glm-5.2[1m]': { contextWindow: 1000000, maxOutputTokens: 131072, inputCostPer1M: 1.4, inputCacheReadCostPer1M: 0.26, outputCostPer1M: 4.4, supportsVision: false, supportsTools: true, reasoning: true },
      'glm-5.1': { contextWindow: 200000, maxOutputTokens: 128000, inputCostPer1M: 1.4, outputCostPer1M: 4.0, supportsVision: false, supportsTools: true, reasoning: true },
      'glm-5-turbo': { contextWindow: 128000, maxOutputTokens: 128000, inputCostPer1M: 0.5, outputCostPer1M: 1.5, supportsVision: false, supportsTools: true, reasoning: false },
      'glm-5v-turbo': { contextWindow: 128000, maxOutputTokens: 128000, inputCostPer1M: 0.6, outputCostPer1M: 1.8, supportsVision: true, supportsTools: true, reasoning: false },
      'glm-5': { contextWindow: 200000, maxOutputTokens: 128000, inputCostPer1M: 1.0, outputCostPer1M: 3.2, supportsVision: false, supportsTools: true, reasoning: true },
      'glm-4.7': { contextWindow: 128000, maxOutputTokens: 128000, inputCostPer1M: 0.6, outputCostPer1M: 2.2, supportsVision: false, supportsTools: true, reasoning: false },
      'glm-4.7-flash': { contextWindow: 128000, maxOutputTokens: 128000, inputCostPer1M: 0, outputCostPer1M: 0, supportsVision: false, supportsTools: true, reasoning: false },
      'glm-4.6v': { contextWindow: 128000, maxOutputTokens: 32000, inputCostPer1M: 0.3, outputCostPer1M: 0.9, supportsVision: true, supportsTools: true, reasoning: false },
      'glm-4.6v-flash': { contextWindow: 128000, maxOutputTokens: 32000, inputCostPer1M: 0, outputCostPer1M: 0, supportsVision: true, supportsTools: true, reasoning: false },
      'glm-4.5-flash': { contextWindow: 128000, maxOutputTokens: 96000, inputCostPer1M: 0, outputCostPer1M: 0, supportsVision: false, supportsTools: true, reasoning: false },
      'glm-4.5': { contextWindow: 128000, maxOutputTokens: 4096, inputCostPer1M: 0.60, outputCostPer1M: 2.40, supportsVision: false, supportsTools: true },
      'glm-4.6': { contextWindow: 128000, maxOutputTokens: 4096, inputCostPer1M: 0.60, outputCostPer1M: 2.40, supportsVision: false, supportsTools: true },
      'zai-glm-4.6': { contextWindow: 128000, maxOutputTokens: 4096, inputCostPer1M: 0.60, outputCostPer1M: 2.40, supportsVision: false, supportsTools: true },
    },
    compat: {},
    sdkOptions: {
      timeout: 300000, // 5 min — GLM-5 reasoning mode can have long TTFB
      defaultHeaders: { 'Accept-Language': 'en-US,en' }, // Required per Z.AI docs
    },
  },

  // ─────────────────────────── CHUTES ───────────────────────────
  {
    key: 'chutes',
    name: 'Chutes',
    baseURL: 'https://llm.chutes.ai/v1',
    sdkType: 'openai',
    authScheme: 'bearer',
    e2ee: true,
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
    },
    recommendedModels: [
      'moonshotai/Kimi-K2.5-TEE',
      'moonshotai/Kimi-K2.6-TEE',
      'zai-org/GLM-5-TEE',
      'zai-org/GLM-5.1-TEE',
    ],
    fallbackModels: [
      'moonshotai/Kimi-K2.5-TEE',
      'moonshotai/Kimi-K2.6-TEE',
      'zai-org/GLM-5-TEE',
      'zai-org/GLM-5.1-TEE',
      'Qwen/Qwen3-32B-TEE',
      'Qwen/Qwen3.5-397B-A17B-TEE',
      'Qwen/Qwen3.6-27B-TEE',
      'MiniMaxAI/MiniMax-M2.5-TEE',
    ],
    fallbackVisionModels: [
      'moonshotai/Kimi-K2.5-TEE',
      'moonshotai/Kimi-K2.6-TEE',
      'Qwen/Qwen3.5-397B-A17B-TEE',
      'Qwen/Qwen3.6-27B-TEE',
    ],
    modelMetadata: {
      'moonshotai/Kimi-K2.6-TEE': { contextWindow: 262144, maxOutputTokens: 65535, inputCostPer1M: 0.95, outputCostPer1M: 4.0, inputCacheReadCostPer1M: 0.475, supportsVision: true, supportsTools: true, reasoning: true, root: 'moonshotai/Kimi-K2.6', chuteId: 'aac09863-35b4-5d9b-9b67-6e6a9d54273a', ownedBy: 'vllm', quantization: 'int4', confidentialCompute: true },
      'moonshotai/Kimi-K2.5-TEE': { contextWindow: 262144, maxOutputTokens: 65535, inputCostPer1M: 0.44, outputCostPer1M: 2.0, inputCacheReadCostPer1M: 0.22, supportsVision: true, supportsTools: true, reasoning: true, root: 'moonshotai/Kimi-K2.5', chuteId: '2ff25e81-4586-5ec8-b892-3a6f342693d7', ownedBy: 'vllm', quantization: 'int4', confidentialCompute: true },
      'zai-org/GLM-5.1-TEE': { contextWindow: 202752, maxOutputTokens: 65535, inputCostPer1M: 1.05, outputCostPer1M: 3.5, inputCacheReadCostPer1M: 0.525, supportsVision: false, supportsTools: true, reasoning: true, root: 'zai-org/GLM-5.1-FP8', chuteId: 'b048fe26-0352-5c46-acf7-335e527e7f3d', ownedBy: 'sglang', quantization: 'fp8', confidentialCompute: true },
      'zai-org/GLM-5-TEE': { contextWindow: 202752, maxOutputTokens: 65535, inputCostPer1M: 0.95, outputCostPer1M: 2.55, inputCacheReadCostPer1M: 0.475, supportsVision: false, supportsTools: true, reasoning: true, root: 'zai-org/GLM-5-FP8', chuteId: 'e51e818e-fa63-570d-9f68-49d7d1b4d12f', ownedBy: 'sglang', quantization: 'fp8', confidentialCompute: true },
      'Qwen/Qwen3-32B-TEE': { contextWindow: 40960, maxOutputTokens: 40960, inputCostPer1M: 0.08, outputCostPer1M: 0.24, inputCacheReadCostPer1M: 0.04, supportsVision: false, supportsTools: true, reasoning: true, root: 'Qwen/Qwen3-32B-FP8', chuteId: 'ac059e33-eb27-541c-b9a9-24b214036475', ownedBy: 'sglang', quantization: 'fp8', confidentialCompute: true },
      'Qwen/Qwen3.5-397B-A17B-TEE': { contextWindow: 262144, maxOutputTokens: 65536, inputCostPer1M: 0.39, outputCostPer1M: 2.34, inputCacheReadCostPer1M: 0.195, supportsVision: true, supportsTools: true, reasoning: true, root: 'Qwen/Qwen3.5-397B-A17B-FP8', chuteId: '51a4284a-a5a0-5e44-a9cc-6af5a2abfbcf', ownedBy: 'sglang', quantization: 'fp8', confidentialCompute: true },
      'Qwen/Qwen3.6-27B-TEE': { contextWindow: 262144, maxOutputTokens: 65536, inputCostPer1M: 0.195, outputCostPer1M: 1.56, inputCacheReadCostPer1M: 0.0975, supportsVision: true, supportsTools: true, reasoning: true, root: 'Qwen/Qwen3.6-27B-FP8', chuteId: '7aa5e899-c0ba-5482-af48-d3f31d635c9f', ownedBy: 'vllm', quantization: 'fp8', confidentialCompute: true },
      'MiniMaxAI/MiniMax-M2.5-TEE': { contextWindow: 196608, maxOutputTokens: 65536, inputCostPer1M: 0.15, outputCostPer1M: 1.2, inputCacheReadCostPer1M: 0.075, supportsVision: false, supportsTools: true, reasoning: true, root: 'MiniMaxAI/MiniMax-M2.5', chuteId: 'ce6a92e4-5c2f-5681-9742-c80a4447bbdf', ownedBy: 'sglang', quantization: 'fp8', confidentialCompute: true },
    },
    modelTransform: (raw) => {
      // Capability fields: only emit explicit true/false when the provider sent
      // an array we can interpret. Missing arrays mean unknown — emit undefined,
      // not false. Coercing unknown → false would silently disable tool calling
      // on dynamic models that actually support it.
      const supportedFeatures = Array.isArray(raw.supported_features) ? raw.supported_features : null;
      const inputModalities = Array.isArray(raw.input_modalities) ? raw.input_modalities : null;
      return {
        id: raw.id,
        name: raw.id,
        description: raw.root ? `TEE model for ${raw.root}` : '',
        createdAt: raw.created || null,
        ownedBy: raw.owned_by || null,
        contextLength: raw.context_length || raw.max_model_len || 0,
        maxOutputLength: raw.max_output_length || 0,
        inputCostPer1M: raw.pricing?.prompt ?? raw.price?.input?.usd ?? null,
        outputCostPer1M: raw.pricing?.completion ?? raw.price?.output?.usd ?? null,
        inputCacheReadCostPer1M: raw.pricing?.input_cache_read ?? raw.price?.input_cache_read?.usd ?? null,
        supportsVision: inputModalities ? inputModalities.includes('image') : undefined,
        supportsTools: supportedFeatures ? supportedFeatures.includes('tools') : undefined,
        reasoning: supportedFeatures ? supportedFeatures.includes('reasoning') : undefined,
        chuteId: raw.chute_id || null,
        root: raw.root || null,
        confidentialCompute: raw.confidential_compute === true,
      };
    },
    modelFilter: (m) => m.id && m.confidential_compute === true,
    compat: {},
    sdkOptions: {},
  },
];

// ─────────────────────────── PROVIDER TEMPLATES ───────────────────────────
// Pre-configured templates for the generic OpenAI-compatible provider system.
// Users select a template when adding a custom provider — it auto-fills name, URL, etc.

export const PROVIDER_TEMPLATES = [
  {
    key: 'mistral',
    name: 'Mistral AI',
    baseURL: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    description: 'Mistral AI — European AI lab with efficient, high-quality models',
  },
  {
    key: 'fireworks',
    name: 'Fireworks AI',
    baseURL: 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
    supportsTools: true,
    supportsStreaming: true,
    description: 'Fireworks AI — Fast inference for open-source models',
  },
  {
    key: 'ollama',
    name: 'Ollama (Local)',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    supportsTools: true,
    supportsStreaming: true,
    requiresApiKey: false,
    description: 'Ollama — Run open-source LLMs locally',
  },
  {
    key: 'lm-studio',
    name: 'LM Studio (Local)',
    baseURL: 'http://localhost:1234/v1',
    defaultModel: 'loaded-model',
    supportsStreaming: true,
    requiresApiKey: false,
    description: 'LM Studio — Desktop app for running local LLMs',
  },
  {
    key: 'deepinfra',
    name: 'DeepInfra',
    baseURL: 'https://api.deepinfra.com/v1/openai',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    supportsTools: true,
    supportsStreaming: true,
    description: 'DeepInfra — Affordable serverless GPU inference',
  },
  {
    key: 'perplexity',
    name: 'Perplexity AI',
    baseURL: 'https://api.perplexity.ai',
    defaultModel: 'sonar-pro',
    supportsTools: false,
    supportsStreaming: true,
    description: 'Perplexity AI — Search-grounded AI answers',
  },
  {
    key: 'sambanova',
    name: 'SambaNova',
    baseURL: 'https://api.sambanova.ai/v1',
    defaultModel: 'Meta-Llama-3.3-70B-Instruct',
    supportsStreaming: true,
    description: 'SambaNova — Enterprise AI inference platform',
  },
  {
    key: 'novita',
    name: 'Novita AI',
    baseURL: 'https://api.novita.ai/v3/openai',
    defaultModel: 'meta-llama/llama-3.1-70b-instruct',
    supportsStreaming: true,
    description: 'Novita AI — Scalable model inference API',
  },
  {
    key: 'nebius',
    name: 'Nebius',
    baseURL: 'https://api.studio.nebius.ai/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    supportsStreaming: true,
    description: 'Nebius — Cloud AI inference (Yandex spinoff)',
  },
  {
    key: 'nvidia-nim',
    name: 'NVIDIA NIM',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'meta/llama-3.1-70b-instruct',
    supportsStreaming: true,
    description: 'NVIDIA NIM — GPU-optimized model inference microservices',
  },
  {
    key: 'scaleway',
    name: 'Scaleway',
    baseURL: 'https://api.scaleway.ai/v1',
    defaultModel: 'llama-3.3-70b-instruct',
    supportsStreaming: true,
    description: 'Scaleway — European cloud AI inference',
  },
  {
    key: 'hyperbolic',
    name: 'Hyperbolic',
    baseURL: 'https://api.hyperbolic.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    supportsStreaming: true,
    description: 'Hyperbolic — Open-access AI cloud',
  },
  {
    key: 'meta-llama',
    name: 'Meta Llama API',
    baseURL: 'https://api.llama.com/v1',
    defaultModel: 'Llama-4-Maverick-17B-128E-Instruct-FP8',
    supportsTools: true,
    supportsStreaming: true,
    description: 'Meta Llama API — Official Llama model API from Meta',
  },
  {
    key: 'cohere',
    name: 'Cohere',
    baseURL: 'https://api.cohere.com/compatibility/v1',
    defaultModel: 'command-r-plus',
    supportsTools: true,
    supportsStreaming: true,
    description: 'Cohere — Enterprise AI with RAG-optimized models (OpenAI-compat mode)',
  },
  {
    key: 'lambda',
    name: 'Lambda',
    baseURL: 'https://api.lambdalabs.com/v1',
    defaultModel: 'llama3.3-70b-instruct-fp8',
    supportsStreaming: true,
    description: 'Lambda — GPU cloud with model inference API',
  },
  {
    key: 'lepton',
    name: 'Lepton AI',
    baseURL: 'https://api.lepton.ai/v1',
    defaultModel: 'llama3.1-70b',
    supportsStreaming: true,
    description: 'Lepton AI — Serverless AI inference platform',
  },
  {
    key: 'vllm',
    name: 'vLLM (Local)',
    baseURL: 'http://localhost:8000/v1',
    defaultModel: 'default',
    supportsStreaming: true,
    requiresApiKey: false,
    description: 'vLLM — High-throughput local LLM serving engine',
  },
  {
    key: 'jan',
    name: 'Jan (Local)',
    baseURL: 'http://localhost:1337/v1',
    defaultModel: 'default',
    supportsStreaming: true,
    requiresApiKey: false,
    description: 'Jan — Open-source desktop AI assistant',
  },
];

// ─────────────────────────── EXPORTS ───────────────────────────

/** Get all built-in provider configs */
export function getAllProviderConfigs() {
  return PROVIDER_CONFIGS;
}

/** Get a provider config by key or name (display name, slug, etc.) */
export function getProviderConfig(key) {
  const lower = key.toLowerCase();
  // Direct key match
  const byKey = PROVIDER_CONFIGS.find((p) => p.key === lower);
  if (byKey) return byKey;
  // Fuzzy match: strip non-alphanumeric and compare
  const stripped = lower.replace(/[^a-z0-9]/g, '');
  return PROVIDER_CONFIGS.find((p) => p.key === stripped || p.name.toLowerCase().replace(/[^a-z0-9]/g, '') === stripped);
}

/** Get all provider keys */
export function getAllProviderKeys() {
  return PROVIDER_CONFIGS.map((p) => p.key);
}

/** Get providers that support a specific capability */
export function getProvidersWithCapability(capability) {
  return PROVIDER_CONFIGS.filter((p) => p.capabilities[capability] != null);
}

/** Get all provider templates for the generic provider system */
export function getAllProviderTemplates() {
  return PROVIDER_TEMPLATES;
}

/** Get a specific provider template by key */
export function getProviderTemplate(key) {
  return PROVIDER_TEMPLATES.find((t) => t.key === key.toLowerCase());
}

/** Get recommended models for a provider (top models to show first in dropdowns) */
export function getRecommendedModels(providerKey) {
  const config = getProviderConfig(providerKey);
  return config?.recommendedModels || config?.fallbackModels?.slice(0, 3) || [];
}

/** Build a PROVIDER_CAPABILITIES object (for backward compat with ProviderRegistry) */
export function buildProviderCapabilities() {
  const caps = {};
  for (const config of PROVIDER_CONFIGS) {
    caps[config.key] = {};
    if (config.capabilities.text) {
      caps[config.key].text = {
        models: config.fallbackModels,
        ...config.capabilities.text,
      };
    }
    if (config.capabilities.vision) {
      caps[config.key].vision = {
        models: config.fallbackVisionModels || config.fallbackModels,
        ...config.capabilities.vision,
      };
    } else {
      caps[config.key].vision = null;
    }
    if (config.capabilities.imageGen) {
      caps[config.key].imageGen = config.capabilities.imageGen;
    } else {
      caps[config.key].imageGen = null;
    }
  }
  return caps;
}

/** Build a baseURLs map (for backward compat with LlmService) */
export function buildBaseURLs() {
  const urls = {};
  for (const config of PROVIDER_CONFIGS) {
    urls[config.key] = config.baseURL;
  }
  // Add local provider
  urls.local = 'http://127.0.0.1:1234/v1';
  return urls;
}

// ─────────────────────────── MODEL METADATA HELPERS ───────────────────────────

/**
 * Mapping of provider variants to their parent provider for metadata fallback.
 * When a variant (e.g. 'openai-codex') has no modelMetadata, we check the parent.
 */
const PROVIDER_METADATA_FALLBACK = {
  'openai-codex': 'openai',
  'claude-code': 'anthropic',
  'gemini-cli': 'gemini',
  'antigravity': 'gemini',
  'grok-build': 'grokai',
  'cursor-cli': 'openai',
  'chutes': 'openrouter',
  'togetherai': 'openrouter',
  'cerebras': 'groq',
  'groq': 'openrouter',
  'kimi-code': 'kimi',
};

function buildReasoningControl(kind, options, defaultValue = 'default') {
  return {
    kind,
    defaultValue,
    options,
  };
}

function inferVariantModelMetadata(providerKey, modelId) {
  const lowerProvider = String(providerKey || '').toLowerCase();
  const lowerModel = String(modelId || '').toLowerCase();

  if (lowerProvider === 'openai-codex') {
    if (lowerModel.endsWith('-codex')) {
      const stripped = modelId.slice(0, -6);
      const direct = getModelMetadata('openai', stripped);
      if (direct) return direct;
      // gpt-5.3-codex → no gpt-5.3 entry yet; fall through to generic gpt-5.x below
      return inferGenericGpt5Metadata(stripped);
    }
    if (lowerModel.endsWith('-codex-max')) {
      const stripped = modelId.slice(0, -10);
      const direct = getModelMetadata('openai', stripped);
      if (direct) return direct;
      return inferGenericGpt5Metadata(stripped);
    }
    // Plain Codex models like 'gpt-5.5' (no -codex suffix) — handled by next branch.
  }

  // Generic gpt-5.x inference for OpenAI / Codex when an exact metadata
  // entry isn't present. New OpenAI gpt-5.x releases (5.3, 5.4, 5.5, …) all
  // ship with vision + tools per OpenAI's docs; without this, supportsVision
  // returns false and the orchestrator silently force-routes to analyze_image
  // instead of letting the model see the image directly.
  if (lowerProvider === 'openai' || lowerProvider === 'openai-codex') {
    const generic = inferGenericGpt5Metadata(modelId);
    if (generic) return generic;
  }

  // Pattern-based inference for Anthropic, Gemini, Grok, Llama, Qwen, etc.
  const norm = normalizeModelKey(modelId);

  // Anthropic / Claude date-suffixed or alias matching
  if (/^claude-3-5-sonnet(-\d+)?$/.test(norm) || /^claude-sonnet-3-5$/.test(norm) || /^claude-3-7-sonnet(-\d+)?$/.test(norm) || /^claude-3-7$/.test(norm)) {
    return getModelMetadata('anthropic', 'claude-sonnet-5') || getModelMetadata('anthropic', 'claude-sonnet-4-6');
  }
  if (/^claude-3-5-haiku(-\d+)?$/.test(norm) || /^claude-3-haiku(-\d+)?$/.test(norm)) {
    return getModelMetadata('anthropic', 'claude-haiku-4-5-20251001');
  }
  if (/^claude-3-opus(-\d+)?$/.test(norm)) {
    return getModelMetadata('anthropic', 'claude-opus-5');
  }
  if (/^claude-3-sonnet(-\d+)?$/.test(norm)) {
    return getModelMetadata('anthropic', 'claude-sonnet-4-6');
  }

  // Gemini pattern matching
  if (/^gemini-1-5-flash(-\d+)?$/.test(norm) || /^gemini-2-0-flash(-exp)?$/.test(norm)) {
    return getModelMetadata('gemini', 'gemini-2.5-flash-lite');
  }
  if (/^gemini-1-5-pro(-\d+)?$/.test(norm) || /^gemini-pro(-agent)?$/.test(norm)) {
    return getModelMetadata('gemini', 'gemini-2.5-pro');
  }
  if (/^gemini-3-flash(-agent)?$/.test(norm) || /^gemini-3-5-flash(-low|-extra-low)?$/.test(norm) || /^gemini-3-6-flash-(high|medium|low)$/.test(norm)) {
    return getModelMetadata('gemini', 'gemini-2.5-flash');
  }

  // Grok pattern matching
  if (/^grok-4-3(-fast)?$/.test(norm) || /^grok-4-0709$/.test(norm) || /^grok-4-1-fast-(reasoning|non-reasoning)$/.test(norm) || /^grok-code-fast-1$/.test(norm)) {
    return getModelMetadata('grokai', 'grok-4-1-fast-reasoning');
  }
  if (/^grok-4-20(-0309)?(-reasoning|-non-reasoning|-multi-agent)?$/.test(norm)) {
    return getModelMetadata('grokai', 'grok-4-0709');
  }

  // Llama pattern matching
  if (/^llama-3-[13]-(70|8)b(-versatile|-instruct|-instant)?$/.test(norm)) {
    return getModelMetadata('groq', 'llama-3.3-70b-versatile') || getModelMetadata('groq', 'llama-3.1-8b-instant');
  }

  return null;
}

function inferGenericGpt5Metadata(modelId) {
  const m = String(modelId || '').toLowerCase();
  // Match gpt-5, gpt-5.x, gpt-5.x.y — but NOT gpt-50, gpt-500, etc.
  if (!/^gpt-5(?:\.\d+)*(?:-[a-z0-9]+)*$/.test(m)) return null;
  // Suffixed minis/nanos already exist in metadata; only fill the gap for
  // un-suffixed versioned models we haven't enumerated yet.
  const isMini = m.endsWith('-mini') || m.endsWith('-nano');
  return {
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputCostPer1M: isMini ? 0.25 : 1.25,
    outputCostPer1M: isMini ? 2.0 : 10.0,
    supportsVision: true,
    supportsTools: true,
    reasoning: true,
    inferred: true,
  };
}

/**
 * Dynamic pricing cache — populated at runtime from provider API responses.
 * Keyed by "providerKey:modelId", values are metadata objects with inputCostPer1M/outputCostPer1M.
 * Used for providers like OpenRouter that return per-model pricing in their API.
 */
const dynamicPricingCache = new Map();

/**
 * Register dynamic metadata for a model (from provider API response).
 *
 * Merges field-by-field with any prior cache entry. Accepts any value that is
 * not strictly `undefined` — including `false` and `0`. This is load-bearing:
 * capability fields like `supportsTools: false` would be silently dropped by
 * truthy gates (`?? null`, `metadata.x ? {...} : {}`), regressing the
 * undefined-vs-false fix that lets unknown capability stay unknown rather
 * than getting coerced to "explicitly unsupported."
 *
 * @param {string} providerKey - Provider key (e.g., 'openrouter')
 * @param {string} modelId - Model ID
 * @param {Object} metadata - { contextWindow, inputCostPer1M, supportsTools, ... }
 */
export function registerDynamicPricing(providerKey, modelId, metadata) {
  if (!metadata) return;
  const key = `${providerKey}:${modelId}`;
  const prior = dynamicPricingCache.get(key) || {};
  const merged = { ...prior };
  for (const [k, v] of Object.entries(metadata)) {
    if (v !== undefined) merged[k] = v; // accept false / 0; reject only undefined
  }
  merged.dynamic = true;
  dynamicPricingCache.set(key, merged);

  // Durability hook (PRD-122). This cache used to be memory-only and
  // picker-triggered, which meant every restart forgot every price a provider
  // had ever reported — so the boot-time repricer, which runs before any
  // client opens a model list, could never use it. The hook is injected by
  // modelMetadataPersistence rather than imported, so this module stays free
  // of a database dependency (unit tests import it constantly). Fire-and-
  // forget: pricing metadata must never block or fail a model-list fetch.
  if (dynamicPricingPersistHook) {
    try {
      dynamicPricingPersistHook(providerKey, modelId, merged);
    } catch { /* persistence is best-effort by contract */ }
  }
}

let dynamicPricingPersistHook = null;

/** Injected by modelMetadataPersistence at boot. */
export function setDynamicPricingPersistence(fn) {
  dynamicPricingPersistHook = typeof fn === 'function' ? fn : null;
}

/**
 * Bulk-load persisted entries into the in-memory cache WITHOUT re-firing the
 * persistence hook (they came from the store; writing them back would be a
 * loop). Used once per process at boot.
 */
export function hydrateDynamicPricing(rows) {
  let n = 0;
  for (const row of rows || []) {
    if (!row?.provider || !row?.model || !row?.metadata) continue;
    const key = `${row.provider}:${row.model}`;
    // In-memory (fresher) wins over persisted (older) on conflict.
    const prior = dynamicPricingCache.get(key);
    dynamicPricingCache.set(key, prior ? { ...row.metadata, ...prior } : { ...row.metadata });
    n += 1;
  }
  return n;
}

/**
 * The same model arrives under many spellings — grokai/grok-4.3,
 * <custom-uuid>/xai/grok-4.3, openrouter/x-ai/grok-4.3 — and catalogs disagree
 * about dots vs dashes (claude-sonnet-4.5 vs claude-sonnet-4-5). Normalising
 * to the final path segment with dots flattened lets one catalog entry answer
 * for all of them.
 */
export function normalizeModelKey(modelId) {
  const parts = String(modelId || '').toLowerCase().trim().split('/');
  return (parts[parts.length - 1] || '').replace(/\./g, '-');
}

/**
 * Register dynamic metadata from an array of fetched model objects.
 *
 * Provider-agnostic: handles every provider's `/models` response shape that
 * exposes a context window (under any of the known field aliases) and/or
 * pricing (either pre-parsed numeric or OpenRouter's per-token strings).
 * Capability fields are persisted only when strictly boolean — unknown stays
 * unknown. Provider-specific extras (Chutes' chuteId/root/ownedBy/etc.) flow
 * through verbatim.
 *
 * @param {string} providerKey - Provider key
 * @param {Object[]} models - Array of model objects from fetchModels()
 */
export function registerDynamicPricingFromModels(providerKey, models) {
  if (!models?.length) return;
  let registered = 0;
  for (const model of models) {
    const ctx =
      model.contextWindow ??
      model.contextLength ??
      model.context_window ??
      model.context_length ??
      model.inputTokenLimit ??
      null;

    // Capability fields: preserve undefined for unknown.
    const cap = {};
    if (typeof model.supportsTools === 'boolean') cap.supportsTools = model.supportsTools;
    if (typeof model.reasoning === 'boolean') cap.reasoning = model.reasoning;
    if (typeof model.supportsVision === 'boolean') cap.supportsVision = model.supportsVision;

    // Pricing — present for OpenRouter (per-token strings, post-parse) and for
    // providers like Chutes that pre-parse via their own modelTransform.
    const pricing = {};
    if (model.pricing?.prompt != null && model.pricing?.completion != null) {
      pricing.inputCostPer1M = parseFloat(model.pricing.prompt) * 1_000_000;
      pricing.outputCostPer1M = parseFloat(model.pricing.completion) * 1_000_000;
    }
    // Together AI and several OpenAI-compatible hosts publish pricing as
    // { input, output } ALREADY in dollars per million tokens, rather than
    // OpenRouter's { prompt, completion } in dollars per token. Same data,
    // different spelling — parsing only one shape silently discards the other
    // provider's published prices and every one of its models reads as
    // "unknown cost" despite the price arriving in the same response.
    if (pricing.inputCostPer1M == null && model.pricing?.input != null) {
      const v = parseFloat(model.pricing.input);
      if (Number.isFinite(v) && v >= 0) pricing.inputCostPer1M = v;
    }
    if (pricing.outputCostPer1M == null && model.pricing?.output != null) {
      const v = parseFloat(model.pricing.output);
      if (Number.isFinite(v) && v >= 0) pricing.outputCostPer1M = v;
    }

    // xAI's spelling: FLAT top-level integers in units of 1e-10 dollars per
    // token, i.e. divide by 10,000 for dollars per million. Verified live
    // 2026-08-10 against api.x.ai/v1/models — grok-4.20 returns
    // prompt_text_token_price 12500 and cached_prompt_text_token_price 2000,
    // which convert to $1.25/M and $0.20/M and match this catalog's hand-
    // maintained entry for that model exactly.
    //
    // This matters more for xAI than for most providers because its cached
    // rates differ PER MODEL (grok-4.3 is 0.1x of input, grok-4.20 is 0.16x),
    // so no family multiplier can be correct for it. Reading the vendor's own
    // numbers is the only approach that stays right when they add a model.
    const xaiPerMillion = (v) => {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
      return v / 10_000;
    };
    const xaiInput = xaiPerMillion(model.prompt_text_token_price);
    if (pricing.inputCostPer1M == null && xaiInput != null) pricing.inputCostPer1M = xaiInput;
    const xaiOutput = xaiPerMillion(model.completion_text_token_price);
    if (pricing.outputCostPer1M == null && xaiOutput != null) pricing.outputCostPer1M = xaiOutput;
    const xaiCached = xaiPerMillion(model.cached_prompt_text_token_price);
    if (xaiCached != null) pricing.inputCacheReadCostPer1M = xaiCached;

    // Published cache rates (OpenRouter's per-token spelling). A provider that
    // states its own cached-read/write price is authoritative; the multiplier
    // table in getModelCost is only a fallback for providers that publish a
    // base rate and nothing else.
    const perToken = (v) => {
      if (v == null) return null;
      const n = parseFloat(v);
      return Number.isFinite(n) && n >= 0 ? n * 1_000_000 : null;
    };
    const cacheReadRate = perToken(model.pricing?.input_cache_read);
    if (cacheReadRate != null) pricing.inputCacheReadCostPer1M = cacheReadRate;
    const cacheWriteRate = perToken(model.pricing?.input_cache_write);
    if (cacheWriteRate != null) pricing.inputCacheWriteCostPer1M = cacheWriteRate;
    const cacheWrite1hRate = perToken(model.pricing?.input_cache_write_1h);
    if (cacheWrite1hRate != null) pricing.inputCacheWrite1hCostPer1M = cacheWrite1hRate;

    if (model.inputCostPer1M != null) pricing.inputCostPer1M = model.inputCostPer1M;
    if (model.outputCostPer1M != null) pricing.outputCostPer1M = model.outputCostPer1M;
    if (model.inputCacheReadCostPer1M != null) {
      pricing.inputCacheReadCostPer1M = model.inputCacheReadCostPer1M;
    }
    if (model.inputCacheWriteCostPer1M != null) {
      pricing.inputCacheWriteCostPer1M = model.inputCacheWriteCostPer1M;
    }
    if (model.inputCacheWrite1hCostPer1M != null) {
      pricing.inputCacheWrite1hCostPer1M = model.inputCacheWrite1hCostPer1M;
    }

    // Provider-specific extras (Chutes' chuteId/root/ownedBy/etc.).
    const extras = {};
    for (const k of ['chuteId', 'root', 'ownedBy', 'quantization', 'confidentialCompute']) {
      if (model[k] != null) extras[k] = model[k];
    }

    const hasAnything =
      ctx ||
      Object.keys(pricing).length ||
      Object.keys(cap).length ||
      Object.keys(extras).length;

    if (hasAnything) {
      registerDynamicPricing(providerKey, model.id, {
        contextWindow: ctx || undefined,
        maxOutputTokens: model.maxOutputLength || model.outputTokenLimit || undefined,
        ...pricing,
        ...cap,
        ...extras,
      });
      registered++;
    }
  }
  if (registered > 0) {
    console.log(`[Dynamic Metadata] Registered ${registered} ${providerKey} models`);
  }
}

/**
 * Get metadata for a specific model.
 * Lookup order:
 *   1. Static modelMetadata on the requested provider
 *   2. Parent provider metadata (for known variants like claude-code → anthropic)
 *   3. Dynamic pricing cache (from provider API responses, e.g. OpenRouter)
 *   4. Cross-provider search (same model ID on a different provider)
 * Returns null if no metadata found (graceful degradation).
 */
/** A metadata record is only useful for costing if it carries BOTH rates. */
function canPrice(meta) {
  return !!meta && meta.inputCostPer1M != null && meta.outputCostPer1M != null;
}

export function getModelMetadata(providerKey, modelId) {
  // Every step below yields a CANDIDATE. The first candidate that can actually
  // price wins; if none can, the first candidate found at all is returned.
  //
  // The chain used to return the first candidate outright, and that is a real
  // defect rather than a nicety: ~250 of the persisted catalog rows are
  // context-window-only entries captured from providers that publish no
  // prices, and boot hydrates them BEFORE the priced catalog sync. So the
  // exact-key hit at step 3 returned `{contextWindow}` with no rates and the
  // search stopped — leaving minimax-m2, glm-4.5-air, deepseek-v4-pro and
  // every dated gpt-4o snapshot unpriced even though the price was already in
  // memory one step further down.
  //
  // Ordering within the chain is unchanged, so an exact match still beats a
  // normalised one whenever both can price.
  let firstSeen = null;
  const consider = (meta) => {
    if (!meta) return null;
    if (canPrice(meta)) return meta;
    firstSeen ||= meta;
    return null;
  };

  // 1. Direct lookup on the requested provider
  const config = getProviderConfig(providerKey);
  let hit = consider(config?.modelMetadata?.[modelId]);
  if (hit) return hit;

  // 2. Fallback to parent provider for known variants
  const fallbackKey = PROVIDER_METADATA_FALLBACK[providerKey];
  if (fallbackKey) {
    const fallbackConfig = getProviderConfig(fallbackKey);
    hit = consider(fallbackConfig?.modelMetadata?.[modelId]);
    if (hit) return hit;
  }

  // 2b. Variant-specific inference (e.g. gpt-5.2-codex -> gpt-5.2)
  hit = consider(inferVariantModelMetadata(providerKey, modelId));
  if (hit) return hit;

  // 3. Dynamic pricing cache (populated from provider API responses)
  hit = consider(dynamicPricingCache.get(`${providerKey}:${modelId}`));
  if (hit) return hit;

  // 4. Search all providers for this exact model ID
  for (const p of PROVIDER_CONFIGS) {
    if (p.key === providerKey || p.key === fallbackKey) continue;
    hit = consider(p.modelMetadata?.[modelId]);
    if (hit) return hit;
  }

  // 4b. Strip a trailing release stamp and retry (PRD-122).
  //
  // Providers publish the same model under a pinned alias: OpenAI serves
  // gpt-4o AND gpt-4o-2024-08-06, gpt-4.1 AND gpt-4.1-2025-04-14; Gemini
  // serves gemini-2.0-flash AND gemini-2.0-flash-001. The pinned form is the
  // SAME model at the SAME price, so enumerating every snapshot by hand is
  // busywork that silently falls behind each new release. One rule covers
  // every provider, past and future.
  const destamped = stripReleaseStamp(modelId);
  if (destamped) {
    hit = consider(getModelMetadata(providerKey, destamped));
    if (hit) return hit;
  }

  // 4c. Family-prefix inference (PRD-122).
  //
  // Providers ship endless variants of one priced family: -latest aliases,
  // -preview stamps, -lite/-thinking/-highspeed tiers, IDE-specific builds.
  // Enumerating them is a treadmill — every release adds more and the list is
  // always one launch behind. Dropping trailing segments until a priced
  // ancestor is found covers all of them with one rule, and it is bounded:
  // same provider (or its declared parent), longest prefix first, and only
  // after every exact path above has already missed.
  const familyMeta = inferByFamilyPrefix(providerKey, modelId, fallbackKey);
  hit = consider(familyMeta);
  if (hit) return hit;

  // 5. Normalised-name search (PRD-122).
  //
  // Custom providers store a UUID as their key and often prefix the model
  // with a vendor path (<uuid> + xai/grok-4.3), and routers spell first-party
  // models with the vendor attached (openrouter + anthropic/claude-haiku-4-5-
  // 20251001) — so steps 1-4 miss even when the model is perfectly known.
  // Dynamic cache first (catalog data is usually fresher), then static tables.
  const wanted = normalizeModelKey(modelId);
  if (wanted) {
    for (const [cacheKey, meta] of dynamicPricingCache.entries()) {
      const cachedModel = cacheKey.slice(cacheKey.indexOf(':') + 1);
      if (normalizeModelKey(cachedModel) !== wanted) continue;
      hit = consider(meta);
      if (hit) return hit;
    }
    for (const p of PROVIDER_CONFIGS) {
      for (const [staticId, meta] of Object.entries(p.modelMetadata || {})) {
        if (normalizeModelKey(staticId) !== wanted) continue;
        hit = consider(meta);
        if (hit) return hit;
      }
    }
  }

  // 6. Provider-level default.
  //
  // A flat-rate seat (Cursor) exposes hundreds of routing aliases and meters
  // none of them. $0 charged is the TRUTHFUL figure there, and it is already
  // the documented convention for the handful of Cursor models enumerated by
  // hand — this just stops that list from having to be exhaustive.
  const defaults = config?.defaultModelMetadata || (fallbackKey ? getProviderConfig(fallbackKey)?.defaultModelMetadata : null);
  hit = consider(defaults);
  if (hit) return hit;

  // Nothing could price it. Return whatever was found first — it still carries
  // a real contextWindow, which callers other than the ledger depend on.
  return firstSeen;
}

/**
 * Walk up the model-name family tree looking for a priced ancestor.
 *
 *   gemini-2.0-flash-lite-001 -> gemini-2.0-flash-lite -> gemini-2.0-flash ✓
 *   gpt-5.6-sol-xhigh         -> gpt-5.6-sol ✓
 *
 * Longest prefix wins, so a specific tier is always preferred over a generic
 * ancestor. Stops at two segments so a bare vendor word ('gemini', 'claude')
 * can never become the match.
 */
function inferByFamilyPrefix(providerKey, modelId, fallbackKey) {
  const base = String(modelId || '').split('/').pop();
  const parts = base.split('-');
  if (parts.length < 3) return null;

  const providers = [getProviderConfig(providerKey), fallbackKey ? getProviderConfig(fallbackKey) : null].filter(Boolean);

  for (let end = parts.length - 1; end >= 2; end -= 1) {
    const candidate = parts.slice(0, end).join('-');
    if (candidate === base) continue;
    for (const p of providers) {
      const meta = p.modelMetadata?.[candidate];
      if (canPrice(meta)) return meta;
    }
    const dyn = dynamicPricingCache.get(`${providerKey}:${candidate}`);
    if (canPrice(dyn)) return dyn;
  }
  return null;
}

/**
 * Strip a trailing release stamp from a model id, or null when there is none.
 *
 *   gpt-4o-2024-08-06      -> gpt-4o
 *   gpt-4.1-mini-2025-04-14 -> gpt-4.1-mini
 *   gemini-2.0-flash-001    -> gemini-2.0-flash
 *
 * Deliberately narrow. A bare 3-digit group is only treated as a stamp when
 * something remains that still looks like a model name, so `grok-3` and
 * `llama-4` survive untouched.
 */
function stripReleaseStamp(modelId) {
  const id = String(modelId || '');
  const patterns = [
    /-\d{4}-\d{2}-\d{2}$/,   // -2024-08-06
    /-\d{8}$/,               // -20241022
    /-\d{4}$/,               // -0125  (OpenAI legacy point releases)
    /-\d{3}$/,               // -001   (Gemini pinned revisions)
  ];
  for (const re of patterns) {
    if (!re.test(id)) continue;
    const base = id.replace(re, '');
    // Require a residue that still contains a letter, so we never reduce a
    // version-bearing name like "grok-3" to "grok".
    // 'o3-2025-04-16' -> 'o3'. A 2-character base is legitimate (the whole
    // o-series), so the guard only rejects an empty or digit-only residue.
    if (/[a-z]/i.test(base) && base.length >= 2 && base !== id) return base;
  }
  return null;
}

/**
 * Resolve the right `max_tokens` value to send for a (provider, model) request.
 *
 * Looks up the model's documented max output from the metadata table. If the
 * model is unknown (a brand-new release we haven't catalogued yet), falls back
 * to a provider-specific ceiling that won't silently truncate long responses.
 * The defaults are deliberately high — a clear API error on an oversize value
 * is always better than a 4k/8k silent cut-off.
 *
 * Anthropic's API REQUIRES `max_tokens`, so callers should always pass the
 * result through. OpenAI-compatible providers may pass it or omit it; passing
 * the documented max is fine.
 *
 * @param {string} providerKey - e.g. 'anthropic', 'openai', 'gemini'
 * @param {string} modelId
 * @param {number} [fallback] - explicit fallback for truly unknown providers
 * @returns {number}
 */
export function resolveMaxOutputTokens(providerKey, modelId, fallback) {
  const meta = getModelMetadata(providerKey, modelId);
  if (meta?.maxOutputTokens) return meta.maxOutputTokens;

  const key = (providerKey || '').toLowerCase();
  // Anthropic — current flagship ceiling (Fable 5 / Opus 4.6-4.8 = 128k)
  if (key === 'anthropic' || key === 'claude-code') return 128000;
  // OpenAI — gpt-5.x flagship ceiling
  if (key === 'openai' || key === 'openai-codex') return 128000;
  // Gemini — current 2.5/3.x ceiling
  if (key === 'gemini') return 65536;
  // xAI Grok 4.x — 131k
  if (key === 'grokai' || key === 'xai') return 131072;
  // Groq / Cerebras / TogetherAI / OpenRouter — varies widely; 64k is a sane ceiling
  if (['groq', 'cerebras', 'togetherai', 'openrouter', 'deepseek'].includes(key)) return 65536;

  return fallback ?? 65536;
}

/**
 * Estimate cost for a given number of input/output tokens, accounting for
 * prompt cache discounts where applicable.
 *
 * Cache pricing multipliers (applied to base input cost):
 *   - Anthropic cache read       : 0.1×  (90% discount, same for 5m & 1h)
 *   - Anthropic 5-min cache write: 1.25×
 *   - Anthropic 1-hour cache write: 2.0×  (extended-cache-ttl-2025-04-11)
 *   - OpenAI cache read          : 0.5×  (auto-applied, 50% discount)
 *   - OpenAI cache write         : 1.0×  (no write premium)
 *
 * `inputTokens` is the TRUE TOTAL input (uncached + cache_read + cache_creation_5m + cache_creation_1h).
 *
 * Back-compat: if only `cacheCreationTokens` is passed (no 5m/1h split), it is
 * treated as 5-minute creation (the historical default).
 *
 * @param {string} providerKey
 * @param {string} modelId
 * @param {number} inputTokens - total input tokens (includes cached)
 * @param {number} outputTokens - total output tokens
 * @param {object} [cache] - { cacheReadTokens, cacheCreation5mTokens, cacheCreation1hTokens, cacheCreationTokens }
 * @returns {{inputCost:number, outputCost:number, totalCost:number}|null}
 */
export function getModelCost(providerKey, modelId, inputTokens, outputTokens, cache = {}) {
  const meta = getModelMetadata(providerKey, modelId);
  if (!meta || meta.inputCostPer1M == null || meta.outputCostPer1M == null) return null;

  const cacheRead = cache.cacheReadTokens || 0;
  const cacheWrite5m = cache.cacheCreation5mTokens != null
    ? cache.cacheCreation5mTokens
    : (cache.cacheCreationTokens || 0); // back-compat: legacy field treated as 5m
  const cacheWrite1h = cache.cacheCreation1hTokens || 0;
  const cacheWriteTotal = cacheWrite5m + cacheWrite1h;
  const uncached = Math.max(0, inputTokens - cacheRead - cacheWriteTotal);

  // Family multipliers — including the OpenRouter vendor remap, which lives
  // there now so the router's economics are resolved in exactly one place —
  // live in getCacheEconomics so the DISPLAY layer can ask
  // "is this rate actually known?" without re-deriving the table. Billing math
  // here is unchanged: an unknown family still bills conservatively at 1.0x —
  // we never invent a discount — but the panel no longer presents that 1.0x as
  // a fact about the provider.
  const { readMult, write5mMult, write1hMult } = getCacheEconomics(providerKey, modelId);

  const baseIn = meta.inputCostPer1M / 1_000_000;
  // A provider-published cached-read price (catalogs report one per model)
  // beats the family multiplier — the multiplier is a house approximation for
  // providers that only publish a base rate.
  const readRate = meta.inputCacheReadCostPer1M != null
    ? meta.inputCacheReadCostPer1M / 1_000_000
    : baseIn * readMult;
  // Same precedence for WRITES. Without this, a routed provider whose write
  // premium differs from the family default (or whose family isn't in the
  // table at all) is billed at 1.0x — i.e. a cache write looks free, and the
  // savings figure derived from it is wrong in the user's favour, which is the
  // dangerous direction for a number attached to money.
  const write5mRate = meta.inputCacheWriteCostPer1M != null
    ? meta.inputCacheWriteCostPer1M / 1_000_000
    : baseIn * write5mMult;
  // A model can publish a 5m write rate without a 1h one. Falling back to the
  // 5m PUBLISHED rate before the multiplier keeps the two consistent.
  const write1hRate = meta.inputCacheWrite1hCostPer1M != null
    ? meta.inputCacheWrite1hCostPer1M / 1_000_000
    : (meta.inputCacheWriteCostPer1M != null
      ? meta.inputCacheWriteCostPer1M / 1_000_000
      : baseIn * write1hMult);
  const inputCost =
    uncached * baseIn +
    cacheRead * readRate +
    cacheWrite5m * write5mRate +
    cacheWrite1h * write1hRate;
  const outputCost = (outputTokens / 1_000_000) * meta.outputCostPer1M;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  };
}

/**
 * Providers billed by a flat subscription rather than per token.
 *
 * These authenticate with a CLI/OAuth session (a seat you already pay for),
 * not a metered API key, so per-token cost is NOT money the user is charged.
 * They still carry per-token metadata because "what this would have cost on
 * the metered API" is genuinely useful — but the UI must label it as notional
 * rather than presenting it as a bill.
 *
 * Evidence per entry:
 *   claude-code  - authScheme 'claude-code', sends the oauth-2025-04-20 beta
 *                  header; inherits anthropic's metered prices via
 *                  PROVIDER_METADATA_FALLBACK.
 *   openai-codex - authScheme 'codex', ChatGPT session; inherits openai's.
 *   gemini-cli   - authScheme 'gemini-cli', Google account OAuth.
 *   antigravity  - subscription-included (already priced at 0).
 *   kimi-code    - subscription CLI (already priced null).
 *   grok-build   - authScheme 'grok-build', local `grok` CLI OIDC session
 *                  (xAI subscription); models priced at 0.
 *   cursor-cli   - authScheme 'cursor-cli', local `cursor-agent login`
 *                  session (Cursor subscription); models priced at 0.
 */
/**
 * Cache pricing multipliers, with `known` as a first-class answer.
 *
 * This used to be an if/else ladder inside getModelCost whose `else` assigned
 * 1.0x. That 1.0x was never "unknown" — it was a confident assertion that the
 * provider gives no cache discount, made about providers that demonstrably do.
 * Measured 2026-08-08: 109 of 206 priced models fell through it, so the
 * savings panel read $0.00 forever.
 *
 * promptCacheTtl.js already states the house rule for this exact situation —
 * "silence is safer than a confident false claim about money" — and this table
 * now follows it (invariant I2):
 *
 *   known: true   traceable to vendor documentation, whatever the value.
 *                 Cerebras is the instructive case: its documented multiplier
 *                 IS 1.0x, and that is a FACT, not a fallback. `known` must
 *                 therefore be independent of the number.
 *   known: false  the multipliers are a conservative BILLING stance, and the
 *                 display layer must render the rate as unknown rather than as
 *                 "no discount".
 *
 * Sources for the non-obvious rows (all retrieved 2026-08-09):
 *   groq     0.5x  "There is a 50% discount for cached input tokens."
 *                  console.groq.com/docs/prompt-caching. SCOPED to the gpt-oss
 *                  family because the same page's "Supported models" section
 *                  lists only gpt-oss-120b / -20b / -safeguard-20b; every other
 *                  Groq model has no cache at all, so it must stay unknown
 *                  rather than inherit a discount for reads that cannot occur.
 *   gemini   0.1x  "Customers pay only 10% of standard input token cost for
 *                  cached tokens for all supported Gemini 2.5 and above
 *                  models." cloud.google.com/blog/products/ai-machine-learning/
 *                  vertex-ai-context-caching. Scoped to 2.5+ ids because the
 *                  citation is; older ids stay unknown. gemini-cli shares it
 *                  (same catalog, notional metered pricing).
 *   cerebras 1.0x  "cached tokens ... billed at the standard input token rate"
 *                  inference-docs.cerebras.ai/capabilities/prompt-caching — the
 *                  discount is latency, not money.
 *
 * NOT xai/grokai: its cached rates differ PER MODEL (grok-4.3 is 0.1x,
 * grok-4.20 is 0.16x), so a family constant would be wrong by construction.
 * Those models carry published per-model catalog rates instead, which always
 * win over this table — see getModelCost.
 *
 * @param {string} providerKey
 * @param {string} modelId
 * @returns {{readMult:number, write5mMult:number, write1hMult:number, known:boolean}}
 */
export function getCacheEconomics(providerKey, modelId) {
  let key = String(providerKey || '').toLowerCase();
  const model = String(modelId || '').toLowerCase();

  // OpenRouter is a router, not a vendor: the family that decides cache
  // economics is named in the model slug, not the provider key.
  if (key === 'openrouter') {
    const vendor = model.split('/')[0];
    if (vendor === 'anthropic') key = 'anthropic';
    else if (vendor === 'openai') key = 'openai';
  }

  if (key === 'anthropic' || key === 'claude-code') {
    return { readMult: 0.1, write5mMult: 1.25, write1hMult: 2.0, known: true };
  }
  if (key === 'openai' || key === 'openai-codex') {
    // "Cache writes have no additional fee on models before the GPT-5.6
    // family. For GPT-5.6 models and later model families, cache writes cost
    // 1.25x the uncached input token rate."
    // developers.openai.com/api/docs/guides/prompt-caching (retrieved
    // 2026-08-10).
    //
    // This matters most on openai-codex, whose model list LEADS with the 5.6
    // family (gpt-5.6-sol/terra/luna) — so the provider people use most was
    // the one being under-billed. It also changes the economics of a cache
    // MISS on these models: a miss is no longer neutral, it writes at 1.25x,
    // which is why prefix stability is worth real money here and not just
    // latency.
    const writeMult = GPT_56_OR_LATER.test(model) ? 1.25 : 1.0;
    return { readMult: 0.5, write5mMult: writeMult, write1hMult: writeMult, known: true };
  }
  if (key === 'groq' && /^openai\/gpt-oss/.test(model)) {
    return { readMult: 0.5, write5mMult: 1.0, write1hMult: 1.0, known: true };
  }
  if ((key === 'gemini' || key === 'gemini-cli') && /^gemini-(2\.5|[3-9])/.test(model)) {
    return { readMult: 0.1, write5mMult: 1.0, write1hMult: 1.0, known: true };
  }
  if (key === 'cerebras') {
    return { readMult: 1.0, write5mMult: 1.0, write1hMult: 1.0, known: true };
  }

  return { readMult: 1.0, write5mMult: 1.0, write1hMult: 1.0, known: false };
}

/**
 * Whether the cached-input price for this model is a fact or a fallback.
 *
 * True when the model publishes a cached-read rate in its catalog metadata, or
 * its family has a sourced multiplier above. Consumers that DISPLAY a cached
 * rate must check this; consumers that BILL may keep calling getModelCost
 * unconditionally, since its unknown path is deliberately conservative.
 */
export function isCachedRateKnown(providerKey, modelId) {
  const meta = getModelMetadata(providerKey, modelId);
  if (meta && meta.inputCacheReadCostPer1M != null) return true;
  return getCacheEconomics(providerKey, modelId).known;
}

export const SUBSCRIPTION_PROVIDERS = new Set([
  'claude-code',
  'openai-codex',
  'gemini-cli',
  'antigravity',
  'kimi-code',
  'grok-build',
  'cursor-cli',
]);

export function isSubscriptionProvider(providerKey) {
  return SUBSCRIPTION_PROVIDERS.has(String(providerKey || '').toLowerCase());
}

/**
 * Whether a provider's chat transport can carry tool/function schemas at all.
 *
 * Defaults PERMISSIVE (true) for unknown providers and for providers that
 * don't declare the capability — the historical behaviour. Only an explicit
 * `capabilities.text.supportsTools: false` opts a provider out. The
 * subscription-CLI connectors (grok-build, cursor-cli) opt out because their
 * clients drive one-shot print CLIs and silently drop any tools they are
 * given; sending schemas there makes the model hallucinate tool calls.
 */
export function providerSupportsTools(providerKey) {
  const cfg = getProviderConfig(String(providerKey || '').toLowerCase());
  return cfg?.capabilities?.text?.supportsTools !== false;
}

/**
 * Check if a model is a reasoning/thinking model.
 * Returns false if metadata not available.
 */
export function isReasoningModel(providerKey, modelId) {
  const meta = getModelMetadata(providerKey, modelId);
  return meta?.reasoning === true;
}

/**
 * Get all model metadata for a provider (for bulk API responses).
 * Returns empty object if no metadata available.
 */
export function getAllModelMetadata(providerKey) {
  const config = getProviderConfig(providerKey);
  if (!config) return {};

  const metadata = { ...(config.modelMetadata || {}) };
  const fallbackKey = PROVIDER_METADATA_FALLBACK[providerKey];
  if (fallbackKey) {
    const fallbackConfig = getProviderConfig(fallbackKey);
    if (fallbackConfig?.modelMetadata) {
      for (const [modelId, meta] of Object.entries(fallbackConfig.modelMetadata)) {
        if (!(modelId in metadata)) {
          metadata[modelId] = meta;
        }
      }
    }
  }

  for (const modelId of config.fallbackModels || []) {
    if (metadata[modelId]) continue;
    const inferredMeta = inferVariantModelMetadata(providerKey, modelId);
    if (inferredMeta) {
      metadata[modelId] = inferredMeta;
    }
  }

  const prefix = `${providerKey}:`;
  for (const [cacheKey, meta] of dynamicPricingCache.entries()) {
    if (!cacheKey.startsWith(prefix)) continue;
    const modelId = cacheKey.slice(prefix.length);
    metadata[modelId] = meta;
  }

  return metadata;
}

export function getReasoningControl(providerKey, modelId) {
  const lowerProvider = String(providerKey || '').toLowerCase();
  const lowerModel = String(modelId || '').toLowerCase();

  if (lowerProvider === 'openai' || lowerProvider === 'openai-codex') {
    if (!isOpenAIResponsesReasoningModel(modelId)) return null;

    // Codex-specific siblings (gpt-5.2-codex, gpt-5.3-codex) — narrower set,
    // no off/none. Must come before the broader gpt-5.x match below.
    if (lowerProvider === 'openai-codex' && (lowerModel.startsWith('gpt-5.3') || lowerModel.startsWith('gpt-5.2'))) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
        { value: 'xhigh', label: 'Max' },
      ]);
    }

    // Modern gpt-5.x contract: off (sent as 'none'), low, medium, high, xhigh.
    // Covers 5.1, 5.2 (non-codex), 5.4, 5.5+. The Codex Responses API rejects
    // 'minimal' for gpt-5.5+, so this branch must catch them before the
    // legacy gpt-5* fallback below. Regex handles 5.10+ for future versions.
    if (
      lowerModel.startsWith('gpt-5.1') ||
      lowerModel.startsWith('gpt-5.2') ||
      /^gpt-5\.([4-9]|\d{2,})/.test(lowerModel)
    ) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'off', label: 'Off' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
        { value: 'xhigh', label: 'Max' },
      ]);
    }

    // Legacy original gpt-5 (no decimal / -mini / -nano): 'minimal' contract,
    // no xhigh. Only the no-decimal variants land here.
    if (lowerModel.startsWith('gpt-5')) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'minimal', label: 'Minimal' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ]);
    }

    if (/^o\d/.test(lowerModel)) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ]);
    }

    return null;
  }

  if (lowerProvider === 'anthropic' || lowerProvider === 'claude-code') {
    if (!isAnthropicAdaptiveThinkingModel(modelId)) return null;

    const options = [
      { value: 'default', label: 'Default' },
      { value: 'off', label: 'Off' },
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ];

    if (anthropicSupportsXHigh(lowerModel)) {
      options.push({ value: 'xhigh', label: 'Max' });
    }

    return buildReasoningControl('effort', options);
  }

  // Antigravity routes Claude models through the Gemini-style gateway; those
  // manage their own thinking and expose no user-facing reasoning toggle.
  if (lowerProvider === 'antigravity' && lowerModel.includes('claude')) {
    return null;
  }

  if (lowerProvider === 'gemini' || lowerProvider === 'gemini-cli' || lowerProvider === 'antigravity') {
    if (isGemini3ReasoningModel(modelId)) {
      const options = [{ value: 'default', label: 'Default' }];
      if (lowerModel.includes('flash')) {
        options.push({ value: 'off', label: 'Off' });
      }
      options.push(
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      );
      return buildReasoningControl('effort', options);
    }

    if (isGemini25ReasoningModel(modelId)) {
      const options = [{ value: 'default', label: 'Default' }];
      if (lowerModel.includes('flash')) {
        options.push({ value: 'off', label: 'Off' });
      }
      options.push(
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      );
      return buildReasoningControl('effort', options);
    }

    return null;
  }

  if (lowerProvider === 'deepseek') {
    if (!supportsDeepSeekThinkingToggle(modelId)) return null;
    return buildReasoningControl('effort', [
      { value: 'default', label: 'Default' },
      { value: 'off', label: 'Off' },
      { value: 'high', label: 'High' },
      { value: 'max', label: 'Max' },
    ]);
  }

  if (lowerProvider === 'groq') {
    if (isGroqGptOssReasoningModel(modelId)) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ]);
    }

    if (isGroqQwenReasoningModel(modelId)) {
      return buildReasoningControl('toggle', [
        { value: 'default', label: 'Default' },
        { value: 'off', label: 'Off' },
      ]);
    }

    return null;
  }

  if (lowerProvider === 'cerebras') {
    if (isCerebrasGptOssReasoningModel(modelId)) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ]);
    }

    if (isCerebrasGlmReasoningModel(modelId)) {
      return buildReasoningControl('toggle', [
        { value: 'default', label: 'Default' },
        { value: 'off', label: 'Off' },
      ]);
    }

    return null;
  }

  if (lowerProvider === 'openrouter') {
    if (isOpenRouterOpenAIReasoningModel(modelId)) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'off', label: 'Off' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
        { value: 'xhigh', label: 'Max' },
      ]);
    }

    if (isOpenRouterAnthropicReasoningModel(modelId) || isOpenRouterGeminiReasoningModel(modelId)) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'off', label: 'Off' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ]);
    }

    if (isOpenRouterXaiReasoningModel(modelId)) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'off', label: 'Off' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
        { value: 'xhigh', label: 'Max' },
      ]);
    }

    return null;
  }

  if (lowerProvider === 'togetherai') {
    if (isTogetherGptOssReasoningModel(modelId)) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ]);
    }

    return null;
  }

  if (lowerProvider === 'zai') {
    // GLM-5.2: OpenAI-compatible `reasoning_effort` with `high` (default) and
    // `max` only. No `off` — adaptive thinking is always on for GLM-5.2.
    if (supportsZaiReasoningEffort(modelId)) {
      return buildReasoningControl('effort', [
        { value: 'default', label: 'Default' },
        { value: 'high', label: 'High' },
        { value: 'max', label: 'Max' },
      ]);
    }
    // GLM-5.1 / GLM-5 / GLM-4.x: legacy enabled/disabled thinking toggle.
    if (!supportsZaiThinkingToggle(modelId)) return null;
    return buildReasoningControl('toggle', [
      { value: 'default', label: 'Default' },
      { value: 'off', label: 'Off' },
    ]);
  }

  if (lowerProvider === 'kimi' || lowerProvider === 'kimi-code') {
    if (!supportsKimiReasoningToggle(lowerProvider, modelId)) return null;
    return buildReasoningControl('toggle', [
      { value: 'default', label: 'Default' },
      { value: 'off', label: 'Off' },
    ]);
  }

  if (lowerProvider === 'chutes') {
    // Chutes serves Kimi / GLM / Qwen3 models inside TEE. Each accepts the
    // same toggle UX; the underlying body-param protocol differs per family
    // and is handled in buildOpenAiLikeReasoningExtraBody.
    if (
      isChutesKimiReasoningModel(modelId) ||
      isChutesGlmReasoningModel(modelId) ||
      isChutesQwenReasoningModel(modelId)
    ) {
      return buildReasoningControl('toggle', [
        { value: 'default', label: 'Default' },
        { value: 'off', label: 'Off' },
      ]);
    }
    return null;
  }

  return null;
}

export function getModelMetadataForClient(providerKey, modelId) {
  const meta = getModelMetadata(providerKey, modelId);
  const reasoningControl = getReasoningControl(providerKey, modelId);
  if (!meta && !reasoningControl) return null;
  return reasoningControl ? { ...(meta || {}), reasoningControl } : { ...meta };
}

export function getAllModelMetadataForClient(providerKey) {
  const metadata = getAllModelMetadata(providerKey);
  const decorated = {};

  for (const [modelId, meta] of Object.entries(metadata)) {
    const reasoningControl = getReasoningControl(providerKey, modelId);
    decorated[modelId] = reasoningControl ? { ...meta, reasoningControl } : { ...meta };
  }

  const config = getProviderConfig(providerKey);
  for (const modelId of config?.fallbackModels || []) {
    if (decorated[modelId]) continue;
    const reasoningControl = getReasoningControl(providerKey, modelId);
    if (reasoningControl) {
      decorated[modelId] = { reasoningControl };
    }
  }

  return decorated;
}

export default PROVIDER_CONFIGS;
