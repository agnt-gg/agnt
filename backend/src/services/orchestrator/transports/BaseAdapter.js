/**
 * The behaviour every transport shares, regardless of wire protocol.
 *
 * Cache markers, cache affinity, rolling breakpoints and tool-result
 * formatting live here because they are CONVERSATION concepts, not
 * protocol concepts: OpenRouter accepts Anthropic's cache_control shape
 * verbatim, and three unrelated adapter hierarchies need the same affinity
 * hint. A per-hierarchy copy would drift.
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

class BaseAdapter {
  constructor(client, model) {
    if (this.constructor === BaseAdapter) {
      throw new Error('BaseAdapter cannot be instantiated directly.');
    }
    this.client = client;
    this.model = model;
  }

  /**
   * Apply cache_control marker to a message's content.
   * Handles string content, array content, and tool_result messages.
   *
   * Lives on BaseAdapter, not AnthropicAdapter, because `cache_control` is not
   * an Anthropic-SDK concept — it is a CONTENT-BLOCK concept. OpenRouter
   * accepts the identical shape on the OpenAI-compatible endpoint and
   * translates it to each upstream's native format, so the Anthropic adapter
   * and the OpenAI-like adapter need the exact same primitive. Duplicating it
   * would let the two copies drift, and the drift would be invisible: a
   * mis-placed breakpoint does not error, it silently bills full price.
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
   * Everything this request carries to pin itself to a cached prefix.
   *
   * Lives on BaseAdapter, like _applyCacheMarker above and for the same
   * reason: cache affinity is not an OpenAI-compatible-transport concept, it
   * is a CONVERSATION concept. Three unrelated adapter hierarchies need it,
   * and a per-hierarchy copy would drift.
   *
   * Split into `body` and `headers` because providers disagree about WHERE the
   * hint belongs, not about whether one helps. One method, so "which providers
   * get an affinity hint" is a single readable list rather than a condition
   * scattered across six call sites.
   *
   *   openrouter    session_id (body) — documented sticky-routing key.
   *
   *   grokai        x-grok-conv-id (header) + prompt_cache_key (body).
   *                 xAI: "we recommend setting the x-grok-conv-id HTTP header
   *                 to maximize your cache hit rate" (docs.x.ai, 2026-08-09).
   *                 Measured before: a COLD conversation reused 128 of 39,998
   *                 tokens on turn 2 (0.3%, $0.0499) while a warm one reached
   *                 99.8% ($0.0081). After: 99.9%.
   *
   *   openai-codex  session_id (header) + prompt_cache_key (body).
   *                 See the measurement note below — this one took four
   *                 experiments to get right.
   *
   * NOT openai: it already measures 97.9% via prompt_cache_options /
   * prompt_cache_retention (openAIPromptCachePolicy). Adding a second,
   * overlapping hint to a path that already works is risk without a measured
   * benefit.
   *
   * ── openai-codex, and why the obvious answer was wrong twice ─────────────
   *
   * Codex first measured 0% over two turns, which looked like the Grok defect.
   * It was not, and neither of the first two hypotheses survived contact:
   *
   *   prompt_cache_key alone   1/5 vs 1/5 baseline (gpt-5.4-mini)
   *                            1/3 vs 2/3 baseline (gpt-5.6-sol)  → no effect
   *   prompt_cache_breakpoint  HTTP 400 "not supported on this model"
   *   prompt_cache_options     HTTP 400 (the pre-existing finding)
   *   store:true + previous_response_id   HTTP 400
   *
   * The whole GPT-5.6 explicit-cache toolkit is closed on the ChatGPT backend.
   * A properly powered baseline (two runs, 20 scored turns) put the real hit
   * rate at 13/20 ≈ 65%, not 0% — the early number was under-powered AND on
   * gpt-5.4-mini, while this provider's model list leads with the 5.6 family.
   *
   * What actually worked was noticing that AGNT already impersonates the Codex
   * CLI almost exactly — OpenAI-Beta: responses=experimental, originator:
   * codex_cli_rs, chatgpt-account-id, pinned client_version — and was missing
   * only the CLI's `session_id` header. A private backend is far likelier to
   * key affinity on its own session header than on the public parameter, which
   * is exactly what the evidence shows (12 turns/arm, candidate arm run FIRST
   * so warming penalises it, gpt-5.6-sol, 18k byte-identical prefix):
   *
   *   baseline                        7/11
   *   session_id + prompt_cache_key  11/11
   *   session_id alone               11/11   ← the header is the mechanism
   *
   * Depth when it hits was 17,152 of 18,041 tokens (95%) in every case, so the
   * gain is in FREQUENCY: ~62% of the prefix reused on average before, ~95%
   * after. Header value need not be a UUID — an `agnt-`-prefixed conversation
   * id measured 7/7.
   *
   * prompt_cache_key rides along because it is the DOCUMENTED public mechanism
   * and costs nothing (accepted, no 400, no measured behaviour change on its
   * own). The header is the part that works today; the parameter is the part
   * that is specified. Neither is load-bearing for the other.
   *
   * Capped at 256 chars per the OpenRouter contract; AGNT conversation ids are
   * UUIDs, so the slice guards a future id format, not a live concern.
   */
  _cacheAffinity() {
    if (!this.conversationId) return null;
    const id = `agnt-${this.conversationId}`.slice(0, 256);

    switch (this.provider) {
      case 'openrouter':
        return { body: { session_id: id }, headers: null };
      case 'grokai':
        return { body: { prompt_cache_key: id }, headers: { 'x-grok-conv-id': id } };
      case 'openai-codex':
        return { body: { prompt_cache_key: id }, headers: { session_id: id } };
      default:
        return null;
    }
  }

  /** Body-only view of _cacheAffinity, for callers that merge into the payload. */
  _cacheRoutingParams() {
    return this._cacheAffinity()?.body || null;
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
   * All-1h rolling breakpoints (PRD-113).
   *
   * With `count >= 2`:
   *   - 1-hour marker on the second-to-last non-system message (the end of the
   *     stable prior-turn prefix). Anthropic caches everything up to and
   *     including this block, so prior turns survive long tool pauses / reads.
   *   - 1-hour marker on the last non-system message (the current turn).
   *
   * Why the tail is 1h and NOT 5m: a 5m tail double-writes every turn — the
   * newest message is written once at the 5m rate (1.25x), then re-written at
   * the 1h rate (2x) next turn when it joins the long-lived prefix. Measured
   * live (2026-07-06, cache-wars-bench E4 vs E4b, Sonnet 4.5): 5m-tail hybrid
   * wrote ~10.4k tokens/turn steady-state vs ~5.2k for all-1h — all-1h was
   * strictly cheaper ($0.262 vs $0.323 over 5 turns + one idle gap).
   *
   * With `count === 1` (or only one eligible message): a single 1h marker on
   * the latest message.
   *
   * The caller (Anthropic adapter) must also mark system + tools with 1h,
   * for a total of 4 breakpoints, all 1h.
   *
   * `marker` is a parameter rather than a hardcoded literal so the same
   * placement strategy can carry a different TTL. Not every upstream honours
   * 1h: routed through OpenRouter, Alibaba's cache is a fixed 5-minute window
   * and rejects nothing — it just ignores the field. Passing the marker in
   * keeps ONE placement implementation while letting the caller state the only
   * thing that actually varies.
   *
   * IMPORTANT: Always strip stale markers first. When the adapter loops
   * through multiple tool-call rounds in one turn, markers on old message
   * positions must be cleared or the 4-breakpoint cap is exceeded.
   */
  _applyRollingCacheBreakpoints(messages, count = 2, marker = { type: 'ephemeral', ttl: '1h' }) {
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
      this._applyCacheMarker(messages[prefixIdx], { ...marker });
      this._applyCacheMarker(messages[latestIdx], { ...marker });
    } else if (count >= 1) {
      this._applyCacheMarker(messages[latestIdx], { ...marker });
    }
  }

  /**
   * Last-line-of-defense guard for outbound provider payloads.
   *
   * The orchestrator sanitizes its message LEDGER (`messages`), but the array
   * that actually goes on the wire is a DERIVED copy produced by
   * compactMessageHistory() + manageContext(). Those transforms run AFTER the
   * sanitize, and the adapter is handed the derived array directly
   * (`contextResult.messages`), so a dangling tool_use left by an aborted,
   * capped, or errored tool round could still reach the provider and 400 with:
   *   "tool_use ids were found without tool_result blocks immediately after"
   *   "unexpected tool_use_id found in tool_result blocks"
   *
   * Sanitizing HERE - at the single choke point where a message array becomes
   * an HTTP request - closes that gap for every caller (orchestrator,
   * LlmExecutionService, AutonomousMessageService, workflow nodes, agent chat)
   * and for any call site added later. The sanitizers are idempotent, so
   * double-application on nested paths costs nothing.
   *
   * @param {Array<Object>} messages Outbound conversation history.
   * @param {string} label Provider label, used for diagnostics only.
   * @returns {Array<Object>} A structurally valid history.
   */
  static _sanitizeOutbound(messages, label = 'provider') {
    if (!Array.isArray(messages) || messages.length === 0) return messages;
    const before = messages.length;
    let out = sanitizeOrphanToolCalls(messages);
    out = sanitizeUnexpectedToolResults(out);
    if (out.length !== before) {
      console.warn(
        `[Adapter Guard] ${label}: outbound history repaired at the wire ` +
        `(${before} -> ${out.length} messages). An upstream transform emitted ` +
        `an unpaired tool_use/tool_result.`
      );
    }
    return out;
  }

  /**
   * Minimal synthetic assistant turn inserted when a user turn has to be split
   * away from the tool results preceding it. Deliberately contentless: it must
   * not put reasoning, claims, or an answer into the model's mouth.
   */
  static TOOL_RESULT_BRIDGE_TEXT = '(Continuing.)';

  /**
   * Structural invariant: a tool call the model cannot be SHOWN to have made
   * must never be executed.
   *
   * An adapter returns two halves that describe the same event: the assistant
   * message (what the model said) and the tool call list (what we will run).
   * Any path that removes a tool_use block from the message without also
   * removing its call desynchronises them - and the orchestrator believes the
   * call list. It executes the tool and appends a tool_result whose tool_use
   * is absent from the assistant message. The outbound sanitizer strips that
   * orphan, the carrier user message empties out, and the request ends on an
   * assistant turn:
   *   400 "This model does not support assistant message prefill."
   * on prefill-less models (claude-opus-5), and a SILENT loss of the tool
   * result on every other one.
   *
   * Measured 2026-07-28, execution 3b4cb1d4: this is exactly how an
   * argument-less `scan_page_elements` took down a workspace turn.
   *
   * Kept as a named helper rather than inlined because no *current* input can
   * reach it - which means only a direct unit test can prove it still works.
   *
   * @param {Array<Object>} toolCalls  OpenAI-shaped calls the adapter would emit.
   * @param {Array<Object>} contentBlocks  Blocks that survived into the message.
   * @param {string} label  Provider label, diagnostics only.
   * @returns {Array<Object>} Only the calls whose tool_use block survived.
   */
  static _reconcileToolCallsWithContent(toolCalls, contentBlocks, label = 'provider') {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) return toolCalls;

    const shownIds = new Set(
      (Array.isArray(contentBlocks) ? contentBlocks : [])
        .filter((b) => b && b.type === 'tool_use' && b.id)
        .map((b) => b.id),
    );

    const kept = toolCalls.filter((tc) => tc && shownIds.has(tc.id));
    if (kept.length !== toolCalls.length) {
      const dropped = toolCalls
        .filter((tc) => !tc || !shownIds.has(tc.id))
        .map((tc) => `${tc?.function?.name || 'unknown'}(${tc?.id || 'no-id'})`);
      console.error(
        `[Adapter Guard] ${label}: dropping ${dropped.length} tool call(s) whose tool_use ` +
        `block did not survive into the assistant message: ${dropped.join(', ')}. ` +
        `Executing them would orphan their tool_result on the next turn.`,
      );
    }
    return kept;
  }

  /**
   * Split any user message shaped [tool_result..., <other blocks>] into two
   * turns separated by a minimal synthetic assistant turn.
   *
   * WHY
   * ---
   * Anthropic's guidance is explicit: never place text blocks immediately after
   * tool results. It teaches the model to expect user input after every tool
   * use and is a documented cause of degenerate 2-3 token end_turn responses
   * (PRD-082). The shape arises naturally whenever a user message follows a
   * tool-result carrier with no assistant turn between them - the alternation
   * merge in _normalizeHistoryMessages folds the two together. Mid-run steering
   * hit this, but so does any ordinary follow-up typed during a tool round.
   *
   * The merge cannot simply be skipped: Anthropic also rejects consecutive
   * same-role messages. So the repair runs after it - keep the tool_result
   * blocks attached to the assistant tool_use that produced them, emit a
   * minimal assistant turn, then carry the remaining blocks as their own user
   * turn. Both invariants hold simultaneously.
   *
   * Properties this pass is required to have, and which the tests pin:
   *  - Identity (by reference-equal content) when the shape is absent.
   *  - Idempotent: no output user message has content after its last
   *    tool_result, so a second pass cannot find anything to split.
   *  - Pairing-preserving: tool_result blocks stay immediately after their
   *    originating assistant message, so tool_use/tool_result pairing and
   *    strict alternation both survive.
   *
   * @param {Array<Object>} messages Anthropic-shaped, post-merge history.
   * @returns {Array<Object>} History with the anti-pattern removed.
   */
  static _splitTextAfterToolResults(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return messages;

    let splitCount = 0;
    const out = [];

    for (const msg of messages) {
      if (!msg || msg.role !== 'user' || !Array.isArray(msg.content)) {
        out.push(msg);
        continue;
      }

      const lastResultIdx = msg.content.map((b) => b?.type).lastIndexOf('tool_result');
      // No tool results, or nothing trailing them: already correct.
      if (lastResultIdx === -1 || lastResultIdx === msg.content.length - 1) {
        out.push(msg);
        continue;
      }

      const head = msg.content.slice(0, lastResultIdx + 1);
      // Whitespace-only text blocks are dropped rather than promoted into a
      // turn of their own - manufacturing an assistant turn to carry nothing
      // would add noise to every subsequent request.
      const trailing = msg.content
        .slice(lastResultIdx + 1)
        .filter((b) => !(b && b.type === 'text' && String(b.text || '').trim() === ''));

      out.push({ ...msg, content: head });
      if (trailing.length > 0) {
        out.push({
          role: 'assistant',
          content: [{ type: 'text', text: BaseAdapter.TOOL_RESULT_BRIDGE_TEXT }],
        });
        out.push({ role: 'user', content: trailing });
      }
      splitCount++;
    }

    if (splitCount > 0) {
      console.log(
        `[Adapter Guard] anthropic: split ${splitCount} user message(s) carrying ` +
        `content after tool_result blocks into separate turns (PRD-082 anti-pattern).`
      );
    }
    return out;
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

  /**
   * Detect transient network / connection failures that should always be
   * retried, regardless of provider. The Anthropic and OpenAI SDKs wrap
   * socket failures in APIConnectionError with `status: undefined` and the
   * real errno buried under `error.cause`, so status/code-only checks miss
   * them — a mid-stream "Connection error." would previously kill the retry
   * loop (and any refusal-fallback call) on the first attempt.
   * Deliberate user cancellations are never treated as transient.
   */
  _isTransientNetworkError(error) {
    if (!error) return false;

    // Never retry deliberate cancellations
    const name = error.name || error.constructor?.name || '';
    if (name === 'APIUserAbortError' || name === 'AbortError') return false;

    // SDK connection-error wrappers (Anthropic + OpenAI SDKs)
    if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') return true;

    // Message-based matching (e.g., Z.AI / Anthropic SDK "Connection error.")
    const msg = (error.message || '').toLowerCase();
    if (
      msg.includes('connection error') ||
      msg.includes('network error') ||
      msg.includes('fetch failed') ||
      msg.includes('socket hang up') ||
      msg.includes('econnrefused')
    ) {
      return true;
    }

    // errno codes — direct, or buried under error.cause by SDK/undici wrapping
    const transientCodes = new Set([
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNREFUSED',
      'EPIPE',
      'UND_ERR_SOCKET',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
    ]);
    const code = error.code || error.cause?.code || error.cause?.cause?.code;
    return transientCodes.has(code);
  }
}

export { BaseAdapter };
