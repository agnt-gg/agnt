/**
 * The Anthropic Messages transport — anthropic and claude-code.
 *
 * The largest single transport, and deliberately so: explicit cache
 * breakpoints, extended thinking, adaptive thinking, the Claude Code billing
 * header, prompt-too-long shrinking and tool-pairing repair all live on this
 * wire and nowhere else. It measures 99.2% cache hit rate with a 17x cost
 * reduction, so it is the reference implementation, not a refactor target.
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
  sanitizeAnthropicToolSchemas,
  isFableOrMythosModel,
  stripThinkingBlocksFromHistory,
  slimLargeToolResultsForFableMythos,
  logAnthropicPreCall,
  buildAnthropicReasoningConfig,
} from './_shared.js';

class AnthropicAdapter extends BaseAdapter {
  constructor(client, model, provider = 'anthropic', options = {}) {
    super(client, model);
    this.provider = provider.toLowerCase();
    this.reasoningValue = options.reasoningValue || 'default';
    this.maxRetries = 3;
    // Prompt-overflow shrink budget (mirrors CodexResponsesAdapter's
    // maxContextShrinkRetries). Each shrink drops oldest message units and
    // retries without consuming the transient-error retry budget.
    this.maxContextShrinkRetries = 4;
    this.baseDelay = 1000; // 1 second
    this.retryableStatusCodes = new Set([429, 500, 502, 503, 504, 529]);
    this.lastRetryAfterMs = null;

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
   * Calculate delay with exponential backoff and jitter. Anthropic's explicit
   * Retry-After floor wins when present, capped with the existing 30s ceiling.
   */
  calculateDelay(attempt) {
    const exponentialDelay = this.baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
    return Math.min(Math.max(exponentialDelay + jitter, this.lastRetryAfterMs || 0), 30000);
  }

  _captureRetryAfter(error) {
    const raw = error?.headers?.get?.('retry-after') ?? error?.headers?.['retry-after'];
    const seconds = Number(raw);
    this.lastRetryAfterMs = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
  }

  /**
   * Check if an error is retryable
   */
  isRetryableError(error) {
    this._captureRetryAfter(error);
    if (error.status && this.retryableStatusCodes.has(error.status)) {
      return true;
    }    // Transient network / SDK-wrapped connection errors (e.g. the Anthropic
    // SDK's APIConnectionError: status=undefined, message='Connection error.').
    // Without this, a mid-stream network hiccup killed the retry loop — and
    // the refusal→fallback-model call — on the first attempt.
    if (this._isTransientNetworkError(error)) {
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
  }  _transformToolsToAnthropic(tools) {
    if (!tools || tools.length === 0) return [];
    // Repair any schema violations Anthropic's draft-2020-12 validator rejects
    // BEFORE mapping. One bad tool schema 400s the whole request otherwise.
    const safeTools = sanitizeAnthropicToolSchemas(tools);
    return safeTools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    }));
  }

  /**
   * Convert OpenAI-format history messages to Anthropic format.
   * - assistant messages with tool_calls → content array with tool_use blocks
   * - role:"tool" messages → role:"user" with tool_result content blocks
   * - Merge consecutive same-role messages (Anthropic requires alternating)
   */
  _normalizeHistoryMessages(messages) {
    // Both AnthropicAdapter entry points (call + callStream) funnel through
    // here immediately before the request body is built, so this single hook
    // guards every outbound Anthropic payload. Running BEFORE the conversion
    // below is deliberate: the sanitizer emits whichever shape matches the
    // input (role:'tool' for OpenAI-style tool_calls, user/tool_result for
    // Anthropic blocks), and the conversion + consecutive-role merge that
    // follow normalize any injected message into the correct final form.
    messages = BaseAdapter._sanitizeOutbound(messages, 'anthropic');

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
    // without inserting a synthetic assistant turn.
    //
    // FIXED: the merge below still runs (it has to - Anthropic rejects
    // consecutive same-role messages), and a repair pass then splits any
    // resulting [tool_result..., text] user message into two turns with a
    // minimal synthetic assistant turn between them. That satisfies both
    // constraints at once. See BaseAdapter._splitTextAfterToolResults.
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

    return BaseAdapter._splitTextAfterToolResults(merged);
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
   * Anthropic's hard context rejection. Distinct from other 400s: the request
   * is structurally valid, it is simply bigger than the window, so the ONLY
   * correct recovery is sending less — never a blind retry.
   */
  _isPromptTooLongError(error) {
    return error?.status === 400 && /prompt is too long/i.test(error?.message || '');
  }

  /**
   * Drop the oldest message units until enough is gone to clear the wall.
   *
   * The 400 message tells us exactly how far over we are ("N tokens > M
   * maximum"), so the drop target is derived from the provider's own count,
   * not the estimator that just missed. Chars are converted at a deliberately
   * conservative 3.0 chars/token: denser content drops MORE than the target,
   * and if it still misses, the next 400 recomputes from its own numbers.
   *
   * Pairing-safe: after removing a leading message, any now-leading user
   * messages carrying tool_result blocks are swept too, so no tool_result
   * ever arrives without its tool_use ("unexpected tool_use_id" 400).
   * Returns a NEW array — the caller's canonical history (persisted to
   * conversation_logs by the orchestrator) is never mutated.
   */
  _shrinkForPromptTooLong(messagesArr, error) {
    const m = /prompt is too long:\s*(\d+)\s*tokens\s*>\s*(\d+)\s*maximum/i.exec(error?.message || '');
    const realTokens = m ? parseInt(m[1], 10) : null;
    const maxTokens = m ? parseInt(m[2], 10) : null;
    const overshoot = realTokens && maxTokens ? realTokens - maxTokens : null;
    const targetDropTokens = overshoot
      ? Math.ceil(overshoot * 1.25) + 2000
      : Math.ceil(((maxTokens || 200000)) * 0.15);
    const targetDropChars = targetDropTokens * 3.0;

    const kept = [...messagesArr];
    const isSystem = (msg) => msg?.role === 'system';
    const hasToolResult = (msg) =>
      Array.isArray(msg?.content) && msg.content.some((b) => b?.type === 'tool_result');
    const sizeOf = (msg) => {
      try { return JSON.stringify(msg).length; } catch { return 0; }
    };
    const nonSystemCount = () => kept.filter((msg) => !isSystem(msg)).length;
    const firstNonSystemIdx = () => kept.findIndex((msg) => !isSystem(msg));

    let droppedChars = 0;
    let dropped = 0;
    // Always keep the last 2 non-system messages — the live exchange.
    while (droppedChars < targetDropChars && nonSystemCount() > 2) {
      const idx = firstNonSystemIdx();
      if (idx === -1) break;
      droppedChars += sizeOf(kept[idx]);
      kept.splice(idx, 1);
      dropped++;
      // Sweep orphaned tool_results now at the front.
      let next = firstNonSystemIdx();
      while (next !== -1 && hasToolResult(kept[next]) && nonSystemCount() > 2) {
        droppedChars += sizeOf(kept[next]);
        kept.splice(next, 1);
        dropped++;
        next = firstNonSystemIdx();
      }
    }
    // The keep-last-2 floor can stop the loop with a tool_result stranded at
    // the front (its tool_use was in the dropped region). An orphaned
    // tool_result guarantees another 400, so validity beats the floor here:
    // sweep leading tool_results as long as one non-system message survives.
    let front = firstNonSystemIdx();
    while (front !== -1 && hasToolResult(kept[front]) && nonSystemCount() > 1) {
      droppedChars += sizeOf(kept[front]);
      kept.splice(front, 1);
      dropped++;
      front = firstNonSystemIdx();
    }
    return { messages: kept, dropped, droppedChars, overshoot };
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
    let shrinkAttempts = 0;
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
        console.warn(`[Vision Check] Supported vision models for ${provider}: ${ProviderRegistry.getVisionModels(provider).join(', ')}`);
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
      // Tool calls whose argument JSON arrived incomplete (stream truncated
      // mid-`input_json_delta`, typically `stop_reason: max_tokens`). These are
      // NEVER emitted as tool calls — see the content_block_stop handler.
      let truncatedToolCalls = [];
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
            // With those models now recognized by isAnthropicReasoningModel,
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
                // Announce tool call immediately so the UI can render a pending
                // pill while args still stream. Anthropic only emits the final
                // tool_call_delta on content_block_stop (after full args parse),
                // which is what made the UI look frozen during long arg writes.
                console.log('[Anthropic DEBUG] content_block_start tool_use:', block.name, block.id);
                if (onChunk) {
                  onChunk({
                    type: 'tool_call_delta',
                    index: idx,
                    toolCall: {
                      id: block.id,
                      type: 'function',
                      function: { name: block.name, arguments: '' },
                    },
                  });
                }
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
                // Parse the accumulated JSON string now that the block is closed.
                //
                // A PARSE FAILURE HERE IS A TRUNCATED TOOL CALL, NOT AN EMPTY ONE.
                // Anthropic streams tool arguments as `input_json_delta` fragments
                // and closes the block even when generation stopped early — most
                // often `stop_reason: max_tokens` partway through a large argument
                // payload. The previous code caught the SyntaxError and substituted
                // `block.input = {}`, then emitted the tool call anyway. Downstream
                // that is indistinguishable from the model deliberately calling a
                // tool with no arguments, so it executed.
                //
                // Measured impact before this fix: 73 of 3,519 production
                // `edit_file` calls ran with `{}`, resolved their absent `path` to
                // the workspace root directory, and failed with
                // `EISDIR: illegal operation on a directory, read` — an error that
                // pointed at the filesystem instead of at the truncation.
                //
                // A tool call whose arguments did not survive the wire is not a
                // tool call. Record it, do not emit it, and let the retry /
                // validation-feedback path upstream deal with it.
                //
                // AN ARGUMENT-LESS CALL STREAMS AS AN *EMPTY* FRAGMENT, NOT AS
                // ZERO FRAGMENTS. Anthropic emits one `input_json_delta` whose
                // `partial_json` is "" for a tool invoked with no arguments
                // (scan_page_elements, list_tools, get_canvas_state, ...), so
                // `_inputJsonString` becomes "" - present, but FALSY.
                //
                // The guard here used to be `if (block._inputJsonString)`, a
                // truthiness test on a string. "" skipped the whole branch, so
                // the accumulator was never deleted; the post-stream sweep then
                // tested `!== undefined`, matched it, and filed a perfectly
                // healthy call as an unclosed truncation. Measured consequence
                // (execution 3b4cb1d4, claude-opus-5, 2026-07-28): 3 wasted
                // requests, the tool_use block stripped from the assistant
                // message while the tool call itself still executed, the
                // resulting tool_result orphaned and sanitized away, and the
                // next request sent ending on an assistant turn ->
                //   400 "This model does not support assistant message prefill."
                //
                // Empty is not corrupt. Empty is {}. Same rule toolArgGuard
                // applies to values: absent and empty are different things.
                // Whether {} is *legal* for this tool is the required-param
                // gate's decision, not the transport's.
                let argumentsCorrupt = false;
                if (block._inputJsonString !== undefined) {
                  try {
                    block.input = block._inputJsonString.trim() === ''
                      ? {}
                      : JSON.parse(block._inputJsonString);
                  } catch (parseError) {
                    argumentsCorrupt = true;
                    console.error(
                      `[Anthropic] TRUNCATED tool call "${block.name}" — argument JSON is incomplete ` +
                      `(${block._inputJsonString.length} chars, stop_reason=${anthropicStopReason || 'null'}): ${parseError.message}`,
                    );
                    console.error('[Anthropic] Raw (truncated) JSON:', block._inputJsonString.slice(0, 400));
                    truncatedToolCalls.push({
                      toolCall: {
                        id: block.id,
                        type: 'function',
                        function: { name: block.name, arguments: block._inputJsonString },
                      },
                      issues: [
                        `Argument JSON was truncated mid-stream (${block._inputJsonString.length} chars received, ` +
                        `stop_reason=${anthropicStopReason || 'null'}) and could not be parsed: ${parseError.message}`,
                      ],
                      blockIndex: index,
                    });
                  }

                  // CRITICAL: Delete the temporary field to prevent it from being sent back to Anthropic
                  // Anthropic will reject messages with "_inputJsonString: Extra inputs are not permitted"
                  delete block._inputJsonString;
                }

                if (!argumentsCorrupt) {
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

        // ---- Truncated tool-call gate -----------------------------------
        //
        // Two ways a tool call can fail to survive the stream:
        //
        //   1. `content_block_stop` arrived but the accumulated argument JSON
        //      was incomplete (recorded above in `truncatedToolCalls`).
        //   2. `content_block_stop` never arrived at all — the block is still
        //      holding `_inputJsonString`. Previously these vanished in
        //      silence: the model believed it had called a tool, the
        //      orchestrator saw zero tool calls, and the turn simply stopped.
        //
        // Both are transient generation failures, and both are retryable. The
        // OpenAI-like adapter already retries its equivalent case; Anthropic
        // did not. Retrying costs one request and usually succeeds — in
        // production the model spontaneously reissued these calls ~20s later
        // and they went through.
        for (const block of contentBlocks) {
          if (block && block.type === 'tool_use' && block._inputJsonString !== undefined) {
            const raw = block._inputJsonString;
            delete block._inputJsonString;
            console.error(
              `[Anthropic] UNCLOSED tool call "${block.name}" — stream ended without content_block_stop ` +
              `(${raw.length} chars of arguments received, stop_reason=${anthropicStopReason || 'null'})`,
            );
            truncatedToolCalls.push({
              toolCall: { id: block.id, type: 'function', function: { name: block.name, arguments: raw } },
              issues: [
                `Tool call was never closed by the provider (stop_reason=${anthropicStopReason || 'null'}); ` +
                `${raw.length} chars of argument JSON received.`,
              ],
              unclosed: true,
            });
          }
        }

        if (truncatedToolCalls.length > 0 && attempt < this.maxRetries) {
          console.warn(
            `[Anthropic] ${truncatedToolCalls.length} truncated tool call(s) ` +
            `(stop_reason=${anthropicStopReason || 'null'}) — retrying ` +
            `(attempt ${attempt + 1}/${this.maxRetries + 1})`,
          );
          await this.sleep(this.calculateDelay(attempt));
          continue streamingAttemptLoop;
        }

        if (truncatedToolCalls.length > 0) {
          console.error(
            `[Anthropic] ${truncatedToolCalls.length} tool call(s) still truncated after ` +
            `${this.maxRetries + 1} attempts — surfacing to the orchestrator as invalid ` +
            `rather than executing them with empty arguments`,
          );
        }

        // Log successful retry if this wasn't the first attempt
        if (attempt > 0) {
          console.log(`Anthropic streaming call succeeded on attempt ${attempt + 1}/${this.maxRetries + 1}`);
        }

        // CRITICAL: Final cleanup of _inputJsonString from all contentBlocks before returning
        // This ensures no _inputJsonString fields make it into the conversation history
        // Drop tool_use blocks whose arguments were truncated. Leaving one in
        // the assistant message would create an orphan: a `tool_use` with no
        // matching `tool_result` on the next turn, which Anthropic rejects
        // outright ("unexpected tool_use_id"). `.filter(Boolean)` also closes
        // the sparse-array holes left by indexed block assignment, which would
        // otherwise serialize as `null` content entries.
        const truncatedToolUseIds = new Set(truncatedToolCalls.map((t) => t.toolCall.id));
        const cleanedContentBlocks = contentBlocks
          .filter((block) => Boolean(block) && !(block.type === 'tool_use' && truncatedToolUseIds.has(block.id)))
          .map((block) => {
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
        // CLASS INVARIANT: a tool call the model cannot be SHOWN to have
        // made must never be executed.
        //
        // `cleanedContentBlocks` above removes the tool_use block of any
        // call judged unusable. If the matching entry survived in
        // `accumulatedToolCalls`, the two halves of this return value
        // contradict each other - and the orchestrator believes the
        // toolCalls half. It executes the tool and appends a tool_result
        // whose tool_use is absent from the assistant message. The outbound
        // sanitizer strips that orphan, the carrier user message empties
        // out, and the request ends on an assistant turn: a hard 400 on
        // prefill-less models (opus 5) and a SILENT loss of the tool result
        // on every other one.
        //
        // Reconciling here makes that desync unrepresentable, whatever
        // future path removes a block.
        accumulatedToolCalls = BaseAdapter._reconcileToolCallsWithContent(
          accumulatedToolCalls,
          cleanedContentBlocks,
          'anthropic',
        );

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
          // Surfacing this field is what activates the orchestrator's existing
          // validation-feedback recovery pipeline (OrchestratorService ~1786).
          // That pipeline was written generically but only ever received data
          // from OpenAiLikeAdapter, so for Anthropic it was dead code.
          invalidToolCalls: truncatedToolCalls.length > 0 ? truncatedToolCalls : undefined,
          usage: anthropicUsage.input_tokens || anthropicUsage.output_tokens ? anthropicUsage : undefined,
          ...(wasEmpty ? { recoveredFromError: true, recoveredError: 'Provider returned empty response' } : {}),
        };
      } catch (error) {
        lastError = error;

        // Prompt overflow: the preflight estimator undercounted and the
        // request hit Anthropic's hard wall. Retrying unchanged can never
        // succeed — drop the oldest history units (the 400 itself says how
        // far over we are) and rebuild. Mirrors the Codex shrink path; does
        // not consume the transient-error retry budget.
        if (this._isPromptTooLongError(error) && shrinkAttempts < this.maxContextShrinkRetries) {
          const before = currentMessages.length;
          const shrink = this._shrinkForPromptTooLong(currentMessages, error);
          if (shrink.dropped > 0) {
            currentMessages = shrink.messages;
            shrinkAttempts++;
            console.warn(
              `[Anthropic] Prompt too long${shrink.overshoot ? ` (${shrink.overshoot} tokens over)` : ''} — ` +
              `dropped ${shrink.dropped} oldest message(s) (${before} -> ${currentMessages.length}), ` +
              `retrying (shrink ${shrinkAttempts}/${this.maxContextShrinkRetries})`
            );
            attempt--;
            continue streamingAttemptLoop;
          }
        }

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

export { AnthropicAdapter };
