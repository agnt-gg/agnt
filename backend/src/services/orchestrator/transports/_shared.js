/**
 * Shared helpers for every transport.
 *
 * These were module-level functions in llmAdapters.js, used across several
 * adapters — error parsing, tool-schema sanitisers, message-history surgery
 * and the reasoning-config builders. They are moved verbatim; the only change
 * is that they are now exported.
 *
 * Kept in ONE module rather than copied per transport, because that copying is
 * exactly what produced the drift this whole branch exists to remove.
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
  isOpenAIGen5OrLater,
  isOpenAIGen6OrLater,
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
  };  return tools.map((tool) => {
    const cloned = JSON.parse(JSON.stringify(tool));
    if (cloned.function?.parameters) {
      fixSchema(cloned.function.parameters);
    }
    return cloned;
  });
}

/**
 * Repair tool input schemas that Anthropic's Messages API rejects under JSON
 * Schema draft 2020-12. Anthropic is much stricter than OpenAI/Gemini and will
 * 400 the ENTIRE request (killing every tool, not just the bad one) with:
 *   "tools.N.custom.input_schema: JSON schema is invalid..."
 *
 * The three violations we see from ToolForge-generated tools:
 *   1. Union types: "type": ["string", "number"]  -> pick the first scalar.
 *   2. Missing root "type": the top-level schema must be {"type":"object"}.
 *   3. Invalid/blank type strings (e.g. UI input-types like "text") -> "string".
 *
 * Non-destructive: valid schemas pass through unchanged.
 */
const ANTHROPIC_VALID_TYPES = new Set([
  'object', 'array', 'string', 'number', 'integer', 'boolean', 'null',
]);

function sanitizeAnthropicToolSchemas(tools) {
  if (!tools || tools.length === 0) return tools;

  const normalizeType = (t) => {
    // Union type array -> first valid scalar, else 'string'.
    if (Array.isArray(t)) {
      const first = t.find((x) => ANTHROPIC_VALID_TYPES.has(x));
      return first || 'string';
    }
    if (typeof t === 'string' && ANTHROPIC_VALID_TYPES.has(t)) return t;
    // Map common UI input-types / unknowns to 'string'.
    return 'string';
  };

  const fixSchema = (obj, isRoot = false) => {
    if (!obj || typeof obj !== 'object') return;

    // Normalize an explicit type; infer for the root if absent.
    if (obj.type !== undefined) {
      obj.type = normalizeType(obj.type);
    } else if (isRoot) {
      // Anthropic requires the root schema to declare type: object.
      obj.type = 'object';
    } else if (obj.properties && typeof obj.properties === 'object') {
      obj.type = 'object';
    }

    // An object schema must carry a properties bag for Anthropic.
    if (obj.type === 'object' && (!obj.properties || typeof obj.properties !== 'object')) {
      obj.properties = obj.properties && typeof obj.properties === 'object' ? obj.properties : {};
    }

    if (obj.properties && typeof obj.properties === 'object') {
      for (const prop of Object.values(obj.properties)) {
        fixSchema(prop, false);
      }
    }
    if (obj.items && typeof obj.items === 'object') {
      fixSchema(obj.items, false);
    }
  };

  return tools.map((tool) => {
    const cloned = JSON.parse(JSON.stringify(tool));
    if (cloned.function) {
      // Ensure parameters exists and is a valid root object schema.
      if (!cloned.function.parameters || typeof cloned.function.parameters !== 'object') {
        cloned.function.parameters = { type: 'object', properties: {} };
      } else {
        fixSchema(cloned.function.parameters, true);
      }
    }
    return cloned;
  });
}

/**
 * Base class for LLM provider adapters.
 * Defines the interface that all adapters must implement.
 */


/**
 * Check if a model requires the OpenAI Responses API instead of Chat Completions
 * @param {string} model The model name
 * @returns {boolean} True if the model uses the Responses API
 */
function requiresResponsesApi(model) {
  if (!model) return false;

  const modelLower = model.toLowerCase();

  // GPT-5 family (gpt-5, gpt-5.1-codex, gpt-5.2-codex, gpt-5.3-codex, gpt-5.4, etc.)
  if (modelLower.startsWith('gpt-5')) return true;

  // GPT-6 and every later generation. This clause exists because the gpt-5
  // prefix test above was, on its own, a claim that OpenAI would never ship a
  // GPT-6 — and the day gpt-6-astra appeared in the Codex model list the
  // openai-codex adapter refused to construct at all, taking the whole
  // provider offline and silently demoting every request to the failover
  // tier. A generation test cannot fail that way.
  if (isOpenAIGen5OrLater(modelLower)) return true;

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
  // GPT-6+ contract. Astra's model page enumerates exactly five levels —
  // "reasoning.effort supports low, medium, high, xhigh, and max"
  // (developers.openai.com/api/docs/models/gpt-6-astra, retrieved 2026-09-04).
  //
  // Two differences from the 5.x set, and both matter:
  //   'max' is NEW — a tier above xhigh that no earlier model had, so a
  //         generation that merely inherited 5.x could never reach the top of
  //         the model it is running on.
  //   'none' is ABSENT — so it is not offered here. buildResponsesReasoningConfig
  //         drops an unlisted effort rather than sending it, which keeps a
  //         stale 'off' preference from becoming a 400 at request time.
  //
  // This clause must also come BEFORE the 5.x branch below: without any gen-6
  // clause at all the model fell through to the empty set, which is read as
  // "send no effort" — a silent downgrade indistinguishable from the model
  // simply being dumber than advertised.
  if (isOpenAIGen6OrLater(lower)) {
    return new Set(['low', 'medium', 'high', 'xhigh', 'max']);
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
  // Single source: reasoningModels.isAnthropicReasoningModel. This module used
  // to wrap it under a second name (supportsAnthropicAdaptiveThinking), which
  // is the same duplicate-predicate disease under a different spelling — and
  // exactly why the guard test matches a NAMING PATTERN rather than a fixed
  // list of names.
  if (!isAnthropicReasoningModel(model)) return null;

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
  // Opus 4.7+ and Fable/Mythos generations expose an `xhigh` ("Max") tier.
  const supportsXHigh = anthropicSupportsXHigh(lower);
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

// Reasoning predicates (isGroq* / isCerebras* / isChutes* / supports*Toggle /
// Anthropic adaptive thinking) are imported from providerConfigs.js at the top
// of this file. The local copies that used to live here had drifted from the
// config's definitions and were deleted — see
// noDuplicateProviderPredicates.test.js, which fails the build if any of them
// is reintroduced under any name.

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
      // Legacy toggle. 'medium' is the natural reading of "thinking on", but
      // it is only sent if this model actually offers it — see below.
      effort = 'medium';
    }

    // Send ONLY an effort this model's control offers.
    //
    // The selected value is sticky across model switches: it lives in the
    // store and survives changing provider or model. So a value picked on one
    // model arrives here attached to a completely different one, and this
    // branch used to forward whatever it was given. Two ways that bites:
    //
    //   • stealth/ox-alpha advertises only max/high/low, so a carried-over
    //     'medium'/'xhigh'/'minimal' — or the legacy toggle's 'on' — sent it
    //     an effort it never claimed to support, and the result is undefined.
    //   • a carried-over 'off' became effort 'none', which a
    //     mandatory-reasoning model rejects outright with
    //     HTTP 400 "Reasoning is mandatory for this endpoint and cannot be
    //     disabled." Pruning 'off' from the control fixed what the UI shows;
    //     it does not stop a value already sitting in the store.
    //
    // Falling back to null means "send no reasoning param", i.e. the vendor's
    // own default — always a legal request. Better a documented default than
    // a guess the endpoint never advertised.
    const offeredValues = new Set((reasoningControl.options || []).map((o) => o.value));
    if (!offeredValues.has(effort)) return null;

    return {
      reasoning: {
        // 'off' is AGNT's spelling; OpenRouter's is 'none'.
        effort: effort === 'off' ? 'none' : effort,
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

export {
  describeCodexError,
  buildCodexErrorGuidance,
  isToolResultCarrier,
  findLastInjectableUserIndex,
  sanitizeKimiToolSchemas,
  sanitizeAnthropicToolSchemas,
  ANTHROPIC_VALID_TYPES,
  requiresResponsesApi,
  normalizeReasoningValue,
  getOpenAIReasoningValues,
  buildResponsesReasoningConfig,
  isFableOrMythosModel,
  stripThinkingBlocksFromHistory,
  slimLargeToolResultsForFableMythos,
  logAnthropicPreCall,
  buildAnthropicReasoningConfig,
  buildGeminiThinkingConfig,
  buildOpenAiLikeReasoningExtraBody,
};
