/**
 * The OpenAI Responses transport — openai (gpt-5.x / o-series) and openai-codex.
 *
 * CodexResponsesAdapter subclasses it because the ChatGPT backend is a
 * different service wearing the same API: it requires streaming, rejects the
 * public cache-retention controls with 400, needs its own error guidance, and
 * keys cache affinity on a private session_id header.
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
  describeCodexError,
  buildCodexErrorGuidance,
  buildResponsesReasoningConfig,
} from './_shared.js';

class OpenAIResponsesAdapter extends BaseAdapter {
  constructor(client, model, options = {}) {
    super(client, model);
    this.reasoningValue = options.reasoningValue || 'default';
    this.promptCachePolicy = openAIPromptCachePolicy(model);
    // Provider + conversation identity, for BaseAdapter._cacheAffinity. This
    // hierarchy did not carry them before, which is why the Codex cache hint
    // had nowhere to attach.
    this.provider = options.provider || 'openai';
    this.conversationId = options.conversationId || null;
    this.maxRetries = 3;
    this.baseDelay = 1000;
    this.retryableStatusCodes = new Set([429, 500, 502, 503, 504, 529]);

    // Models that support reasoning (o-series)
    this.reasoningModels = new Set(['o1', 'o1-mini', 'o1-preview', 'o3', 'o3-mini', 'o3-preview', 'gpt-5', 'gpt-5.1-codex-max']);

    // Self-healing kill switch for `reasoning.summary`. Some organizations are
    // not cleared to receive reasoning summaries; if the API rejects the field
    // we flip this and retry without it rather than failing the turn.
    this._reasoningSummaryDisabled = false;
  }

  /**
   * GPT-5.x defaults to concise final answers. Keep this model-gated so older
   * Responses models do not receive a field they may not support.
   */
  _defaultTextConfig() {
    return /^gpt-5(?:$|[.-])/i.test(this.model) ? { verbosity: 'low' } : null;
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
   */  isRetryableError(error) {
    if (error.status && this.retryableStatusCodes.has(error.status)) {
      return true;
    }
    // Transient network / SDK-wrapped connection errors — shared BaseAdapter
    // helper (also covers CodexResponsesAdapter via its super call).
    if (this._isTransientNetworkError(error)) {
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
  /**
   * Normalize Responses-API usage into the Chat-Completions shape the rest of
   * AGNT accounts in.
   *
   * Chat Completions reports cached prompt reads as
   *   usage.prompt_tokens_details.cached_tokens
   * The Responses API — used by gpt-5.x AND every Codex model — reports the
   * identical number as
   *   usage.input_tokens_details.cached_tokens
   * OrchestratorService.accumulateUsage() only read the former, so every cache
   * hit on this transport was accumulated as zero and prompt-cache health was
   * invisible on exactly the provider where it mattered most. Mirror the field
   * instead of teaching every consumer both shapes.
   */
  _normalizeResponsesUsage(usage) {
    if (!usage) return undefined;
    const cached = usage.input_tokens_details?.cached_tokens
      ?? usage.prompt_tokens_details?.cached_tokens;
    if (cached === undefined || cached === null) return usage;
    return {
      ...usage,
      prompt_tokens_details: { ...(usage.prompt_tokens_details || {}), cached_tokens: cached },
    };
  }

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
  _sanitizeSchema(schema, isRoot = false) {
    if (!schema || typeof schema !== 'object') {
      return isRoot ? { type: 'object', properties: {} } : { type: 'string' };
    }

    if (Array.isArray(schema)) {
      // A schema itself must be an object. Treat a non-standard schema array as
      // alternatives and keep the first usable schema rather than forwarding an
      // invalid array to the Responses API.
      return schema.length > 0
        ? this._sanitizeSchema(schema[0], isRoot)
        : (isRoot ? { type: 'object', properties: {} } : { type: 'string' });
    }

    const result = { ...schema };
    const validTypes = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
    const uiTypeMap = {
      text: 'string',
      textarea: 'string',
      password: 'string',
      email: 'string',
      url: 'string',
      date: 'string',
      datetime: 'string',
      select: 'string',
      radio: 'string',
      checkbox: 'boolean',
      toggle: 'boolean',
      range: 'number',
      json: 'object',
      list: 'array',
    };

    const normalizeType = (type) => {
      if (Array.isArray(type)) {
        // Codex Responses rejects AGNT-generated union arrays in some tool
        // schemas. Preserve the first valid scalar type deterministically.
        const firstValid = type.find((entry) => validTypes.has(entry));
        return firstValid || 'string';
      }
      if (validTypes.has(type)) return type;
      if (typeof type === 'string' && uiTypeMap[type.toLowerCase()]) {
        return uiTypeMap[type.toLowerCase()];
      }
      return null;
    };

    const normalizedType = normalizeType(result.type);
    if (normalizedType) {
      result.type = normalizedType;
    } else if (isRoot || (result.properties && typeof result.properties === 'object')) {
      result.type = 'object';
    } else if (result.items) {
      result.type = 'array';
    } else {
      result.type = 'string';
    }

    // The function parameters root must always be an object schema.
    if (isRoot) result.type = 'object';

    if (result.type === 'object' && (!result.properties || typeof result.properties !== 'object' || Array.isArray(result.properties))) {
      result.properties = {};
    }

    // Array type must have a valid items schema.
    if (result.type === 'array' && !result.items) {
      result.items = { type: 'string' };
    }

    if (result.items) {
      result.items = this._sanitizeSchema(result.items, false);
    }

    if (result.properties) {
      const sanitized = {};
      for (const [key, value] of Object.entries(result.properties)) {
        sanitized[key] = this._sanitizeSchema(value, false);
      }
      result.properties = sanitized;
    }

    if (result.additionalProperties && typeof result.additionalProperties === 'object') {
      result.additionalProperties = this._sanitizeSchema(result.additionalProperties, false);
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
      // Responses/Codex require every function parameter schema to be a valid
      // root object under JSON Schema. Normalize AGNT UI-oriented schemas here.
      parameters: this._sanitizeSchema(tool.function.parameters, true),
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

  /**
   * Reasoning-summary streaming.
   *
   * Reasoning models (gpt-5.x-codex, o-series) deliberately emit almost nothing
   * on `output_text` while they work — their interim narration arrives ONLY on
   * the `response.reasoning_summary_*` channel. We already ask for it via
   * `reasoning.summary`, but the stream loops had no branch for those events,
   * so every mid-task update was read off the wire and dropped. The visible
   * symptom: a long run of tool calls in total silence followed by one big
   * summary at the end, while other providers appear to narrate as they go.
   *
   * Forwarding these as `type: 'reasoning'` puts them on the same path the
   * Anthropic adapter uses for `thinking_delta` — OrchestratorService turns it
   * into a `reasoning_delta` SSE event and the UI appends it live.
   *
   * Summary text is deliberately NOT merged into `accumulatedContent`: it is
   * narration, not the assistant's answer, and must never enter replayed history.
   */
  _createReasoningSummaryState() {
    return { accumulated: '', partText: '' };
  }

  /**
   * @returns {boolean} true when the event belonged to the reasoning-summary
   *   channel and was fully handled here (caller should skip its own chain).
   */
  _handleReasoningSummaryEvent(event, state, onChunk) {
    const type = event?.type;
    if (
      type !== 'response.reasoning_summary_part.added' &&
      type !== 'response.reasoning_summary_text.delta' &&
      type !== 'response.reasoning_summary_text.done'
    ) {
      return false;
    }
    if (!state) return true;

    const emit = (delta) => {
      if (!delta) return;
      state.accumulated += delta;
      if (onChunk) {
        onChunk({ type: 'reasoning', delta, accumulated: state.accumulated });
      }
    };

    if (type === 'response.reasoning_summary_part.added') {
      // One response can carry several summary parts. Without a separator they
      // render as a single run-on paragraph.
      if (state.accumulated) emit('\n\n');
      state.partText = '';
      return true;
    }

    if (type === 'response.reasoning_summary_text.delta') {
      const delta = typeof event.delta === 'string' ? event.delta : '';
      state.partText += delta;
      emit(delta);
      return true;
    }

    // `...text.done` is normally a no-op — the deltas already carried the whole
    // part. Backfill only for backends that emit the terminal event alone, and
    // only when it cleanly extends what we already streamed; otherwise we would
    // duplicate the entire part.
    const full = typeof event.text === 'string' ? event.text : '';
    if (full && full.length > state.partText.length && full.startsWith(state.partText)) {
      emit(full.slice(state.partText.length));
      state.partText = full;
    }
    return true;
  }

  /**
   * Attach `summary: 'auto'` so the provider actually emits the narration the
   * stream loops now consume. Honors the self-healing kill switch.
   */
  _withReasoningSummary(reasoningConfig) {
    if (!reasoningConfig || this._reasoningSummaryDisabled) return reasoningConfig;
    return { ...reasoningConfig, summary: 'auto' };
  }

  /**
   * Detect a rejection that is specifically about the `summary` field, so the
   * caller can drop it and retry instead of failing the whole turn. Deliberately
   * narrow: it must mention summaries AND read like a capability rejection.
   */
  _isReasoningSummaryUnsupportedError(error) {
    if (this._reasoningSummaryDisabled) return false;
    const status = error?.status;
    if (status && status !== 400 && status !== 403 && status !== 422) return false;
    const haystack = [
      error?.message,
      error?.param,
      error?.error?.message,
      error?.error?.param,
      error?.response?.data?.error?.message,
      error?.response?.data?.error?.param,
    ]
      .filter((part) => typeof part === 'string')
      .join(' ')
      .toLowerCase();
    if (!haystack.includes('summar')) return false;
    return /unsupported|not supported|does not support|unknown parameter|unrecognized|invalid|must be verified|verified organization|not allowed|no access/.test(
      haystack,
    );
  }

  async call(messages, tools, context = {}) {
    let lastError;
    messages = BaseAdapter._sanitizeOutbound(messages, 'openai-responses');

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        // context.imageData -> input_image blocks. Non-streaming call() previously
        // dropped images while callStream() injected them, so the analyze_image
        // tool (which uses call()) silently sent a prompt with no picture attached.
        const { instructions, input } = this._transformMessagesToInput(messages, context.imageData);
        const responsesTools = this._transformToolsToResponses(tools);

        const requestParams = {
          model: this.model,
          input: input,
          store: false, // Don't store responses by default
          ...(this.promptCachePolicy || {}),
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
          requestParams.reasoning = this._withReasoningSummary(
            buildResponsesReasoningConfig(this.model, this.reasoningValue) || { effort: 'medium' },
          );
        }

        const textConfig = this._defaultTextConfig();
        if (textConfig) requestParams.text = textConfig;

        console.log(`[OpenAI Responses] Calling model '${this.model}' with Responses API`);
        console.log(`[OpenAI Responses] Input items: ${input.length}, Tools: ${responsesTools?.length || 0}`);

        const affinity = this._cacheAffinity();
        if (affinity?.body) Object.assign(requestParams, affinity.body);
        const response = await this.client.responses.create(
          requestParams,
          affinity?.headers ? { headers: affinity.headers } : undefined,
        );

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
          usage: this._normalizeResponsesUsage(response.usage),
          ...(wasEmpty ? { recoveredFromError: true, recoveredError: 'Provider returned empty response' } : {}),
        };
      } catch (error) {
        lastError = error;

        // Only the `summary` field was rejected — drop it and retry immediately
        // without consuming the transient-error retry budget. The turn still
        // works, just without live narration.
        if (this._isReasoningSummaryUnsupportedError(error)) {
          this._reasoningSummaryDisabled = true;
          console.warn(`[OpenAI Responses] Model '${this.model}' rejected reasoning.summary; retrying without live narration`);
          attempt--;
          continue;
        }

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
    messages = BaseAdapter._sanitizeOutbound(messages, 'openai-responses');

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let accumulatedContent = '';
      let accumulatedToolCalls = [];
      let streamUsage = null;
      let replayableOutputItems = undefined;
      const reasoningState = this._createReasoningSummaryState();

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
          ...(this.promptCachePolicy || {}),
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
          requestParams.reasoning = this._withReasoningSummary(
            buildResponsesReasoningConfig(this.model, this.reasoningValue) || { effort: 'medium' },
          );
        }

        const textConfig = this._defaultTextConfig();
        if (textConfig) requestParams.text = textConfig;

        console.log(`[OpenAI Responses] Streaming call to model '${this.model}'`);

        const abortSignal = context.abortSignal;
        const affinity = this._cacheAffinity();
        if (affinity?.body) Object.assign(requestParams, affinity.body);
        const stream = await this.client.responses.create(
          requestParams,
          affinity?.headers ? { headers: affinity.headers } : undefined,
        );

        // Handle streaming events
        for await (const event of stream) {
          if (abortSignal?.aborted) {
            console.log('[OpenAI Responses Stream] Aborted by client disconnect');
            break;
          }

          // Interim narration (reasoning summaries) is checked first so it can
          // never be swallowed by a later branch in the chain.
          if (this._handleReasoningSummaryEvent(event, reasoningState, onChunk)) {
            continue;
          }

          // Handle different event types from Responses API
          if (event.type === 'response.output_item.added') {
            // New output item started
            const item = event.item;
            if (item.type === 'function_call') {
              const newToolCall = {
                id: item.call_id || `responses-tool-${Date.now()}-${accumulatedToolCalls.length}`,
                type: 'function',
                function: {
                  name: item.name || '',
                  arguments: '',
                },
              };
              accumulatedToolCalls.push(newToolCall);
              // Announce immediately so the UI shows a pending pill before
              // arg deltas start arriving — otherwise the pill only appears
              // once the first arg token streams in.
              if (onChunk && newToolCall.function.name) {
                onChunk({
                  type: 'tool_call_delta',
                  index: accumulatedToolCalls.length - 1,
                  toolCall: newToolCall,
                });
              }
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
          usage: this._normalizeResponsesUsage(streamUsage),
          ...(wasEmpty ? { recoveredFromError: true, recoveredError: 'Provider returned empty response' } : {}),
        };
      } catch (error) {
        lastError = error;

        // Only the `summary` field was rejected — drop it and retry immediately
        // without consuming the transient-error retry budget.
        if (this._isReasoningSummaryUnsupportedError(error)) {
          this._reasoningSummaryDisabled = true;
          console.warn(`[OpenAI Responses] Model '${this.model}' rejected reasoning.summary; retrying without live narration`);
          attempt--;
          continue;
        }

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

class CodexResponsesAdapter extends OpenAIResponsesAdapter {
  constructor(client, model, options = {}) {
    super(client, model, options);
    // The ChatGPT Codex backend rejects api.openai.com's public retention
    // controls with HTTP 400. Keep its cache policy implicit; only the public
    // OpenAI Responses adapter may send prompt_cache_options/retention.
    // (Re-verified 2026-08-10, along with prompt_cache_breakpoint → 400 and
    // store:true → 400. The affinity hint this provider CAN use is the
    // session_id header — see BaseAdapter._cacheAffinity.)
    this.promptCachePolicy = null;
    // The factory passes options through without a provider key, and this
    // class serves exactly one provider.
    this.provider = 'openai-codex';
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
    // Reserve a quarter of the window for the response, because Codex reasoning
    // models routinely spend tens of thousands of output tokens on hidden
    // chain-of-thought before emitting any visible content.
    //
    // The extra serialized-payload margin is 0.95, not the previous 0.86. That
    // 14% pad existed to compensate for a blunt global chars/1.6 estimator; now
    // that _estimateCodexRequestTokens() measures each component against its
    // own measured ratio — and each of those already carries 12-19% headroom —
    // stacking another 14% on top was double-counting, and it stole ~28k tokens
    // of usable conversation window for nothing.
    const contextWindow = this._getCodexContextWindow();
    const outputReserve = Math.min(96_000, Math.floor(contextWindow * 0.25));
    return Math.max(16_000, Math.floor((contextWindow - outputReserve) * 0.95));
  }

  /**
   * Per-component chars/token ratios, measured against o200k_base (the gpt-5.x
   * / Codex tokenizer) on real AGNT payloads, 2026-07-25:
   *
   *   tool schemas         4.75   (295-tool live surface; p05 per-tool 4.49)
   *   instructions/prose   3.91
   *   plain message items  ~4.0   (prose plus a thin JSON wrapper)
   *   function args/results 2.58  (escaped code) .. 3.17 (JSON results)
   *   encrypted reasoning  1.46   (random base64)
   *
   * A single global divisor cannot serve a 3.3x spread. The previous chars/1.6
   * was simultaneously wrong in BOTH directions: it overcounted tool schemas by
   * 2.97x — inventing a 375k-token request out of a real 128k one and driving
   * the preflight to delete conversation history to "fix" an overflow that did
   * not exist — while UNDERCOUNTING random base64 by 1.10x, failing at the very
   * job (bounding encrypted reasoning replay) it was introduced for.
   *
   * Each divisor below sits ~12-19% under its measured ratio, so every class is
   * still deliberately overestimated — just not by a factor of three.
   */
  static CODEX_CPT_SCHEMA = 4.0;   // measured 4.75
  static CODEX_CPT_PROSE = 3.5;    // measured 3.91
  static CODEX_CPT_STRUCTURED = 2.5; // measured 2.58 (escaped code, worst case)
  static CODEX_CPT_OPAQUE = 1.3;   // measured 1.46 (random base64)

  /**
   * True for input items whose payload is opaque high-entropy text — encrypted
   * reasoning blobs — which tokenize near 1:1 and must never be estimated with
   * a prose ratio.
   */
  _isOpaqueInputItem(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.type === 'reasoning') return true;
    if (typeof item.encrypted_content === 'string') return true;
    return false;
  }

  /**
   * Cost of the parts of the request that shedding conversation CANNOT reduce.
   */
  _estimateCodexFixedOverhead(params) {
    if (!params) return 0;
    const C = CodexResponsesAdapter;
    let total = 0;
    try {
      total += Math.ceil(JSON.stringify(params.tools || []).length / C.CODEX_CPT_SCHEMA);
    } catch { /* unserializable tools — ignore, the input estimate still applies */ }
    total += Math.ceil(String(params.instructions || '').length / C.CODEX_CPT_PROSE);
    return total;
  }

  _estimateCodexRequestTokens(params) {
    if (!params) return 0;
    const C = CodexResponsesAdapter;
    let total = this._estimateCodexFixedOverhead(params);

    const input = Array.isArray(params.input) ? params.input : [];
    for (const item of input) {
      let serialized;
      try {
        serialized = JSON.stringify(item);
      } catch {
        serialized = String(item);
      }
      if (!serialized) continue;

      const ratio = this._isOpaqueInputItem(item)
        ? C.CODEX_CPT_OPAQUE
        : (item?.type === 'message' ? C.CODEX_CPT_PROSE : C.CODEX_CPT_STRUCTURED);
      total += Math.ceil(serialized.length / ratio);
    }

    return total;
  }

  _buildCodexParamsWithinBudget(messages, tools, imageData = null, logPrefix = 'Codex Responses') {
    let workingMessages = messages;
    let params = this._buildCodexParams(workingMessages, tools, imageData);
    const budget = this._getCodexPreflightInputBudget();
    let estimatedTokens = this._estimateCodexRequestTokens(params);
    let shrinkAttempts = 0;

    // Shedding can only remove INPUT items. If the fixed overhead — tool
    // schemas plus instructions — already exceeds the budget on its own, then
    // no amount of dropping conversation can bring the request under it, and
    // every turn dropped is pure damage for zero benefit.
    //
    // That is precisely how this loop used to blind the model: with a large
    // tool surface the fixed overhead alone was scored at 214% of budget, so
    // the loop burned all 8 shrink attempts eating history it could never
    // recover enough from, and a 3-message chat reached the model as a single
    // orphaned sentence. Refuse to start, and let the provider's own token
    // accounting (via the reactive shed handlers in call/callStream) decide
    // whether a genuine overflow exists.
    const fixedOverhead = this._estimateCodexFixedOverhead(params);
    if (estimatedTokens > budget && fixedOverhead >= budget) {
      console.warn(
        `[${logPrefix} Preflight] Fixed overhead (tools + instructions) is ${fixedOverhead} tokens ` +
        `against a ${budget}-token budget; shedding conversation cannot help. ` +
        `Sending history intact — reduce the active tool surface for this model.`
      );
      return { params, workingMessages, estimatedTokens, budget, shrinkAttempts };
    }

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
   */  isRetryableError(error) {
    // Deliberate user cancellations must never be retried — without this
    // guard, the 'aborted' substring match below would classify
    // APIUserAbortError ("Request was aborted.") as a transient backend
    // hiccup and replay a request the user explicitly stopped.
    const errName = error?.name || error?.constructor?.name || '';
    if (errName === 'APIUserAbortError' || errName === 'AbortError') return false;

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
      params.reasoning = this._withReasoningSummary(reasoningConfig);
    }

    // GPT-5.x Codex models default to concise final answers.
    const textConfig = this._defaultTextConfig();
    if (textConfig) params.text = textConfig;

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
    const reasoningState = this._createReasoningSummaryState();

    for await (const event of stream) {
      if (abortSignal?.aborted) {
        console.log('[Codex Stream] Aborted by client disconnect');
        break;
      }

      // Codex narrates its work exclusively on the reasoning-summary channel.
      // Handle it before the content/tool chain so it is never dropped.
      if (this._handleReasoningSummaryEvent(event, reasoningState, onChunk)) {
        continue;
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

    return {
      accumulatedContent,
      accumulatedToolCalls,
      responseId,
      usage: this._normalizeResponsesUsage(streamUsage),
      replayableOutputItems,
      reasoningSummary: reasoningState.accumulated || undefined,
    };
  }

  /**
   * Non-streaming call — uses streaming internally since the Codex endpoint requires it,
   * then returns the assembled response.
   */  async call(messages, tools, context = {}) {
    let lastError;
    let workingMessages = BaseAdapter._sanitizeOutbound(messages, 'codex-responses');
    let shrinkAttempts = 0;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        // Forward context.imageData exactly as callStream() does. This argument
        // was hardcoded to null, so the streaming path could see uploaded images
        // but the non-streaming path (used by the analyze_image tool) could not.
        const preflight = this._buildCodexParamsWithinBudget(workingMessages, tools, context.imageData || null, 'Codex Responses');
        const params = preflight.params;
        workingMessages = preflight.workingMessages;

        console.log(`[Codex Responses] Calling model '${this.model}' via ChatGPT backend (streaming internally)`);
        console.log(`[Codex Responses] Input items: ${params.input.length}, Tools: ${params.tools?.length || 0}`);

        const affinity = this._cacheAffinity();
        if (affinity?.body) Object.assign(params, affinity.body);
        const stream = await this.client.responses.create(
          params,
          affinity?.headers ? { headers: affinity.headers } : undefined,
        );
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

        // Only the `summary` field was rejected — drop it and retry without
        // consuming the transient-error retry budget.
        if (this._isReasoningSummaryUnsupportedError(error)) {
          this._reasoningSummaryDisabled = true;
          console.warn('[Codex Responses] Backend rejected reasoning.summary; retrying without live narration');
          attempt--;
          continue;
        }

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
    let workingMessages = BaseAdapter._sanitizeOutbound(messages, 'codex-responses');
    let shrinkAttempts = 0;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const preflight = this._buildCodexParamsWithinBudget(workingMessages, tools, context.imageData, 'Codex Responses Stream');
        const params = preflight.params;
        workingMessages = preflight.workingMessages;

        console.log(`[Codex Responses] Streaming call to model '${this.model}' via ChatGPT backend`);

        const abortSignal = context.abortSignal;
        const affinity = this._cacheAffinity();
        if (affinity?.body) Object.assign(params, affinity.body);
        const stream = await this.client.responses.create(
          params,
          affinity?.headers ? { headers: affinity.headers } : undefined,
        );
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

        // Only the `summary` field was rejected — drop it and retry without
        // consuming the transient-error retry budget.
        if (this._isReasoningSummaryUnsupportedError(error)) {
          this._reasoningSummaryDisabled = true;
          console.warn('[Codex Responses Stream] Backend rejected reasoning.summary; retrying without live narration');
          attempt--;
          continue;
        }

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

export { OpenAIResponsesAdapter, CodexResponsesAdapter };
