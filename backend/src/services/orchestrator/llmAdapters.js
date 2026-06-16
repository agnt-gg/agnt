// ALL OF THIS SHOULD BE IN THIS AI.SERVICE

import axios from 'axios';
import { manageContext } from '../../utils/contextManager.js';
import { validateToolCalls, createRetryGuidance } from './toolValidator.js';
import * as ProviderRegistry from '../ai/ProviderRegistry.js';
import CustomOpenAIProviderService from '../ai/CustomOpenAIProviderService.js';
import { getModelMetadata, getProviderConfig, getReasoningControl, supportsZaiReasoningEffort } from '../ai/providerConfigs.js';
import { buildBillingHeaderBlock, extractFirstUserMessage } from '../ai/claudeBillingHeader.js';

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

/**
 * Pull every diagnostic crumb the OpenAI SDK might attach to a Codex failure.
 * Different SDK versions stash useful detail under different keys
 * (`error.error`, `error.body`, `error.response.data`, raw `error.headers`, etc.).
 * The default `error.message` for ChatGPT-backend rejections is often the
 * useless "400 status code (no body)" — this helper hands the catch site
 * something it can actually log.
 */
function describeCodexError(error) {
  if (!error || typeof error !== 'object') return { summary: String(error) };
  const out = {
    status: error.status ?? error.response?.status ?? null,
    code: error.code ?? null,
    message: error.message ?? null,
  };
  if (error.error !== undefined) out.error = error.error;
  if (error.body !== undefined) out.body = error.body;
  if (error.response?.data !== undefined) out.responseData = error.response.data;
  if (error.headers) {
    const interesting = ['x-request-id', 'x-codex-request-id', 'cf-ray', 'content-type', 'retry-after'];
    out.headers = {};
    for (const h of interesting) {
      const v = typeof error.headers.get === 'function' ? error.headers.get(h) : error.headers[h];
      if (v) out.headers[h] = v;
    }
    if (Object.keys(out.headers).length === 0) delete out.headers;
  }
  return out;
}

function buildCodexErrorGuidance(error, model) {
  const status = Number(error?.status || error?.response?.status || 0);
  const message = String(error?.message || '').toLowerCase();

  if (status === 401 || status === 403 || message.includes('unauthorized') || message.includes('forbidden')) {
    return `This model (${model}) uses the Codex Responses API. The Codex OAuth authorization was rejected; reconnect your OAuth account or try a different model.`;
  }

  if (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 529 ||
    message.includes('overloaded') ||
    message.includes('temporarily unavailable')
  ) {
    return `This model (${model}) uses the Codex Responses API. The upstream Codex service is rate-limited, overloaded, or temporarily unavailable; retry later or try a different model.`;
  }

  if (status === 400) {
    return `This model (${model}) uses the Codex Responses API. The request could not be accepted; try a different model or reduce the active tool/context surface.`;
  }

  return `This model (${model}) uses the Codex Responses API. Try again or switch models; reconnect OAuth only if provider status shows the Codex connection is expired.`;
}

/**
 * Returns true if a message is a user-role carrier of tool_result blocks.
 * Such messages must stay paired with the preceding assistant tool_use message —
 * mutating their content (e.g. to inject images) orphans the tool_use IDs and
 * triggers provider 400 errors like "tool_use ids were found without tool_result blocks".
 */
function isToolResultCarrier(msg) {
  if (!msg || msg.role !== 'user') return false;
  // Anthropic: user message with tool_result content blocks
  if (Array.isArray(msg.content) && msg.content.some((block) => block && block.type === 'tool_result')) {
    return true;
  }
  // Gemini: user message whose parts contain functionResponse entries
  if (Array.isArray(msg.parts) && msg.parts.some((part) => part && part.functionResponse)) {
    return true;
  }
  // OpenAI-compat: a user-role stand-in for a tool result (has tool_call_id)
  if (msg.tool_call_id) {
    return true;
  }
  return false;
}

/**
 * Finds the index of the last user message that is safe to inject images into —
 * i.e. the most recent user message whose content is not a tool_result carrier.
 * Returns -1 if none found.
 */
function findLastInjectableUserIndex(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    if (isToolResultCarrier(m)) continue;
    return i;
  }
  return -1;
}

/**
 * Sanitize tool schemas for Kimi / Kimi Code (Moonshot).
 *
 * Moonshot's validator is stricter than other OpenAI-compatible providers and
 * rejects schemas with: "tools.function.parameters is not a valid moonshot
 * flavored json schema". Two cases are known to trigger this:
 *
 *   1. `type: "array"` parameters missing an `items` definition.
 *   2. `enum` values that don't match the declared `type` — e.g. a plugin
 *      manifest that declares `{ type: "boolean", options: ["true"] }` and
 *      gets transcribed to `{ type: "boolean", enum: ["true"] }`.
 *
 * For (1) we insert a permissive `items: { type: "string" }`. For (2) we drop
 * the enum on boolean fields entirely (only two valid values, enum is
 * meaningless) and coerce mismatched values for string/integer/number fields.
 *
 * Scoped to Kimi only — other OpenAI-compatible providers tolerate looser
 * schemas, and applying this globally previously broke them (reverted ecb5cf2).
 */
function sanitizeKimiToolSchemas(tools) {
  if (!tools || tools.length === 0) return tools;

  const coerceEnumValues = (type, values) => {
    if (!Array.isArray(values)) return values;
    if (type === 'string') {
      return values.map((v) => (v == null ? v : String(v))).filter((v) => v != null);
    }
    if (type === 'integer') {
      return values
        .map((v) => (typeof v === 'number' ? Math.trunc(v) : parseInt(v, 10)))
        .filter((v) => Number.isFinite(v));
    }
    if (type === 'number') {
      return values
        .map((v) => (typeof v === 'number' ? v : Number(v)))
        .filter((v) => Number.isFinite(v));
    }
    return values;
  };

  const fixSchema = (obj) => {
    if (!obj || typeof obj !== 'object') return;

    if (obj.type === 'array' && !obj.items) {
      obj.items = { type: 'string' };
    }

    if (Array.isArray(obj.enum)) {
      if (obj.type === 'boolean') {
        // Booleans only have two values — Moonshot rejects any enum here.
        delete obj.enum;
      } else if (obj.type === 'string' || obj.type === 'integer' || obj.type === 'number') {
        const coerced = coerceEnumValues(obj.type, obj.enum);
        if (coerced.length > 0) {
          obj.enum = coerced;
        } else {
          delete obj.enum;
        }
      }
    }

    if (obj.properties && typeof obj.properties === 'object') {
      for (const prop of Object.values(obj.properties)) {
        fixSchema(prop);
      }
    }
    if (obj.items && typeof obj.items === 'object') {
      fixSchema(obj.items);
    }
  };

  return tools.map((tool) => {
    const cloned = JSON.parse(JSON.stringify(tool));
    if (cloned.function?.parameters) {
      fixSchema(cloned.function.parameters);
    }
    return cloned;
  });
}

/**
 * Base class for LLM provider adapters.
 * Defines the interface that all adapters must implement.
 */
class BaseAdapter {
  constructor(client, model) {
    if (this.constructor === BaseAdapter) {
      throw new Error('BaseAdapter cannot be instantiated directly.');
    }
    this.client = client;
    this.model = model;
  }

  /**
   * Makes a call to the LLM.
   * @param {Array<Object>} messages The conversation history.
   * @param {Array<Object>} tools The available tools in OpenAI format.
   * @returns {Promise<{responseMessage: Object, toolCalls: Array<Object>}>} A standardized response object.
   */
  async call(messages, tools) {
    throw new Error("Method 'call()' must be implemented.");
  }

  /**
   * Formats tool execution results into the provider-specific message format.
   * @param {Array<Object>} toolExecutionResults The results from executed tools.
   * @returns {Array<Object>} An array of messages to be added to the conversation history.
   */
  formatToolResults(toolExecutionResults) {
    throw new Error("Method 'formatToolResults()' must be implemented.");
  }

  /**
   * Ensure an assistant response has non-empty content or tool calls.
   * Empty assistant messages cause strict providers (Anthropic, Kimi, OpenAI)
   * to reject the next turn with "must not be empty" errors. This helper
   * normalizes any response shape (string/null content or array content
   * blocks) and pads truly empty responses with a placeholder so they can
   * be safely stored in conversation history.
   *
   * @param {Object} responseMessage The raw response from the provider adapter.
   * @returns {{message: Object, wasEmpty: boolean}} Normalized message + flag.
   */
  static _normalizeAssistantResponse(responseMessage) {
    const EMPTY_PLACEHOLDER = '[The model returned an empty response.]';

    if (!responseMessage || typeof responseMessage !== 'object') {
      return {
        message: { role: 'assistant', content: EMPTY_PLACEHOLDER },
        wasEmpty: true,
      };
    }

    const msg = { ...responseMessage };
    const hasTools = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;

    // String/null content shape (OpenAI, Gemini, Responses API, Cerebras, etc.)
    if (typeof msg.content === 'string' || msg.content == null) {
      const hasText = typeof msg.content === 'string' && msg.content.trim() !== '';
      if (!hasText && !hasTools) {
        return {
          message: { ...msg, content: EMPTY_PLACEHOLDER },
          wasEmpty: true,
        };
      }
      return { message: msg, wasEmpty: false };
    }

    // Array content shape (Anthropic native tool_use/text blocks)
    if (Array.isArray(msg.content)) {
      const cleanedBlocks = msg.content.filter((b) => {
        if (!b || typeof b !== 'object') return false;
        if (b.type === 'text') return typeof b.text === 'string' && b.text.trim() !== '';
        return true; // tool_use, tool_result, image, etc. — keep structural blocks
      });

      if (cleanedBlocks.length === 0 && !hasTools) {
        return {
          message: { ...msg, content: [{ type: 'text', text: EMPTY_PLACEHOLDER }] },
          wasEmpty: true,
        };
      }
      return {
        message: { ...msg, content: cleanedBlocks },
        wasEmpty: false,
      };
    }

    return { message: msg, wasEmpty: false };
  }
}

/**
 * Adapter for OpenAI and compatible APIs (Groq, TogetherAI, etc.).
 */
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
  }

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
    }

    // Check for network errors (code-based)
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      return true;
    }

    // Check for network errors (message-based, e.g., Z.AI "Connection error.")
    const errMsg = (error.message || '').toLowerCase();
    if (errMsg.includes('connection error') || errMsg.includes('network error') || errMsg.includes('econnrefused')) {
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
    let currentMessages = messages;
    const preparedTools = this._prepareTools(tools);

    if (this.client?.__agntCompat?.mapDeveloperRole) {
      currentMessages = currentMessages.map((msg) => (msg?.role === 'developer' ? { ...msg, role: 'system' } : msg));
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const requestParams = {
          model: this.model,
          messages: currentMessages,
          tools: preparedTools.length > 0 ? preparedTools : undefined,
          tool_choice: preparedTools.length > 0 ? 'auto' : undefined,
        };
        // Pass extra body params for providers that need them (e.g., Z.AI thinking)
        if (this.extraBody) {
          Object.assign(requestParams, this.extraBody);
        }
        const response = await this.client.chat.completions.create(requestParams);

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
    let currentMessages = messages;

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
        console.warn(`[Vision Check] Supported vision models for ${provider}: ${visionModels.join(', ')}`);
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
          messages: currentMessages,
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
        const stream = await this.client.chat.completions.create(requestParams);

        try {
          for await (const chunk of stream) {
            if (abortSignal?.aborted) {
              stream.controller?.abort?.();
              console.log('[OpenAI Stream] Aborted by client disconnect');
              break;
            }

            const choice = chunk.choices[0];
            const delta = choice?.delta;

            // Capture usage from final chunk (sent when stream_options.include_usage is true)
            if (chunk.usage) {
              streamUsage = chunk.usage;
            }

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

            // Handle reasoning_content for providers that use thinking mode (Z.AI GLM-5, Kimi, etc.)
            // Stream reasoning chunks to frontend to show thinking progress and keep connection alive
            if (delta.reasoning_content) {
              accumulatedReasoningContent += delta.reasoning_content;
              if (onChunk) {
                onChunk({
                  type: 'reasoning',
                  delta: delta.reasoning_content,
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

          // Detect silent premature stream close: upstream (Kimi, Cloudflare, etc.)
          // cleanly half-closes the HTTP connection mid-response. The for-await exits
          // normally with no error — but no finish_reason arrived and the response is
          // empty. Without this check we'd silently return an empty assistant message.
          // Abort-triggered exits are expected (client disconnect) and must NOT retry.
          if (!finishReason && !context.abortSignal?.aborted) {
            const isEmpty =
              accumulatedContent.length === 0 &&
              accumulatedReasoningContent.length === 0 &&
              accumulatedToolCalls.length === 0;

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

/**
 * Adapter for Anthropic's API.
 */
class AnthropicAdapter extends BaseAdapter {
  constructor(client, model, provider = 'anthropic', options = {}) {
    super(client, model);
    this.provider = provider.toLowerCase();
    this.reasoningValue = options.reasoningValue || 'default';
    this.maxRetries = 3;
    this.baseDelay = 1000; // 1 second
    this.retryableStatusCodes = new Set([429, 500, 502, 503, 504, 529]);

    // Model-specific max output token limits (synchronous Messages API).
    // Source: https://platform.claude.com/docs/en/docs/about-claude/models/overview
    // Note: Opus 4.6+, Sonnet 4.6, Fable 5, Mythos 5 support 300k via the
    // `output-300k-2026-03-24` beta header — not enabled here.
    this.modelMaxTokens = {
      // Legacy Claude 3
      'claude-3-haiku-20240307': 4096,
      'claude-3-sonnet-20240229': 4096,
      'claude-3-opus-20240229': 4096,
      'claude-3-5-haiku-20241022': 8192,
      'claude-3-5-sonnet-20240620': 8192,
      'claude-3-5-sonnet-20241022': 8192,
      'claude-3-7-sonnet-20250219': 64000,
      // Claude 4 (deprecated)
      'claude-sonnet-4-20250514': 64000,
      'claude-sonnet-4-0': 64000,
      'claude-opus-4-20250514': 32000,
      'claude-opus-4-0': 32000,
      'claude-opus-4-1-20250805': 32000,
      'claude-opus-4-1': 32000,
      // Claude 4.5
      'claude-sonnet-4-5-20250929': 64000,
      'claude-sonnet-4-5': 64000,
      'claude-haiku-4-5-20251001': 64000,
      'claude-haiku-4-5': 64000,
      'claude-opus-4-5-20251101': 64000,
      'claude-opus-4-5': 64000,
      // Claude 4.6 / 4.7 / 4.8
      'claude-opus-4-6': 128000,
      'claude-sonnet-4-6': 64000,
      'claude-opus-4-7': 128000,
      'claude-opus-4-8': 128000,
      // Claude Fable 5 / Mythos 5 (June 2026)
      'claude-fable-5': 128000,
      'claude-mythos-5': 128000,
      'claude-mythos-preview': 128000,
    };
  }

  /**
   * Get the maximum output tokens for the current model.
   * Ordered most-specific-first to avoid mis-classifying newer variants
   * (e.g. `opus-4-6` must not fall into the generic `opus-4` legacy bucket).
   */
  _getMaxTokensForModel() {
    if (this.modelMaxTokens[this.model]) {
      return this.modelMaxTokens[this.model];
    }

    const m = this.model.toLowerCase();

    // Fable / Mythos family (any version) — 128k
    if (m.includes('fable') || m.includes('mythos')) {
      return 128000;
    }

    // Generation 5+ (future flagships: opus-5, sonnet-5, haiku-5, opus-10, …) — 128k
    if (/(opus|sonnet|haiku)-([5-9]|\d{2,})(\b|-|$)/.test(m)) {
      return 128000;
    }

    // Opus 4.6+ (Opus 4.6 / 4.7 / 4.8 / 4.9 / 4.10 …) — 128k extended output
    if (/opus-4-([6-9]|\d{2,})/.test(m)) {
      return 128000;
    }

    // Opus 4.2 – 4.5 — 64k
    if (/opus-4-[2-5]/.test(m)) {
      return 64000;
    }

    // Opus 4.0 / 4.1 (deprecated) — 32k. Matches `opus-4`, `opus-4-0`, `opus-4-1`.
    if (/opus-4(-[01])?(\b|-|$)/.test(m)) {
      return 32000;
    }

    // Sonnet 4.x — 64k (covers 4.0 / 4.5 / 4.6 / future 4.x)
    if (/sonnet-4/.test(m)) {
      return 64000;
    }

    // Haiku 4.x — 64k
    if (/haiku-4/.test(m)) {
      return 64000;
    }

    // Claude 3.7 — 64k
    if (m.includes('3-7') || m.includes('3.7')) {
      return 64000;
    }

    // Claude 3.5 — 8k
    if (m.includes('3-5') || m.includes('3.5')) {
      return 8192;
    }

    // Claude 3.x legacy — 4k
    if (/claude-3(-|$)/.test(m)) {
      return 4096;
    }

    // Unknown model — assume current flagship ceiling (128k). Anthropic's API
    // requires max_tokens, so we can't omit it; defaulting low would silently
    // truncate long responses from new models we haven't catalogued yet.
    console.warn(`[Anthropic] Unknown model '${this.model}', defaulting max_tokens to 128000 (current flagship ceiling)`);
    return 128000;
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
    }

    // Check for network errors
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      return true;
    }

    // Retry 400 errors that are tool/function-related (same as OpenAI adapter)
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
        console.log('Treating 400 tool/function error as retryable (Anthropic)');
        return true;
      }
    }

    return false;
  }

  _transformToolsToAnthropic(tools) {
    if (!tools || tools.length === 0) return [];
    return tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    }));
  }

  /**
   * Apply cache_control marker to a message's content.
   * Handles string content, array content, and tool_result messages.
   */
  _applyCacheMarker(msg, marker) {
    const content = msg.content;

    // tool_result or empty content — mark at message level (not supported, skip)
    if (content == null || content === '') return;

    // String content → convert to content block array with marker
    if (typeof content === 'string') {
      msg.content = [{ type: 'text', text: content, cache_control: marker }];
      return;
    }

    // Array content → mark the last block
    if (Array.isArray(content) && content.length > 0) {
      content[content.length - 1].cache_control = marker;
    }
  }

  /**
   * Strip all cache_control markers from conversation messages.
   * Must be called before applying fresh markers to avoid exceeding
   * Anthropic's 4-breakpoint limit across tool loop rounds.
   */
  _stripCacheMarkers(messages) {
    for (const msg of messages) {
      delete msg.cache_control;
      const content = msg.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          delete block.cache_control;
        }
      }
    }
  }

  /**
   * Hybrid 5m + 1h rolling breakpoints.
   *
   * With `count >= 2`:
   *   - 1-hour marker on the second-to-last non-system message (the end of the
   *     stable prior-turn prefix). Anthropic caches everything up to and
   *     including this block, so prior turns survive long tool pauses / reads.
   *   - 5-minute marker on the last non-system message (the current turn). This
   *     shorter-TTL marker doesn't invalidate the 1h prefix — the prefix cache
   *     is still hit even when the 5m marker is new.
   *
   * With `count === 1` (or only one eligible message): fall back to a single
   * 5m marker on the latest message.
   *
   * The caller (Anthropic adapter) must also mark system + tools with 1h,
   * for a total of 4 breakpoints (system/tools/prefix = 1h, latest = 5m).
   *
   * IMPORTANT: Always strip stale markers first. When the adapter loops
   * through multiple tool-call rounds in one turn, markers on old message
   * positions must be cleared or the 4-breakpoint cap is exceeded.
   */
  _applyRollingCacheBreakpoints(messages, count = 2) {
    if (!messages || messages.length === 0) return;

    this._stripCacheMarkers(messages);

    const indices = [];
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role !== 'system') indices.push(i);
    }
    if (indices.length === 0) return;

    const latestIdx = indices[indices.length - 1];

    if (count >= 2 && indices.length >= 2) {
      const prefixIdx = indices[indices.length - 2];
      this._applyCacheMarker(messages[prefixIdx], { type: 'ephemeral', ttl: '1h' });
      this._applyCacheMarker(messages[latestIdx], { type: 'ephemeral' });
    } else if (count >= 1) {
      this._applyCacheMarker(messages[latestIdx], { type: 'ephemeral' });
    }
  }

  /**
   * Convert OpenAI-format history messages to Anthropic format.
   * - assistant messages with tool_calls → content array with tool_use blocks
   * - role:"tool" messages → role:"user" with tool_result content blocks
   * - Merge consecutive same-role messages (Anthropic requires alternating)
   */
  _normalizeHistoryMessages(messages) {
    const converted = [];

    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0 && !Array.isArray(msg.content)) {
        // Convert OpenAI-format tool_calls to Anthropic tool_use content blocks
        const content = [];
        if (msg.content) {
          content.push({ type: 'text', text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) });
        }
        for (const tc of msg.tool_calls) {
          let input = {};
          try {
            input = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function?.arguments || {};
          } catch {
            input = { raw: tc.function?.arguments };
          }
          content.push({ type: 'tool_use', id: tc.id, name: tc.function?.name || 'unknown', input });
        }
        converted.push({ role: 'assistant', content });
      } else if (msg.role === 'tool') {
        // Convert OpenAI-format tool result to Anthropic tool_result content block
        converted.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: msg.tool_call_id, content: msg.content || '' }],
        });
      } else {
        converted.push(msg);
      }
    }

    // Merge consecutive same-role messages (Anthropic requires alternating user/assistant)
    //
    // KNOWN ANTI-PATTERN (PRD-082 follow-up): when a user adds a follow-up
    // text message immediately after a tool_result-bearing user message
    // (no assistant turn between them), this merge produces a user message
    // shaped like [tool_result, tool_result, ..., text]. Anthropic's
    // documentation explicitly warns against this: "Never add text blocks
    // immediately after tool results — this teaches Claude to expect user
    // input after every tool use" and is a documented cause of empty 2-3
    // token end_turn responses (the *original* PRD-082 symptom, distinct
    // from the Fable refusal symptom in PRD-083).
    //
    // A fully correct fix is non-trivial because Anthropic also requires
    // alternating user/assistant — we can't just split the merged message
    // without inserting a synthetic assistant turn. Left as a follow-up;
    // the [Anthropic Pre-Call] diagnostic will surface when this shape
    // appears so we can prioritize.
    const merged = [];
    for (const msg of converted) {
      const last = merged[merged.length - 1];
      if (last && last.role === msg.role) {
        const lastContent = Array.isArray(last.content) ? last.content : [{ type: 'text', text: String(last.content || '') }];
        const msgContent = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content || '') }];
        last.content = [...lastContent, ...msgContent];
      } else {
        merged.push({ ...msg });
      }
    }

    return merged;
  }

  async call(messages, tools) {
    let lastError;
    // PRD-083 (CTO follow-up): mirror callStream's one-shot refusal fallback
    // here too so the suggestions feature (and other non-streaming consumers)
    // also benefits from auto-fallback to Opus 4.8 on Fable/Mythos refusals.
    let currentMessages = messages;
    let fallbackAttempted = false;
    const REFUSAL_FALLBACK_MODEL = 'claude-opus-4-8';

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const systemPrompt = currentMessages.find((m) => m.role === 'system')?.content || '';
        const conversationMessages = this._normalizeHistoryMessages(currentMessages.filter((m) => m.role !== 'system'));

        // Build system parameter with cache_control for prompt caching.
        // Anthropic allows max 4 cache_control breakpoints total across
        // system + tools + messages. Budget them carefully.
        let systemParam;
        let usedBreakpoints = 0;
        if (this.provider === 'claude-code') {
          // claude-code: billing header + identity + system prompt
          // The billing header with cch placeholder goes FIRST — the custom fetch
          // in LlmService computes the real hash over the serialized body and
          // replaces cch=00000 before the request is sent.
          const firstUserMsg = extractFirstUserMessage(conversationMessages);
          const billingBlock = buildBillingHeaderBlock(firstUserMsg);
          const systemBlocks = [
            billingBlock,
            { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." },
          ];
          if (systemPrompt) {
            systemBlocks.push({
              type: 'text',
              text: typeof systemPrompt === 'string' ? systemPrompt : JSON.stringify(systemPrompt),
              cache_control: { type: 'ephemeral', ttl: '1h' },
            });
          } else {
            systemBlocks[1].cache_control = { type: 'ephemeral', ttl: '1h' };
          }
          systemParam = systemBlocks;
          usedBreakpoints = 1;
        } else if (systemPrompt) {
          systemParam = [
            {
              type: 'text',
              text: typeof systemPrompt === 'string' ? systemPrompt : JSON.stringify(systemPrompt),
              cache_control: { type: 'ephemeral', ttl: '1h' },
            },
          ];
          usedBreakpoints = 1;
        } else {
          // No system prompt — omit `system` entirely. Sending an empty text
          // block with cache_control triggers Anthropic's
          // "cache_control cannot be set for empty text blocks" error.
          systemParam = undefined;
        }

        // Breakpoint on last tool — 1h because the tools array grows
        // monotonically within a conversation (additive-only in chatConfigs).
        const anthropicTools = this._transformToolsToAnthropic(tools);
        if (anthropicTools.length > 0) {
          anthropicTools[anthropicTools.length - 1].cache_control = { type: 'ephemeral', ttl: '1h' };
          usedBreakpoints++;
        }

        // Remaining breakpoints for rolling messages (max 4 total).
        // _applyRollingCacheBreakpoints handles the hybrid 1h-prefix + 5m-latest split.
        const messageBreakpoints = Math.max(0, 4 - usedBreakpoints);
        this._applyRollingCacheBreakpoints(conversationMessages, messageBreakpoints);

        const requestParams = {
          model: this.model,
          messages: conversationMessages,
          tools: anthropicTools,
          max_tokens: this._getMaxTokensForModel(), // Model-specific max tokens
        };
        if (systemParam) requestParams.system = systemParam;

        const reasoningConfig = buildAnthropicReasoningConfig(this.model, this.reasoningValue);
        if (reasoningConfig?.thinking) {
          requestParams.thinking = reasoningConfig.thinking;
        }
        if (reasoningConfig?.outputConfig) {
          requestParams.output_config = reasoningConfig.outputConfig;
        }

        const response = await this.client.messages.create(requestParams);

        const toolUseBlocks = response.content.filter((block) => block.type === 'tool_use');

        const standardizedToolCalls = toolUseBlocks.map((block) => ({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        }));

        // Construct a history-safe message object, stripping top-level metadata.
        const historyMessage = {
          role: 'assistant',
          content: response.content,
        };

        // Log successful retry if this wasn't the first attempt
        if (attempt > 0) {
          console.log(`Anthropic call succeeded on attempt ${attempt + 1}/${this.maxRetries + 1}`);
        }

        // Anthropic tool_use blocks live inside the content array, so the normalizer's
        // array-shape path will treat them as non-empty structural blocks automatically.
        const { message: normalizedMessage, wasEmpty } = BaseAdapter._normalizeAssistantResponse(historyMessage);
        if (wasEmpty) {
          const rawShape = JSON.stringify({
            stopReason: response?.stop_reason,
            contentBlockTypes: Array.isArray(historyMessage?.content) ? historyMessage.content.map((b) => b?.type) : null,
            contentLen: Array.isArray(historyMessage?.content) ? historyMessage.content.length : null,
          });
          console.warn(`[Anthropic] Empty response model=${this.model} ${rawShape}`);
        }

        // PRD-083 §7d (extended): refusal stop_reason path for non-streaming
        // calls. Mirrors the callStream handling — surface a clear refusal
        // message instead of the generic "API Error: Provider returned empty
        // response" string. This path is hit by features like suggestions
        // generation that don't stream.
        //
        // Per Anthropic docs: refusals carry a top-level `stop_details` object
        // with { type:'refusal', category, explanation }. Both category and
        // explanation can legitimately be null. Surface them when present so
        // the user sees the classifier that fired.
        if (response?.stop_reason === 'refusal') {
          const category = response?.stop_details?.category;
          const explanation = response?.stop_details?.explanation;
          console.warn(
            `[Anthropic Refusal] model=${this.model} provider=${this.provider} ` +
            `category=${category || 'null'} ` +
            `explanation=${explanation ? JSON.stringify(explanation) : 'null'} ` +
            `output_tokens=${response.usage?.output_tokens || 0}`,
          );

          // Auto-fallback to Opus 4.8 on Fable/Mythos refusal (same as
          // callStream). One-shot per call — if Opus also refuses, fall
          // through to the user-facing refusal message.
          const canFallback =
            isFableOrMythosModel(this.model) &&
            !fallbackAttempted &&
            this.model.toLowerCase() !== REFUSAL_FALLBACK_MODEL.toLowerCase();
          if (canFallback) {
            fallbackAttempted = true;
            const originalModel = this.model;
            console.warn(
              `[Anthropic Fallback] ${originalModel} refused (category=${category || 'null'}) — ` +
              `retrying same request on ${REFUSAL_FALLBACK_MODEL} with thinking blocks stripped`,
            );
            currentMessages = stripThinkingBlocksFromHistory(currentMessages);
            this.model = REFUSAL_FALLBACK_MODEL;
            attempt--;
            continue;
          }

          const categoryLabel = category ? ` (${category})` : '';
          const explanationLine = explanation
            ? ` Anthropic's explanation: ${explanation}`
            : '';
          const fallbackNote = fallbackAttempted
            ? ` Fallback to ${REFUSAL_FALLBACK_MODEL} also refused.`
            : '';
          const refusalText =
            `The model declined to respond to that turn` +
            `${categoryLabel}. This is a model-side safety classifier decision, ` +
            `not an API error.${explanationLine}${fallbackNote} ` +
            `Try rephrasing, switching to a different model, or switching to the Anthropic provider.`;
          // CRITICAL: toolCalls: [] on refusal (see streaming-path comment).
          // The returned responseMessage is plain text — any tool_use the
          // model emitted before refusing isn't in it, so we must not let
          // the orchestrator execute orphaned tool calls.
          return {
            responseMessage: {
              role: 'assistant',
              content: [{ type: 'text', text: refusalText }],
            },
            toolCalls: [],
            usage: response.usage || undefined,
            recoveredFromError: true,
            recoveredError: refusalText,
          };
        }

        return {
          responseMessage: normalizedMessage,
          toolCalls: standardizedToolCalls,
          usage: response.usage || undefined,
          ...(wasEmpty ? { recoveredFromError: true, recoveredError: 'Provider returned empty response' } : {}),
        };
      } catch (error) {
        lastError = error;

        // Check if this is the last attempt or if the error is not retryable
        if (attempt === this.maxRetries || !this.isRetryableError(error)) {
          console.error(`Anthropic call failed after ${attempt + 1} attempts, but NEVER STOPPING:`, {
            status: error.status,
            message: error.message,
            retryable: this.isRetryableError(error),
          });

          // Parse the error to get a user-friendly message
          const userFriendlyError = parseApiErrorMessage(error);

          // NEVER STOP - return a recovery response instead of throwing
          return {
            responseMessage: {
              role: 'assistant',
              content: [
                {
                  type: 'text',
                  text: `⚠️ **API Error:** ${userFriendlyError}\n\nPlease check your API configuration or try a different provider.`,
                },
              ],
            },
            toolCalls: [],
            recoveredFromError: true,
            recoveredError: error.message || 'Unknown error',
          };
        }

        // Add error context for tool/function errors to help LLM correct itself
        if (error.status === 400 && this.isRetryableError(error)) {
          const errorMessage = error.message || error.error?.message || 'Unknown error';
          console.log('Adding tool error context to help Anthropic retry');

          // For Anthropic, we need to add the error feedback as a user message
          // since Anthropic doesn't process system messages in the conversation flow
          messages.push({
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Your previous tool call failed with error: "${errorMessage}". Please retry with corrected formatting. Common issues include:
- Missing required parameters
- Incorrect parameter types (e.g., string instead of number)
- Invalid tool/function names
- Malformed JSON in arguments
Please carefully check the tool schema and ensure all parameters match the expected format.`,
              },
            ],
          });
        }

        // Calculate delay and wait before retrying
        const delay = this.calculateDelay(attempt);
        console.warn(`Anthropic call failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${Math.round(delay)}ms:`, {
          status: error.status,
          message: error.message,
        });

        await this.sleep(delay);
      }
    }

    // This should never be reached, but if it does, return a recovery response
    console.error('Unexpected fallback in Anthropic adapter, returning recovery response');
    return {
      responseMessage: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: "I encountered an unexpected error, but I'm still here to help. Please try your request again.",
          },
        ],
      },
      toolCalls: [],
      recoveredFromError: true,
    };
  }

  /**
   * Makes a streaming call to Anthropic's API with real-time token updates.
   * @param {Array<Object>} messages The conversation history.
   * @param {Array<Object>} tools The available tools in OpenAI format.
   * @param {Function} onChunk Callback for streaming chunks: (chunk) => void
   * @param {Object} context Optional context with imageData for vision
   * @returns {Promise<{responseMessage: Object, toolCalls: Array<Object>}>} A standardized response object.
   */
  async callStream(messages, tools, onChunk, context = {}) {
    let lastError;
    let currentMessages = messages;
    // PRD-083 (CTO follow-up): one-shot refusal fallback to Opus 4.8. Declared
    // outside streamingAttemptLoop so it persists across attempt iterations.
    // When Fable/Mythos refuses, we swap this.model, strip thinking blocks
    // from history, and `continue streamingAttemptLoop` to retry on Opus 4.8.
    let fallbackAttempted = false;
    const REFUSAL_FALLBACK_MODEL = 'claude-opus-4-8';

    // Handle vision images - inject into the last user message if model supports vision
    if (context.imageData && context.imageData.length > 0) {
      const provider = context.provider || 'anthropic';

      // Check if this model supports vision (uses metadata variant fallback so
      // claude-code routing through Anthropic adapter resolves to anthropic metadata).
      const supportsVision = ProviderRegistry.supportsVision(provider, this.model);

      if (supportsVision) {
        currentMessages = JSON.parse(JSON.stringify(messages)); // Deep clone

        // Inject into the last user message that is NOT a tool_result carrier.
        // Overwriting a tool_result-carrying user message orphans the preceding
        // assistant tool_use blocks and causes Anthropic 400 errors
        // ("tool_use ids were found without tool_result blocks immediately after").
        const targetIdx = findLastInjectableUserIndex(currentMessages);
        if (targetIdx !== -1) {
          const originalContent = currentMessages[targetIdx].content;
          const contentBlocks = [
            {
              type: 'text',
              text: typeof originalContent === 'string' ? originalContent : JSON.stringify(originalContent),
            },
          ];
          // Anthropic hard limits: 5 MB per image (base64-decoded), JPEG/PNG/GIF/WebP only.
          // Skip-and-narrate so the model can apologize accurately instead of 400-ing.
          // https://platform.claude.com/docs/en/build-with-claude/vision
          const ANTHROPIC_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
          const ANTHROPIC_SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
          const skipNotes = [];
          let injectedCount = 0;
          context.imageData.forEach((img) => {
            const name = img.filename || 'image';
            if (img.unsupported || !ANTHROPIC_SUPPORTED_TYPES.has(img.type)) {
              skipNotes.push(`[Image "${name}" (${img.type}) was not sent: Claude only accepts JPEG/PNG/GIF/WebP.]`);
              return;
            }
            // base64 length * 3/4 ≈ decoded byte count (close enough; padding noise is < 3 bytes)
            const decodedBytes = Math.floor((img.data?.length || 0) * 3 / 4);
            if (decodedBytes > ANTHROPIC_MAX_IMAGE_BYTES) {
              const mb = (decodedBytes / 1024 / 1024).toFixed(2);
              skipNotes.push(`[Image "${name}" was not sent: ${mb} MB exceeds Claude's 5 MB per-image limit. Please resize it under 5 MB.]`);
              return;
            }
            contentBlocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: img.type,
                data: img.data,
              },
            });
            injectedCount++;
          });
          if (skipNotes.length > 0) {
            // Surface skip reasons inline so the model can explain them to the user.
            contentBlocks[0].text = `${contentBlocks[0].text}\n\n${skipNotes.join('\n')}`;
            console.warn(`[Anthropic Vision] Skipped ${skipNotes.length} image(s); see notes appended to user message.`);
          }
          currentMessages[targetIdx].content = contentBlocks;
          console.log(`[Anthropic Vision] Added ${injectedCount}/${context.imageData.length} image(s) to user message at index ${targetIdx}`);
        } else {
          console.warn('[Anthropic Vision] No injectable user message found (all user messages carry tool_result blocks); skipping image injection to avoid orphaning tool_use IDs.');
        }
      } else {
        console.warn(`[Vision Check] Model '${this.model}' does not support vision. Images will be ignored.`);
        console.warn(`[Vision Check] Supported vision models for ${provider}: ${visionModels.join(', ')}`);
        console.warn(`[Vision Check] Consider using the 'analyze_image' tool or switching to a vision-capable model.`);
      }
    }

    // Labeled so the in-catch `continue streamingAttemptLoop` below skips the
    // inner pause_turn-resume `while` and restarts the whole attempt cleanly.
    streamingAttemptLoop:
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let accumulatedContent = '';
      let accumulatedToolCalls = [];
      let accumulatedThinking = '';
      let contentBlocks = [];
      let anthropicUsage = {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_5m_input_tokens: 0,
        cache_creation_1h_input_tokens: 0,
      };
      // Anthropic's documented stop_reason values: end_turn, max_tokens,
      // stop_sequence, tool_use, pause_turn, refusal. We capture the last one
      // we see on message_delta so we can: (a) auto-resume on pause_turn, and
      // (b) log it on empty responses for diagnostic visibility. See PRD-082.
      let anthropicStopReason = null;
      // PRD-082/083: stop_details carries the *reason* behind a stop_reason
      // — particularly important for refusals where Anthropic publishes the
      // classifier category (cyber/bio/frontier_llm/reasoning_extraction)
      // and a human-readable explanation. Per Anthropic docs, both fields
      // can legitimately be null (un-categorized refusal). Without this we
      // were dropping the single most diagnostic field on the response.
      let anthropicStopDetails = null;
      // Offset added to every event.index so that a resumed stream (after
      // pause_turn) appends its blocks to the same accumulator instead of
      // overwriting blocks from the previous segment. Bumped to
      // contentBlocks.length before each resume.
      let blockIndexOffset = 0;
      let resumeCount = 0;
      const MAX_PAUSE_TURN_RESUMES = 3;

      try {
        const systemPrompt = currentMessages.find((m) => m.role === 'system')?.content || '';

        // Normalize OpenAI-format history messages (role:"tool", tool_calls) to Anthropic format
        const normalizedMessages = this._normalizeHistoryMessages(currentMessages.filter((m) => m.role !== 'system'));

        // CRITICAL: Clean up any _inputJsonString fields from message history before sending to Anthropic
        // This can happen if messages are reused across retries or if deletion failed
        const conversationMessages = normalizedMessages.map((msg) => {
          if (msg.role === 'assistant' && Array.isArray(msg.content)) {
            return {
              ...msg,
              content: msg.content.map((block) => {
                // CRITICAL: Always create new block objects to prevent reference leaks
                if (block.type === 'tool_use') {
                  // Remove _inputJsonString if it exists
                  const { _inputJsonString, ...cleanBlock } = block;
                  if (_inputJsonString) {
                    console.warn(`[Anthropic] Cleaned _inputJsonString from tool_use block in message history (tool: ${block.name})`);
                  }
                  return cleanBlock;
                }
                // For non-tool_use blocks, create a shallow copy to prevent mutations
                return { ...block };
              }),
            };
          }
          // For non-assistant messages, create a shallow copy to prevent reference issues
          return { ...msg, content: Array.isArray(msg.content) ? [...msg.content] : msg.content };
        });

        // Defensive check: Verify no _inputJsonString fields remain
        for (let i = 0; i < conversationMessages.length; i++) {
          const msg = conversationMessages[i];
          if (msg.role === 'assistant' && Array.isArray(msg.content)) {
            for (let j = 0; j < msg.content.length; j++) {
              const block = msg.content[j];
              if (block.type === 'tool_use' && '_inputJsonString' in block) {
                console.error(`[Anthropic] ERROR: _inputJsonString still present in messages.${i}.content.${j} after cleanup!`);
                console.error(`[Anthropic] Block:`, JSON.stringify(block, null, 2));
                // Force delete it
                delete block._inputJsonString;
              }
            }
          }
        }

        // PRD-083 §7a: Pre-slim oversized tool_result content for Fable/Mythos
        // before sending. The universal orchestrator-level compactor misses
        // results that are under its 50k char threshold but, because of
        // Fable's 30%-larger tokenizer, still land at ~10k+ tokens — the
        // size at which Fable returns an empty 2-token response. Idempotent
        // across pause_turn resumes and retries (the stub is ≤2000 chars,
        // so a slimmed block is never re-slimmed).
        let fableSlimSummary = { slimmedCount: 0, originalBytes: 0, slimmedBytes: 0 };
        if (isFableOrMythosModel(this.model)) {
          fableSlimSummary = slimLargeToolResultsForFableMythos(conversationMessages);
          if (fableSlimSummary.slimmedCount > 0) {
            console.warn(
              `[Anthropic] Fable/Mythos tool_result slim — ${fableSlimSummary.slimmedCount} block(s), ` +
              `${fableSlimSummary.originalBytes} → ${fableSlimSummary.slimmedBytes} chars (PRD-083 §7a)`,
            );
          }
        }

        // PRD-083 §6: Pre-call diagnostic — log the input shape that the
        // post-call empty-response detector pairs against. With both lines
        // we can identify the trigger from one repro.
        logAnthropicPreCall(this.model, this.provider, conversationMessages, fableSlimSummary);

        // Build system parameter with cache_control for prompt caching.
        // Anthropic allows max 4 cache_control breakpoints total across
        // system + tools + messages. Budget them carefully.
        let systemParam;
        let usedBreakpoints = 0;
        if (this.provider === 'claude-code') {
          // claude-code: billing header + identity + system prompt
          // The billing header with cch placeholder goes FIRST — the custom fetch
          // in LlmService computes the real hash over the serialized body and
          // replaces cch=00000 before the request is sent.
          const firstUserMsg = extractFirstUserMessage(conversationMessages);
          const billingBlock = buildBillingHeaderBlock(firstUserMsg);
          const systemBlocks = [
            billingBlock,
            { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." },
          ];
          if (systemPrompt) {
            systemBlocks.push({
              type: 'text',
              text: typeof systemPrompt === 'string' ? systemPrompt : JSON.stringify(systemPrompt),
              cache_control: { type: 'ephemeral', ttl: '1h' },
            });
          } else {
            systemBlocks[1].cache_control = { type: 'ephemeral', ttl: '1h' };
          }
          systemParam = systemBlocks;
          usedBreakpoints = 1;
        } else {
          systemParam = [
            {
              type: 'text',
              text: typeof systemPrompt === 'string' ? systemPrompt : JSON.stringify(systemPrompt),
              cache_control: { type: 'ephemeral', ttl: '1h' },
            },
          ];
          usedBreakpoints = 1;
        }

        // Breakpoint on last tool — 1h because the tools array grows
        // monotonically within a conversation (additive-only in chatConfigs).
        const anthropicTools = this._transformToolsToAnthropic(tools);
        if (anthropicTools.length > 0) {
          anthropicTools[anthropicTools.length - 1].cache_control = { type: 'ephemeral', ttl: '1h' };
          usedBreakpoints++;
        }

        // Remaining breakpoints for rolling messages (max 4 total).
        // _applyRollingCacheBreakpoints handles the hybrid 1h-prefix + 5m-latest split.
        const messageBreakpoints = Math.max(0, 4 - usedBreakpoints);
        this._applyRollingCacheBreakpoints(conversationMessages, messageBreakpoints);

        const abortSignal = context.abortSignal;
        const requestParams = {
          model: this.model,
          system: systemParam,
          messages: conversationMessages,
          tools: anthropicTools,
          max_tokens: this._getMaxTokensForModel(), // Model-specific max tokens
        };

        const reasoningConfig = buildAnthropicReasoningConfig(this.model, this.reasoningValue);
        if (reasoningConfig?.thinking) {
          requestParams.thinking = reasoningConfig.thinking;
        }
        if (reasoningConfig?.outputConfig) {
          requestParams.output_config = reasoningConfig.outputConfig;
        }

        // Outer loop: handles `stop_reason: pause_turn` resumes. Anthropic emits
        // pause_turn on long agentic turns (typically big context + lots of
        // tools) to ask the client to re-invoke with the partial assistant
        // content appended; the model resumes the same turn. See PRD-082.
        let streamParseError = null;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          // Reset the per-segment stop_reason so we only ever read the one
          // emitted by the segment we're about to consume.
          anthropicStopReason = null;
          const stream = await this.client.messages.stream(requestParams);

          // Handle streaming events with error recovery
          try {
          for await (const event of stream) {
            if (abortSignal?.aborted) {
              stream.abort?.();
              console.log('[Anthropic Stream] Aborted by client disconnect');
              break;
            }

            // Skip null/undefined events
            if (!event || !event.type) {
              console.warn('[Anthropic] Received null or invalid event, skipping');
              continue;
            }

            // Capture usage from message_start event (contains input_tokens)
            if (event.type === 'message_start' && event.message?.usage) {
              const u = event.message.usage;
              anthropicUsage.input_tokens = u.input_tokens || 0;
              if (u.cache_creation_input_tokens) {
                anthropicUsage.cache_creation_input_tokens = u.cache_creation_input_tokens;
              }
              if (u.cache_read_input_tokens) {
                anthropicUsage.cache_read_input_tokens = u.cache_read_input_tokens;
              }
              // Hybrid 5m/1h breakdown — populated when extended-cache-ttl-2025-04-11
              // beta header is active. Flatten nested shape so downstream accumulator
              // code (OrchestratorService.accumulateUsage) can read either shape.
              if (u.cache_creation) {
                anthropicUsage.cache_creation_5m_input_tokens = u.cache_creation.ephemeral_5m_input_tokens || 0;
                anthropicUsage.cache_creation_1h_input_tokens = u.cache_creation.ephemeral_1h_input_tokens || 0;
              }
            }

            // Capture usage from message_delta event (contains output_tokens)
            if (event.type === 'message_delta' && event.usage) {
              anthropicUsage.output_tokens = event.usage.output_tokens || 0;
            }
            // Capture stop_reason from message_delta. `pause_turn` is used by
            // Anthropic on long agentic turns to ask the client to resume; we
            // handle it explicitly below. All other values are logged on empty
            // responses (PRD-082 diagnostic) so we can tell end_turn vs refusal
            // vs max_tokens at a glance.
            if (event.type === 'message_delta' && event.delta?.stop_reason) {
              anthropicStopReason = event.delta.stop_reason;
            }
            // Capture stop_details — the explanatory companion to stop_reason.
            // On refusals this contains { type: 'refusal', category, explanation }
            // where category is the classifier that fired (cyber/bio/frontier_llm/
            // reasoning_extraction) and explanation is Anthropic's human-readable
            // reason. Both can be null (un-categorized refusal). This is the
            // single highest-value field for diagnosing why Fable refused.
            if (event.type === 'message_delta' && event.delta?.stop_details) {
              anthropicStopDetails = event.delta.stop_details;
            }

            // Handle content block start.
            // CRITICAL: Use indexed assignment, not push(). Anthropic streams emit a
            // sequential `index` per content block. Fable 5 and Mythos 5 have
            // adaptive thinking ALWAYS ON — every stream begins with an index-0
            // `thinking` block regardless of request params. Older code only
            // initialized text/tool_use blocks via push(), silently skipping the
            // thinking slot, so the array fell one ahead of the event indices:
            // `input_json_delta` for tool_use(index=2) looked up contentBlocks[2]
            // which was undefined, the tool's argument JSON got dropped, and the
            // assistant emitted an orphan tool_use with empty args — hence "0 tool
            // calls" and [sanitizeOrphanToolCalls] warnings on Fable.
            //
            // Opus 4.6 / 4.7 / 4.8 / Sonnet 4.6 also support adaptive thinking but
            // only emit a thinking block when our adapter passes `thinking: {type:
            // 'adaptive'}`. They worked fine pre-fix because we never enabled it.
            // With those models now recognized by supportsAnthropicAdaptiveThinking,
            // the indexed-assignment fix protects them too once a user turns on
            // a non-default reasoning effort.
            if (event.type === 'content_block_start') {
              const block = event.content_block;
              // blockIndexOffset is 0 on the first segment of a stream, and
              // bumped to contentBlocks.length before each pause_turn resume,
              // so resumed segments append rather than overwrite.
              const idx = blockIndexOffset + event.index;
              if (block.type === 'text') {
                contentBlocks[idx] = { type: 'text', text: '' };
              } else if (block.type === 'tool_use') {
                contentBlocks[idx] = {
                  type: 'tool_use',
                  id: block.id,
                  name: block.name,
                  input: {},
                };
              } else if (block.type === 'thinking') {
                // Preserve thinking blocks so the cryptographic signature flows back
                // into the conversation history; Anthropic verifies it on the follow-up
                // call when the same assistant message is replayed with tool_results.
                contentBlocks[idx] = { type: 'thinking', thinking: '', signature: '' };
              } else if (block.type === 'redacted_thinking') {
                contentBlocks[idx] = { type: 'redacted_thinking', data: block.data || '' };
              } else if (block.type === 'refusal') {
                // PRD-083 §7d: Anthropic emits a `refusal` content block when the
                // model declines to answer (safety/policy). Pre-fix we initialized
                // these via the fallback `{ ...block }` branch, which left them
                // shaped like `{type:'refusal'}` with no `.text` field — subsequent
                // text_delta accumulation would set `.text = textDelta` rather than
                // `'' + textDelta`, technically fine, but the value never reached
                // the UI because nothing extracts `text` from refusal blocks. We
                // now initialize with an explicit empty text and surface the
                // refusal via onChunk so the user sees *something* instead of
                // "API Error: Provider returned empty response".
                contentBlocks[idx] = { type: 'refusal', text: '' };
              } else {
                // Future-proof: store unknown block types as-is so indices stay aligned.
                contentBlocks[idx] = { ...block };
              }
            }

            // Handle content block delta (streaming text, tool input, or thinking)
            if (event.type === 'content_block_delta') {
              const delta = event.delta;
              const index = blockIndexOffset + event.index;

              if (delta.type === 'text_delta') {
                // Accumulate text content
                const textDelta = delta.text || '';
                accumulatedContent += textDelta;

                if (contentBlocks[index]) {
                  // text_delta covers both `text` and `refusal` blocks — for
                  // refusal blocks the field is still `.text` (PRD-083 §7d).
                  contentBlocks[index].text = (contentBlocks[index].text || '') + textDelta;
                }

                if (onChunk) {
                  onChunk({
                    type: 'content',
                    delta: textDelta,
                    accumulated: accumulatedContent,
                  });
                }
              } else if (delta.type === 'refusal_delta') {
                // PRD-083 §7d: explicit refusal_delta path (in case Anthropic
                // routes refusal content through a dedicated delta type instead
                // of reusing text_delta). Same accumulation as text so the
                // user actually sees the refusal text in the chat stream.
                const refusalDelta = delta.text || delta.refusal || '';
                accumulatedContent += refusalDelta;
                if (contentBlocks[index]) {
                  contentBlocks[index].text = (contentBlocks[index].text || '') + refusalDelta;
                }
                if (onChunk) {
                  onChunk({
                    type: 'content',
                    delta: refusalDelta,
                    accumulated: accumulatedContent,
                  });
                }
              } else if (delta.type === 'input_json_delta') {
                // FIXED: Accumulate the raw JSON string instead of trying to parse incomplete JSON
                // Anthropic streams JSON as partial strings that need to be concatenated
                if (contentBlocks[index] && contentBlocks[index].type === 'tool_use') {
                  // Initialize the JSON string accumulator if it doesn't exist
                  if (!contentBlocks[index]._inputJsonString) {
                    contentBlocks[index]._inputJsonString = '';
                  }

                  // Accumulate the partial JSON string
                  const partialJson = delta.partial_json || '';
                  contentBlocks[index]._inputJsonString += partialJson;

                  // Don't try to parse until we have the complete JSON (on content_block_stop)
                }
              } else if (delta.type === 'thinking_delta') {
                // Fable 5 / Mythos 5 (always-on adaptive thinking) and any
                // model with `output_config.effort` set spend tokens here
                // BEFORE emitting any text. Without forwarding these deltas
                // to onChunk, the UI sees dead silence for the whole thinking
                // phase and the response feels like it's batching rather than
                // streaming. The orchestrator translates `type: 'reasoning'`
                // into a `reasoning_delta` SSE event — same path the OpenAI
                // adapter (line ~708) uses for o-series reasoning tokens.
                const thinkingDelta = delta.thinking || '';
                accumulatedThinking += thinkingDelta;
                if (contentBlocks[index] && contentBlocks[index].type === 'thinking') {
                  contentBlocks[index].thinking += thinkingDelta;
                }
                if (onChunk) {
                  onChunk({
                    type: 'reasoning',
                    delta: thinkingDelta,
                    accumulated: accumulatedThinking,
                  });
                }
              } else if (delta.type === 'signature_delta') {
                if (contentBlocks[index] && contentBlocks[index].type === 'thinking') {
                  contentBlocks[index].signature += (delta.signature || '');
                }
              }
            }

            // Handle content block stop
            if (event.type === 'content_block_stop') {
              const index = blockIndexOffset + event.index;
              const block = contentBlocks[index];

              if (block && block.type === 'tool_use') {
                // FIXED: Parse the accumulated JSON string now that it's complete
                if (block._inputJsonString) {
                  try {
                    block.input = JSON.parse(block._inputJsonString);
                    console.log(`[Anthropic] Successfully parsed tool input for ${block.name}:`, block.input);
                  } catch (parseError) {
                    console.error(`[Anthropic] Failed to parse tool input JSON for ${block.name}:`, parseError);
                    console.error(`[Anthropic] Raw JSON string:`, block._inputJsonString);
                    // Keep the empty object as fallback
                    block.input = {};
                  }

                  // CRITICAL: Delete the temporary field to prevent it from being sent back to Anthropic
                  // Anthropic will reject messages with "_inputJsonString: Extra inputs are not permitted"
                  delete block._inputJsonString;
                }

                // Finalize tool call with the parsed input
                const toolCall = {
                  id: block.id,
                  type: 'function',
                  function: {
                    name: block.name,
                    arguments: JSON.stringify(block.input),
                  },
                };

                accumulatedToolCalls.push(toolCall);

                if (onChunk) {
                  onChunk({
                    type: 'tool_call_delta',
                    index: accumulatedToolCalls.length - 1,
                    toolCall: toolCall,
                  });
                }
              }
            }
          }
        } catch (streamIteratorError) {
          // CRITICAL: Handle stream parsing errors gracefully
          // The Anthropic SDK sometimes throws "Unexpected end of JSON input" errors
          // when parsing SSE events.
          streamParseError = streamIteratorError;
          console.error('[Anthropic] Stream iterator error:', streamIteratorError.message);
          console.log('[Anthropic] Accumulated content so far:', accumulatedContent.length, 'chars');
          console.log('[Anthropic] Accumulated tool calls so far:', accumulatedToolCalls.length);

          // CRITICAL: Check for in-progress tool_use blocks that never got content_block_stop.
          // These are tool calls the LLM was generating when the stream broke.
          const inProgressToolBlocks = contentBlocks.filter((b) => b.type === 'tool_use' && b._inputJsonString !== undefined);

          if (inProgressToolBlocks.length > 0) {
            console.log(`[Anthropic] Found ${inProgressToolBlocks.length} in-progress tool call(s) cut off by stream error`);

            // Try to salvage tool calls with complete-enough JSON
            for (const block of inProgressToolBlocks) {
              try {
                block.input = JSON.parse(block._inputJsonString);
                delete block._inputJsonString;
                accumulatedToolCalls.push({
                  id: block.id,
                  type: 'function',
                  function: {
                    name: block.name,
                    arguments: JSON.stringify(block.input),
                  },
                });
                console.log(`[Anthropic] Salvaged complete tool call: ${block.name}`);
              } catch {
                console.warn(
                  `[Anthropic] Tool call "${block.name}" has incomplete JSON (${(block._inputJsonString || '').length} chars), cannot salvage`,
                );
              }
            }

            // If we still have unsalvaged tool calls and retries left, retry the whole request
            const salvagedCount = accumulatedToolCalls.length;
            const unsalvagedCount = inProgressToolBlocks.length - salvagedCount;
            if (unsalvagedCount > 0 && attempt < this.maxRetries) {
              console.warn(
                `[Anthropic] ${unsalvagedCount} tool call(s) could not be salvaged, retrying (attempt ${attempt + 1}/${this.maxRetries + 1})`,
              );
              const delay = this.calculateDelay(attempt);
              await this.sleep(delay);
              // Skip the pause_turn resume loop and restart the whole attempt.
              continue streamingAttemptLoop;
            }
          }

          // If we have nothing at all, throw to trigger retry
          if (accumulatedContent.length === 0 && accumulatedToolCalls.length === 0) {
            throw streamIteratorError;
          }

          console.log(
            `[Anthropic] Continuing with ${accumulatedContent.length} chars content and ${accumulatedToolCalls.length} tool calls after stream error`,
          );
        }

          // pause_turn auto-resume. Append the partial assistant content
          // (thinking blocks + signatures + any text/tool_use so far) to the
          // request's messages and re-stream. The model picks up where it
          // left off. Hard-capped at MAX_PAUSE_TURN_RESUMES to prevent
          // runaway. See PRD-082.
          if (
            anthropicStopReason === 'pause_turn' &&
            resumeCount < MAX_PAUSE_TURN_RESUMES &&
            contentBlocks.length > 0
          ) {
            resumeCount++;
            const partialAssistant = {
              role: 'assistant',
              content: contentBlocks.map((block) => {
                if (block && block.type === 'tool_use') {
                  const { _inputJsonString, ...clean } = block;
                  return clean;
                }
                return { ...block };
              }).filter(Boolean),
            };
            requestParams.messages = [...requestParams.messages, partialAssistant];
            blockIndexOffset = contentBlocks.length;
            console.log(
              `[Anthropic Stream] pause_turn detected — resuming (${resumeCount}/${MAX_PAUSE_TURN_RESUMES}), ` +
              `${contentBlocks.length} block(s) carried forward, offset=${blockIndexOffset}`,
            );
            continue; // re-enter the pause_turn resume while loop
          }

          // Any other stop_reason (end_turn, max_tokens, tool_use, refusal,
          // null) means this segment is the final one — exit the resume loop.
          break;
        } // end of pause_turn resume while loop

        // Log successful retry if this wasn't the first attempt
        if (attempt > 0) {
          console.log(`Anthropic streaming call succeeded on attempt ${attempt + 1}/${this.maxRetries + 1}`);
        }

        // CRITICAL: Final cleanup of _inputJsonString from all contentBlocks before returning
        // This ensures no _inputJsonString fields make it into the conversation history
        const cleanedContentBlocks = contentBlocks.map((block) => {
          // CRITICAL: Always create new block objects to prevent _inputJsonString from leaking
          if (block.type === 'tool_use') {
            // Remove _inputJsonString if it exists (it shouldn't at this point, but be defensive)
            const { _inputJsonString, ...cleanBlock } = block;
            return cleanBlock;
          }
          // For non-tool_use blocks, create a shallow copy
          return { ...block };
        });

        // Construct response message in Anthropic format
        const responseMessage = {
          role: 'assistant',
          content: cleanedContentBlocks.length > 0 ? cleanedContentBlocks : [{ type: 'text', text: accumulatedContent }],
        };

        const { message: normalizedMessage, wasEmpty } = BaseAdapter._normalizeAssistantResponse(responseMessage);
        // PRD-083 §7d (extended): Anthropic can set `stop_reason: refusal`
        // WITHOUT emitting a refusal content block — the only signal is the
        // stop_reason. When that happens our empty-response handler kicks in,
        // but the user sees the generic "API Error" string which is wrong:
        // the model didn't error, it refused. Detect the refusal stop_reason
        // and surface a clear message so the user understands what happened
        // and what to do about it.
        const wasRefusal = anthropicStopReason === 'refusal';
        if (wasEmpty) {
          console.warn('[Anthropic Stream] Provider returned empty response (no content, no tool calls) — padded for history safety');
          // Phase 1 diagnostic — PRD-082. On empty responses, log the data we
          // need to disambiguate root cause without restarting the chat:
          //   stop_reason         — end_turn vs pause_turn vs refusal vs max_tokens
          //   block tally         — was the response all thinking? truly nothing?
          //   thinkingSigLen      — did we capture a full signature?
          //   resumeCount         — did we already exhaust pause_turn resumes?
          const blockSummary = contentBlocks.reduce((acc, b) => {
            if (!b) return acc;
            acc[b.type] = (acc[b.type] || 0) + 1;
            return acc;
          }, {});
          const thinkingBlock = contentBlocks.find((b) => b?.type === 'thinking');
          console.warn(
            `[Anthropic Stream] Empty response detail — model=${this.model} ` +
            `provider=${this.provider} ` +
            `stop_reason=${anthropicStopReason || 'null'} ` +
            `stop_details=${anthropicStopDetails ? JSON.stringify(anthropicStopDetails) : 'null'} ` +
            `blocks=${JSON.stringify(blockSummary)} ` +
            `thinkingSigLen=${(thinkingBlock?.signature || '').length} ` +
            `output_tokens=${anthropicUsage.output_tokens || 0} ` +
            `resumeCount=${resumeCount}/${MAX_PAUSE_TURN_RESUMES}`,
          );
        }

        // If the model refused (with or without explicit content), inject a
        // user-facing message so the chat bubble shows real text instead of
        // the generic "API Error: Provider returned empty response".
        //
        // Per Anthropic docs: refusals on Fable 5 / Mythos 5 are not errors —
        // they're successful HTTP 200 responses where the pre-output safety
        // classifier declined the turn. stop_details carries the classifier
        // category (cyber/bio/frontier_llm/reasoning_extraction) and a
        // human-readable explanation when Anthropic categorized the refusal.
        // Both fields can legitimately be null. Pre-output refusals are not
        // billed; mid-stream refusals bill only what was emitted before the
        // refusal block.
        //
        // CRITICAL: stream via onChunk(type: 'content') so the message goes
        // through the SAME SSE/socket path the model's normal text would
        // have used — landing in APPEND_MESSAGE_CONTENT during the live
        // stream, before message_end fires. The `recoveredFromError` /
        // post-stream content_delta path was racing badly with message_end
        // in some chat types (orchestrator chat) and never reaching the
        // bubble. Routing through onChunk avoids that race entirely.
        //
        // We don't set recoveredFromError on the return: from the
        // orchestrator's point of view this is now a normal successful
        // response whose text happens to be a refusal explanation.
        //
        // Recommended next step per Anthropic: on stop_reason:refusal, fall
        // back to a different model (e.g. Opus 4.8) with thinking blocks
        // stripped from the history — never retry the same model. Left as
        // a follow-up.
        if (wasRefusal) {
          const category = anthropicStopDetails?.category;
          const explanation = anthropicStopDetails?.explanation;

          // One-shot operational log so refusals show up as their own metric
          // rather than getting buried in the empty-response detail line.
          console.warn(
            `[Anthropic Refusal] model=${this.model} provider=${this.provider} ` +
            `category=${category || 'null'} ` +
            `explanation=${explanation ? JSON.stringify(explanation) : 'null'} ` +
            `output_tokens=${anthropicUsage.output_tokens || 0}`,
          );

          // Auto-fallback to Opus 4.8 on Fable/Mythos refusal. Per Anthropic
          // docs: "Re-sending a refused request to the same model usually
          // earns another refusal" — fall back to a different model with
          // thinking blocks stripped from history first. One-shot per call
          // (fallbackAttempted gates re-entry) — if Opus also refuses, fall
          // through to the user-facing refusal message below.
          const canFallback =
            isFableOrMythosModel(this.model) &&
            !fallbackAttempted &&
            this.model.toLowerCase() !== REFUSAL_FALLBACK_MODEL.toLowerCase();
          if (canFallback) {
            fallbackAttempted = true;
            const originalModel = this.model;
            console.warn(
              `[Anthropic Fallback] ${originalModel} refused (category=${category || 'null'}) — ` +
              `retrying same request on ${REFUSAL_FALLBACK_MODEL} with thinking blocks stripped`,
            );
            // Strip thinking blocks (carries cryptographic signatures only
            // valid on the original model). Mutates `currentMessages` so
            // the next streamingAttemptLoop iteration rebuilds the request
            // with the cleaned history.
            currentMessages = stripThinkingBlocksFromHistory(currentMessages);
            this.model = REFUSAL_FALLBACK_MODEL;
            // Tell the user what's happening so the bubble shows progress
            // rather than going silent during the second roundtrip.
            if (onChunk) {
              const notice =
                `⚠️ ${originalModel} declined this turn` +
                `${category ? ` (${category})` : ''}. ` +
                `Falling back to ${REFUSAL_FALLBACK_MODEL}…\n\n`;
              onChunk({ type: 'content', delta: notice, accumulated: notice });
            }
            // Don't burn a retry slot — the for loop will increment attempt
            // back to where it was. Restart the attempt with the new model.
            attempt--;
            continue streamingAttemptLoop;
          }

          // No fallback available (already attempted, or model isn't Fable/Mythos,
          // or model IS the fallback model). Surface the refusal to the user.
          const categoryLabel = category ? ` (${category})` : '';
          const explanationLine = explanation
            ? `\n\n**Anthropic's explanation:** ${explanation}`
            : '';
          const fallbackNote = fallbackAttempted
            ? `\n\nFallback to ${REFUSAL_FALLBACK_MODEL} also refused.`
            : '';
          const refusalText =
            `⚠️ The model declined to respond to that turn` +
            `${categoryLabel}. This is a model-side safety classifier decision, ` +
            `not an API error.${explanationLine}${fallbackNote}\n\n` +
            `Re-sending the same prompt to the same model will almost always earn ` +
            `another refusal. Try: switching to a different model, switching ` +
            `to the Anthropic provider (not Claude Code), or rephrasing the request.`;
          // accumulatedContent may already hold partial text the model
          // emitted before refusing — preserve it and append the refusal
          // explanation as a clearly-separated suffix.
          const prefix = accumulatedContent ? `${accumulatedContent}\n\n` : '';
          const streamDelta = `${prefix ? '\n\n' : ''}${refusalText}`;
          if (onChunk) {
            onChunk({
              type: 'content',
              delta: streamDelta,
              accumulated: `${prefix}${refusalText}`,
            });
          }
          const refusalMessage = {
            role: 'assistant',
            content: [{ type: 'text', text: `${prefix}${refusalText}` }],
          };
          // CRITICAL: must return toolCalls: [] on refusal. If Fable started
          // emitting a tool_use block before refusing, accumulatedToolCalls
          // would carry that tool_use's id. But the assistant message we're
          // returning is plain refusal text — there is no matching tool_use
          // in its content. Returning the tool calls anyway would cause the
          // orchestrator to execute the tool and append a tool_result whose
          // tool_use_id has no matching tool_use in the preceding assistant
          // message — Anthropic 400 ("unexpected tool_use_id found in
          // tool_result blocks") on the next call. Drop them entirely.
          return {
            responseMessage: refusalMessage,
            toolCalls: [],
            usage: anthropicUsage.input_tokens || anthropicUsage.output_tokens ? anthropicUsage : undefined,
          };
        }

        return {
          responseMessage: normalizedMessage,
          toolCalls: accumulatedToolCalls,
          usage: anthropicUsage.input_tokens || anthropicUsage.output_tokens ? anthropicUsage : undefined,
          ...(wasEmpty ? { recoveredFromError: true, recoveredError: 'Provider returned empty response' } : {}),
        };
      } catch (error) {
        lastError = error;

        // Check if this is the last attempt or if the error is not retryable
        if (attempt === this.maxRetries || !this.isRetryableError(error)) {
          console.error(`Anthropic streaming call failed after ${attempt + 1} attempts, but NEVER STOPPING:`, {
            status: error.status,
            message: error.message,
          });

          // Parse the error to get a user-friendly message
          const userFriendlyError = parseApiErrorMessage(error);

          return {
            responseMessage: {
              role: 'assistant',
              content: [
                {
                  type: 'text',
                  text: `⚠️ **API Error:** ${userFriendlyError}\n\nPlease check your API configuration or try a different provider.`,
                },
              ],
            },
            toolCalls: [],
            recoveredFromError: true,
            recoveredError: error.message || 'Unknown error',
          };
        }

        // Add error context for tool/function errors
        if (error.status === 400 && this.isRetryableError(error)) {
          const errorMessage = error.message || error.error?.message || 'Unknown error';
          console.log('Adding tool error context to help Anthropic retry (streaming)');

          currentMessages = [...currentMessages];
          currentMessages.push({
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Your previous tool call failed with error: "${errorMessage}". Please retry with corrected formatting.`,
              },
            ],
          });
        }

        // Calculate delay and wait before retrying
        const delay = this.calculateDelay(attempt);
        console.warn(`Anthropic streaming call failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${Math.round(delay)}ms:`, {
          status: error.status,
          message: error.message,
        });

        await this.sleep(delay);
      }
    }

    // Fallback recovery response
    return {
      responseMessage: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: "I encountered an unexpected error, but I'm still here to help. Please try your request again.",
          },
        ],
      },
      toolCalls: [],
      recoveredFromError: true,
    };
  }

  formatToolResults(toolExecutionResults) {
    const toolResultBlocks = toolExecutionResults.map((result) => ({
      type: 'tool_result',
      tool_use_id: result.tool_call_id,
      content: result.content,
      // Anthropic can also handle an error state
      // is_error: result.is_error || false
    }));

    // Anthropic expects tool results to be sent in a 'user' role message.
    return [
      {
        role: 'user',
        content: toolResultBlocks,
      },
    ];
  }
}

/**
 * Adapter for Cerebras API using the native @cerebras/cerebras_cloud_sdk.
 *
 * The Cerebras SDK is OpenAI-compatible, so this adapter extends OpenAiLikeAdapter.
 * Key differences from standard OpenAI:
 * - Does NOT support parallel_tool_calls parameter (will cause 400 error)
 * - Streaming + tool calling is ONLY supported for: gpt-oss-120b, zai-glm-4.6
 * - For llama models, streaming with tools is NOT supported - must fall back to non-streaming
 * - Some models have reasoning parameters (reasoning_effort, disable_reasoning)
 * - Has strict rate limits (tokens per minute) - requires longer delays on 429 errors
 *
 * The native Cerebras SDK provides:
 * - Better error handling specific to Cerebras
 * - Official support and updates
 * - Same API interface as OpenAI (client.chat.completions.create())
 */
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
    let currentMessages = messages;

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

          const delta = chunk.choices[0]?.delta;

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

/**
 * Adapter for Google's Gemini API.
 * This adapter is necessary because the Gemini API is not OpenAI-compatible.
 */
class GeminiAdapter extends BaseAdapter {
  constructor(client, model, options = {}) {
    super(client, model);
    this.reasoningValue = options.reasoningValue || 'default';
    this.maxRetries = 6; // More retries to survive free-tier rate limits (quota resets ~20-60s)
    this.baseDelay = 1000; // 1 second for non-rate-limit errors
    this.retryableStatusCodes = new Set([429, 500, 502, 503, 504, 529]);
    this.rateLimitBaseDelay = 5000; // 5 second minimum for rate limit retries
  }

  /**
   * Sleep for a given number of milliseconds
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Calculate delay with exponential backoff and jitter.
   * For rate limit errors, uses the server-reported reset time when available.
   */
  calculateDelay(attempt, rateLimitResetSeconds = 0) {
    if (rateLimitResetSeconds > 0) {
      // Use the server-reported reset time + 2s buffer + small jitter
      const resetDelay = (rateLimitResetSeconds + 2) * 1000;
      const jitter = Math.random() * 2000;
      return resetDelay + jitter;
    }
    const exponentialDelay = this.baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
    return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
  }

  /**
   * Check if an error is a rate limit / quota error
   */
  isRateLimitError(error) {
    const status = error.status || error.response?.status;
    if (status === 429) return true;
    const msg = (error.message || '').toLowerCase();
    return msg.includes('quota') || msg.includes('rate limit') || msg.includes('resource has been exhausted');
  }

  /**
   * Parse the "quota will reset after Xs" value from a Gemini error message.
   * Returns the number of seconds, or 0 if not found.
   */
  parseQuotaResetSeconds(error) {
    const msg = error.message || '';
    // Gemini returns messages like: "Your quota will reset after 21s."
    const match = msg.match(/reset after (\d+)s/i);
    if (match) return parseInt(match[1], 10);
    // Also check for "retry after" header style
    const retryMatch = msg.match(/retry.?after[:\s]+(\d+)/i);
    if (retryMatch) return parseInt(retryMatch[1], 10);
    return 0;
  }

  /**
   * Check if an error is retryable
   */
  isRetryableError(error) {
    // Check for HTTP status codes
    if (error.status && this.retryableStatusCodes.has(error.status)) {
      return true;
    }

    // Check for axios error response
    if (error.response?.status && this.retryableStatusCodes.has(error.response.status)) {
      return true;
    }

    // Check for network errors
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      return true;
    }

    // Check error message for rate limiting
    const errorMessage = error.message?.toLowerCase() || '';
    if (errorMessage.includes('rate limit') || errorMessage.includes('quota') || errorMessage.includes('429')) {
      return true;
    }

    return false;
  }

  /**
   * Transform messages from OpenAI format to Gemini format
   */
  _transformToGemini(messages) {
    const systemMessage = messages.find((m) => m.role === 'system');

    // CRITICAL FIX: Don't filter out 'user' messages that contain function responses!
    // Gemini uses 'user' role for function responses, not 'tool' role
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    // Check if this is a thinking model that requires thought signatures
    const isThinkingModel =
      this.model &&
      (this.model.includes('preview') ||
        this.model.includes('thinking') ||
        this.model.includes('nano-banana') ||
        this.model.includes('exp') ||
        this.model.includes('image'));

    const geminiMessages = conversationMessages.map((msg, msgIndex) => {
      let role = msg.role;

      // Transform roles for Gemini
      if (role === 'assistant') {
        role = 'model';
      } else if (role === 'tool') {
        // Tool responses should be 'user' role in Gemini
        role = 'user';
      }

      // Handle different content formats
      let parts = [];

      // Convert OpenAI-format tool_calls on assistant messages to Gemini functionCall parts
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0 && !msg.parts) {
        if (msg.content) {
          parts.push({ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) });
        }
        let missingSigCount = 0;
        for (const tc of msg.tool_calls) {
          let args = {};
          try {
            args = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function?.arguments || {};
          } catch {
            args = {};
          }
          const fcPart = { functionCall: { name: tc.function?.name || 'unknown', args } };
          // Reattach thought signature so Gemini 2.5+ thinking models accept multi-tool-call turns (Refs agnt-gg/agnt#35).
          // SDK expects camelCase `thoughtSignature` — snake_case is dropped during serialization.
          const signature = tc._thoughtSignature || msg._geminiThoughtSignature;
          if (signature) {
            fcPart.thoughtSignature = signature;
          } else {
            missingSigCount++;
          }
          parts.push(fcPart);
        }
        // TEMP DIAGNOSTIC for issue #35 — always log on thinking models so we can see exactly
        // which functionCall parts are going back to Gemini with/without signatures.
        if (isThinkingModel) {
          const perCall = msg.tool_calls.map((tc, i) => {
            const ownSig = tc._thoughtSignature ? 'own' : '-';
            const fallback = !tc._thoughtSignature && msg._geminiThoughtSignature ? 'fallback' : '-';
            return `${i}:${tc.function?.name || '?'}[${ownSig}/${fallback}]`;
          }).join(' | ');
          console.log(`[Gemini Rebuild #35] msgIdx=${msgIndex} sigs ${perCall} (missingFinal=${missingSigCount}, msg._gts=${msg._geminiThoughtSignature ? 'present' : 'absent'})`);
        }
        if (missingSigCount > 0 && isThinkingModel) {
          console.warn(`[Gemini] Rebuilding assistant turn with ${missingSigCount}/${msg.tool_calls.length} functionCall part(s) lacking thought_signature — Gemini will reject this on thinking models. Check Gemini Stream warnings from the prior turn.`);
        }
        return { role, parts };
      }

      // Convert OpenAI-format tool result messages to Gemini functionResponse parts
      if (msg.role === 'tool' && msg.tool_call_id) {
        let response = {};
        try {
          response = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content || {};
        } catch {
          response = { result: msg.content };
        }
        parts.push({ functionResponse: { name: msg.name || 'tool', response } });
        return { role, parts };
      }

      // Check if message already has parts (vision images added or function responses)
      if (msg.parts) {
        // Already has parts - transform them to Gemini format
        // CRITICAL: Filter out any invalid/empty parts that would cause
        // "required oneof field 'data' must have one initialized field" error
        parts = msg.parts
          .map((part) => {
            // Handle function responses (from tool results) - pass through as-is
            if (part.functionResponse) {
              return part;
            }

            // Handle function calls — preserve thoughtSignature for Gemini 2.5+ thinking models (Refs agnt-gg/agnt#35)
            // SDK expects camelCase outgoing; snake_case is silently dropped.
            if (part.functionCall) {
              const fcPart = { functionCall: part.functionCall };
              const signature = part.thoughtSignature || part.thought_signature;
              if (signature) {
                fcPart.thoughtSignature = signature;
              }
              return fcPart;
            }

            // Handle text parts with type field
            if (part.type === 'text') {
              const textPart = { text: part.text || '' };
              // Preserve thought signature if present (camelCase — SDK drops snake_case)
              if (part.thoughtSignature) {
                textPart.thoughtSignature = part.thoughtSignature;
              }
              return textPart;
            }

            // Handle image parts with type field
            if (part.type === 'image' && part.inlineData) {
              return {
                inlineData: {
                  mimeType: part.inlineData.mimeType,
                  data: part.inlineData.data,
                },
              };
            }

            // Handle parts already in Gemini format (have text property directly)
            if (part.text !== undefined) {
              return part;
            }

            // Handle parts already in Gemini format (have inlineData directly)
            if (part.inlineData && part.inlineData.data && part.inlineData.mimeType) {
              return part;
            }

            // CRITICAL: Skip invalid/empty parts that would cause Gemini API errors
            // This prevents "required oneof field 'data' must have one initialized field"
            console.warn('[Gemini] Skipping invalid/empty part in message transformation:', JSON.stringify(part).substring(0, 200));
            return null;
          })
          .filter((part) => part !== null); // Remove null/invalid parts
      } else if (typeof msg.content === 'string') {
        const textPart = { text: msg.content || '' };

        // For thinking models, add thought signature to ALL text parts (camelCase — SDK drops snake_case)
        if (isThinkingModel) {
          textPart.thoughtSignature = '';
        }
        // Preserve thought signature from previous model responses
        if (msg._geminiThoughtSignature) {
          textPart.thoughtSignature = msg._geminiThoughtSignature;
        }

        parts = [textPart];
      } else if (Array.isArray(msg.content)) {
        // Handle Anthropic-style content blocks or Gemini function responses
        const textBlock = msg.content.find((c) => c.type === 'text');
        if (textBlock) {
          const textPart = { text: textBlock.text };

          // For thinking models, add thought signature to ALL text parts (camelCase — SDK drops snake_case)
          if (isThinkingModel) {
            textPart.thoughtSignature = '';
          }
          // Preserve thought signature from previous responses
          if (msg._geminiThoughtSignature) {
            textPart.thoughtSignature = msg._geminiThoughtSignature;
          }

          parts = [textPart];
        } else {
          // This might be function responses already in Gemini format
          parts = msg.content;
        }
      }

      return {
        role: role,
        parts: parts.length > 0 ? parts : [{ text: '' }],
      };
    });

    return { systemMessage, geminiMessages };
  }

  /**
   * Transform OpenAI tool format to Gemini function declarations
   */
  _transformToolsToGemini(tools) {
    if (!tools || tools.length === 0) return undefined;

    return tools.map((tool) => {
      const params = tool.function.parameters || {};

      // Deep clone and fix schema for Gemini compatibility
      const geminiParams = this._fixSchemaForGemini(params);

      return {
        name: tool.function.name,
        description: tool.function.description || '',
        parameters: geminiParams,
      };
    });
  }

  /**
   * Extract thought signature from Gemini response part
   */
  _extractThoughtSignature(part) {
    if (part && part.thoughtSignature) {
      return part.thoughtSignature;
    }
    return null;
  }

  /**
   * Preserve thought signature in message parts
   */
  _createPartWithSignature(content, signature) {
    const part = { text: content };
    if (signature) {
      part.thoughtSignature = signature;
    }
    return part;
  }

  /**
   * Fix OpenAI schema to be Gemini-compatible
   * Gemini has stricter validation rules than OpenAI
   */
  _fixSchemaForGemini(schema) {
    if (!schema || typeof schema !== 'object') return schema;

    const fixed = JSON.parse(JSON.stringify(schema)); // Deep clone

    // Recursively fix properties
    if (fixed.properties) {
      for (const [key, prop] of Object.entries(fixed.properties)) {
        // Fix enum - only allowed for string type in Gemini
        if (prop.enum && prop.type !== 'string') {
          delete prop.enum;
        }

        // Fix enum - filter out empty strings (Gemini rejects empty enum values)
        if (prop.enum && Array.isArray(prop.enum)) {
          prop.enum = prop.enum.filter((v) => v !== '');
          if (prop.enum.length === 0) {
            delete prop.enum;
          }
        }

        // Recursively fix nested objects
        if (prop.type === 'object' && prop.properties) {
          prop.properties = this._fixSchemaForGemini({ properties: prop.properties }).properties;
        }

        // Fix array type - must have items field (Gemini requires it)
        if (prop.type === 'array') {
          if (!prop.items) {
            prop.items = { type: 'string' };
          }
          // Recursively fix array items
          if (prop.items.properties) {
            prop.items = this._fixSchemaForGemini(prop.items);
          }
          // Fix enum in array items
          if (prop.items.enum) {
            if (prop.items.type !== 'string') {
              delete prop.items.enum;
            } else {
              prop.items.enum = prop.items.enum.filter((v) => v !== '');
              if (prop.items.enum.length === 0) {
                delete prop.items.enum;
              }
            }
          }
        }
      }
    }

    return fixed;
  }

  /**
   * Extract tool calls from Gemini response
   */
  _extractToolCalls(response) {
    const toolCalls = [];

    // Prefer walking candidates.parts so we can capture per-call thoughtSignature.
    // Required for Gemini 2.5+ thinking models on multi-tool-call turns (Refs agnt-gg/agnt#35).
    const parts = response?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
      let index = 0;
      let pending = null;
      for (const part of parts) {
        if (!part) continue;
        const partSig = part.thoughtSignature || part.thought_signature || null;
        if (!part.functionCall) {
          if (partSig) pending = partSig;
          continue;
        }
        const fc = part.functionCall;
        const toolCall = {
          id: `gemini-tool-${Date.now()}-${index}`,
          type: 'function',
          function: {
            name: fc.name,
            arguments: JSON.stringify(fc.args || {}),
          },
        };
        const sig = partSig || pending;
        if (sig) {
          toolCall._thoughtSignature = sig;
          pending = null;
        }
        toolCalls.push(toolCall);
        index += 1;
      }
      return toolCalls;
    }

    // Fallback to flat array shape if candidates structure isn't present
    if (response.functionCalls && Array.isArray(response.functionCalls)) {
      response.functionCalls.forEach((fc, index) => {
        toolCalls.push({
          id: `gemini-tool-${Date.now()}-${index}`,
          type: 'function',
          function: {
            name: fc.name,
            arguments: JSON.stringify(fc.args || {}),
          },
        });
      });
    }

    return toolCalls;
  }

  async call(messages, tools) {
    let lastError;
    let currentMessages = messages;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const { systemMessage, geminiMessages } = this._transformToGemini(currentMessages);
        const geminiTools = this._transformToolsToGemini(tools);

        const config = {};

        // Add system instruction if present
        if (systemMessage) {
          config.systemInstruction = {
            parts: [{ text: systemMessage.content }],
          };
        }

        // Add tools if present with proper toolConfig
        if (geminiTools && geminiTools.length > 0) {
          config.tools = [{ functionDeclarations: geminiTools }];

          // Add toolConfig for function calling mode
          config.toolConfig = {
            functionCallingConfig: {
              mode: 'AUTO', // Let Gemini decide when to call functions
            },
          };
        }

        const thinkingConfig = buildGeminiThinkingConfig(this.model, this.reasoningValue);
        if (thinkingConfig) {
          config.thinkingConfig = thinkingConfig;
        }

        const response = await this.client.models.generateContent({
          model: this.model,
          config: config,
          contents: geminiMessages,
        });

        // Extract text content
        const textContent = response.text || '';

        // Extract tool calls and thought signatures
        const toolCalls = this._extractToolCalls(response);

        // Extract thought signature from the first part (if present)
        let thoughtSignature = null;
        if (response.candidates && response.candidates[0] && response.candidates[0].content && response.candidates[0].content.parts) {
          const firstPart = response.candidates[0].content.parts[0];
          thoughtSignature = this._extractThoughtSignature(firstPart);
        }

        // Log successful retry if this wasn't the first attempt
        if (attempt > 0) {
          console.log(`Gemini call succeeded on attempt ${attempt + 1}/${this.maxRetries + 1}`);
        }

        const responseMessage = {
          role: 'assistant',
          content: textContent,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          _geminiThoughtSignature: thoughtSignature, // Store for next turn
        };

        const { message: normalizedMessage, wasEmpty } = BaseAdapter._normalizeAssistantResponse(responseMessage);
        if (wasEmpty) {
          console.warn('[Gemini] Provider returned empty response (no content, no tool calls) — padded for history safety');
        }

        // Extract Gemini usage metadata (including context-cache tokens when present)
        const geminiUsage = response.usageMetadata
          ? {
              prompt_tokens: response.usageMetadata.promptTokenCount || 0,
              completion_tokens: response.usageMetadata.candidatesTokenCount || 0,
              total_tokens: response.usageMetadata.totalTokenCount || 0,
              prompt_tokens_details: response.usageMetadata.cachedContentTokenCount
                ? { cached_tokens: response.usageMetadata.cachedContentTokenCount }
                : undefined,
            }
          : undefined;

        return {
          responseMessage: normalizedMessage,
          toolCalls: toolCalls,
          usage: geminiUsage,
          ...(wasEmpty ? { recoveredFromError: true, recoveredError: 'Provider returned empty response' } : {}),
        };
      } catch (error) {
        lastError = error;

        // Check if this is the last attempt or if the error is not retryable
        if (attempt === this.maxRetries || !this.isRetryableError(error)) {
          console.error(`Gemini call failed after ${attempt + 1} attempts, but NEVER STOPPING:`, {
            status: error.status || error.response?.status,
            message: error.message,
            retryable: this.isRetryableError(error),
          });

          // Parse the error to get a user-friendly message
          const userFriendlyError = parseApiErrorMessage(error);

          // NEVER STOP - return a recovery response instead of throwing
          return {
            responseMessage: {
              role: 'assistant',
              content: `⚠️ **Gemini API Error:** ${userFriendlyError}\n\nPlease check your API configuration or try a different provider.`,
              tool_calls: [],
            },
            toolCalls: [],
            recoveredFromError: true,
            recoveredError: error.message || 'Unknown error',
          };
        }

        // Calculate delay - use server-reported reset time for rate limit errors
        const quotaResetSeconds = this.isRateLimitError(error) ? this.parseQuotaResetSeconds(error) : 0;
        const delay = this.calculateDelay(attempt, quotaResetSeconds);

        if (this.isRateLimitError(error)) {
          console.warn(
            `[Gemini] Rate limit hit (attempt ${attempt + 1}/${this.maxRetries + 1}), waiting ${Math.round(delay / 1000)}s before retry${quotaResetSeconds ? ` (server says reset in ${quotaResetSeconds}s)` : ''}...`,
            {
              status: error.status || error.response?.status,
              message: error.message,
            },
          );
        } else {
          console.warn(`Gemini call failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${Math.round(delay)}ms:`, {
            status: error.status || error.response?.status,
            message: error.message,
          });
        }

        await this.sleep(delay);
      }
    }

    // Fallback recovery response
    console.error('Unexpected fallback in Gemini adapter, returning recovery response');
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
   * Makes a streaming call to the Gemini API with real-time token updates.
   * @param {Array<Object>} messages The conversation history.
   * @param {Array<Object>} tools The available tools in OpenAI format.
   * @param {Function} onChunk Callback for streaming chunks: (chunk) => void
   * @param {Object} context Optional context with imageData for vision
   * @returns {Promise<{responseMessage: Object, toolCalls: Array<Object>}>} A standardized response object.
   */
  async callStream(messages, tools, onChunk, context = {}) {
    let lastError;
    let currentMessages = messages;

    // Handle vision images - inject into the last user message if model supports vision
    if (context.imageData && context.imageData.length > 0) {
      // Extract provider from context or use 'gemini' for GeminiAdapter
      const provider = context.provider || 'gemini';

      // Check if this model supports vision (uses metadata variant fallback so
      // gemini-cli routing through Gemini adapter resolves to gemini metadata).
      const supportsVision = ProviderRegistry.supportsVision(provider, this.model);

      if (supportsVision) {
        currentMessages = JSON.parse(JSON.stringify(messages)); // Deep clone

        // Inject into the last user message that is NOT a tool_result carrier.
        // Gemini uses 'user' role for function responses too, so overwriting the
        // last user message can break tool-call/response pairing.
        const targetIdx = findLastInjectableUserIndex(currentMessages);
        if (targetIdx !== -1) {
          const originalContent = currentMessages[targetIdx].content;
          const contentParts = [{ type: 'text', text: originalContent }];
          context.imageData.forEach((img) => {
            contentParts.push({
              type: 'image',
              inlineData: {
                mimeType: img.type,
                data: img.data,
              },
            });
          });
          currentMessages[targetIdx].parts = contentParts;
          console.log(`[Gemini Vision] Added ${context.imageData.length} image(s) to user message at index ${targetIdx}`);
        } else {
          console.warn('[Gemini Vision] No injectable user message found (all user messages carry tool results); skipping image injection.');
        }
      } else {
        console.warn(`[Vision Check] Model '${this.model}' does not support vision. Images will be ignored.`);
        console.warn(`[Vision Check] Supported vision models for ${provider}: ${visionModels.join(', ')}`);
        console.warn(`[Vision Check] Consider using the 'analyze_image' tool or switching to a vision-capable model.`);
      }
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let accumulatedContent = '';
      let accumulatedToolCalls = [];
      let firstTextThoughtSignature = null;
      // Signatures observed on non-functionCall parts (e.g. preceding thought parts) waiting
      // to be paired with the next functionCall. Required because Gemini streaming sometimes
      // delivers thoughtSignature on a sibling/prior chunk rather than on the functionCall part itself.
      const pendingSignatures = [];

      try {
        const { systemMessage, geminiMessages } = this._transformToGemini(currentMessages);
        const geminiTools = this._transformToolsToGemini(tools);

        const config = {};

        // Add system instruction if present
        if (systemMessage) {
          config.systemInstruction = {
            parts: [{ text: systemMessage.content }],
          };
        }

        // Add tools if present
        if (geminiTools && geminiTools.length > 0) {
          config.tools = [{ functionDeclarations: geminiTools }];
        }

        const thinkingConfig = buildGeminiThinkingConfig(this.model, this.reasoningValue);
        if (thinkingConfig) {
          config.thinkingConfig = thinkingConfig;
        }

        const abortSignal = context.abortSignal;
        const response = await this.client.models.generateContentStream({
          model: this.model,
          config: config,
          contents: geminiMessages,
        });

        // Stream chunks — capture usageMetadata from the last chunk
        let geminiUsage = null;
        for await (const chunk of response) {
          if (abortSignal?.aborted) {
            console.log('[Gemini Stream] Aborted by client disconnect');
            break;
          }

          const delta = chunk.text || '';

          if (delta) {
            accumulatedContent += delta;

            if (onChunk) {
              onChunk({
                type: 'content',
                delta: delta,
                accumulated: accumulatedContent,
              });
            }
          }

          // Walk candidate parts so we capture per-call thoughtSignature for thinking models (Refs agnt-gg/agnt#35)
          const chunkParts = chunk?.candidates?.[0]?.content?.parts;
          if (Array.isArray(chunkParts) && chunkParts.length > 0) {
            // TEMP DIAGNOSTIC for issue #35 — dump raw chunk parts so we can confirm whether
            // the SDK is actually delivering thoughtSignature in streaming chunks. Remove once verified.
            const sigSummary = chunkParts.map((p, i) => {
              if (!p) return `${i}:null`;
              const kind = p.functionCall ? 'fc' : (p.text !== undefined ? 'text' : (p.thought ? 'thought' : 'other'));
              const sig = p.thoughtSignature || p.thought_signature;
              return `${i}:${kind}${sig ? '+sig(' + String(sig).substring(0, 12) + '...)' : ''}`;
            }).join(' | ');
            console.log(`[Gemini Stream DEBUG #35] chunk parts: ${sigSummary}`);
          }
          if (Array.isArray(chunkParts)) {
            for (const part of chunkParts) {
              if (!part) continue;
              const partSig = part.thoughtSignature || part.thought_signature || null;

              if (part.functionCall) {
                const fc = part.functionCall;
                const index = accumulatedToolCalls.length;
                const toolCall = {
                  id: `gemini-tool-${Date.now()}-${index}`,
                  type: 'function',
                  function: {
                    name: fc.name,
                    arguments: JSON.stringify(fc.args || {}),
                  },
                };
                // Prefer signature on this part, else drain a pending signature from earlier parts/chunks
                const sig = partSig || pendingSignatures.shift() || null;
                if (sig) {
                  toolCall._thoughtSignature = sig;
                }
                accumulatedToolCalls.push(toolCall);

                if (onChunk) {
                  onChunk({
                    type: 'tool_call_delta',
                    index: index,
                    toolCall: toolCall,
                  });
                }
                continue;
              }

              // Non-functionCall part: stash any signature for the next functionCall to consume.
              if (partSig) {
                if (firstTextThoughtSignature === null && part.text !== undefined) {
                  firstTextThoughtSignature = partSig;
                }
                pendingSignatures.push(partSig);
              }
            }
          } else if (chunk.functionCalls && Array.isArray(chunk.functionCalls)) {
            // Fallback: flat array shape (no signature info available)
            chunk.functionCalls.forEach((fc, index) => {
              const toolCall = {
                id: `gemini-tool-${Date.now()}-${index}`,
                type: 'function',
                function: {
                  name: fc.name,
                  arguments: JSON.stringify(fc.args || {}),
                },
              };

              accumulatedToolCalls.push(toolCall);

              if (onChunk) {
                onChunk({
                  type: 'tool_call_delta',
                  index: index,
                  toolCall: toolCall,
                });
              }
            });
          }

          // Capture usage metadata (typically present on the last chunk)
          if (chunk.usageMetadata) {
            geminiUsage = {
              prompt_tokens: chunk.usageMetadata.promptTokenCount || 0,
              completion_tokens: chunk.usageMetadata.candidatesTokenCount || 0,
              total_tokens: chunk.usageMetadata.totalTokenCount || 0,
              prompt_tokens_details: chunk.usageMetadata.cachedContentTokenCount
                ? { cached_tokens: chunk.usageMetadata.cachedContentTokenCount }
                : undefined,
            };
          }
        }

        // Log successful retry if this wasn't the first attempt
        if (attempt > 0) {
          console.log(`Gemini streaming call succeeded on attempt ${attempt + 1}/${this.maxRetries + 1}`);
        }

        // Backfill: if any tool call still lacks _thoughtSignature, drain remaining pending
        // signatures and finally fall back to firstTextThoughtSignature (Refs agnt-gg/agnt#35).
        // Gemini rejects round-tripped functionCall parts that lack thought_signature on thinking
        // models, so we'd rather attach a shared signature than send a bare part.
        const fallbackSig = firstTextThoughtSignature || null;
        let missingSigCount = 0;
        for (const tc of accumulatedToolCalls) {
          if (!tc._thoughtSignature) {
            tc._thoughtSignature = pendingSignatures.shift() || fallbackSig || null;
            if (!tc._thoughtSignature) missingSigCount++;
          }
        }
        if (missingSigCount > 0) {
          console.warn(`[Gemini Stream] ${missingSigCount}/${accumulatedToolCalls.length} tool call(s) have no thought_signature — multi-tool turns on thinking models may 400 on next round`);
        }

        const responseMessage = {
          role: 'assistant',
          content: accumulatedContent ?? null,
          tool_calls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
          _geminiThoughtSignature: firstTextThoughtSignature,
        };

        const { message: normalizedMessage, wasEmpty } = BaseAdapter._normalizeAssistantResponse(responseMessage);
        if (wasEmpty) {
          console.warn('[Gemini Stream] Provider returned empty response (no content, no tool calls) — padded for history safety');
        }

        return {
          responseMessage: normalizedMessage,
          toolCalls: accumulatedToolCalls,
          usage: geminiUsage || undefined,
          ...(wasEmpty ? { recoveredFromError: true, recoveredError: 'Provider returned empty response' } : {}),
        };
      } catch (error) {
        lastError = error;

        // Check if this is the last attempt or if the error is not retryable
        if (attempt === this.maxRetries || !this.isRetryableError(error)) {
          console.error(`Gemini streaming call failed after ${attempt + 1} attempts, but NEVER STOPPING:`, {
            status: error.status || error.response?.status,
            message: error.message,
          });

          // Parse the error to get a user-friendly message
          const userFriendlyError = parseApiErrorMessage(error);

          return {
            responseMessage: {
              role: 'assistant',
              content: `⚠️ **Gemini API Error:** ${userFriendlyError}\n\nPlease check your API configuration or try a different provider.`,
              tool_calls: [],
            },
            toolCalls: [],
            recoveredFromError: true,
            recoveredError: error.message || 'Unknown error',
          };
        }

        // Calculate delay - use server-reported reset time for rate limit errors
        const quotaResetSeconds = this.isRateLimitError(error) ? this.parseQuotaResetSeconds(error) : 0;
        const delay = this.calculateDelay(attempt, quotaResetSeconds);

        if (this.isRateLimitError(error)) {
          console.warn(
            `[Gemini] Rate limit hit (attempt ${attempt + 1}/${this.maxRetries + 1}), waiting ${Math.round(delay / 1000)}s before retry${quotaResetSeconds ? ` (server says reset in ${quotaResetSeconds}s)` : ''}...`,
            {
              status: error.status || error.response?.status,
              message: error.message,
            },
          );
        } else {
          console.warn(`Gemini streaming call failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${Math.round(delay)}ms:`, {
            status: error.status || error.response?.status,
            message: error.message,
          });
        }

        await this.sleep(delay);
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
    // Transform tool results into Gemini's expected format
    const geminiToolResults = toolExecutionResults.map((result) => {
      let content = result.content;

      // Parse content if it's a JSON string to get the actual result object
      try {
        const parsed = JSON.parse(content);
        content = parsed;
      } catch (e) {
        // Keep as string if not valid JSON
      }

      // CRITICAL FIX: The tool name is in result.name, NOT in tool_call_id
      // tool_call_id is like "gemini-tool-1234567890-0" but we need the actual function name
      const toolName = result.name;

      if (!toolName) {
        console.error('[Gemini] CRITICAL: Missing tool name in result:', result);
        console.error('[Gemini] Result keys:', Object.keys(result));
        console.error('[Gemini] This will cause Gemini to not recognize the tool response!');
      } else {
        console.log(`[Gemini] Formatting tool result for function: ${toolName}`);
      }

      return {
        functionResponse: {
          name: toolName,
          response: content, // Send the content directly, not wrapped in {result: ...}
        },
      };
    });

    console.log(`[Gemini] Formatted ${geminiToolResults.length} tool result(s) for Gemini`);

    // Gemini expects tool results in a 'user' role message with function responses
    return [
      {
        role: 'user',
        parts: geminiToolResults,
      },
    ];
  }
}

/**
 * Adapter for OpenAI's new Responses API (GPT-5, o-series models).
 *
 * The Responses API is a completely different API from Chat Completions:
 * - Endpoint: /v1/responses instead of /v1/chat/completions
 * - Input format: `input` (string or array) instead of `messages`
 * - System prompt: `instructions` parameter instead of system message
 * - Conversation state: Built-in via `previous_response_id` or `conversation`
 * - Reasoning: `reasoning` parameter with `effort` for o-series models
 *
 * Models that use this API:
 * - gpt-5, gpt-5.1-codex-max
 * - o1, o1-mini, o1-preview
 * - o3, o3-mini
 * - Any model with reasoning capabilities
 */
class OpenAIResponsesAdapter extends BaseAdapter {
  constructor(client, model, options = {}) {
    super(client, model);
    this.reasoningValue = options.reasoningValue || 'default';
    this.maxRetries = 3;
    this.baseDelay = 1000;
    this.retryableStatusCodes = new Set([429, 500, 502, 503, 504, 529]);

    // Models that support reasoning (o-series)
    this.reasoningModels = new Set(['o1', 'o1-mini', 'o1-preview', 'o3', 'o3-mini', 'o3-preview', 'gpt-5', 'gpt-5.1-codex-max']);
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
    const jitter = Math.random() * 0.1 * exponentialDelay;
    return Math.min(exponentialDelay + jitter, 30000);
  }

  /**
   * Check if an error is retryable
   */
  isRetryableError(error) {
    if (error.status && this.retryableStatusCodes.has(error.status)) {
      return true;
    }
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      return true;
    }
    return false;
  }

  /**
   * Check if the current model supports reasoning
   */
  supportsReasoning() {
    const modelLower = this.model.toLowerCase();
    return this.reasoningModels.has(this.model) || /^o\d/.test(modelLower) || modelLower.startsWith('gpt-5');
  }

  /**
   * Transform OpenAI Chat Completions messages to Responses API input format.
   * When imageData is provided, append input_image blocks to the last
   * injectable user message so vision-capable models (gpt-5.x, gpt-4o, o-series,
   * gpt-5.x-codex) can actually see uploaded images. Without this the
   * Responses API call would silently drop them — the parent chat-completions
   * adapter has its own image injection but this code path bypassed it.
   * https://developers.openai.com/api/docs/guides/images-vision
   */
  _transformMessagesToInput(messages, imageData = null) {
    // Extract system message as instructions
    const systemMessage = messages.find((m) => m.role === 'system');
    const instructions = systemMessage?.content || '';

    // Transform conversation messages to input items
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    const inputItems = conversationMessages.map((msg) => {
      // Handle tool results
      if (msg.role === 'tool') {
        return {
          type: 'function_call_output',
          call_id: msg.tool_call_id,
          output: msg.content,
        };
      }

      // Responses API stateless mode needs prior output items replayed
      // verbatim-ish, especially encrypted reasoning items before tool results.
      if (msg.role === 'assistant' && Array.isArray(msg._responsesOutputItems) && msg._responsesOutputItems.length > 0) {
        return this._sanitizeResponsesOutputItemsForInput(msg._responsesOutputItems);
      }

      // Handle assistant messages with tool calls
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        const items = [];

        // Add text content if present
        if (msg.content) {
          items.push({
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: msg.content }],
          });
        }

        // Add function calls
        msg.tool_calls.forEach((tc) => {
          items.push({
            type: 'function_call',
            call_id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          });
        });

        return items;
      }

      // Handle regular user/assistant messages
      const role = msg.role === 'assistant' ? 'assistant' : 'user';
      const contentType = msg.role === 'assistant' ? 'output_text' : 'input_text';

      return {
        type: 'message',
        role: role,
        content: [{ type: contentType, text: msg.content || '' }],
      };
    });

    // Flatten any nested arrays (from assistant messages with tool calls)
    const flattenedInput = inputItems.flat();

    // Inject input_image blocks into the last user message when imageData is present.
    // Match the chat-completions adapter's "skip tool_result carriers" behavior so we
    // don't clobber a tool_result-bearing user item.
    if (Array.isArray(imageData) && imageData.length > 0) {
      let targetIdx = -1;
      for (let i = flattenedInput.length - 1; i >= 0; i--) {
        const item = flattenedInput[i];
        if (item && item.type === 'message' && item.role === 'user') {
          targetIdx = i;
          break;
        }
      }
      if (targetIdx !== -1) {
        const targetItem = flattenedInput[targetIdx];
        const newContent = Array.isArray(targetItem.content) ? [...targetItem.content] : [];
        let appended = 0;
        imageData.forEach((img) => {
          if (img.unsupported || !img.type || !img.data) return;
          newContent.push({
            type: 'input_image',
            image_url: `data:${img.type};base64,${img.data}`,
          });
          appended++;
        });
        if (appended > 0) {
          flattenedInput[targetIdx] = { ...targetItem, content: newContent };
          console.log(`[OpenAI Responses Vision] Added ${appended}/${imageData.length} input_image block(s) to last user message`);
        } else {
          console.warn('[OpenAI Responses Vision] All images marked unsupported or empty; nothing injected.');
        }
      } else {
        console.warn('[OpenAI Responses Vision] No injectable user message found; skipping image injection.');
      }
    }

    return { instructions, input: flattenedInput };
  }

  _sanitizeResponsesOutputItemsForInput(outputItems) {
    if (!Array.isArray(outputItems)) return [];

    return outputItems
      .map((item) => {
        if (!item || typeof item !== 'object') return null;

        if (item.type === 'reasoning') {
          return {
            type: 'reasoning',
            id: item.id,
            summary: Array.isArray(item.summary) ? item.summary : [],
            ...(item.encrypted_content ? { encrypted_content: item.encrypted_content } : {}),
            ...(item.status ? { status: item.status } : {}),
          };
        }

        if (item.type === 'function_call') {
          return {
            type: 'function_call',
            call_id: item.call_id,
            name: item.name || '',
            arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {}),
            ...(item.id ? { id: item.id } : {}),
            ...(item.status ? { status: item.status } : {}),
          };
        }

        if (item.type === 'message' && item.role === 'assistant') {
          const content = Array.isArray(item.content)
            ? item.content
                .filter((part) => part && part.type === 'output_text')
                .map((part) => ({
                  type: 'output_text',
                  text: part.text || '',
                  ...(Array.isArray(part.annotations) ? { annotations: part.annotations } : {}),
                }))
            : [];

          if (content.length === 0) return null;
          return {
            type: 'message',
            role: 'assistant',
            content,
            ...(item.id ? { id: item.id } : {}),
            ...(item.status ? { status: item.status } : {}),
          };
        }

        return null;
      })
      .filter(Boolean);
  }

  _extractReplayableOutputItems(output) {
    if (!Array.isArray(output)) return undefined;
    const replayable = this._sanitizeResponsesOutputItemsForInput(output);
    return replayable.length > 0 ? replayable : undefined;
  }

  /**
   * Recursively sanitize a JSON Schema so the Responses API accepts it.
   * - Ensures every "type": "array" has an "items" field.
   * - Strips non-standard keys the Responses API rejects.
   */
  _sanitizeSchema(schema) {
    if (!schema || typeof schema !== 'object') return schema;

    if (Array.isArray(schema)) {
      return schema.map((item) => this._sanitizeSchema(item));
    }

    const result = { ...schema };

    // Array type must have items
    if (result.type === 'array' && !result.items) {
      result.items = { type: 'string' };
    }

    // Recurse into items
    if (result.items) {
      result.items = this._sanitizeSchema(result.items);
    }

    // Recurse into properties
    if (result.properties) {
      const sanitized = {};
      for (const [key, value] of Object.entries(result.properties)) {
        sanitized[key] = this._sanitizeSchema(value);
      }
      result.properties = sanitized;
    }

    // Recurse into additionalProperties if it's a schema
    if (result.additionalProperties && typeof result.additionalProperties === 'object') {
      result.additionalProperties = this._sanitizeSchema(result.additionalProperties);
    }

    return result;
  }

  /**
   * Transform OpenAI tools format to Responses API format
   */
  _transformToolsToResponses(tools) {
    if (!tools || tools.length === 0) return undefined;

    return tools.map((tool) => ({
      type: 'function',
      name: tool.function.name,
      description: tool.function.description || '',
      parameters: this._sanitizeSchema(tool.function.parameters),
    }));
  }

  /**
   * Extract tool calls from Responses API output
   */
  _extractToolCalls(output) {
    const toolCalls = [];

    if (!output || !Array.isArray(output)) return toolCalls;

    output.forEach((item, index) => {
      if (item.type === 'function_call') {
        toolCalls.push({
          id: item.call_id || item.id || `responses-tool-${Date.now()}-${index}`,
          type: 'function',
          function: {
            name: item.name,
            arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {}),
          },
        });
      }
    });

    return toolCalls;
  }

  /**
   * Extract text content from Responses API output
   */
  _extractTextContent(output) {
    if (!output || !Array.isArray(output)) return '';

    let textContent = '';

    output.forEach((item) => {
      if (item.type === 'message' && item.role === 'assistant') {
        if (item.content && Array.isArray(item.content)) {
          item.content.forEach((contentItem) => {
            if (contentItem.type === 'output_text' && contentItem.text) {
              textContent += contentItem.text;
            }
          });
        }
      }
    });

    return textContent;
  }

  async call(messages, tools) {
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const { instructions, input } = this._transformMessagesToInput(messages);
        const responsesTools = this._transformToolsToResponses(tools);

        const requestParams = {
          model: this.model,
          input: input,
          store: false, // Don't store responses by default
        };

        if (this.supportsReasoning()) {
          requestParams.include = ['reasoning.encrypted_content'];
        }

        // Add instructions if present
        if (instructions) {
          requestParams.instructions = instructions;
        }

        // Add tools if present
        if (responsesTools && responsesTools.length > 0) {
          requestParams.tools = responsesTools;
        }

        if (this.supportsReasoning()) {
          requestParams.reasoning = buildResponsesReasoningConfig(this.model, this.reasoningValue) || { effort: 'medium' };
        }

        console.log(`[OpenAI Responses] Calling model '${this.model}' with Responses API`);
        console.log(`[OpenAI Responses] Input items: ${input.length}, Tools: ${responsesTools?.length || 0}`);

        const response = await this.client.responses.create(requestParams);

        // Extract content and tool calls from response
        const textContent = this._extractTextContent(response.output);
        const toolCalls = this._extractToolCalls(response.output);

        if (attempt > 0) {
          console.log(`OpenAI Responses call succeeded on attempt ${attempt + 1}/${this.maxRetries + 1}`);
        }

        const responseMessage = {
          role: 'assistant',
          content: textContent ?? null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          _responsesOutputItems: this._extractReplayableOutputItems(response.output),
        };

        const { message: normalizedMessage, wasEmpty } = BaseAdapter._normalizeAssistantResponse(responseMessage);
        if (wasEmpty) {
          console.warn('[OpenAI Responses] Provider returned empty response (no content, no tool calls) — padded for history safety');
        }

        return {
          responseMessage: normalizedMessage,
          toolCalls: toolCalls,
          _responsesApiId: response.id, // Store for potential conversation continuation
          usage: response.usage || undefined,
          ...(wasEmpty ? { recoveredFromError: true, recoveredError: 'Provider returned empty response' } : {}),
        };
      } catch (error) {
        lastError = error;

        if (attempt === this.maxRetries || !this.isRetryableError(error)) {
          console.error(`OpenAI Responses call failed after ${attempt + 1} attempts, but NEVER STOPPING:`, {
            status: error.status,
            message: error.message,
          });

          const userFriendlyError = parseApiErrorMessage(error);

          return {
            responseMessage: {
              role: 'assistant',
              content: `⚠️ **OpenAI Responses API Error:** ${userFriendlyError}\n\nThis model (${this.model}) uses OpenAI's new Responses API. Please check your API configuration or try a different model.`,
              tool_calls: [],
            },
            toolCalls: [],
            recoveredFromError: true,
            recoveredError: error.message || 'Unknown error',
          };
        }

        const delay = this.calculateDelay(attempt);
        console.warn(`OpenAI Responses call failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${Math.round(delay)}ms:`, {
          status: error.status,
          message: error.message,
        });

        await this.sleep(delay);
      }
    }

    return {
      responseMessage: {
        role: 'assistant',
        content: "I encountered an unexpected error with the OpenAI Responses API, but I'm still here to help. Please try your request again.",
        tool_calls: [],
      },
      toolCalls: [],
      recoveredFromError: true,
    };
  }

  /**
   * Makes a streaming call to the OpenAI Responses API
   */
  async callStream(messages, tools, onChunk, context = {}) {
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let accumulatedContent = '';
      let accumulatedToolCalls = [];
      let streamUsage = null;
      let replayableOutputItems = undefined;

      try {
        // Gate vision injection on the model's vision capability; non-vision models
        // shouldn't receive input_image blocks (Responses API will 400).
        // supportsVision() uses getModelMetadata's variant fallback so future
        // gpt-5.x / o-series models work without manual list maintenance.
        const visionOk = ProviderRegistry.supportsVision('openai', this.model);
        const imageDataForInput = (Array.isArray(context.imageData) && context.imageData.length > 0 && visionOk)
          ? context.imageData
          : null;
        if (Array.isArray(context.imageData) && context.imageData.length > 0 && !visionOk) {
          console.warn(`[Vision Check] OpenAI model '${this.model}' does not support vision; ignoring ${context.imageData.length} image(s).`);
        }
        const { instructions, input } = this._transformMessagesToInput(messages, imageDataForInput);
        const responsesTools = this._transformToolsToResponses(tools);

        const requestParams = {
          model: this.model,
          input: input,
          stream: true,
          store: false,
        };

        if (this.supportsReasoning()) {
          requestParams.include = ['reasoning.encrypted_content'];
        }

        if (instructions) {
          requestParams.instructions = instructions;
        }

        if (responsesTools && responsesTools.length > 0) {
          requestParams.tools = responsesTools;
        }

        if (this.supportsReasoning()) {
          requestParams.reasoning = buildResponsesReasoningConfig(this.model, this.reasoningValue) || { effort: 'medium' };
        }

        console.log(`[OpenAI Responses] Streaming call to model '${this.model}'`);

        const abortSignal = context.abortSignal;
        const stream = await this.client.responses.create(requestParams);

        // Handle streaming events
        for await (const event of stream) {
          if (abortSignal?.aborted) {
            console.log('[OpenAI Responses Stream] Aborted by client disconnect');
            break;
          }

          // Handle different event types from Responses API
          if (event.type === 'response.output_item.added') {
            // New output item started
            const item = event.item;
            if (item.type === 'function_call') {
              accumulatedToolCalls.push({
                id: item.call_id || `responses-tool-${Date.now()}-${accumulatedToolCalls.length}`,
                type: 'function',
                function: {
                  name: item.name || '',
                  arguments: '',
                },
              });
            }
          } else if (event.type === 'response.output_text.delta') {
            // Text content delta
            const delta = event.delta || '';
            accumulatedContent += delta;

            if (onChunk) {
              onChunk({
                type: 'content',
                delta: delta,
                accumulated: accumulatedContent,
              });
            }
          } else if (event.type === 'response.function_call_arguments.delta') {
            // Function call arguments delta
            const delta = event.delta || '';
            const lastToolCall = accumulatedToolCalls[accumulatedToolCalls.length - 1];
            if (lastToolCall) {
              lastToolCall.function.arguments += delta;

              if (onChunk) {
                onChunk({
                  type: 'tool_call_delta',
                  index: accumulatedToolCalls.length - 1,
                  toolCall: lastToolCall,
                });
              }
            }
          } else if (event.type === 'response.function_call_arguments.done') {
            // Function call complete
            const lastToolCall = accumulatedToolCalls[accumulatedToolCalls.length - 1];
            if (lastToolCall && onChunk) {
              onChunk({
                type: 'tool_call_delta',
                index: accumulatedToolCalls.length - 1,
                toolCall: lastToolCall,
              });
            }
          } else if (event.type === 'response.completed') {
            // Response complete - extract any remaining data
            if (event.response && event.response.output) {
              const finalToolCalls = this._extractToolCalls(event.response.output);
              if (finalToolCalls.length > accumulatedToolCalls.length) {
                accumulatedToolCalls = finalToolCalls;
              }
              replayableOutputItems = this._extractReplayableOutputItems(event.response.output);
            }
            // Capture usage from completed response
            if (event.response && event.response.usage) {
              streamUsage = event.response.usage;
            }
          }
        }

        if (attempt > 0) {
          console.log(`OpenAI Responses streaming call succeeded on attempt ${attempt + 1}/${this.maxRetries + 1}`);
        }

        const responseMessage = {
          role: 'assistant',
          content: accumulatedContent ?? null,
          tool_calls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
          _responsesOutputItems: replayableOutputItems,
        };

        const { message: normalizedMessage, wasEmpty } = BaseAdapter._normalizeAssistantResponse(responseMessage);
        if (wasEmpty) {
          console.warn('[OpenAI Responses Stream] Provider returned empty response (no content, no tool calls) — padded for history safety');
        }

        return {
          responseMessage: normalizedMessage,
          toolCalls: accumulatedToolCalls,
          usage: streamUsage || undefined,
          ...(wasEmpty ? { recoveredFromError: true, recoveredError: 'Provider returned empty response' } : {}),
        };
      } catch (error) {
        lastError = error;

        if (attempt === this.maxRetries || !this.isRetryableError(error)) {
          console.error(`OpenAI Responses streaming call failed after ${attempt + 1} attempts, but NEVER STOPPING:`, {
            status: error.status,
            message: error.message,
          });

          const userFriendlyError = parseApiErrorMessage(error);

          return {
            responseMessage: {
              role: 'assistant',
              content: `⚠️ **OpenAI Responses API Error:** ${userFriendlyError}\n\nThis model (${this.model}) uses OpenAI's new Responses API. Please check your API configuration or try a different model.`,
              tool_calls: [],
            },
            toolCalls: [],
            recoveredFromError: true,
            recoveredError: error.message || 'Unknown error',
          };
        }

        const delay = this.calculateDelay(attempt);
        console.warn(`OpenAI Responses streaming call failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${Math.round(delay)}ms`);
        await this.sleep(delay);
      }
    }

    return {
      responseMessage: {
        role: 'assistant',
        content: "I encountered an unexpected error with the OpenAI Responses API, but I'm still here to help. Please try your request again.",
        tool_calls: [],
      },
      toolCalls: [],
      recoveredFromError: true,
    };
  }

  formatToolResults(toolExecutionResults) {
    // Transform tool results to Responses API format
    // Tool results are sent as function_call_output items in the next request
    return toolExecutionResults.map((result) => ({
      role: 'tool',
      tool_call_id: result.tool_call_id,
      content: result.content,
      name: result.name,
    }));
  }
}

/**
 * CodexResponsesAdapter — Specialized adapter for the ChatGPT backend Codex Responses API.
 *
 * The Codex OAuth token authorizes against chatgpt.com/backend-api/codex/responses,
 * which has a slightly different request format from the standard OpenAI Responses API:
 * - Always includes `include: ["reasoning.encrypted_content"]`
 * - Uses `reasoning.summary` in addition to `reasoning.effort`
 * - Adds `text.verbosity` for output control
 * - Uses `tool_choice: "auto"` and `parallel_tool_calls: true` when tools are present
 * - Always sends `instructions` (even empty string) and `store: false`
 * - ALWAYS streams (endpoint requires `stream: true`); non-streaming call() collects internally
 */
class CodexResponsesAdapter extends OpenAIResponsesAdapter {
  constructor(client, model, options = {}) {
    super(client, model, options);
    // Codex reasoning models — match by prefix so new models work automatically
    this.reasoningModels = new Set();
    // The ChatGPT backend hiccups (transient 5xx with the generic
    // "An error occurred while processing your request" envelope) more often
    // than api.openai.com. Give Codex more retry budget so a brief upstream
    // blip doesn't surface to the user as a hard error.
    this.maxRetries = 5;
    // Bounded shrink budget for context-window recovery. Each shrink drops
    // one whole oldest turn (assistant + paired tool results, together with
    // its replayable _responsesOutputItems blob). 8 turns is enough to
    // recover from the deepest realistic overrun while preventing runaway
    // loops on a misclassified error.
    this.maxContextShrinkRetries = 8;
  }

  _getCodexContextWindow() {
    const meta = getModelMetadata('openai-codex', this.model);
    if (meta?.contextWindow) return meta.contextWindow;
    if (/^gpt-5/i.test(this.model)) return 400_000;
    return 128_000;
  }

  _getCodexPreflightInputBudget() {
    // The ChatGPT Codex backend counts Responses framing, tool schemas, and
    // encrypted reasoning replay much higher than our message estimator. Keep
    // a large response/reasoning reserve and a conservative serialized-payload
    // margin so oversized stateless replay is shed before the stream starts.
    const contextWindow = this._getCodexContextWindow();
    const outputReserve = Math.min(96_000, Math.floor(contextWindow * 0.25));
    return Math.max(16_000, Math.floor((contextWindow - outputReserve) * 0.86));
  }

  _estimateCodexRequestTokens(params) {
    if (!params) return 0;
    let serialized;
    try {
      serialized = JSON.stringify(params);
    } catch {
      serialized = String(params);
    }

    // This intentionally overestimates compared with normal prose tokenizers.
    // Codex replay payloads contain JSON, base64-ish encrypted blobs, and
    // escaped function arguments, and production logs showed ~2x undercounts
    // when using the shared chars/3.5 estimator.
    return Math.ceil(serialized.length / 1.6);
  }

  _buildCodexParamsWithinBudget(messages, tools, imageData = null, logPrefix = 'Codex Responses') {
    let workingMessages = messages;
    let params = this._buildCodexParams(workingMessages, tools, imageData);
    const budget = this._getCodexPreflightInputBudget();
    let estimatedTokens = this._estimateCodexRequestTokens(params);
    let shrinkAttempts = 0;

    while (estimatedTokens > budget && shrinkAttempts < this.maxContextShrinkRetries) {
      const shrunk = this._dropOldestTurn(workingMessages);
      if (shrunk.length === workingMessages.length) break;

      console.warn(
        `[${logPrefix} Preflight] Serialized request estimate ${estimatedTokens} exceeds budget ${budget}; ` +
        `shed oldest turn (${workingMessages.length} -> ${shrunk.length} messages), ` +
        `retrying build (shrink ${shrinkAttempts + 1}/${this.maxContextShrinkRetries})`
      );

      workingMessages = shrunk;
      params = this._buildCodexParams(workingMessages, tools, imageData);
      estimatedTokens = this._estimateCodexRequestTokens(params);
      shrinkAttempts++;
    }

    if (estimatedTokens > budget) {
      console.warn(
        `[${logPrefix} Preflight] Serialized request estimate ${estimatedTokens} still exceeds budget ${budget}; ` +
        'sending smallest safe message set available'
      );
    }

    return { params, workingMessages, estimatedTokens, budget, shrinkAttempts };
  }

  /**
   * Detect Codex / Responses API rejections caused by the input exceeding
   * the model's context window. The ChatGPT backend phrases this several
   * ways depending on whether the rejection comes from quota checking,
   * pre-flight token estimation, or the model itself.
   */
  _isContextWindowError(error) {
    if (!error) return false;
    const message = String(error?.message || error?.error?.message || '').toLowerCase();
    if (!message) return false;
    return (
      message.includes('exceeds the context window') ||
      message.includes('exceeds context window') ||
      message.includes('context_length_exceeded') ||
      message.includes('context length exceeded') ||
      message.includes('maximum context length') ||
      message.includes('input is too long') ||
      message.includes('input too long')
    );
  }

  /**
   * Return a new messages array with the oldest droppable atomic turn removed.
   *
   * An assistant message with tool_calls + its following role:'tool' messages
   * form one atomic turn that must stay together (or be dropped together) so
   * tool_call_ids never orphan their results — and so the encrypted reasoning
   * blob in _responsesOutputItems is dropped alongside its own turn, never
   * re-stitched into a stranger's context (which would violate the Codex
   * protocol).
   *
   * The most recent user message is pinned: it is the question the assistant
   * is currently answering, and dropping it makes any follow-up reply
   * incoherent (Annie ends up with no idea what she was asked, so she falls
   * back to greeting the user from the system-prompt page context). The
   * scanner skips that pinned unit and keeps searching for an older,
   * droppable one — and gives up rather than dropping it.
   *
   * Returns the input unchanged when no droppable older turn exists.
   */
  _dropOldestTurn(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return messages;

    // Find the index of the most recent user message — this is the turn we
    // refuse to shed even if it is the oldest remaining non-system unit.
    let pinnedUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user') { pinnedUserIdx = i; break; }
    }

    let cursor = 0;
    while (cursor < messages.length) {
      const firstNonSystemIdx = messages.findIndex(
        (m, i) => i >= cursor && m && m.role !== 'system',
      );
      if (firstNonSystemIdx === -1) return messages;

      const head = messages[firstNonSystemIdx];
      let unitEnd = firstNonSystemIdx + 1;
      if (head.role === 'assistant' && Array.isArray(head.tool_calls) && head.tool_calls.length > 0) {
        while (unitEnd < messages.length && messages[unitEnd]?.role === 'tool') {
          unitEnd++;
        }
      }

      // Skip the pinned user message and continue scanning for an older
      // droppable unit. Without this, in a fresh chat where [system, user, …]
      // is over budget, the shedder ate the user's question on retry #2.
      if (firstNonSystemIdx === pinnedUserIdx) {
        cursor = unitEnd;
        continue;
      }

      // Refuse to drop if doing so would leave no non-system content at all.
      const remaining = [
        ...messages.slice(0, firstNonSystemIdx),
        ...messages.slice(unitEnd),
      ];
      const hasNonSystemAfter = remaining.some((m) => m && m.role !== 'system');
      if (!hasNonSystemAfter) return messages;

      return remaining;
    }

    return messages;
  }

  /**
   * All gpt-5+ and o-series Codex models support reasoning.
   */
  supportsReasoning() {
    const m = this.model.toLowerCase();
    return m.startsWith('gpt-5') || /^o\d/.test(m);
  }

  /**
   * Codex-specific retry detection. Beyond the parent's status-code and
   * connection-code checks, treat the ChatGPT backend's generic-error envelope
   * as retryable — those are upstream hiccups that clear on retry, but the
   * SDK frequently throws them without `error.status` populated (mid-stream
   * SSE errors), which means the parent's status-based check misses them and
   * the user sees the wrapped error after a single attempt.
   */
  isRetryableError(error) {
    if (super.isRetryableError(error)) return true;
    const message = String(error?.message || '').toLowerCase();
    if (
      message.includes('an error occurred while processing your request') ||
      message.includes('terminated') ||
      message.includes('premature close') ||
      message.includes('aborted') ||
      message.includes('internal server error') ||
      message.includes('bad gateway') ||
      message.includes('service unavailable') ||
      message.includes('gateway timeout') ||
      message.includes('overloaded') ||
      message.includes('temporarily unavailable')
    ) {
      return true;
    }
    return false;
  }

  /**
   * Build Codex-specific request parameters.
   * Always includes `stream: true` because the ChatGPT backend rejects non-streaming requests.
   * imageData (when provided) is forwarded into the parent transform so vision
   * models like gpt-5.2-codex see uploaded images via input_image blocks.
   */
  _buildCodexParams(messages, tools, imageData = null) {
    // Codex models (gpt-5.x-codex, gpt-5.5, etc.) inherit OpenAI's vision
    // capability via getModelMetadata's variant fallback chain. Use
    // supportsVision() so we don't have to manually enumerate every Codex
    // model in providerConfigs.fallbackVisionModels.
    const visionOk = ProviderRegistry.supportsVision('openai-codex', this.model);
    const imageDataForInput = (Array.isArray(imageData) && imageData.length > 0 && visionOk)
      ? imageData
      : null;
    if (Array.isArray(imageData) && imageData.length > 0 && !visionOk) {
      console.warn(`[Vision Check] Codex model '${this.model}' is not vision-capable per metadata; ignoring ${imageData.length} image(s).`);
    }
    const { instructions, input } = this._transformMessagesToInput(messages, imageDataForInput);
    const responsesTools = this._transformToolsToResponses(tools);

    const params = {
      model: this.model,
      input: input,
      instructions: instructions || '', // Codex always expects instructions field
      store: false,
      stream: true, // ChatGPT backend REQUIRES streaming
      include: ['reasoning.encrypted_content'],
    };

    // Codex backend rejects requests without reasoning.effort for gpt-5.x-codex
    // models with a 400 (no body). When the user's reasoningValue is 'default'
    // (or unset by background callers like InsightEngine), buildResponsesReasoningConfig
    // returns null — fall back to the Codex CLI's documented default effort.
    if (this.supportsReasoning()) {
      const reasoningConfig = buildResponsesReasoningConfig(this.model, this.reasoningValue) || { effort: 'medium' };
      params.reasoning = { ...reasoningConfig, summary: 'auto' };
    }

    // Add text verbosity control
    params.text = {
      verbosity: 'medium',
    };

    // Add tools if present
    if (responsesTools && responsesTools.length > 0) {
      params.tools = responsesTools.map((tool) => ({
        ...tool,
        strict: null, // Codex uses null instead of false
      }));
      params.tool_choice = 'auto';
      params.parallel_tool_calls = true;
    }

    return params;
  }

  /**
   * Consume a streaming response and return accumulated results.
   * Used by both call() and callStream() to process SSE events.
   */
  async _consumeStream(stream, onChunk = null, abortSignal = null) {
    let accumulatedContent = '';
    let accumulatedToolCalls = [];
    let responseId = null;
    let streamUsage = null;
    let replayableOutputItems = undefined;

    for await (const event of stream) {
      if (abortSignal?.aborted) {
        console.log('[Codex Stream] Aborted by client disconnect');
        break;
      }

      if (event.type === 'response.output_item.added') {
        const item = event.item;
        if (item.type === 'function_call') {
          accumulatedToolCalls.push({
            id: item.call_id || `codex-tool-${Date.now()}-${accumulatedToolCalls.length}`,
            type: 'function',
            function: {
              name: item.name || '',
              arguments: '',
            },
          });
        }
      } else if (event.type === 'response.output_text.delta') {
        const delta = event.delta || '';
        accumulatedContent += delta;
        if (onChunk) {
          onChunk({ type: 'content', delta, accumulated: accumulatedContent });
        }
      } else if (event.type === 'response.function_call_arguments.delta') {
        const delta = event.delta || '';
        const lastToolCall = accumulatedToolCalls[accumulatedToolCalls.length - 1];
        if (lastToolCall) {
          lastToolCall.function.arguments += delta;
          if (onChunk) {
            onChunk({ type: 'tool_call_delta', index: accumulatedToolCalls.length - 1, toolCall: lastToolCall });
          }
        }
      } else if (event.type === 'response.function_call_arguments.done') {
        const lastToolCall = accumulatedToolCalls[accumulatedToolCalls.length - 1];
        if (lastToolCall && onChunk) {
          onChunk({ type: 'tool_call_delta', index: accumulatedToolCalls.length - 1, toolCall: lastToolCall });
        }
      } else if (event.type === 'response.completed') {
        responseId = event.response?.id || null;
        if (event.response && event.response.output) {
          const finalToolCalls = this._extractToolCalls(event.response.output);
          if (finalToolCalls.length > accumulatedToolCalls.length) {
            accumulatedToolCalls = finalToolCalls;
          }
          replayableOutputItems = this._extractReplayableOutputItems(event.response.output);
        }
        // Extract usage from completed response
        if (event.response && event.response.usage) {
          streamUsage = event.response.usage;
        }
      }
    }

    return { accumulatedContent, accumulatedToolCalls, responseId, usage: streamUsage || undefined, replayableOutputItems };
  }

  /**
   * Non-streaming call — uses streaming internally since the Codex endpoint requires it,
   * then returns the assembled response.
   */
  async call(messages, tools) {
    let lastError;
    let workingMessages = messages;
    let shrinkAttempts = 0;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const preflight = this._buildCodexParamsWithinBudget(workingMessages, tools, null, 'Codex Responses');
        const params = preflight.params;
        workingMessages = preflight.workingMessages;

        console.log(`[Codex Responses] Calling model '${this.model}' via ChatGPT backend (streaming internally)`);
        console.log(`[Codex Responses] Input items: ${params.input.length}, Tools: ${params.tools?.length || 0}`);

        const stream = await this.client.responses.create(params);
        const { accumulatedContent, accumulatedToolCalls, responseId, usage, replayableOutputItems } = await this._consumeStream(stream);

        if (attempt > 0) {
          console.log(`Codex Responses call succeeded on attempt ${attempt + 1}/${this.maxRetries + 1}`);
        }

        const codexResponseMessage = {
          role: 'assistant',
          content: accumulatedContent ?? null,
          tool_calls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
          _responsesOutputItems: replayableOutputItems,
        };
        const { message: normalizedMessage, wasEmpty } = BaseAdapter._normalizeAssistantResponse(codexResponseMessage);
        if (wasEmpty) {
          console.warn('[Codex Responses] Provider returned empty response (no content, no tool calls) — padded for history safety');
        }

        return {
          responseMessage: normalizedMessage,
          toolCalls: accumulatedToolCalls,
          _responsesApiId: responseId,
          usage,
          ...(wasEmpty ? { recoveredFromError: true, recoveredError: 'Provider returned empty response' } : {}),
        };
      } catch (error) {
        lastError = error;

        // Context-window overrun: shed the oldest atomic turn (which drops
        // its _responsesOutputItems blob with it — protocol safe; we never
        // touch encrypted_content internals) and retry without consuming
        // the transient-error retry budget or waiting on backoff.
        if (shrinkAttempts < this.maxContextShrinkRetries && this._isContextWindowError(error)) {
          const shrunk = this._dropOldestTurn(workingMessages);
          if (shrunk.length < workingMessages.length) {
            console.warn(
              `[Codex Responses] Input exceeds context window; shed oldest turn ` +
              `(${workingMessages.length} -> ${shrunk.length} messages), ` +
              `retrying (shrink ${shrinkAttempts + 1}/${this.maxContextShrinkRetries})`
            );
            workingMessages = shrunk;
            shrinkAttempts++;
            attempt--; // do not consume the transient-error retry budget
            continue;
          }
          // Cannot shrink further — fall through to normal error handling
          console.warn('[Codex Responses] Context-window error but no more turns to shed');
        }

        if (attempt === this.maxRetries || !this.isRetryableError(error)) {
          console.error(
            `Codex Responses call failed after ${attempt + 1} attempts, but NEVER STOPPING:`,
            describeCodexError(error),
          );

          const userFriendlyError = parseApiErrorMessage(error);

          return {
            responseMessage: {
              role: 'assistant',
              content: `⚠️ **Codex Responses API Error:** ${userFriendlyError}\n\n${buildCodexErrorGuidance(error, this.model)}`,
              tool_calls: [],
            },
            toolCalls: [],
            recoveredFromError: true,
            recoveredError: error.message || 'Unknown error',
          };
        }

        const delay = this.calculateDelay(attempt);
        console.warn(`Codex Responses call failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${Math.round(delay)}ms:`, {
          status: error.status,
          message: error.message,
        });

        await this.sleep(delay);
      }
    }

    return {
      responseMessage: {
        role: 'assistant',
        content: "I encountered an unexpected error with the Codex Responses API, but I'm still here to help. Please try your request again.",
        tool_calls: [],
      },
      toolCalls: [],
      recoveredFromError: true,
    };
  }

  /**
   * Streaming call — passes chunks to onChunk callback as they arrive.
   */
  async callStream(messages, tools, onChunk, context = {}) {
    let lastError;
    let workingMessages = messages;
    let shrinkAttempts = 0;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const preflight = this._buildCodexParamsWithinBudget(workingMessages, tools, context.imageData, 'Codex Responses Stream');
        const params = preflight.params;
        workingMessages = preflight.workingMessages;

        console.log(`[Codex Responses] Streaming call to model '${this.model}' via ChatGPT backend`);

        const abortSignal = context.abortSignal;
        const stream = await this.client.responses.create(params);
        const { accumulatedContent, accumulatedToolCalls, usage, replayableOutputItems } = await this._consumeStream(stream, onChunk, abortSignal);

        if (attempt > 0) {
          console.log(`Codex Responses streaming call succeeded on attempt ${attempt + 1}/${this.maxRetries + 1}`);
        }

        const codexStreamResponseMessage = {
          role: 'assistant',
          content: accumulatedContent ?? null,
          tool_calls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
          _responsesOutputItems: replayableOutputItems,
        };
        const { message: normalizedMessage, wasEmpty } = BaseAdapter._normalizeAssistantResponse(codexStreamResponseMessage);
        if (wasEmpty) {
          console.warn('[Codex Responses Stream] Provider returned empty response (no content, no tool calls) — padded for history safety');
        }

        return {
          responseMessage: normalizedMessage,
          toolCalls: accumulatedToolCalls,
          usage,
          ...(wasEmpty ? { recoveredFromError: true, recoveredError: 'Provider returned empty response' } : {}),
        };
      } catch (error) {
        lastError = error;

        // Context-window overrun: shed the oldest atomic turn (which drops
        // its _responsesOutputItems blob with it — protocol safe; we never
        // touch encrypted_content internals) and retry without consuming
        // the transient-error retry budget or waiting on backoff.
        if (shrinkAttempts < this.maxContextShrinkRetries && this._isContextWindowError(error)) {
          const shrunk = this._dropOldestTurn(workingMessages);
          if (shrunk.length < workingMessages.length) {
            console.warn(
              `[Codex Responses Stream] Input exceeds context window; shed oldest turn ` +
              `(${workingMessages.length} -> ${shrunk.length} messages), ` +
              `retrying (shrink ${shrinkAttempts + 1}/${this.maxContextShrinkRetries})`
            );
            workingMessages = shrunk;
            shrinkAttempts++;
            attempt--; // do not consume the transient-error retry budget
            continue;
          }
          // Cannot shrink further — fall through to normal error handling
          console.warn('[Codex Responses Stream] Context-window error but no more turns to shed');
        }

        if (attempt === this.maxRetries || !this.isRetryableError(error)) {
          console.error(
            `Codex Responses streaming call failed after ${attempt + 1} attempts, but NEVER STOPPING:`,
            describeCodexError(error),
          );

          const userFriendlyError = parseApiErrorMessage(error);

          return {
            responseMessage: {
              role: 'assistant',
              content: `⚠️ **Codex Responses API Error:** ${userFriendlyError}\n\n${buildCodexErrorGuidance(error, this.model)}`,
              tool_calls: [],
            },
            toolCalls: [],
            recoveredFromError: true,
            recoveredError: error.message || 'Unknown error',
          };
        }

        const delay = this.calculateDelay(attempt);
        console.warn(`Codex Responses streaming call failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${Math.round(delay)}ms`);
        await this.sleep(delay);
      }
    }

    return {
      responseMessage: {
        role: 'assistant',
        content: "I encountered an unexpected error with the Codex Responses API, but I'm still here to help. Please try your request again.",
        tool_calls: [],
      },
      toolCalls: [],
      recoveredFromError: true,
    };
  }
}

/**
 * Check if a model requires the OpenAI Responses API instead of Chat Completions
 * @param {string} model The model name
 * @returns {boolean} True if the model uses the Responses API
 */
function requiresResponsesApi(model) {
  if (!model) return false;

  const modelLower = model.toLowerCase();

  // GPT-5+ models (gpt-5, gpt-5.1-codex, gpt-5.2-codex, gpt-5.3-codex, gpt-5.4, etc.)
  if (modelLower.startsWith('gpt-5')) return true;

  // o-series reasoning models (o1, o3, o4, and future o-series)
  if (/^o\d/.test(modelLower)) return true;

  return false;
}

function normalizeReasoningValue(reasoningValue) {
  return typeof reasoningValue === 'string' && reasoningValue.trim()
    ? reasoningValue.trim().toLowerCase()
    : 'default';
}

function getOpenAIReasoningValues(model) {
  const lower = String(model || '').toLowerCase();

  if ((lower.startsWith('gpt-5.2') || lower.startsWith('gpt-5.3')) && lower.includes('codex')) {
    return new Set(['low', 'medium', 'high', 'xhigh']);
  }
  // Modern gpt-5.x contract (5.1, 5.2 non-codex, 5.4, 5.5+): 'none' instead of
  // 'minimal', plus 'xhigh'. The Codex Responses API rejects 'minimal' for
  // gpt-5.5+, hence the widened match on 5.4 through 5.99 (and 5.10+ for future).
  if (
    lower.startsWith('gpt-5.1') ||
    lower.startsWith('gpt-5.2') ||
    /^gpt-5\.([4-9]|\d{2,})/.test(lower)
  ) {
    return new Set(['none', 'low', 'medium', 'high', 'xhigh']);
  }
  // Legacy original gpt-5 (no decimal / -mini / -nano): 'minimal' contract.
  if (lower.startsWith('gpt-5')) {
    return new Set(['minimal', 'low', 'medium', 'high']);
  }
  if (/^o\d/.test(lower)) {
    return new Set(['low', 'medium', 'high']);
  }

  return new Set();
}

function buildResponsesReasoningConfig(model, reasoningValue) {
  const normalized = normalizeReasoningValue(reasoningValue);
  if (normalized === 'default') return null;

  const allowed = getOpenAIReasoningValues(model);
  if (allowed.size === 0) return null;

  let effort = normalized;
  if (effort === 'on') {
    effort = 'medium';
  } else if (effort === 'off') {
    effort = 'none';
  }

  if (!allowed.has(effort)) return null;
  return { effort };
}

function supportsAnthropicAdaptiveThinking(model) {
  const lower = String(model || '').toLowerCase();
  return (
    lower.startsWith('claude-fable-') ||
    lower.startsWith('claude-mythos-') ||
    lower.startsWith('claude-opus-4-8') ||
    lower.startsWith('claude-opus-4-7') ||
    lower.startsWith('claude-opus-4-6') ||
    lower.startsWith('claude-sonnet-4-6')
  );
}

// PRD-083: Fable 5 and Mythos 5 are the only Anthropic models we've observed
// emitting empty 2-token responses immediately after a large tool_result
// payload (typically a file save / read echo). The hypothesis is that a fresh
// ~50k-token tool_result block — even when the conversation as a whole still
// fits comfortably in the 1M window — overwhelms Fable's working memory after
// thinking budget allocation. Mark these models so the adapter can pre-slim
// oversized tool_result content before the API call.
function isFableOrMythosModel(model) {
  const lower = String(model || '').toLowerCase();
  return lower.startsWith('claude-fable-') || lower.startsWith('claude-mythos-');
}

// PRD-083 (CTO follow-up): when retrying a refused request on a different
// model, Anthropic's docs explicitly require stripping the original model's
// thinking blocks from the conversation history first. Fable/Mythos thinking
// blocks carry cryptographic signatures that only validate on the original
// model; replaying them on Opus 4.8 causes a 400 invalid_request_error.
// Walks all assistant messages and removes thinking/redacted_thinking blocks.
function stripThinkingBlocksFromHistory(messages) {
  if (!Array.isArray(messages)) return messages;
  let totalStripped = 0;
  const stripped = messages.map((msg) => {
    if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) return msg;
    const filtered = msg.content.filter(
      (b) => b && b.type !== 'thinking' && b.type !== 'redacted_thinking',
    );
    if (filtered.length === msg.content.length) return msg;
    totalStripped += (msg.content.length - filtered.length);
    return { ...msg, content: filtered };
  });
  if (totalStripped > 0) {
    console.log(`[Anthropic Fallback] Stripped ${totalStripped} thinking/redacted_thinking block(s) from history for cross-model replay`);
  }
  return stripped;
}

// Stringify a tool_result `content` field for byte counting. Anthropic accepts
// either a raw string or an array of content blocks ([{type: 'text', text}]).
function _stringifyToolResultContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (!b) return '';
        if (typeof b === 'string') return b;
        if (b.type === 'text') return b.text || '';
        return JSON.stringify(b);
      })
      .join('');
  }
  if (content && typeof content === 'object') return JSON.stringify(content);
  return '';
}

// PRD-083 §7a: For Fable/Mythos only, walk Anthropic-format messages and
// replace tool_result blocks whose content exceeds `thresholdChars` with a
// head+tail stub. The universal orchestrator-level compactor (50k char
// threshold on role:'tool' messages) misses cases where the result is just
// under 50k chars but, because Fable's tokenizer produces ~30% more tokens
// per character, ends up well over 10k tokens — which is the size at which
// we see the 2-token empty-response failure mode.
//
// Mutates `messages` in place. Returns a summary { slimmedCount,
// originalBytes, slimmedBytes } for diagnostic logging.
function slimLargeToolResultsForFableMythos(messages, thresholdChars = 32000) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { slimmedCount: 0, originalBytes: 0, slimmedBytes: 0 };
  }
  let slimmedCount = 0;
  let originalBytes = 0;
  let slimmedBytes = 0;

  for (const msg of messages) {
    if (!msg || msg.role !== 'user' || !Array.isArray(msg.content)) continue;
    for (let i = 0; i < msg.content.length; i++) {
      const block = msg.content[i];
      if (!block || block.type !== 'tool_result') continue;

      const asString = _stringifyToolResultContent(block.content);
      // Idempotency: blocks already below the threshold (including ones
      // slimmed on a previous pass — the stub is ≤2000 chars) are skipped.
      // This keeps the cache prefix stable across pause_turn resumes/retries.
      if (asString.length <= thresholdChars) continue;

      const head = asString.slice(0, 800);
      const tail = asString.slice(-800);
      const elided = asString.length - head.length - tail.length;
      const stub =
        `[tool_result content elided for Fable/Mythos compatibility — ` +
        `original ${asString.length} chars, ${elided} elided]\n\n` +
        `--- head (first 800 chars) ---\n${head}\n\n` +
        `--- tail (last 800 chars) ---\n${tail}`;

      originalBytes += asString.length;
      slimmedBytes += stub.length;
      slimmedCount++;

      // NOTE: don't add custom marker fields — Anthropic strictly validates
      // tool_result block shape and rejects unknown keys ("Extra inputs are
      // not permitted"). The length check above is enough.
      msg.content[i] = {
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: stub,
        ...(block.is_error ? { is_error: block.is_error } : {}),
      };
    }
  }

  return { slimmedCount, originalBytes, slimmedBytes };
}

// PRD-083 §6: Pre-call diagnostic. On every Anthropic call, log the shape of
// the conversation we're about to send so we can correlate input shape with
// the post-call "[Anthropic Stream] Empty response detail" line. Specifically
// surfaces: (a) whether the last message is a tool_result carrier and how
// big the tool_results are (H1/H2 — large tool_result poisoning), and (b)
// whether the previous assistant turn has a thinking block with a real
// signature (H3 — orphan signature on replay).
function logAnthropicPreCall(model, provider, conversationMessages, slimSummary) {
  if (!Array.isArray(conversationMessages) || conversationMessages.length === 0) return;

  const lastMsg = conversationMessages[conversationMessages.length - 1];
  const lastMessageRole = lastMsg?.role || 'unknown';

  let lastMessageContentTypes = [];
  if (Array.isArray(lastMsg?.content)) {
    lastMessageContentTypes = lastMsg.content.map((b) => b?.type || 'unknown');
  } else if (typeof lastMsg?.content === 'string') {
    lastMessageContentTypes = ['text'];
  }

  let totalToolResultBytes = 0;
  let lastToolResultBytes = 0;
  for (const m of conversationMessages) {
    if (!Array.isArray(m?.content)) continue;
    for (const b of m.content) {
      if (b && b.type === 'tool_result') {
        const size = _stringifyToolResultContent(b.content).length;
        totalToolResultBytes += size;
      }
    }
  }
  if (Array.isArray(lastMsg?.content)) {
    const lastToolResult = [...lastMsg.content].reverse().find((b) => b?.type === 'tool_result');
    if (lastToolResult) {
      lastToolResultBytes = _stringifyToolResultContent(lastToolResult.content).length;
    }
  }

  // Walk backwards for the most recent assistant message. Inspect its thinking
  // block (if any) and the captured signature length. Empty signature on a
  // thinking block in history is a red flag for H3 (signature lost during
  // accumulation or compaction).
  let prevAssistantHasThinking = false;
  let prevAssistantThinkingSigLen = 0;
  for (let i = conversationMessages.length - 1; i >= 0; i--) {
    const m = conversationMessages[i];
    if (m?.role !== 'assistant') continue;
    if (Array.isArray(m.content)) {
      const thinkingBlock = m.content.find((b) => b?.type === 'thinking');
      if (thinkingBlock) {
        prevAssistantHasThinking = true;
        prevAssistantThinkingSigLen = (thinkingBlock.signature || '').length;
      }
    }
    break;
  }

  const slimPart = slimSummary && slimSummary.slimmedCount > 0
    ? ` slimmed=${slimSummary.slimmedCount}(${slimSummary.originalBytes}→${slimSummary.slimmedBytes})`
    : '';

  console.log(
    `[Anthropic Pre-Call] model=${model} provider=${provider} ` +
    `messagesCount=${conversationMessages.length} ` +
    `lastMessageRole=${lastMessageRole} ` +
    `lastMessageContentTypes=${JSON.stringify(lastMessageContentTypes)} ` +
    `totalToolResultBytes=${totalToolResultBytes} ` +
    `lastToolResultBytes=${lastToolResultBytes} ` +
    `prevAssistantHasThinking=${prevAssistantHasThinking} ` +
    `prevAssistantThinkingSigLen=${prevAssistantThinkingSigLen}` +
    slimPart,
  );
}

function buildAnthropicReasoningConfig(model, reasoningValue) {
  if (!supportsAnthropicAdaptiveThinking(model)) return null;

  const normalized = normalizeReasoningValue(reasoningValue);
  const lower = String(model || '').toLowerCase();

  // PRD-082: Fable 5 and Mythos 5 have always-on adaptive thinking, but unlike
  // Opus 4.8 (where Anthropic's server-side default is documented as `effort:
  // 'high'`) the docs are silent on Fable/Mythos's default. Empirically, when
  // we send no output_config we get tiny 4-6 token responses with everything
  // consumed by thinking. Pin 'default' to 'high' for these models so the
  // model has the budget to actually emit text/tool_use after thinking.
  const isAlwaysOnThinkingModel =
    lower.startsWith('claude-fable-') || lower.startsWith('claude-mythos-');

  if (normalized === 'default') {
    if (!isAlwaysOnThinkingModel) return null;
    return { thinking: { type: 'adaptive' }, outputConfig: { effort: 'high' } };
  }
  if (normalized === 'off') {
    return { thinking: { type: 'disabled' } };
  }

  const effort = normalized === 'on' ? 'high' : normalized;
  // Opus 4.7 and the Fable/Mythos/Opus-4.8 generation expose an `xhigh` ("Max") tier.
  const supportsXHigh =
    lower.startsWith('claude-opus-4-7') ||
    lower.startsWith('claude-opus-4-8') ||
    lower.startsWith('claude-fable-') ||
    lower.startsWith('claude-mythos-');
  const allowed = supportsXHigh
    ? new Set(['low', 'medium', 'high', 'xhigh'])
    : new Set(['low', 'medium', 'high']);

  if (!allowed.has(effort)) return null;

  return {
    thinking: { type: 'adaptive' },
    outputConfig: { effort },
  };
}

function buildGeminiThinkingConfig(model, reasoningValue) {
  const normalized = normalizeReasoningValue(reasoningValue);
  if (normalized === 'default') return null;

  const lower = String(model || '').toLowerCase();
  if (lower.startsWith('gemini-3')) {
    if (lower.includes('flash')) {
      if (normalized === 'off') return { thinkingLevel: 'minimal' };
      if (normalized === 'on') return { thinkingLevel: 'high' };
      if (['low', 'medium', 'high'].includes(normalized)) return { thinkingLevel: normalized };
    } else {
      if (normalized === 'on') return { thinkingLevel: 'high' };
      if (['low', 'medium', 'high'].includes(normalized)) return { thinkingLevel: normalized };
    }
    return null;
  }

  if (lower.startsWith('gemini-2.5')) {
    if (lower.includes('flash')) {
      if (normalized === 'off') return { thinkingBudget: 0 };
      if (normalized === 'on') return { thinkingBudget: -1 };
      if (normalized === 'low') return { thinkingBudget: 1024 };
      if (normalized === 'medium') return { thinkingBudget: 8192 };
      if (normalized === 'high') return { thinkingBudget: 24576 };
    } else {
      if (normalized === 'on') return { thinkingBudget: -1 };
      if (normalized === 'low') return { thinkingBudget: 1024 };
      if (normalized === 'medium') return { thinkingBudget: 8192 };
      if (normalized === 'high') return { thinkingBudget: 32768 };
    }
  }

  return null;
}

function supportsKimiToggle(provider, model) {
  const normalizedProvider = String(provider || '').toLowerCase();
  const lower = String(model || '').toLowerCase();

  if (normalizedProvider === 'kimi-code') {
    return lower === 'kimi-for-coding';
  }

  return lower.startsWith('kimi-k2') && !lower.includes('thinking');
}

function supportsDeepSeekToggle(model) {
  const lower = String(model || '').toLowerCase();
  return lower === 'deepseek-chat' || lower === 'deepseek-reasoner' || lower.startsWith('deepseek-v4-');
}

function isGroqGptOssReasoningModel(model) {
  const lower = String(model || '').toLowerCase();
  return lower === 'openai/gpt-oss-20b' || lower === 'openai/gpt-oss-120b';
}

function isGroqQwenReasoningModel(model) {
  return String(model || '').toLowerCase() === 'qwen/qwen3-32b';
}

function isCerebrasGptOssReasoningModel(model) {
  return String(model || '').toLowerCase() === 'gpt-oss-120b';
}

function isCerebrasGlmReasoningModel(model) {
  return String(model || '').toLowerCase() === 'zai-glm-4.7';
}

function isTogetherGptOssReasoningModel(model) {
  return String(model || '').toLowerCase().startsWith('openai/gpt-oss-');
}

// Chutes reasoning models — protocol routes by underlying family.
function isChutesKimiReasoningModel(model) {
  return /^moonshotai\/kimi-k2/i.test(String(model || ''));
}

function isChutesGlmReasoningModel(model) {
  return /^zai-org\/glm-5/i.test(String(model || ''));
}

function isChutesQwenReasoningModel(model) {
  return /^qwen\/qwen3/i.test(String(model || ''));
}

function buildOpenAiLikeReasoningExtraBody(provider, model, reasoningValue) {
  const normalizedProvider = String(provider || '').toLowerCase();
  const normalizedValue = normalizeReasoningValue(reasoningValue);
  const reasoningControl = getReasoningControl(normalizedProvider, model);

  if (!reasoningControl || normalizedValue === 'default') {
    return null;
  }

  if (normalizedProvider === 'zai') {
    // GLM-5.2: OpenAI-compatible `reasoning_effort` with `high` (default) and
    // `max` only. No `off` — adaptive thinking is always on. Older GLM models
    // (5.1, 5, 4.7, 4.6, 4.5) still use the enabled/disabled `thinking`
    // toggle below.
    if (supportsZaiReasoningEffort(model)) {
      // `default` already returned null at the top of this function — we only
      // reach here on an explicit non-default selection. Map our internal
      // values to Z.AI's accepted set.
      let effort = normalizedValue;
      if (effort === 'on' || effort === 'low' || effort === 'medium') effort = 'high';
      if (effort === 'xhigh') effort = 'max';
      if (!['high', 'max'].includes(effort)) return null;
      return { reasoning_effort: effort };
    }
    if (normalizedValue === 'off') return { thinking: { type: 'disabled' } };
    return { thinking: { type: 'enabled' } };
  }

  if ((normalizedProvider === 'kimi' || normalizedProvider === 'kimi-code') && supportsKimiToggle(normalizedProvider, model)) {
    if (normalizedValue === 'off') return { thinking: { type: 'disabled' } };
    return { thinking: { type: 'enabled' } };
  }

  if (normalizedProvider === 'deepseek' && supportsDeepSeekToggle(model)) {
    if (normalizedValue === 'off') return { thinking: { type: 'disabled' } };

    let effort = normalizedValue;
    if (effort === 'on' || effort === 'low' || effort === 'medium') {
      effort = 'high';
    } else if (effort === 'xhigh') {
      effort = 'max';
    }

    if (!['high', 'max'].includes(effort)) {
      effort = 'high';
    }

    return {
      thinking: { type: 'enabled' },
      reasoning_effort: effort,
    };
  }

  if (normalizedProvider === 'groq') {
    if (isGroqGptOssReasoningModel(model)) {
      const effort = normalizedValue === 'on' ? 'medium' : normalizedValue;
      if (!['low', 'medium', 'high'].includes(effort)) return null;
      return {
        reasoning_effort: effort,
        include_reasoning: true,
      };
    }

    if (isGroqQwenReasoningModel(model)) {
      if (normalizedValue === 'off') return { reasoning_effort: 'none' };
      return { reasoning_effort: 'default' };
    }

    return null;
  }

  if (normalizedProvider === 'openrouter') {
    let effort = normalizedValue;
    if (effort === 'on') {
      effort = 'medium';
    } else if (effort === 'off') {
      effort = 'none';
    }
    return {
      reasoning: {
        effort,
      },
    };
  }

  if (normalizedProvider === 'cerebras') {
    if (isCerebrasGptOssReasoningModel(model)) {
      const effort = normalizedValue === 'on' ? 'medium' : normalizedValue;
      if (!['low', 'medium', 'high'].includes(effort)) return null;
      return { reasoning_effort: effort };
    }

    if (isCerebrasGlmReasoningModel(model)) {
      if (normalizedValue === 'off') {
        return { reasoning_effort: 'none' };
      }
      return null;
    }
  }

  if (normalizedProvider === 'togetherai' && isTogetherGptOssReasoningModel(model)) {
    const effort = normalizedValue === 'on' ? 'medium' : normalizedValue;
    if (!['low', 'medium', 'high'].includes(effort)) return null;
    return { reasoning_effort: effort };
  }

  if (normalizedProvider === 'chutes') {
    // Chutes hosts upstream models via vLLM / sglang. The disable-thinking
    // knob is `chat_template_kwargs`, but the inner key NAME is set by each
    // model's chat template — not unified. Kimi K2.x uses `thinking`; GLM
    // and Qwen3 use `enable_thinking`. References:
    //   - SGLang Kimi-K2.6 cookbook: chat_template_kwargs: { thinking: false }
    //   - vLLM Qwen3 / GLM5 docs:    chat_template_kwargs: { enable_thinking: false }
    if (isChutesKimiReasoningModel(model)) {
      if (normalizedValue === 'off') return { chat_template_kwargs: { thinking: false } };
      if (normalizedValue === 'on')  return { chat_template_kwargs: { thinking: true } };
      return null;
    }
    if (isChutesGlmReasoningModel(model) || isChutesQwenReasoningModel(model)) {
      if (normalizedValue === 'off') return { chat_template_kwargs: { enable_thinking: false } };
      if (normalizedValue === 'on')  return { chat_template_kwargs: { enable_thinking: true } };
      return null;
    }
    return null;
  }

  if (normalizedProvider === 'grokai') {
    return null;
  }

  return null;
}

/**
 * Factory function to create the appropriate LLM adapter.
 * @param {string} provider The name of the AI provider.
 * @param {Object} client The initialized SDK client.
 * @param {string} model The model name.
 * @returns {Promise<BaseAdapter>} An instance of a provider-specific adapter.
 */
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

// Export adapters for testing
export { GeminiAdapter, buildOpenAiLikeReasoningExtraBody };
