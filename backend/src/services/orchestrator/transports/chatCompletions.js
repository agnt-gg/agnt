/**
 * The OpenAI-compatible Chat Completions transport.
 *
 * FOURTEEN of the twenty providers speak it: groq, deepseek, openrouter,
 * togetherai, grokai, minimax, zai, kimi, kimi-code, chutes, cursor-cli,
 * grok-build, local and any user-defined custom endpoint.
 *
 * CerebrasAdapter subclasses it because Cerebras is Chat-Completions-shaped
 * but has its own rate-limit semantics and streaming quirks.
 */
// ALL OF THIS SHOULD BE IN THIS AI.SERVICE

import axios from 'axios';
import { manageContext } from '../../../utils/contextManager.js';
import { validateToolCalls, createRetryGuidance } from '../toolValidator.js';
import * as ProviderRegistry from '../../ai/ProviderRegistry.js';
import CustomOpenAIProviderService from '../../ai/CustomOpenAIProviderService.js';
import {
  getModelMetadata,
  getProviderConfig,
  getReasoningControl,
  supportsZaiReasoningEffort,
  // Reasoning predicates are defined ONCE, in providerConfigs, and consumed
  // here to build the wire body. This module used to carry its own copies and
  // two had drifted (Groq gpt-oss / qwen3: config said startsWith, this file
  // said exact-match), which silently no-ops the UI toggle on any newly listed
  // model in the gap. Import, never redefine — enforced by
  // noDuplicateProviderPredicates.test.js.
  isGroqGptOssReasoningModel,
  isGroqQwenReasoningModel,
  isCerebrasGptOssReasoningModel,
  isCerebrasGlmReasoningModel,
  isTogetherGptOssReasoningModel,
  isChutesKimiReasoningModel,
  isChutesGlmReasoningModel,
  isChutesQwenReasoningModel,
  supportsKimiReasoningToggle as supportsKimiToggle,
  supportsDeepSeekThinkingToggle as supportsDeepSeekToggle,
} from '../../ai/providerConfigs.js';
import { isAnthropicReasoningModel, anthropicSupportsXHigh } from '../../ai/reasoningModels.js';
import { buildBillingHeaderBlock, extractFirstUserMessage } from '../../ai/claudeBillingHeader.js';
import { sanitizeOrphanToolCalls, sanitizeUnexpectedToolResults } from '../messageSanitizers.js';
import { openAIPromptCachePolicy } from '../../../utils/promptCacheTtl.js';
import { normalizeGeminiUsage } from '../../../utils/usageCacheFields.js';
import { resolveOpenRouterCacheContract } from '../../../utils/openRouterCache.js';

/**
 * Return the upstream provider error verbatim.
 *
 * Previous versions of this function rewrote messages — stripping HTML,
 * unwrapping JSON, replacing "quota" matches with generic templates — which
 * destroyed useful provider-specific details (upgrade URLs, schema validation
 * paths, rate-limit windows). The contract is now: whatever the SDK gave us
 * is what surfaces to the user, regardless of provider.
 *
 * @param {Error} error - The error object from the API
 * @returns {string} The raw upstream message
 */
function parseApiErrorMessage(error) {
  return error?.message || 'Unknown error occurred';
}
import { BaseAdapter } from './BaseAdapter.js';
import {
  findLastInjectableUserIndex,
  sanitizeKimiToolSchemas,
} from './_shared.js';

class OpenAiLikeAdapter extends BaseAdapter {
  constructor(client, model, options = {}) {
    super(client, model);
    this.maxRetries = 3;
    this.baseDelay = 1000; // 1 second
    this.retryableStatusCodes = new Set([429, 500, 502, 503, 504, 529]);
    // Extra body params for providers that need custom parameters (e.g., Z.AI thinking mode)
    this.extraBody = options.extraBody || null;
    // Provider key — used to gate provider-specific request shaping (e.g., Kimi schema sanitization)
    this.provider = options.provider || null;
    // Conversation identity. OpenRouter uses this to pin a conversation to one
    // upstream endpoint (sticky routing) from the FIRST request, instead of
    // only after it has already observed a cache hit.
    this.conversationId = options.conversationId || null;
    // Resolved once per adapter: which cache protocol this specific routed
    // model speaks. Null for every provider that is not OpenRouter.
    this.cacheContract = this.provider === 'openrouter'
      ? resolveOpenRouterCacheContract(model)
      : null;
  }

  /**
   * Return a copy of `messages` carrying OpenRouter cache breakpoints, or the
   * original array when this model caches automatically.
   *
   * Three breakpoints, under Anthropic's cap of four:
   *   1. the last system message — AGNT's system prompt plus tool definitions,
   *      the largest and most stable block in the request, and the one that
   *      produced the measured 94.8% saving;
   *   2. + 3. the rolling pair from _applyRollingCacheBreakpoints, so prior
   *      turns survive long tool pauses.
   *
   * Returns a COPY. The array handed to an adapter is the orchestrator's live
   * message ledger, and _applyCacheMarker rewrites string content into content
   * blocks in place. Mutating it here would leak provider-specific request
   * shape back into conversation state that other providers, the token
   * estimator, and the persisted transcript all read.
   */
  _shapeCacheBreakpoints(messages) {
    const contract = this.cacheContract;
    if (!contract || contract.mode !== 'explicit') return messages;
    if (!Array.isArray(messages) || messages.length === 0) return messages;

    const marker = contract.marker;
    if (!marker) return messages;

    const shaped = messages.map((msg) => ({
      ...msg,
      content: Array.isArray(msg.content) ? msg.content.map((b) => ({ ...b })) : msg.content,
    }));

    // Strips stale markers, then marks the rolling pair.
    this._applyRollingCacheBreakpoints(shaped, 2, marker);

    // Then the stable prefix. Must come AFTER the rolling call, which strips.
    for (let i = shaped.length - 1; i >= 0; i--) {
      if (shaped[i].role === 'system') {
        this._applyCacheMarker(shaped[i], { ...marker });
        break;
      }
    }

    return shaped;
  }

  /**
   * Request fields that identify this conversation to OpenRouter.
   *
   * OpenRouter pins a conversation to one upstream endpoint so the prefix that
   * endpoint cached stays reachable. Without an explicit key it derives
   * identity by hashing the opening messages, and per its own docs only
   * establishes stickiness AFTER it has already observed cache usage — so the
   * first hop of a conversation can land on a different upstream and start
   * cold. `session_id` is the documented sticky-routing key and makes that
   * deterministic from request one.
   *
   * Capped at 256 chars per the API contract; AGNT conversation ids are UUIDs,
   * so the slice is a guard against a future id format, not a live concern.
   */
  /**
   * Apply provider-specific tool schema fixes. Currently only Kimi/Kimi Code
   * (Moonshot) requires sanitization — every other OpenAI-compatible provider
   * passes tools through unchanged.
   */
  _prepareTools(tools) {
    if (this.provider === 'chutes') {
      const metadata = getModelMetadata('chutes', this.model);
      if (metadata?.supportsTools === false) {
        console.warn(`[Chutes] Model '${this.model}' does not support tool calling; sending request without tools.`);
        return [];
      }
    }

    if (this.provider === 'kimi' || this.provider === 'kimi-code') {
      return sanitizeKimiToolSchemas(tools);
    }
    return tools;
  }

  /**
   * Sleep for a given number of milliseconds
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  calculateDelay(attempt) {
    const exponentialDelay = this.baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
    return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
  }

  /**
   * Check if an error is retryable
   */
  isRetryableError(error) {
    if (error.status && this.retryableStatusCodes.has(error.status)) {
      return true;
    }    // Transient network / SDK-wrapped connection errors (code-based,
    // message-based, and APIConnectionError shapes) — shared BaseAdapter helper.
    if (this._isTransientNetworkError(error)) {
      return true;
    }

    // Retry 400 errors that are tool/function-related
    if (error.status === 400) {
      const message = error.message?.toLowerCase() || '';
      const errorDetails = error.error?.message?.toLowerCase() || '';
      if (
        message.includes('function') ||
        message.includes('tool') ||
        errorDetails.includes('function') ||
        errorDetails.includes('tool') ||
        message.includes('failed to call') ||
        errorDetails.includes('failed to call')
      ) {
        console.log('Treating 400 tool/function error as retryable');
        return true;
      }
    }

    return false;
  }

  /**
   * Check if error is due to token limit
   */
  isTokenLimitError(error) {
    if (error.status === 400) {
      const message = error.message?.toLowerCase() || '';
      return (
        message.includes('reduce the length') || message.includes('too long') || message.includes('token limit') || message.includes('context length')
      );
    }
    return false;
  }

  async call(messages, tools) {
    let lastError;
    let currentMessages = BaseAdapter._sanitizeOutbound(messages, 'openai-like');
    const preparedTools = this._prepareTools(tools);

    if (this.client?.__agntCompat?.mapDeveloperRole) {
      currentMessages = currentMessages.map((msg) => (msg?.role === 'developer' ? { ...msg, role: 'system' } : msg));
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const requestParams = {
          model: this.model,
          messages: this._shapeCacheBreakpoints(currentMessages),
          tools: preparedTools.length > 0 ? preparedTools : undefined,
          tool_choice: preparedTools.length > 0 ? 'auto' : undefined,
        };
        // Pass extra body params for providers that need them (e.g., Z.AI thinking)
        if (this.extraBody) {
          Object.assign(requestParams, this.extraBody);
        }
        const affinity = this._cacheAffinity();
        if (affinity?.body) Object.assign(requestParams, affinity.body);
        const response = await this.client.chat.completions.create(
          requestParams,
          affinity?.headers ? { headers: affinity.headers } : undefined,
        );

        const message = response.choices[0].message;

        // Log successful retry if this wasn't the first attempt
        if (attempt > 0) {
          console.log(`LLM call succeeded on attempt ${attempt + 1}/${this.maxRetries + 1}`);
        }

        const { message: normalizedMessage, wasEmpty } = BaseAdapter._normalizeAssistantResponse(message);
        if (wasEmpty) {
          // Diagnostic: log the raw shape so we can tell whether the provider
          // really sent nothing, or sent something the normalizer mistakenly
          // classified as empty. finish_reason is especially useful — many
          // streaming-bug empties come back with finish_reason='stop' AND no
          // content, which usually indicates a content filter or guardrail.
          const finishReason = response.choices[0]?.finish_reason;
          const rawShape = JSON.stringify({
            hasContent: message?.content !== undefined && message?.content !== null,
            contentType: typeof message?.content,
            contentLen: typeof message?.content === 'string' ? message.content.length : (Array.isArray(message?.content) ? message.content.length : null),
            toolCallsLen: Array.isArray(message?.tool_calls) ? message.tool_calls.length : 0,
            finishReason,
          });
          console.warn(`[OpenAiLike] Empty response model=${this.model} provider=${this.provider} ${rawShape}`);
        }

        return {
          responseMessage: normalizedMessage,
          toolCalls: normalizedMessage.tool_calls || [],
          usage: response.usage || undefined,
          ...(wasEmpty ? { recoveredFromError: true, recoveredError: 'Provider returned empty response' } : {}),
        };
      } catch (error) {
        lastError = error;

        // Handle token limit errors with automatic context reduction
        if (this.isTokenLimitError(error)) {
          console.warn(`Token limit error detected, attempting context reduction (attempt ${attempt + 1})`);

          const contextResult = manageContext(currentMessages, this.model, tools, this.provider);
          if (contextResult.wasManaged && contextResult.managedTokens < contextResult.originalTokens) {
            console.log(`Context reduced: ${contextResult.originalTokens} -> ${contextResult.managedTokens} tokens`);
            currentMessages = contextResult.messages;

            // Don't count this as a retry attempt, just try again with reduced context
            attempt--;
            continue;
          } else {
            console.warn('Context could not be reduced further, treating as non-retryable error');
            // Fall through to recovery response
          }
        }

        // Check if this is the last attempt or if the error is not retryable
        if (attempt === this.maxRetries || (!this.isRetryableError(error) && !this.isTokenLimitError(error))) {
          console.error(`LLM call failed after ${attempt + 1} attempts, but NEVER STOPPING:`, {
            model: this.model,
            status: error.status,
            message: error.message,
            retryable: this.isRetryableError(error),
            tokenLimit: this.isTokenLimitError(error),
          });

          // Parse the error to get a user-friendly message
          const userFriendlyError = parseApiErrorMessage(error);

          // NEVER STOP - return a recovery response instead of throwing
          return {
            responseMessage: {
              role: 'assistant',
              content: `⚠️ **API Error:** ${userFriendlyError}\n\nPlease check your API configuration or try a different provider.`,
              tool_calls: [],
            },
            toolCalls: [],
            recoveredFromError: true,
            recoveredError: error.message || 'Unknown error',
          };
        }

        // Add error context for tool/function errors to help LLM correct itself
        if (error.status === 400 && this.isRetryableError(error)) {
          const errorMessage = error.message || error.error?.message || 'Unknown error';
          console.log('Adding tool error context to help LLM retry');

          // Create a new messages array with error feedback
          currentMessages = [...currentMessages];
          currentMessages.push({
            role: 'system',
            content: `Your previous tool call failed with error: "${errorMessage}". Please retry with corrected formatting. Common issues include:
- Missing required parameters
- Incorrect parameter types (e.g., string instead of number)
- Invalid tool/function names
- Malformed JSON in arguments
Please carefully check the tool schema and ensure all parameters match the expected format.`,
          });
        }

        // Calculate delay and wait before retrying (only for non-token-limit errors)
        if (!this.isTokenLimitError(error)) {
          const delay = this.calculateDelay(attempt);
          console.warn(`LLM call failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${Math.round(delay)}ms:`, {
            status: error.status,
            message: error.message,
          });

          await this.sleep(delay);
        }
      }
    }

    // This should never be reached, but if it does, return a recovery response
    console.error('Unexpected fallback in OpenAI adapter, returning recovery response');
    return {
      responseMessage: {
        role: 'assistant',
        content: "I encountered an unexpected error, but I'm still here to help. Please try your request again.",
        tool_calls: [],
      },
      toolCalls: [],
      recoveredFromError: true,
    };
  }

  /**
   * Makes a streaming call to the LLM with real-time token updates.
   * @param {Array<Object>} messages The conversation history.
   * @param {Array<Object>} tools The available tools in OpenAI format.
   * @param {Function} onChunk Callback for streaming chunks: (chunk) => void
   * @param {Object} context Optional context with imageData for vision
   * @returns {Promise<{responseMessage: Object, toolCalls: Array<Object>}>} A standardized response object.
   */
  async callStream(messages, tools, onChunk, context = {}) {
    let lastError;
    let currentMessages = BaseAdapter._sanitizeOutbound(messages, 'openai-like');

    if (this.client?.__agntCompat?.mapDeveloperRole) {
      currentMessages = currentMessages.map((msg) => (msg?.role === 'developer' ? { ...msg, role: 'system' } : msg));
    }

    // Handle vision images - inject into the last user message ONLY if model supports vision
    if (context.imageData && context.imageData.length > 0) {
      // Extract provider from context or determine from adapter
      const provider = context.provider || 'openai'; // Default to openai for OpenAiLikeAdapter

      // Check if this model supports vision (uses metadata variant fallback so e.g.
      // openrouter passthroughs and llama-4 on groq/cerebras resolve correctly).
      const supportsVision = ProviderRegistry.supportsVision(provider, this.model);

      if (supportsVision) {
        // Deep clone to avoid mutating original messages
        currentMessages = JSON.parse(JSON.stringify(messages));

        // Inject into the last user message that is NOT a tool_result carrier.
        // OpenAI-compatible providers normally carry tool results as role:'tool',
        // but some provider adapters / history shapes can surface tool_result blocks
        // inside a user message — overwriting those orphans the preceding tool_calls.
        const targetIdx = findLastInjectableUserIndex(currentMessages);
        if (targetIdx !== -1) {
          const originalContent = currentMessages[targetIdx].content;
          currentMessages[targetIdx].content = [
            {
              type: 'text',
              text: typeof originalContent === 'string' ? originalContent : JSON.stringify(originalContent),
            },
          ];
          context.imageData.forEach((img) => {
            currentMessages[targetIdx].content.push({
              type: 'image_url',
              image_url: {
                url: `data:${img.type};base64,${img.data}`,
              },
            });
          });
          console.log(`[OpenAI Vision] Added ${context.imageData.length} image(s) to user message at index ${targetIdx}`);
        } else {
          console.warn('[OpenAI Vision] No injectable user message found (all user messages carry tool_result blocks); skipping image injection.');
        }
      } else {
        console.warn(`[Vision Check] Model '${this.model}' does not support vision. Images will be ignored.`);
        console.warn(`[Vision Check] Supported vision models for ${provider}: ${ProviderRegistry.getVisionModels(provider).join(', ')}`);
        console.warn(`[Vision Check] Consider using the 'analyze_image' tool or switching to a vision-capable model.`);
      }
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let accumulatedContent = '';
      let accumulatedReasoningContent = '';
      let accumulatedToolCalls = [];
      let role = 'assistant';
      let streamError = null;
      let finishReason = null;
      let streamUsage = null;

      try {
        // DEBUG: Log message structure before sending to OpenAI
        console.log('[OpenAI Debug] Message structure being sent:');
        currentMessages.forEach((msg, idx) => {
          console.log(`  [${idx}] role: ${msg.role}, content type: ${typeof msg.content}, isArray: ${Array.isArray(msg.content)}`);
          if (Array.isArray(msg.content)) {
            console.log(`    Array length: ${msg.content.length}, first item type: ${msg.content[0]?.type || 'unknown'}`);
          }
        });

        const abortSignal = context.abortSignal;

        // Apply provider-specific schema fixes (Kimi/Moonshot strict validator)
        let effectiveTools = this._prepareTools(tools);

        // Z.AI GLM-5 network_error workaround: large tool payloads (121KB+) cause
        // Z.AI's server to abort during inference. Limit tools to reduce payload size.
        // TODO: Remove this cap once Z.AI fixes GLM-5 tool handling
        if (this.model === 'glm-5' && effectiveTools.length > 20) {
          console.warn(`[GLM-5 Workaround] Reducing tools from ${effectiveTools.length} to 20 to avoid Z.AI network_error`);
          effectiveTools = effectiveTools.slice(0, 20);
        }

        const requestParams = {
          model: this.model,
          messages: this._shapeCacheBreakpoints(currentMessages),
          tools: effectiveTools.length > 0 ? effectiveTools : undefined,
          tool_choice: effectiveTools.length > 0 ? 'auto' : undefined,
          stream: true,
          stream_options: { include_usage: true },
        };
        // Pass extra body params for providers that need them (e.g., Z.AI thinking)
        if (this.extraBody) {
          Object.assign(requestParams, this.extraBody);
          console.log('[OpenAI Debug] Extra body params merged:', JSON.stringify(this.extraBody));
        }
        const affinity = this._cacheAffinity();
        if (affinity?.body) Object.assign(requestParams, affinity.body);
        // Log key request params (excluding message content for brevity)
        const requestBodySize = JSON.stringify(requestParams).length;
        console.log('[OpenAI Debug] Request params:', {
          model: requestParams.model,
          toolCount: requestParams.tools?.length || 0,
          stream: requestParams.stream,
          thinking: requestParams.thinking || 'not set',
          max_tokens: requestParams.max_tokens || 'not set',
          requestBodySizeKB: Math.round(requestBodySize / 1024),
        });
        const stream = await this.client.chat.completions.create(
          requestParams,
          affinity?.headers ? { headers: affinity.headers } : undefined,
        );

        try {
          for await (const chunk of stream) {
            if (abortSignal?.aborted) {
              stream.controller?.abort?.();
              console.log('[OpenAI Stream] Aborted by client disconnect');
              break;
            }

            // USAGE FIRST, and defensively.
            //
            // With stream_options.include_usage the final chunk carries the
            // whole billing record — input, output, cached reads. OpenAI's own
            // spec says that chunk's `choices` is an EMPTY ARRAY, but several
            // OpenAI-compatible providers OMIT the field entirely instead.
            // This block used to read `chunk.choices[0]` first and unguarded,
            // so those providers threw a TypeError on the usage chunk before
            // the usage was ever read: measured live on kimi 2026-08-09, where
            // a completed turn reported inputTokens undefined, outputTokens
            // undefined and cost 0 — the entire ledger blind, not merely the
            // cache counters, and indistinguishable from a free request.
            //
            // Reading usage before anything else means no future parse error
            // on an unrelated field can cost us the billing record again.
            if (chunk.usage) {
              streamUsage = chunk.usage;
            }

            const choice = chunk.choices?.[0];
            const delta = choice?.delta;

            // Track finish_reason
            if (choice?.finish_reason) {
              finishReason = choice.finish_reason;
              console.log('[Stream Debug] finish_reason:', finishReason);
            }

            if (!delta) continue;

            // Handle role
            if (delta.role) {
              role = delta.role;
            }

            // Handle content streaming
            if (delta.content) {
              accumulatedContent += delta.content;
              if (onChunk) {
                onChunk({
                  type: 'content',
                  delta: delta.content,
                  accumulated: accumulatedContent,
                });
              }
            }

            // Thinking-mode deltas. TWO spellings are live on the wire and a
            // provider only ever sends one of them:
            //
            //   reasoning_content — DeepSeek's spelling, adopted by Z.AI GLM,
            //                       Kimi/Moonshot, Chutes and the other
            //                       OpenAI-compatible hosts that copied it.
            //   reasoning         — OpenRouter's spelling, for EVERY reasoning
            //                       model it routes, whoever built the model.
            //
            // Reading only `reasoning_content` cost us the whole OpenRouter
            // reasoning surface: the thinking panel stayed empty no matter how
            // long a model thought, and — worse — the "no content but we do
            // have reasoning" fallback further down could never fire, because
            // the buffer it inspects was always ''. A model that answered
            // entirely in its reasoning channel therefore reached the user as
            // an EMPTY assistant message. stealth/ox-alpha made that
            // unmissable (its reasoning is mandatory and defaults to effort
            // 'max', so every single turn takes the broken path), but the bug
            // was never specific to one model.
            //
            // Coalesce rather than choose: no provider sends both, so taking
            // whichever arrived keeps every existing provider byte-identical.
            const reasoningDelta = delta.reasoning_content || delta.reasoning;
            if (reasoningDelta) {
              accumulatedReasoningContent += reasoningDelta;
              if (onChunk) {
                onChunk({
                  type: 'reasoning',
                  delta: reasoningDelta,
                  accumulated: accumulatedReasoningContent,
                });
              }
            }

            // Handle tool calls streaming
            if (delta.tool_calls) {
              for (const toolCallDelta of delta.tool_calls) {
                const index = toolCallDelta.index;

                // Initialize tool call if needed
                if (!accumulatedToolCalls[index]) {
                  accumulatedToolCalls[index] = {
                    id: toolCallDelta.id || `tool-${Date.now()}-${index}`,
                    type: 'function',
                    function: {
                      name: '',
                      arguments: '',
                    },
                  };
                }

                // Accumulate tool call data
                if (toolCallDelta.id) {
                  accumulatedToolCalls[index].id = toolCallDelta.id;
                }
                if (toolCallDelta.function?.name) {
                  accumulatedToolCalls[index].function.name += toolCallDelta.function.name;
                }
                if (toolCallDelta.function?.arguments) {
                  accumulatedToolCalls[index].function.arguments += toolCallDelta.function.arguments;
                }

                // Notify about tool call progress
                if (onChunk) {
                  onChunk({
                    type: 'tool_call_delta',
                    index: index,
                    toolCall: accumulatedToolCalls[index],
                  });
                }
              }
            }
          }

          console.log('[Stream Complete] Successfully processed stream:', {
            contentLength: accumulatedContent.length,
            reasoningContentLength: accumulatedReasoningContent.length,
            toolCallsCount: accumulatedToolCalls.length,
            finishReason: finishReason || 'none',
          });

          const isEmptyResponse =
            accumulatedContent.length === 0 &&
            accumulatedReasoningContent.length === 0 &&
            accumulatedToolCalls.length === 0;

          // A stream that completes CLEANLY and delivers nothing.
          //
          // The premature-close case below retries because no finish_reason
          // arrived. But a provider can also report `finish_reason: 'stop'` —
          // a successful completion — while sending zero content, zero
          // reasoning and zero tool calls. That led with `!finishReason`, so
          // it matched nothing here and fell straight through to an empty
          // assistant message, and from there to a CROSS-PROVIDER failover:
          // the user's chosen model was abandoned over a blip.
          //
          // Measured on openrouter/stealth/ox-alpha, 2026-08-23: roughly one
          // request in ten returns a single chunk carrying only
          // finish_reason 'stop', in ~1.3s, and the byte-identical request
          // then succeeds — 3 of 3 immediate retries returned full answers.
          // Transient, and indistinguishable from the half-close we already
          // retry, so it is retried the same way.
          //
          // Scoped to 'stop' deliberately. 'length', 'content_filter' and
          // 'tool_calls' are EXPLANATIONS for the silence rather than silence
          // itself, and an identical retry would just reproduce them.
          //
          // Retries only; the terminal behaviour is deliberately unchanged. If
          // every attempt comes back empty this falls through to the same
          // empty response as before, so cross-provider failover still gets
          // its turn on a provider that is genuinely down.
          if (
            isEmptyResponse
            && finishReason === 'stop'
            && !context.abortSignal?.aborted
            && attempt < this.maxRetries
          ) {
            const delay = this.calculateDelay(attempt);
            console.warn(
              `[Stream Retry] Provider reported finish_reason='stop' with an empty response `
              + `(attempt ${attempt + 1}/${this.maxRetries + 1}) model=${this.model} provider=${this.provider}. `
              + `Retrying the same model in ${Math.round(delay)}ms`,
            );
            await this.sleep(delay);
            continue; // retry the request
          }

          // Detect silent premature stream close: upstream (Kimi, Cloudflare, etc.)
          // cleanly half-closes the HTTP connection mid-response. The for-await exits
          // normally with no error — but no finish_reason arrived and the response is
          // empty. Without this check we'd silently return an empty assistant message.
          // Abort-triggered exits are expected (client disconnect) and must NOT retry.
          if (!finishReason && !context.abortSignal?.aborted) {
            const isEmpty = isEmptyResponse;

            const hasIncompleteToolCallJson = accumulatedToolCalls.some((tc) => {
              if (!tc?.function?.arguments) return false;
              try { JSON.parse(tc.function.arguments); return false; } catch { return true; }
            });

            if (isEmpty) {
              if (attempt < this.maxRetries) {
                const delay = this.calculateDelay(attempt);
                console.warn(
                  `[Stream Retry] Stream closed with no finish_reason and empty response (attempt ${attempt + 1}/${this.maxRetries + 1}). ` +
                  `Upstream likely dropped connection silently. Retrying in ${Math.round(delay)}ms`,
                );
                await this.sleep(delay);
                continue; // retry the request
              }
              console.error(`[Stream Error] Stream closed prematurely with empty response after ${this.maxRetries + 1} attempts`);
              return {
                responseMessage: {
                  role: 'assistant',
                  content: `⚠️ **Connection dropped:** The provider closed the stream without sending a response. This is usually a transient network issue — please try again.`,
                  tool_calls: [],
                },
                toolCalls: [],
                recoveredFromError: true,
                recoveredError: 'Stream ended with no finish_reason and empty response',
              };
            }

            if (hasIncompleteToolCallJson && attempt < this.maxRetries) {
              const delay = this.calculateDelay(attempt);
              console.warn(
                `[Stream Retry] Stream truncated mid-tool-call with no finish_reason (attempt ${attempt + 1}/${this.maxRetries + 1}). Retrying in ${Math.round(delay)}ms`,
              );
              await this.sleep(delay);
              continue;
            }

            // Had content/tool_calls but no finish_reason — partial response. Log it
            // but fall through and return what we have; forcing retry would discard
            // usable output.
            console.warn(
              `[Stream Warning] Stream ended with no finish_reason but has partial output ` +
              `(content: ${accumulatedContent.length}, tools: ${accumulatedToolCalls.length}). Returning partial response.`,
            );
          }

          // Debug: log actual content when suspiciously short (helps diagnose truncated responses)
          if (accumulatedContent.length < 20 || accumulatedReasoningContent.length < 20) {
            console.log('[Stream Debug] Short response detected:', {
              content: JSON.stringify(accumulatedContent),
              reasoningContent: JSON.stringify(accumulatedReasoningContent),
            });
          }

          // Retry on server-side network_error (e.g., Z.AI GLM-5 inference failures)
          if (finishReason === 'network_error') {
            if (attempt < this.maxRetries) {
              const delay = this.calculateDelay(attempt);
              console.warn(
                `[Stream Retry] Server returned finish_reason: network_error (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${Math.round(delay)}ms`,
              );
              await this.sleep(delay);
              continue; // retry the request
            } else {
              console.error(
                `[Stream Error] Server returned network_error after ${this.maxRetries + 1} attempts. Z.AI may be experiencing issues with model: ${this.model}`,
              );
            }
          }

          // Fallback: if reasoning model returned reasoning_content but no content,
          // use the reasoning content as the response (e.g., Z.AI GLM-5 thinking mode)
          if (!accumulatedContent && accumulatedReasoningContent && accumulatedToolCalls.length === 0) {
            console.warn(
              `[Stream Fallback] No content received but reasoning_content available (${accumulatedReasoningContent.length} chars). Using as response content.`,
            );
            accumulatedContent = accumulatedReasoningContent;
            if (onChunk) {
              onChunk({
                type: 'content',
                delta: accumulatedContent,
                accumulated: accumulatedContent,
              });
            }
          }
        } catch (streamIteratorError) {
          // CRITICAL: Catch errors from the stream iterator itself
          streamError = streamIteratorError;
          console.error('Error during stream processing:', streamIteratorError);
          console.error('Stream error stack:', streamIteratorError.stack);

          // Extract error details for retry guidance
          const errorMessage = streamIteratorError.message || streamIteratorError.error?.message || 'Unknown stream error';
          const failedGeneration = streamIteratorError.error?.failed_generation;

          console.log('Stream error details:', {
            message: errorMessage,
            failedGeneration: failedGeneration ? failedGeneration.substring(0, 200) : 'N/A',
            hasContent: accumulatedContent.length > 0,
            hasToolCalls: accumulatedToolCalls.length > 0,
          });

          // Check for LM Studio context overflow error
          if (errorMessage.includes('context') && errorMessage.includes('overflow')) {
            console.error('LM Studio context overflow detected!');
            throw new Error(
              `Your local model's context window is too small for this request. Please load a model with at least 8K context in LM Studio. Current error: ${errorMessage}`,
            );
          }

          // Check for "keep" token error (another sign of context overflow)
          if (errorMessage.includes('keep') && errorMessage.includes('tokens')) {
            console.error('LM Studio token limit error detected!');
            throw new Error(
              `Your local model's context window is too small. The request requires more tokens than your model supports. Please load a model with a larger context window (8K+ recommended) in LM Studio.`,
            );
          }

          // If this is a tool validation error and we have retries left, retry with guidance
          if (attempt < this.maxRetries && errorMessage.includes('tool')) {
            console.warn(`Stream error is tool-related (attempt ${attempt + 1}), retrying with guidance`);

            currentMessages = [...currentMessages];
            currentMessages.push({
              role: 'system',
              content: `Your previous tool call failed with error: "${errorMessage}"

${failedGeneration ? `Failed generation:\n${failedGeneration}\n\n` : ''}Please retry with corrections. Common issues:
1. Using invalid action values - check the tool schema for exact allowed values
2. Missing required parameters
3. Incorrect parameter types
4. Malformed JSON in arguments

Available tools and their schemas:
${tools.map((t) => `- ${t.function.name}: ${JSON.stringify(t.function.parameters, null, 2)}`).join('\n')}`,
            });

            // Wait before retry
            const delay = this.calculateDelay(attempt);
            await this.sleep(delay);
            continue; // Retry the call
          }

          // CRITICAL: Check for in-progress tool calls with incomplete JSON arguments.
          // When a stream breaks mid-tool-call, accumulatedToolCalls may contain entries
          // with partial/unparseable JSON arguments. Try to salvage or retry.
          const hasInProgressToolCalls = accumulatedToolCalls.some((tc) => {
            if (!tc?.function?.arguments) return false;
            try {
              JSON.parse(tc.function.arguments);
              return false; // Valid JSON, this tool call is complete
            } catch {
              return true; // Invalid JSON, this tool call was cut off
            }
          });

          if (hasInProgressToolCalls && attempt < this.maxRetries) {
            console.warn(`[Stream Recovery] Found in-progress tool calls with incomplete JSON (attempt ${attempt + 1}), retrying`);
            const delay = this.calculateDelay(attempt);
            await this.sleep(delay);
            continue; // Retry the call
          }

          // Filter out any tool calls with unparseable arguments
          if (hasInProgressToolCalls) {
            console.warn(`[Stream Recovery] Dropping ${accumulatedToolCalls.length} tool call(s) with incomplete JSON after max retries`);
            accumulatedToolCalls = accumulatedToolCalls.filter((tc) => {
              try {
                JSON.parse(tc.function.arguments);
                return true;
              } catch {
                return false;
              }
            });
          }

          // If we have accumulated content, we can continue with that.
          // Otherwise, return a recovery response with the error message.
          if (!accumulatedContent && accumulatedToolCalls.length === 0) {
            const userFriendlyError = parseApiErrorMessage(streamIteratorError);
            return {
              responseMessage: {
                role: 'assistant',
                content: `⚠️ **API Error:** ${userFriendlyError}\n\nPlease check your API configuration or try a different provider.`,
                tool_calls: [],
              },
              toolCalls: [],
              recoveredFromError: true,
              recoveredError: streamIteratorError.message || 'Unknown stream error',
            };
          }
        }

        // CRITICAL: Use AJV validation to check tool calls BEFORE they reach execution
        const { valid: validToolCalls, invalid: invalidToolCalls } = validateToolCalls(accumulatedToolCalls, tools);

        // If we have invalid tool calls and this isn't the last attempt, retry with detailed guidance
        if (invalidToolCalls.length > 0 && attempt < this.maxRetries && !streamError) {
          console.warn(`AJV validation failed for ${invalidToolCalls.length} tool call(s) (attempt ${attempt + 1}), retrying with schema guidance`);

          const retryGuidance = createRetryGuidance(invalidToolCalls, tools);

          currentMessages = [...currentMessages];
          currentMessages.push({
            role: 'system',
            content: retryGuidance,
          });

          // Wait before retry
          const delay = this.calculateDelay(attempt);
          await this.sleep(delay);
          continue; // Retry the call
        }

        // Log successful retry if this wasn't the first attempt
        if (attempt > 0) {
          console.log(`LLM streaming call succeeded on attempt ${attempt + 1}/${this.maxRetries + 1}`);
        }

        // If we have invalid tool calls on the last attempt, log them but continue
        if (invalidToolCalls.length > 0) {
          console.error(`Invalid tool calls on final attempt (continuing anyway):`, invalidToolCalls);
        }

        // Construct final message with only valid tool calls
        const responseMessage = {
          role: role,
          content: accumulatedContent ?? null,
          tool_calls: validToolCalls.length > 0 ? validToolCalls : undefined,
          // Include reasoning_content for providers like Kimi Code that require it for tool calls
          reasoning_content: accumulatedReasoningContent || undefined,
        };

        const { message: normalizedMessage, wasEmpty } = BaseAdapter._normalizeAssistantResponse(responseMessage);
        if (wasEmpty) {
          const rawShape = JSON.stringify({
            accumulatedContentLen: typeof accumulatedContent === 'string' ? accumulatedContent.length : null,
            validToolCalls: validToolCalls.length,
            invalidToolCalls: invalidToolCalls.length,
            hasReasoning: !!accumulatedReasoningContent,
          });
          console.warn(`[OpenAiLike Stream] Empty response model=${this.model} provider=${this.provider} ${rawShape}`);
        }

        return {
          responseMessage: normalizedMessage,
          toolCalls: validToolCalls || [],
          invalidToolCalls: invalidToolCalls.length > 0 ? invalidToolCalls : undefined,
          usage: streamUsage || undefined,
          ...(wasEmpty ? { recoveredFromError: true, recoveredError: 'Provider returned empty response' } : {}),
        };
      } catch (error) {
        lastError = error;

        // Handle token limit errors with automatic context reduction
        if (this.isTokenLimitError(error)) {
          console.warn(`Token limit error detected in streaming, attempting context reduction (attempt ${attempt + 1})`);

          const contextResult = manageContext(currentMessages, this.model, tools, this.provider);
          if (contextResult.wasManaged && contextResult.managedTokens < contextResult.originalTokens) {
            console.log(`Context reduced: ${contextResult.originalTokens} -> ${contextResult.managedTokens} tokens`);
            currentMessages = contextResult.messages;
            attempt--;
            continue;
          }
        }

        // Check if this is the last attempt or if the error is not retryable
        if (attempt === this.maxRetries || (!this.isRetryableError(error) && !this.isTokenLimitError(error))) {
          console.error(`LLM streaming call failed after ${attempt + 1} attempts, but NEVER STOPPING:`, {
            status: error.status,
            message: error.message,
          });

          // Parse the error to get a user-friendly message
          const userFriendlyError = parseApiErrorMessage(error);

          return {
            responseMessage: {
              role: 'assistant',
              content: `⚠️ **API Error:** ${userFriendlyError}\n\nPlease check your API configuration or try a different provider.`,
              tool_calls: [],
            },
            toolCalls: [],
            recoveredFromError: true,
            recoveredError: error.message || 'Unknown error',
          };
        }

        // Add error context for tool/function errors
        if (error.status === 400 && this.isRetryableError(error)) {
          const errorMessage = error.message || error.error?.message || 'Unknown error';
          console.log('Adding tool error context to help LLM retry (streaming)');

          currentMessages = [...currentMessages];

          // CRITICAL: Check if we're in vision mode (messages have array content)
          // If so, maintain array format for consistency
          const isVisionMode = currentMessages.some((m) => m.role !== 'system' && Array.isArray(m.content));

          // System messages should stay as strings even in vision mode
          currentMessages.push({
            role: 'system',
            content: `Your previous tool call failed with error: "${errorMessage}". Please retry with corrected formatting.`,
          });
        }

        // Wait before retrying
        if (!this.isTokenLimitError(error)) {
          const delay = this.calculateDelay(attempt);
          console.warn(`LLM streaming call failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${Math.round(delay)}ms`);
          await this.sleep(delay);
        }
      }
    }

    // Fallback recovery response
    return {
      responseMessage: {
        role: 'assistant',
        content: "I encountered an unexpected error, but I'm still here to help. Please try your request again.",
        tool_calls: [],
      },
      toolCalls: [],
      recoveredFromError: true,
    };
  }

  formatToolResults(toolExecutionResults) {
    // The orchestrator already produces results in the OpenAI-compatible format.
    return toolExecutionResults;
  }
}

class CerebrasAdapter extends OpenAiLikeAdapter {
  constructor(client, model, options = {}) {
    super(client, model, options);

    // Models that support streaming + tool calling
    // Per Cerebras docs: "Streaming is supported for gpt-oss-120b, zai-glm-4.7, and non-reasoning models with these features"
    // However, llama models do NOT support streaming + tools
    this.streamingToolModels = new Set(['gpt-oss-120b', 'zai-glm-4.7']);

    // Add 422 to retryable status codes for Cerebras (tool schema issues)
    this.retryableStatusCodes.add(422);

    // Cerebras-specific rate limiting configuration
    // Cerebras has strict tokens-per-minute limits, so we need longer delays
    this.baseDelay = 5000; // 5 seconds base delay (increased from 1 second)
    this.maxRetries = 5; // More retries for rate limiting
    this.rateLimitDelay = 30000; // 30 seconds delay specifically for 429 errors
  }

  /**
   * Override calculateDelay to handle Cerebras rate limits more aggressively
   */
  calculateDelay(attempt, isRateLimit = false) {
    if (isRateLimit) {
      // For rate limit errors, use much longer delays
      // 30s, 60s, 120s, 240s, 480s
      const rateLimitDelay = this.rateLimitDelay * Math.pow(2, attempt);
      const jitter = Math.random() * 0.1 * rateLimitDelay;
      return Math.min(rateLimitDelay + jitter, 300000); // Cap at 5 minutes
    }

    // For other errors, use standard exponential backoff
    const exponentialDelay = this.baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.1 * exponentialDelay;
    return Math.min(exponentialDelay + jitter, 60000); // Cap at 1 minute
  }

  /**
   * Check if error is a rate limit error
   */
  isRateLimitError(error) {
    return error.status === 429 || (error.message && error.message.includes('rate') && error.message.includes('limit'));
  }

  /**
   * Generate a user-friendly rate limit error message for Cerebras
   * Explains model-specific limits and suggests alternatives
   */
  getCerebrasRateLimitMessage(error) {
    const message = error.message || '';
    const isHourlyLimit = message.includes('hour');
    const isDailyLimit = message.includes('day');
    const isMinuteLimit = message.includes('minute');

    // Check if using a preview model with strict limits
    const isPreviewModel = this.model === 'zai-glm-4.6' || this.model.includes('preview');

    let limitInfo = '';
    if (isPreviewModel) {
      limitInfo =
        `\n\n**Model '${this.model}' has strict rate limits:**\n` + `• 10 requests/minute\n` + `• 100 requests/hour\n` + `• 100 requests/day`;
    } else {
      limitInfo = `\n\n**Model '${this.model}' rate limits:**\n` + `• 30 requests/minute\n` + `• 900 requests/hour\n` + `• 14,400 requests/day`;
    }

    let suggestion = '\n\n**Solutions:**\n';
    if (isPreviewModel) {
      suggestion += `1. **Switch to a production model** - \`llama3.1-8b\`, \`qwen-3-32b\`, or \`gpt-oss-120b\` have 144x more daily requests\n`;
    }

    if (isDailyLimit) {
      suggestion += `2. Wait until tomorrow for your daily quota to reset\n`;
      suggestion += `3. Upgrade your Cerebras plan for higher limits`;
    } else if (isHourlyLimit) {
      suggestion += `2. Wait ~${isPreviewModel ? '1 hour' : '1 hour'} for your hourly quota to replenish\n`;
      suggestion += `3. Upgrade your Cerebras plan for higher limits`;
    } else {
      suggestion += `2. Wait 1-2 minutes for your quota to replenish\n`;
      suggestion += `3. Upgrade your Cerebras plan for higher limits`;
    }

    return (
      `⚠️ **Cerebras Rate Limit Exceeded**\n\n` +
      `You've exceeded the ${isDailyLimit ? 'daily' : isHourlyLimit ? 'hourly' : 'per-minute'} rate limit for Cerebras.` +
      limitInfo +
      suggestion
    );
  }

  /**
   * Check if the current model supports streaming with tool calling
   */
  supportsStreamingWithTools() {
    return this.streamingToolModels.has(this.model);
  }

  /**
   * Transform tools for Cerebras - use standard OpenAI format
   * Cerebras claims to be OpenAI-compatible, so we pass tools through with minimal changes
   */
  _transformToolsForCerebras(tools) {
    if (!tools || tools.length === 0) return undefined;

    // Simply return the tools as-is in standard OpenAI format
    // Do NOT add strict: true or modify the schema - this causes 422 errors
    return tools;
  }

  async call(messages, tools, skipTools = false) {
    let lastError;
    let currentMessages = BaseAdapter._sanitizeOutbound(messages, 'cerebras');

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const cerebrasTools = skipTools ? undefined : this._transformToolsForCerebras(tools);

        // Cerebras does NOT support parallel_tool_calls parameter at all
        // Per Cerebras docs: "parallel_tool_calls will result in a 400 error if supplied"
        const requestParams = {
          model: this.model,
          messages: currentMessages,
        };
        if (this.extraBody) {
          Object.assign(requestParams, this.extraBody);
        }

        if (cerebrasTools && cerebrasTools.length > 0) {
          requestParams.tools = cerebrasTools;
          // NOTE: Do NOT include parallel_tool_calls - it causes 400 error per Cerebras docs

          // DEBUG: Log the tool schema being sent to Cerebras
          console.log('[Cerebras Debug] Non-streaming call with tools:', {
            model: this.model,
            toolCount: cerebrasTools.length,
            toolNames: cerebrasTools.map((t) => t.function.name),
          });
        } else if (skipTools) {
          console.log(`[Cerebras] Calling model '${this.model}' WITHOUT tools (model may not support function calling)`);
        }

        const response = await this.client.chat.completions.create(requestParams);
        const message = response.choices[0].message;

        if (attempt > 0) {
          console.log(`Cerebras call succeeded on attempt ${attempt + 1}/${this.maxRetries + 1}`);
        }

        const { message: normalizedMessage, wasEmpty } = BaseAdapter._normalizeAssistantResponse(message);
        if (wasEmpty) {
          console.warn('[Cerebras] Provider returned empty response (no content, no tool calls) — padded for history safety');
        }

        return {
          responseMessage: normalizedMessage,
          toolCalls: normalizedMessage.tool_calls || [],
          usage: response.usage || undefined,
          ...(wasEmpty ? { recoveredFromError: true, recoveredError: 'Provider returned empty response' } : {}),
        };
      } catch (error) {
        lastError = error;

        // CRITICAL: If we get a 422 error with tools, the model doesn't support function calling
        // Retry WITHOUT tools so the model can still respond
        if (error.status === 422 && !skipTools && tools && tools.length > 0) {
          console.warn(
            `[Cerebras] Model '${this.model}' returned 422 with tools. This model may not support function calling. Retrying WITHOUT tools.`,
          );

          // Recursively call ourselves with skipTools=true
          const result = await this.call(messages, tools, true);

          // Add flag to indicate tools were skipped due to model limitation
          result.toolsSkipped = true;
          result.toolsSkippedReason = `Model '${this.model}' does not support function calling. Responding without tools.`;

          return result;
        }

        if (this.isTokenLimitError(error)) {
          console.warn(`Token limit error detected, attempting context reduction (attempt ${attempt + 1})`);

          const contextResult = manageContext(currentMessages, this.model, tools, this.provider || 'cerebras');
          if (contextResult.wasManaged && contextResult.managedTokens < contextResult.originalTokens) {
            console.log(`Context reduced: ${contextResult.originalTokens} -> ${contextResult.managedTokens} tokens`);
            currentMessages = contextResult.messages;
            attempt--;
            continue;
          }
        }

        if (attempt === this.maxRetries || (!this.isRetryableError(error) && !this.isTokenLimitError(error))) {
          console.error(`Cerebras call failed after ${attempt + 1} attempts, but NEVER STOPPING:`, {
            status: error.status,
            message: error.message,
          });

          // Use detailed rate limit message for 429 errors
          let userFriendlyError;
          if (this.isRateLimitError(error)) {
            userFriendlyError = this.getCerebrasRateLimitMessage(error);
          } else {
            userFriendlyError = `⚠️ **Cerebras API Error:** ${parseApiErrorMessage(
              error,
            )}\n\nPlease check your API configuration or try a different model/provider.`;
          }

          return {
            responseMessage: {
              role: 'assistant',
              content: userFriendlyError,
              tool_calls: [],
            },
            toolCalls: [],
            recoveredFromError: true,
            recoveredError: error.message || 'Unknown error',
          };
        }

        if (error.status === 400 && this.isRetryableError(error)) {
          const errorMessage = error.message || error.error?.message || 'Unknown error';
          console.log('Adding tool error context to help Cerebras retry');

          currentMessages = [...currentMessages];
          currentMessages.push({
            role: 'system',
            content: `Your previous tool call failed with error: "${errorMessage}". Please retry with corrected formatting.`,
          });
        }

        if (!this.isTokenLimitError(error)) {
          // Use longer delays for rate limit errors
          const isRateLimit = this.isRateLimitError(error);
          const delay = this.calculateDelay(attempt, isRateLimit);

          if (isRateLimit) {
            console.warn(
              `[Cerebras] Rate limit hit (attempt ${attempt + 1}/${this.maxRetries + 1}), waiting ${Math.round(delay / 1000)}s before retry...`,
              {
                status: error.status,
                message: error.message,
              },
            );
          } else {
            console.warn(`Cerebras call failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${Math.round(delay)}ms:`, {
              status: error.status,
              message: error.message,
            });
          }

          await this.sleep(delay);
        }
      }
    }

    return {
      responseMessage: {
        role: 'assistant',
        content: "I encountered an unexpected error with Cerebras, but I'm still here to help. Please try your request again.",
        tool_calls: [],
      },
      toolCalls: [],
      recoveredFromError: true,
    };
  }

  async callStream(messages, tools, onChunk, context = {}) {
    // CRITICAL: Check if this model supports streaming + tool calling
    // Per Cerebras docs: Streaming with tools is ONLY supported for gpt-oss-120b, zai-glm-4.6
    // For llama models (llama3.1-8b, llama-3.3-70b, etc.), we MUST fall back to non-streaming
    const hasTools = tools && tools.length > 0;
    const supportsStreamingTools = this.supportsStreamingWithTools();

    if (hasTools && !supportsStreamingTools) {
      console.warn(
        `[Cerebras] Model '${this.model}' does NOT support streaming with tool calling. ` +
          `Falling back to non-streaming mode. Supported models for streaming + tools: gpt-oss-120b, zai-glm-4.6`,
      );

      // Fall back to non-streaming call
      const result = await this.call(messages, tools);

      // Simulate streaming for the content so the UI still gets updates
      if (result.responseMessage.content && onChunk) {
        onChunk({
          type: 'content',
          delta: result.responseMessage.content,
          accumulated: result.responseMessage.content,
        });
      }

      // Simulate streaming for tool calls
      if (result.toolCalls && result.toolCalls.length > 0 && onChunk) {
        result.toolCalls.forEach((toolCall, index) => {
          onChunk({
            type: 'tool_call_delta',
            index: index,
            toolCall: toolCall,
          });
        });
      }

      return result;
    }

    let lastError;
    let currentMessages = messages;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let accumulatedContent = '';
      let accumulatedToolCalls = [];
      let role = 'assistant';
      let streamUsage = null;

      try {
        // Transform tools for Cerebras compatibility (strict: true, additionalProperties: false)
        const cerebrasTools = this._transformToolsForCerebras(tools);

        const requestParams = {
          model: this.model,
          messages: currentMessages,
          stream: true,
          stream_options: { include_usage: true },
        };
        if (this.extraBody) {
          Object.assign(requestParams, this.extraBody);
        }

        // Add tools if present AND model supports streaming + tools
        // NOTE: Do NOT include parallel_tool_calls - causes 400 error per Cerebras docs
        if (cerebrasTools && cerebrasTools.length > 0 && supportsStreamingTools) {
          requestParams.tools = cerebrasTools;
          // parallel_tool_calls is NOT supported by Cerebras at all
        }

        console.log('[Cerebras Debug] Streaming request params:', {
          model: this.model,
          messageCount: currentMessages.length,
          hasTools: !!(cerebrasTools && cerebrasTools.length > 0),
          toolCount: cerebrasTools?.length || 0,
          supportsStreamingTools: supportsStreamingTools,
        });

        // DEBUG: Log first tool schema to verify format
        if (cerebrasTools && cerebrasTools.length > 0 && supportsStreamingTools) {
          console.log('[Cerebras Debug] First tool schema sample:', JSON.stringify(cerebrasTools[0], null, 2));
        }

        const abortSignal = context.abortSignal;
        const stream = await this.client.chat.completions.create(requestParams);

        for await (const chunk of stream) {
          if (abortSignal?.aborted) {
            stream.controller?.abort?.();
            console.log('[Cerebras Stream] Aborted by client disconnect');
            break;
          }

          // Capture usage from final chunk
          if (chunk.usage) {
            streamUsage = chunk.usage;
          }

          // Guarded for the same reason as OpenAiLikeAdapter above: a
          // usage-only final chunk may omit `choices` entirely rather than
          // sending an empty array. Usage is already captured above, so this
          // guard protects the rest of the stream loop rather than the
          // billing record.
          const delta = chunk.choices?.[0]?.delta;

          if (!delta) continue;

          if (delta.role) {
            role = delta.role;
          }

          // Handle content streaming
          if (delta.content) {
            accumulatedContent += delta.content;
            if (onChunk) {
              onChunk({
                type: 'content',
                delta: delta.content,
                accumulated: accumulatedContent,
              });
            }
          }

          // Handle tool calls streaming (same pattern as OpenAI adapter)
          if (delta.tool_calls) {
            for (const toolCallDelta of delta.tool_calls) {
              const index = toolCallDelta.index;

              // Initialize tool call if needed
              if (!accumulatedToolCalls[index]) {
                accumulatedToolCalls[index] = {
                  id: toolCallDelta.id || `tool-${Date.now()}-${index}`,
                  type: 'function',
                  function: {
                    name: '',
                    arguments: '',
                  },
                };
              }

              // Accumulate tool call data
              if (toolCallDelta.id) {
                accumulatedToolCalls[index].id = toolCallDelta.id;
              }
              if (toolCallDelta.function?.name) {
                accumulatedToolCalls[index].function.name += toolCallDelta.function.name;
              }
              if (toolCallDelta.function?.arguments) {
                accumulatedToolCalls[index].function.arguments += toolCallDelta.function.arguments;
              }

              // Notify about tool call progress
              if (onChunk) {
                onChunk({
                  type: 'tool_call_delta',
                  index: index,
                  toolCall: accumulatedToolCalls[index],
                });
              }
            }
          }
        }

        console.log('[Cerebras Stream Complete] Successfully processed stream:', {
          contentLength: accumulatedContent.length,
          toolCallsCount: accumulatedToolCalls.length,
        });

        if (attempt > 0) {
          console.log(`Cerebras streaming call succeeded on attempt ${attempt + 1}/${this.maxRetries + 1}`);
        }

        const responseMessage = {
          role: role,
          content: accumulatedContent ?? null,
          tool_calls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
        };

        const { message: normalizedMessage, wasEmpty } = BaseAdapter._normalizeAssistantResponse(responseMessage);
        if (wasEmpty) {
          console.warn('[Cerebras Stream] Provider returned empty response (no content, no tool calls) — padded for history safety');
        }

        return {
          responseMessage: normalizedMessage,
          toolCalls: accumulatedToolCalls,
          usage: streamUsage || undefined,
          ...(wasEmpty ? { recoveredFromError: true, recoveredError: 'Provider returned empty response' } : {}),
        };
      } catch (error) {
        lastError = error;

        if (this.isTokenLimitError(error)) {
          console.warn(`Token limit error detected in Cerebras streaming (attempt ${attempt + 1})`);

          const contextResult = manageContext(currentMessages, this.model, tools, this.provider || 'cerebras');
          if (contextResult.wasManaged && contextResult.managedTokens < contextResult.originalTokens) {
            console.log(`Context reduced: ${contextResult.originalTokens} -> ${contextResult.managedTokens} tokens`);
            currentMessages = contextResult.messages;
            attempt--;
            continue;
          }
        }

        if (attempt === this.maxRetries || (!this.isRetryableError(error) && !this.isTokenLimitError(error))) {
          console.error(`Cerebras streaming call failed after ${attempt + 1} attempts, but NEVER STOPPING:`, {
            status: error.status,
            message: error.message,
          });

          // Use detailed rate limit message for 429 errors
          let userFriendlyError;
          if (this.isRateLimitError(error)) {
            userFriendlyError = this.getCerebrasRateLimitMessage(error);
          } else {
            userFriendlyError = `⚠️ **Cerebras API Error:** ${parseApiErrorMessage(
              error,
            )}\n\nPlease check your API configuration or try a different model/provider.`;
          }

          return {
            responseMessage: {
              role: 'assistant',
              content: userFriendlyError,
              tool_calls: [],
            },
            toolCalls: [],
            recoveredFromError: true,
            recoveredError: error.message || 'Unknown error',
          };
        }

        // Add error context for tool/function errors to help LLM correct itself
        if (error.status === 400 && this.isRetryableError(error)) {
          const errorMessage = error.message || error.error?.message || 'Unknown error';
          console.log('Adding tool error context to help Cerebras retry (streaming)');

          currentMessages = [...currentMessages];
          currentMessages.push({
            role: 'system',
            content: `Your previous tool call failed with error: "${errorMessage}". Please retry with corrected formatting.`,
          });
        }

        if (!this.isTokenLimitError(error)) {
          // Use longer delays for rate limit errors
          const isRateLimit = this.isRateLimitError(error);
          const delay = this.calculateDelay(attempt, isRateLimit);

          if (isRateLimit) {
            console.warn(
              `[Cerebras] Rate limit hit (attempt ${attempt + 1}/${this.maxRetries + 1}), waiting ${Math.round(delay / 1000)}s before retry...`,
              {
                status: error.status,
                message: error.message,
              },
            );
          } else {
            console.warn(`Cerebras streaming call failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${Math.round(delay)}ms`);
          }

          await this.sleep(delay);
        }
      }
    }

    return {
      responseMessage: {
        role: 'assistant',
        content: "I encountered an unexpected error with Cerebras, but I'm still here to help. Please try your request again.",
        tool_calls: [],
      },
      toolCalls: [],
      recoveredFromError: true,
    };
  }
}

export { OpenAiLikeAdapter, CerebrasAdapter };
