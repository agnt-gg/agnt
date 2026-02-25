// ALL OF THIS SHOULD BE IN THIS AI.SERVICE

import axios from 'axios';
import { manageContext } from '../../utils/contextManager.js';
import { validateToolCalls, createRetryGuidance } from './toolValidator.js';
import * as ProviderRegistry from '../ai/ProviderRegistry.js';
import CustomOpenAIProviderService from '../ai/CustomOpenAIProviderService.js';

/**
 * Parse API error messages to extract user-friendly error details
 * @param {Error} error - The error object from the API
 * @returns {string} A user-friendly error message
 */
function parseApiErrorMessage(error) {
  const rawMessage = error.message || '';

  // Try to extract JSON error from the message (common pattern: "400 {...}")
  try {
    const jsonMatch = rawMessage.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      let parsed = JSON.parse(jsonMatch[0]);

      // Handle Gemini's deeply nested error format where error.message is itself a JSON string
      // e.g., {"error":{"message":"{\\n  \\"error\\": {\\n    \\"code\\": 429...
      if (parsed.error?.message && typeof parsed.error.message === 'string') {
        try {
          // Try to parse the nested JSON string
          const nestedParsed = JSON.parse(parsed.error.message);
          if (nestedParsed.error?.message) {
            return nestedParsed.error.message;
          }
        } catch (nestedError) {
          // Not nested JSON, use the message directly
          return parsed.error.message;
        }
      }

      // Handle Anthropic error format
      if (parsed.error?.message) {
        return parsed.error.message;
      }
      // Handle OpenAI error format
      if (parsed.message) {
        return parsed.message;
      }
    }
  } catch (e) {
    // JSON parsing failed, continue with other methods
  }

  // Check for common error patterns
  if (rawMessage.includes('credit balance is too low')) {
    return 'Your API credit balance is too low. Please add credits to your account.';
  }
  if (rawMessage.includes('invalid_api_key') || rawMessage.includes('Invalid API Key')) {
    return 'Invalid API key. Please check your API key configuration.';
  }
  if (rawMessage.includes('rate_limit') || rawMessage.includes('Rate limit')) {
    return 'Rate limit exceeded. Please wait a moment and try again.';
  }
  if (rawMessage.includes('overloaded') || rawMessage.includes('capacity')) {
    return 'The AI service is currently overloaded. Please try again in a few moments.';
  }
  if (rawMessage.includes('RESOURCE_EXHAUSTED') || rawMessage.includes('quota')) {
    return 'API quota exceeded. Please check your plan and billing details, or wait for your quota to reset.';
  }
  if (rawMessage.includes('INVALID_ARGUMENT') || rawMessage.includes('not supported')) {
    // Extract the specific error message if possible
    const supportMatch = rawMessage.match(/not supported[^"]*|INVALID_ARGUMENT[^"]*/i);
    if (supportMatch) {
      return `Invalid request: ${supportMatch[0]}`;
    }
    return 'Invalid request. The model may not support this operation.';
  }

  // Return the raw message if no pattern matched
  return rawMessage || 'Unknown error occurred';
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
}

/**
 * Adapter for OpenAI and compatible APIs (Groq, TogetherAI, etc.).
 */
class OpenAiLikeAdapter extends BaseAdapter {
  constructor(client, model) {
    super(client, model);
    this.maxRetries = 3;
    this.baseDelay = 1000; // 1 second
    this.retryableStatusCodes = new Set([429, 500, 502, 503, 504, 529]);
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

    if (this.client?.__agntCompat?.mapDeveloperRole) {
      currentMessages = currentMessages.map((msg) =>
        msg?.role === 'developer' ? { ...msg, role: 'system' } : msg
      );
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: currentMessages,
          tools: tools.length > 0 ? tools : undefined,
          tool_choice: tools.length > 0 ? 'auto' : undefined,
        });

        const message = response.choices[0].message;

        // Log successful retry if this wasn't the first attempt
        if (attempt > 0) {
          console.log(`LLM call succeeded on attempt ${attempt + 1}/${this.maxRetries + 1}`);
        }

        return {
          responseMessage: message,
          toolCalls: message.tool_calls || [],
        };
      } catch (error) {
        lastError = error;

        // Handle token limit errors with automatic context reduction
        if (this.isTokenLimitError(error)) {
          console.warn(`Token limit error detected, attempting context reduction (attempt ${attempt + 1})`);

          const contextResult = manageContext(currentMessages, this.model, tools);
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
      currentMessages = currentMessages.map((msg) =>
        msg?.role === 'developer' ? { ...msg, role: 'system' } : msg
      );
    }

    // Handle vision images - inject into the last user message ONLY if model supports vision
    if (context.imageData && context.imageData.length > 0) {
      // Extract provider from context or determine from adapter
      const provider = context.provider || 'openai'; // Default to openai for OpenAiLikeAdapter

      // Check if this model supports vision
      const visionModels = ProviderRegistry.getVisionModels(provider);
      const supportsVision = visionModels.includes(this.model);

      if (supportsVision) {
        // Deep clone to avoid mutating original messages
        currentMessages = JSON.parse(JSON.stringify(messages));

        // Find the LAST user message and convert it to array format with images
        for (let i = currentMessages.length - 1; i >= 0; i--) {
          if (currentMessages[i].role === 'user') {
            const originalContent = currentMessages[i].content;

            // Convert to array format
            currentMessages[i].content = [
              {
                type: 'text',
                text: typeof originalContent === 'string' ? originalContent : JSON.stringify(originalContent),
              },
            ];

            // Add images
            context.imageData.forEach((img) => {
              currentMessages[i].content.push({
                type: 'image_url',
                image_url: {
                  url: `data:${img.type};base64,${img.data}`,
                },
              });
            });

            console.log(`[OpenAI Vision] Added ${context.imageData.length} image(s) to last user message`);
            break; // Only modify the last user message
          }
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
        const stream = await this.client.chat.completions.create({
          model: this.model,
          messages: currentMessages,
          tools: tools.length > 0 ? tools : undefined,
          tool_choice: tools.length > 0 ? 'auto' : undefined,
          stream: true,
        });

        try {
          for await (const chunk of stream) {
            if (abortSignal?.aborted) {
              stream.controller?.abort?.();
              console.log('[OpenAI Stream] Aborted by client disconnect');
              break;
            }

            const delta = chunk.choices[0]?.delta;

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

            // Handle reasoning_content for providers like Kimi Code that use thinking mode
            if (delta.reasoning_content) {
              accumulatedReasoningContent += delta.reasoning_content;
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
            toolCallsCount: accumulatedToolCalls.length,
          });
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
              `Your local model's context window is too small for this request. Please load a model with at least 8K context in LM Studio. Current error: ${errorMessage}`
            );
          }

          // Check for "keep" token error (another sign of context overflow)
          if (errorMessage.includes('keep') && errorMessage.includes('tokens')) {
            console.error('LM Studio token limit error detected!');
            throw new Error(
              `Your local model's context window is too small. The request requires more tokens than your model supports. Please load a model with a larger context window (8K+ recommended) in LM Studio.`
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

          // If we have accumulated content, we can continue with that
          // Otherwise, we'll fall through to the recovery response
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
          content: accumulatedContent || null,
          tool_calls: validToolCalls.length > 0 ? validToolCalls : undefined,
          // Include reasoning_content for providers like Kimi Code that require it for tool calls
          reasoning_content: accumulatedReasoningContent || undefined,
        };

        return {
          responseMessage: responseMessage,
          toolCalls: validToolCalls || [],
          invalidToolCalls: invalidToolCalls.length > 0 ? invalidToolCalls : undefined,
        };
      } catch (error) {
        lastError = error;

        // Handle token limit errors with automatic context reduction
        if (this.isTokenLimitError(error)) {
          console.warn(`Token limit error detected in streaming, attempting context reduction (attempt ${attempt + 1})`);

          const contextResult = manageContext(currentMessages, this.model, tools);
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
  constructor(client, model, provider = 'anthropic') {
    super(client, model);
    this.provider = provider.toLowerCase();
    this.maxRetries = 3;
    this.baseDelay = 1000; // 1 second
    this.retryableStatusCodes = new Set([429, 500, 502, 503, 504, 529]);

    // Model-specific max output token limits (from Anthropic docs)
    // https://docs.anthropic.com/en/docs/about-claude/models
    this.modelMaxTokens = {
      // Legacy Claude 3 models
      'claude-3-haiku-20240307': 4096,
      'claude-3-sonnet-20240229': 4096,
      'claude-3-opus-20240229': 4096,
      'claude-3-5-haiku-20241022': 8192,
      'claude-3-5-sonnet-20240620': 8192,
      'claude-3-5-sonnet-20241022': 8192,
      'claude-3-7-sonnet-20250219': 64000,
      // Claude 4 models
      'claude-sonnet-4-20250514': 64000,
      'claude-sonnet-4-0': 64000,
      'claude-opus-4-20250514': 32000,
      'claude-opus-4-0': 32000,
      'claude-opus-4-1-20250805': 32000,
      'claude-opus-4-1': 32000,
      // Claude 4.5 models
      'claude-sonnet-4-5-20250929': 64000,
      'claude-sonnet-4-5': 64000,
      'claude-haiku-4-5-20251001': 64000,
      'claude-haiku-4-5': 64000,
      'claude-opus-4-5-20251101': 64000,
      'claude-opus-4-5': 64000,
    };
  }

  /**
   * Get the maximum output tokens for the current model
   * @returns {number} Max tokens for the model
   */
  _getMaxTokensForModel() {
    // Check for exact match first
    if (this.modelMaxTokens[this.model]) {
      return this.modelMaxTokens[this.model];
    }

    // Check for partial matches (e.g., model aliases or variations)
    const modelLower = this.model.toLowerCase();

    // Claude 4.5 models (newest, highest limits)
    if (modelLower.includes('4-5') || modelLower.includes('4.5')) {
      return 64000;
    }

    // Claude 4 Opus models
    if (modelLower.includes('opus-4') || modelLower.includes('opus4')) {
      return 32000;
    }

    // Claude 4 Sonnet or Claude 3.7 models
    if (modelLower.includes('sonnet-4') || modelLower.includes('sonnet4') || modelLower.includes('3-7') || modelLower.includes('3.7')) {
      return 64000;
    }

    // Claude 3.5 models
    if (modelLower.includes('3-5') || modelLower.includes('3.5')) {
      return 8192;
    }

    // Claude 3 Haiku (legacy) - most restrictive
    if (modelLower.includes('haiku') && modelLower.includes('3') && !modelLower.includes('3-5') && !modelLower.includes('3.5')) {
      return 4096;
    }

    // Default to 4096 for unknown models (safe fallback)
    console.warn(`[Anthropic] Unknown model '${this.model}', using safe default max_tokens: 4096`);
    return 4096;
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

  async call(messages, tools) {
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const systemPrompt = messages.find((m) => m.role === 'system')?.content || '';
        const conversationMessages = messages.filter((m) => m.role !== 'system');

        // Build system parameter: Claude Code OAuth requires identity prompt as first block
        let systemParam;
        if (this.provider === 'claude-code') {
          const systemBlocks = [
            {
              type: 'text',
              text: "You are Claude Code, Anthropic's official CLI for Claude.",
              cache_control: { type: 'ephemeral' },
            },
          ];
          if (systemPrompt) {
            systemBlocks.push({
              type: 'text',
              text: typeof systemPrompt === 'string' ? systemPrompt : JSON.stringify(systemPrompt),
            });
          }
          systemParam = systemBlocks;
        } else {
          systemParam = systemPrompt;
        }

        const response = await this.client.messages.create({
          model: this.model,
          system: systemParam,
          messages: conversationMessages,
          tools: this._transformToolsToAnthropic(tools),
          max_tokens: this._getMaxTokensForModel(), // Model-specific max tokens
        });

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

        return {
          responseMessage: historyMessage,
          toolCalls: standardizedToolCalls,
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

    // Handle vision images - inject into the last user message if model supports vision
    if (context.imageData && context.imageData.length > 0) {
      const provider = context.provider || 'anthropic';

      // Check if this model supports vision
      const visionModels = ProviderRegistry.getVisionModels(provider);
      const supportsVision = visionModels.includes(this.model);

      if (supportsVision) {
        currentMessages = JSON.parse(JSON.stringify(messages)); // Deep clone

        // Find the last user message and add images
        for (let i = currentMessages.length - 1; i >= 0; i--) {
          if (currentMessages[i].role === 'user') {
            const originalContent = currentMessages[i].content;

            // Convert to Anthropic's content block format
            const contentBlocks = [
              {
                type: 'text',
                text: typeof originalContent === 'string' ? originalContent : JSON.stringify(originalContent),
              },
            ];

            // Add images
            context.imageData.forEach((img) => {
              contentBlocks.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: img.type,
                  data: img.data,
                },
              });
            });

            currentMessages[i].content = contentBlocks;
            console.log(`[Anthropic Vision] Added ${context.imageData.length} image(s) to last user message`);
            break;
          }
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
      let contentBlocks = [];

      try {
        const systemPrompt = currentMessages.find((m) => m.role === 'system')?.content || '';

        // CRITICAL: Clean up any _inputJsonString fields from message history before sending to Anthropic
        // This can happen if messages are reused across retries or if deletion failed
        const conversationMessages = currentMessages
          .filter((m) => m.role !== 'system')
          .map((msg) => {
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

        // Build system parameter: Claude Code OAuth requires identity prompt as first block
        let systemParam;
        if (this.provider === 'claude-code') {
          const systemBlocks = [
            {
              type: 'text',
              text: "You are Claude Code, Anthropic's official CLI for Claude.",
              cache_control: { type: 'ephemeral' },
            },
          ];
          if (systemPrompt) {
            systemBlocks.push({
              type: 'text',
              text: typeof systemPrompt === 'string' ? systemPrompt : JSON.stringify(systemPrompt),
            });
          }
          systemParam = systemBlocks;
        } else {
          systemParam = systemPrompt;
        }

        const abortSignal = context.abortSignal;
        const stream = await this.client.messages.stream({
          model: this.model,
          system: systemParam,
          messages: conversationMessages,
          tools: this._transformToolsToAnthropic(tools),
          max_tokens: this._getMaxTokensForModel(), // Model-specific max tokens
        });

        // Handle streaming events with error recovery
        let streamParseError = null;
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

            // Handle content block start
            if (event.type === 'content_block_start') {
              const block = event.content_block;
              if (block.type === 'text') {
                // Initialize text block
                contentBlocks.push({ type: 'text', text: '' });
              } else if (block.type === 'tool_use') {
                // Initialize tool use block
                contentBlocks.push({
                  type: 'tool_use',
                  id: block.id,
                  name: block.name,
                  input: {},
                });
              }
            }

            // Handle content block delta (streaming text or tool input)
            if (event.type === 'content_block_delta') {
              const delta = event.delta;
              const index = event.index;

              if (delta.type === 'text_delta') {
                // Accumulate text content
                const textDelta = delta.text || '';
                accumulatedContent += textDelta;

                if (contentBlocks[index]) {
                  contentBlocks[index].text += textDelta;
                }

                if (onChunk) {
                  onChunk({
                    type: 'content',
                    delta: textDelta,
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
              }
            }

            // Handle content block stop
            if (event.type === 'content_block_stop') {
              const index = event.index;
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
          // when parsing SSE events. If we have accumulated content, continue with it.
          streamParseError = streamIteratorError;
          console.error('[Anthropic] Stream iterator error:', streamIteratorError.message);
          console.log('[Anthropic] Accumulated content so far:', accumulatedContent.length, 'chars');
          console.log('[Anthropic] Accumulated tool calls so far:', accumulatedToolCalls.length);

          // If we have content or tool calls, we can continue
          // Otherwise, we'll need to retry or return an error
          if (accumulatedContent.length === 0 && accumulatedToolCalls.length === 0) {
            // No content accumulated, this is a real error - throw to trigger retry
            throw streamIteratorError;
          }

          // We have some content, continue with what we have
          console.log('[Anthropic] Continuing with accumulated content despite stream error');
        }

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

        return {
          responseMessage: responseMessage,
          toolCalls: accumulatedToolCalls,
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
  constructor(client, model) {
    super(client, model);

    // Models that support streaming + tool calling
    // Per Cerebras docs: "Streaming is supported for gpt-oss-120b, zai-glm-4.6, and non-reasoning models with these features"
    // However, llama models do NOT support streaming + tools
    this.streamingToolModels = new Set(['gpt-oss-120b', 'zai-glm-4.6']);

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

        return {
          responseMessage: message,
          toolCalls: message.tool_calls || [],
        };
      } catch (error) {
        lastError = error;

        // CRITICAL: If we get a 422 error with tools, the model doesn't support function calling
        // Retry WITHOUT tools so the model can still respond
        if (error.status === 422 && !skipTools && tools && tools.length > 0) {
          console.warn(
            `[Cerebras] Model '${this.model}' returned 422 with tools. This model may not support function calling. Retrying WITHOUT tools.`
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

          const contextResult = manageContext(currentMessages, this.model, tools);
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
              error
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
              }
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
          `Falling back to non-streaming mode. Supported models for streaming + tools: gpt-oss-120b, zai-glm-4.6`
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

      try {
        // Transform tools for Cerebras compatibility (strict: true, additionalProperties: false)
        const cerebrasTools = this._transformToolsForCerebras(tools);

        const requestParams = {
          model: this.model,
          messages: currentMessages,
          stream: true,
        };

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
          content: accumulatedContent || null,
          tool_calls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
        };

        return {
          responseMessage: responseMessage,
          toolCalls: accumulatedToolCalls,
        };
      } catch (error) {
        lastError = error;

        if (this.isTokenLimitError(error)) {
          console.warn(`Token limit error detected in Cerebras streaming (attempt ${attempt + 1})`);

          const contextResult = manageContext(currentMessages, this.model, tools);
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
              error
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
              }
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
  constructor(client, model) {
    super(client, model);
    this.maxRetries = 3;
    this.baseDelay = 1000; // 1 second
    this.retryableStatusCodes = new Set([429, 500, 502, 503, 504, 529]);
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

            // Handle text parts with type field
            if (part.type === 'text') {
              const textPart = { text: part.text || '' };
              // Preserve thought signature if present
              if (part.thoughtSignature) {
                textPart.thought_signature = part.thoughtSignature;
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

        // For thinking models, add thought signature to ALL text parts (not just user messages)
        if (isThinkingModel) {
          textPart.thought_signature = '';
        }
        // Preserve thought signature from previous model responses
        if (msg._geminiThoughtSignature) {
          textPart.thought_signature = msg._geminiThoughtSignature;
        }

        parts = [textPart];
      } else if (Array.isArray(msg.content)) {
        // Handle Anthropic-style content blocks or Gemini function responses
        const textBlock = msg.content.find((c) => c.type === 'text');
        if (textBlock) {
          const textPart = { text: textBlock.text };

          // For thinking models, add thought signature to ALL text parts (not just user messages)
          if (isThinkingModel) {
            textPart.thought_signature = '';
          }
          // Preserve thought signature from previous responses
          if (msg._geminiThoughtSignature) {
            textPart.thought_signature = msg._geminiThoughtSignature;
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
          console.warn(`Removing enum from non-string property: ${key} (type: ${prop.type})`);
          delete prop.enum;
        }

        // Recursively fix nested objects
        if (prop.type === 'object' && prop.properties) {
          prop.properties = this._fixSchemaForGemini({ properties: prop.properties }).properties;
        }

        // Recursively fix array items
        if (prop.type === 'array' && prop.items) {
          if (prop.items.properties) {
            prop.items = this._fixSchemaForGemini(prop.items);
          }
          // Fix enum in array items
          if (prop.items.enum && prop.items.type !== 'string') {
            console.warn(`Removing enum from non-string array items: ${key} (type: ${prop.items.type})`);
            delete prop.items.enum;
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

        return {
          responseMessage: responseMessage,
          toolCalls: toolCalls,
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

        // Calculate delay and wait before retrying
        const delay = this.calculateDelay(attempt);
        console.warn(`Gemini call failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${Math.round(delay)}ms:`, {
          status: error.status || error.response?.status,
          message: error.message,
        });

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

      // Check if this model supports vision
      const visionModels = ProviderRegistry.getVisionModels(provider);
      const supportsVision = visionModels.includes(this.model);

      if (supportsVision) {
        currentMessages = JSON.parse(JSON.stringify(messages)); // Deep clone

        // Find the last user message and add images
        for (let i = currentMessages.length - 1; i >= 0; i--) {
          if (currentMessages[i].role === 'user') {
            const originalContent = currentMessages[i].content;

            // For Gemini, we need to transform to parts format
            // This will be handled by _transformToGemini, but we need to prepare the content
            const contentParts = [{ type: 'text', text: originalContent }];

            // Add images
            context.imageData.forEach((img) => {
              contentParts.push({
                type: 'image',
                inlineData: {
                  mimeType: img.type,
                  data: img.data,
                },
              });
            });

            // Store as parts for Gemini transformation
            currentMessages[i].parts = contentParts;
            console.log(`[Gemini Vision] Added ${context.imageData.length} image(s) to user message`);
            break; // Only modify the last user message
          }
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

        const abortSignal = context.abortSignal;
        const response = await this.client.models.generateContentStream({
          model: this.model,
          config: config,
          contents: geminiMessages,
        });

        // Stream chunks
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

          // Check for function calls in the chunk
          if (chunk.functionCalls && Array.isArray(chunk.functionCalls)) {
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
        }

        // Log successful retry if this wasn't the first attempt
        if (attempt > 0) {
          console.log(`Gemini streaming call succeeded on attempt ${attempt + 1}/${this.maxRetries + 1}`);
        }

        const responseMessage = {
          role: 'assistant',
          content: accumulatedContent || null,
          tool_calls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
        };

        return {
          responseMessage: responseMessage,
          toolCalls: accumulatedToolCalls,
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

        // Calculate delay and wait before retrying
        const delay = this.calculateDelay(attempt);
        console.warn(`Gemini streaming call failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${Math.round(delay)}ms:`, {
          status: error.status || error.response?.status,
          message: error.message,
        });

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
  constructor(client, model) {
    super(client, model);
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
    return this.reasoningModels.has(this.model) || modelLower.startsWith('o1') || modelLower.startsWith('o3') || modelLower.startsWith('gpt-5');
  }

  /**
   * Transform OpenAI Chat Completions messages to Responses API input format
   */
  _transformMessagesToInput(messages) {
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

    return { instructions, input: flattenedInput };
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

        // Add instructions if present
        if (instructions) {
          requestParams.instructions = instructions;
        }

        // Add tools if present
        if (responsesTools && responsesTools.length > 0) {
          requestParams.tools = responsesTools;
        }

        // Add reasoning config for o-series models
        if (this.supportsReasoning()) {
          requestParams.reasoning = {
            effort: 'medium', // Can be 'low', 'medium', 'high'
          };
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
          content: textContent || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        };

        return {
          responseMessage: responseMessage,
          toolCalls: toolCalls,
          _responsesApiId: response.id, // Store for potential conversation continuation
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

      try {
        const { instructions, input } = this._transformMessagesToInput(messages);
        const responsesTools = this._transformToolsToResponses(tools);

        const requestParams = {
          model: this.model,
          input: input,
          stream: true,
          store: false,
        };

        if (instructions) {
          requestParams.instructions = instructions;
        }

        if (responsesTools && responsesTools.length > 0) {
          requestParams.tools = responsesTools;
        }

        if (this.supportsReasoning()) {
          requestParams.reasoning = {
            effort: 'medium',
          };
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
            }
          }
        }

        if (attempt > 0) {
          console.log(`OpenAI Responses streaming call succeeded on attempt ${attempt + 1}/${this.maxRetries + 1}`);
        }

        const responseMessage = {
          role: 'assistant',
          content: accumulatedContent || null,
          tool_calls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
        };

        return {
          responseMessage: responseMessage,
          toolCalls: accumulatedToolCalls,
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
  constructor(client, model) {
    super(client, model);
    // Codex models all support reasoning
    this.reasoningModels = new Set(['gpt-5-codex', 'gpt-5', 'gpt-5.1-codex-max', 'o1', 'o3']);
  }

  /**
   * Build Codex-specific request parameters.
   * Always includes `stream: true` because the ChatGPT backend rejects non-streaming requests.
   */
  _buildCodexParams(messages, tools) {
    const { instructions, input } = this._transformMessagesToInput(messages);
    const responsesTools = this._transformToolsToResponses(tools);

    const params = {
      model: this.model,
      input: input,
      instructions: instructions || '', // Codex always expects instructions field
      store: false,
      stream: true, // ChatGPT backend REQUIRES streaming
      include: ['reasoning.encrypted_content'],
    };

    // Add reasoning config for Codex models
    if (this.supportsReasoning()) {
      params.reasoning = {
        effort: 'medium',
        summary: 'auto',
      };
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
        }
      }
    }

    return { accumulatedContent, accumulatedToolCalls, responseId };
  }

  /**
   * Non-streaming call — uses streaming internally since the Codex endpoint requires it,
   * then returns the assembled response.
   */
  async call(messages, tools) {
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const params = this._buildCodexParams(messages, tools);

        console.log(`[Codex Responses] Calling model '${this.model}' via ChatGPT backend (streaming internally)`);
        console.log(`[Codex Responses] Input items: ${params.input.length}, Tools: ${params.tools?.length || 0}`);

        const stream = await this.client.responses.create(params);
        const { accumulatedContent, accumulatedToolCalls, responseId } = await this._consumeStream(stream);

        if (attempt > 0) {
          console.log(`Codex Responses call succeeded on attempt ${attempt + 1}/${this.maxRetries + 1}`);
        }

        return {
          responseMessage: {
            role: 'assistant',
            content: accumulatedContent || null,
            tool_calls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
          },
          toolCalls: accumulatedToolCalls,
          _responsesApiId: responseId,
        };
      } catch (error) {
        lastError = error;

        if (attempt === this.maxRetries || !this.isRetryableError(error)) {
          console.error(`Codex Responses call failed after ${attempt + 1} attempts, but NEVER STOPPING:`, {
            status: error.status,
            message: error.message,
          });

          const userFriendlyError = parseApiErrorMessage(error);

          return {
            responseMessage: {
              role: 'assistant',
              content: `⚠️ **Codex Responses API Error:** ${userFriendlyError}\n\nThis model (${this.model}) uses the Codex Responses API. Please check your OAuth connection or try a different model.`,
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

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const params = this._buildCodexParams(messages, tools);

        console.log(`[Codex Responses] Streaming call to model '${this.model}' via ChatGPT backend`);

        const abortSignal = context.abortSignal;
        const stream = await this.client.responses.create(params);
        const { accumulatedContent, accumulatedToolCalls } = await this._consumeStream(stream, onChunk, abortSignal);

        if (attempt > 0) {
          console.log(`Codex Responses streaming call succeeded on attempt ${attempt + 1}/${this.maxRetries + 1}`);
        }

        return {
          responseMessage: {
            role: 'assistant',
            content: accumulatedContent || null,
            tool_calls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
          },
          toolCalls: accumulatedToolCalls,
        };
      } catch (error) {
        lastError = error;

        if (attempt === this.maxRetries || !this.isRetryableError(error)) {
          console.error(`Codex Responses streaming call failed after ${attempt + 1} attempts, but NEVER STOPPING:`, {
            status: error.status,
            message: error.message,
          });

          const userFriendlyError = parseApiErrorMessage(error);

          return {
            responseMessage: {
              role: 'assistant',
              content: `⚠️ **Codex Responses API Error:** ${userFriendlyError}\n\nThis model (${this.model}) uses the Codex Responses API. Please check your OAuth connection or try a different model.`,
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

  // GPT-5 models
  if (modelLower.startsWith('gpt-5')) return true;

  // o-series reasoning models
  if (modelLower.startsWith('o1')) return true;
  if (modelLower.startsWith('o3')) return true;

  // Specific model names
  const responsesApiModels = ['gpt-5', 'gpt-5.1-codex-max', 'o1', 'o1-mini', 'o1-preview', 'o3', 'o3-mini', 'o3-preview'];

  return responsesApiModels.includes(modelLower);
}

/**
 * Factory function to create the appropriate LLM adapter.
 * @param {string} provider The name of the AI provider.
 * @param {Object} client The initialized SDK client.
 * @param {string} model The model name.
 * @returns {Promise<BaseAdapter>} An instance of a provider-specific adapter.
 */
export async function createLlmAdapter(provider, client, model) {
  const lowerCaseProvider = provider.toLowerCase();

  // Check if this is a custom provider (UUID format)
  const isCustom = await CustomOpenAIProviderService.isCustomProvider(provider);
  if (isCustom) {
    console.log(`[LLM Adapter] Using OpenAI-like adapter for custom provider: ${provider}`);
    return new OpenAiLikeAdapter(client, model);
  }

  switch (lowerCaseProvider) {
    case 'claude-code':
    case 'anthropic':
      return new AnthropicAdapter(client, model, lowerCaseProvider);

    case 'gemini':
      return new GeminiAdapter(client, model);

    case 'cerebras':
      console.log(`[LLM Adapter] Using CerebrasAdapter for model: ${model}`);
      return new CerebrasAdapter(client, model);

    case 'openai':
    case 'openai-codex':
      // Check if this model requires the new Responses API (GPT-5, o-series)
      if (requiresResponsesApi(model)) {
        console.log(`[LLM Adapter] Using OpenAIResponsesAdapter for model: ${model} (Responses API)`);
        return new OpenAIResponsesAdapter(client, model);
      }
      return new OpenAiLikeAdapter(client, model);

    case 'openai-codex-cli':
      // Codex CLI models use the ChatGPT backend Responses API (different from standard OpenAI).
      if (requiresResponsesApi(model)) {
        console.log(`[LLM Adapter] Using CodexResponsesAdapter for codex-cli model: ${model} (ChatGPT backend)`);
        return new CodexResponsesAdapter(client, model);
      }
      return new OpenAiLikeAdapter(client, model);

    case 'deepseek':
    case 'grokai':
    case 'groq':
    case 'kimi':
    case 'local':
    case 'minimax':
    case 'openrouter':
    case 'togetherai':
    case 'zai':
      return new OpenAiLikeAdapter(client, model);

    default:
      throw new Error(`Unsupported provider for LLM adapter: ${provider}`);
  }
}
