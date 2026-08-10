/**
 * The Google Gemini transport — gemini, gemini-cli and antigravity.
 *
 * Distinct enough to need its own file: contents/parts instead of messages,
 * functionCall parts instead of tool_calls, synthesised tool ids, and thought
 * signatures that must be round-tripped or Gemini rejects the next turn.
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
  buildGeminiThinkingConfig,
} from './_shared.js';

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
    }    // Transient network / SDK-wrapped connection errors — shared BaseAdapter helper.
    if (this._isTransientNetworkError(error)) {
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
    let currentMessages = BaseAdapter._sanitizeOutbound(messages, 'gemini');

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

        // Extract Gemini usage metadata (including context-cache tokens when
        // present). Normalized in usageCacheFields, which knows every field
        // spelling Google's backends use. The hand-rolled read this replaces
        // knew only cachedContentTokenCount, so a backend reporting under any
        // other name was indistinguishable from caching being off — measured
        // 2026-08-09 as 0% on the API-key client versus 99.6% on Code Assist
        // for the same model through this same adapter.
        const geminiUsage = normalizeGeminiUsage(response.usageMetadata);

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
    let currentMessages = BaseAdapter._sanitizeOutbound(messages, 'gemini');

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
        console.warn(`[Vision Check] Supported vision models for ${provider}: ${ProviderRegistry.getVisionModels(provider).join(', ')}`);
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

          // Capture usage metadata (typically present on the last chunk).
          // Same normalizer as the non-streaming path — one reader for every
          // field spelling Google uses across its backends.
          if (chunk.usageMetadata) {
            geminiUsage = normalizeGeminiUsage(chunk.usageMetadata);
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

export { GeminiAdapter };
