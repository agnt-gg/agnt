/**
 * Context Manager - Handles automatic token counting and context truncation
 * Ensures conversations never pause due to token limits
 */

import { getModelMetadata } from '../services/ai/providerConfigs.js';

// Rough token estimation (1 token ≈ 3.5 characters for more accurate estimation)
const CHARS_PER_TOKEN = 3.5;
// Provider tokenizers count JSON structure, tool-call payloads, multimodal blocks,
// and schema wrappers differently. Bias high so context management triggers before
// the provider's hard limit instead of a few tokens after it.
const TOKEN_ESTIMATE_SAFETY_FACTOR = 1.12;
const MESSAGE_OVERHEAD_TOKENS = 12;

// Dense JSON — tool schemas above all — tokenizes FAR more efficiently than
// prose. Repeated structural keys ("type":"string", "description":, "required":)
// collapse to single BPE tokens, so the prose ratio structurally OVERcounts them.
//
// Measured against o200k_base over the live 295-tool surface (2026-07-25):
//   whole array           4.75 chars/token
//   per-tool p05          4.49
//   worst random subset   4.63   (30 samples, n = 10..295)
//   worst single tool     3.89   (generate_image)
// The shared prose estimator scored the same block at 3.125 chars/token — a
// 1.52x overcount (182,251 vs a real 120,021). That inflation drove
// availableTokens NEGATIVE on every model with a <=200k window, clamped the
// budget to MIN_AVAILABLE_TOKENS, and made Strategy 4 delete the user's
// conversation on chats as short as two turns.
//
// 4.0 keeps ~19% headroom against the measured whole-array ratio, which covers
// cross-tokenizer drift (Anthropic / Llama tokenizers differ from o200k) while
// no longer hallucinating an overflow that does not exist.
const CHARS_PER_TOKEN_JSON_SCHEMA = 4.0;

/**
 * Estimate tokens for a tool-schema array using the dense-JSON ratio.
 *
 * Deliberately NOT estimateTokens(): that applies the prose ratio plus a 1.12
 * safety factor, which is correct for message content and wrong by 1.52x for
 * schemas. Keep the two estimators separate so neither has to compromise.
 */
function estimateToolTokens(tools) {
  if (!tools) return 0;
  let serialized;
  try {
    serialized = JSON.stringify(tools);
  } catch {
    serialized = String(tools);
  }
  if (!serialized) return 0;
  return Math.ceil(serialized.length / CHARS_PER_TOKEN_JSON_SCHEMA);
}

// Fallback token limit when model metadata isn't available
const DEFAULT_TOKEN_LIMIT = 128000;
const RESPONSE_BUFFER = 8000;
// Reasoning models (gpt-5.x, o3/o4, Codex Responses API) routinely spend
// tens of thousands of output tokens on hidden chain-of-thought before
// visible content. The 8k default leaves no headroom and the provider
// rejects the request with "input exceeds context window" once reasoning
// tokens are counted.
const REASONING_RESPONSE_BUFFER = 32_000;

/**
 * Estimate token count for text
 */
function estimateTokens(text) {
  if (!text) return 0;
  if (typeof text === 'object') {
    text = JSON.stringify(text);
  }
  return Math.ceil((text.length / CHARS_PER_TOKEN) * TOKEN_ESTIMATE_SAFETY_FACTOR);
}

function estimateSerializedTokens(value) {
  if (value === undefined || value === null) return 0;
  try {
    return estimateTokens(JSON.stringify(value));
  } catch {
    return estimateTokens(String(value));
  }
}

function estimateContentTokens(content) {
  if (!content) return 0;

  if (typeof content === 'string') {
    return estimateTokens(content);
  }

  if (Array.isArray(content)) {
    return content.reduce((sum, block) => {
      if (!block) return sum;
      if (typeof block === 'string') return sum + estimateTokens(block);

      // Common text-bearing blocks: OpenAI, Anthropic, and Gemini wrappers.
      if (typeof block.text === 'string') return sum + estimateTokens(block.text);
      if (block.content !== undefined) return sum + estimateContentTokens(block.content);

      // Multimodal blocks are easy to undercount because payloads usually live
      // under provider-specific fields instead of `text`.
      if (block.image_url?.url) return sum + estimateTokens(block.image_url.url);
      if (block.source?.data) return sum + estimateTokens(block.source.data);
      if (block.inlineData?.data) return sum + estimateTokens(block.inlineData.data);

      // Tool-use blocks include input JSON under `input`; unknown blocks still
      // cost tokens when serialized into the provider request.
      return sum + estimateSerializedTokens(block);
    }, 0);
  }

  return estimateSerializedTokens(content);
}

/**
 * Family-prefix heuristic table — used as a cold-start fallback when no exact
 * metadata is registered yet (chat fires before /models fetch, or a model
 * that hasn't been added to providerConfigs.modelMetadata).
 *
 * The table is hand-maintained but only needs entries for *families*, not
 * individual models — so it scales with model lineages, not releases.
 *
 * Conservative-by-design when wrong: under-reporting causes premature
 * compression (safe). Over-reporting causes one user request to hit a
 * provider error before the next /models fetch heals it (acceptable).
 */
const FAMILY_CONTEXT_WINDOWS = [
  // OpenAI / Codex
  [/^gpt-5/i, 400_000],
  [/^gpt-4\.1/i, 1_000_000],
  [/^gpt-4o/i, 128_000],
  [/^o[34]/i, 200_000],
  // Anthropic
  [/^claude-opus-4/i, 200_000],
  [/^claude-sonnet-4/i, 200_000],
  [/^claude-haiku-4/i, 200_000],
  // Gemini
  [/^gemini-3/i, 1_048_576],
  [/^gemini-2\.5/i, 1_048_576],
  // xAI / Grok
  [/^grok-4/i, 256_000],
  [/^grok-3/i, 131_072],
  // DeepSeek
  [/^deepseek-(chat|reasoner|v\d)/i, 128_000],
  // Generic Llama / Qwen / Kimi (also covers Chutes-hosted prefixed variants)
  [/^kimi-k2/i, 256_000],
  [/kimi-k2/i, 256_000],
  [/^moonshotai\/kimi-k2/i, 256_000],
  [/llama-?3\.[1-9]/i, 131_072],
  [/qwen3/i, 131_072],
  [/^zai-org\/glm-5/i, 200_000],
  [/^glm-5/i, 200_000],
];

function inferContextWindowFromFamily(modelId) {
  if (!modelId) return null;
  for (const [pattern, ctx] of FAMILY_CONTEXT_WINDOWS) {
    if (pattern.test(modelId)) return ctx;
  }
  return null;
}

/**
 * Output buffer reserved for the model's response. Most providers complete
 * within 8k, but reasoning models (gpt-5.x, o3/o4, Codex Responses) consume
 * far more on hidden chain-of-thought; we reserve more so compression
 * triggers before reasoning tokens push us past the hard limit.
 *
 * The reserve also SCALES with the context window. A flat 8k is 6.25% of a
 * 128k window but only 0.8% of a 1M window — at that scale the estimator's
 * structural undercount of dense JSON/code (see getProviderSafetyMargin)
 * easily exceeds the fixed margin, so the request sails past the budget and
 * the provider rejects it (e.g. Anthropic "1004527 tokens > 1000000"). We
 * reserve at least CONTEXT_RESERVE_FRACTION of the window so headroom grows
 * with the window instead of vanishing.
 */
const CONTEXT_RESERVE_FRACTION = 0.06;
function getResponseBuffer(model, provider, contextWindow = DEFAULT_TOKEN_LIMIT) {
  let base = RESPONSE_BUFFER;
  if (provider === 'openai-codex') {
    base = REASONING_RESPONSE_BUFFER;
  } else if (model && (/^gpt-5/i.test(model) || /^o[34]/i.test(model))) {
    base = REASONING_RESPONSE_BUFFER;
  }
  const scaled = Math.ceil((contextWindow || DEFAULT_TOKEN_LIMIT) * CONTEXT_RESERVE_FRACTION);
  return Math.max(base, scaled);
}

/**
 * Multiplier on the available-input budget. The chars/3.5 * 1.12 estimator
 * assumes a fixed 3.125 chars/token, but real BPE tokenization of the
 * content that dominates an agentic conversation — code, JSON tool outputs,
 * URLs, tool schemas — runs closer to 2.6-3.0 chars/token, so the estimator
 * structurally UNDERcounts. Left uncorrected, the preflight sees ~964k while
 * the provider counts ~1.0M and rejects the request. A sub-1.0 margin pulls
 * the compression trigger below the real ceiling for every provider; Codex
 * stays slightly tighter because its Responses API also replays encrypted
 * reasoning items the estimator can't fully see.
 */
function getProviderSafetyMargin(model, provider) {
  if (provider === 'openai-codex') return 0.93;
  return 0.94;
}

/**
 * Get effective token limit for a model.
 * Resolution order:
 *   1. Exact metadata via getModelMetadata (static + dynamic cache)
 *   2. Family-prefix heuristic (cold-start fallback before /models fetch)
 *   3. DEFAULT_TOKEN_LIMIT (last-resort fallback)
 */
function getTokenLimit(model, provider) {
  const { availableTokens } = getContextBudget(model, provider);
  return availableTokens;
}

/**
 * Resolve the full context budget for a model in one place so callers see
 * a consistent (contextWindow, outputBuffer, availableTokens) triple.
 */
function getContextBudget(model, provider) {
  let contextWindow = DEFAULT_TOKEN_LIMIT;
  if (provider && model) {
    const meta = getModelMetadata(provider, model);
    if (meta?.contextWindow) {
      contextWindow = meta.contextWindow;
    } else {
      const familyWindow = inferContextWindowFromFamily(model);
      if (familyWindow) {
        console.log(`[Context Manager] Using family-prefix heuristic for ${provider}/${model}: ${familyWindow}`);
        contextWindow = familyWindow;
      }
    }
  }
  const outputBuffer = getResponseBuffer(model, provider, contextWindow);
  const margin = getProviderSafetyMargin(model, provider);
  const availableTokens = Math.floor((contextWindow - outputBuffer) * margin);
  return { contextWindow, outputBuffer, availableTokens };
}

/**
 * Estimate tokens for a message array
 */
function estimateMessagesTokens(messages) {
  if (!Array.isArray(messages)) return 0;

  return messages.reduce((total, message) => {
    if (!message || typeof message !== 'object') return total;

    let messageTokens = estimateContentTokens(message.content);

    // Gemini vision injection uses `parts`; OpenAI/Anthropic use `content`.
    messageTokens += estimateContentTokens(message.parts);

    // Assistant tool call arguments can be huge and were previously invisible
    // to context management even though providers count them in the request.
    messageTokens += estimateSerializedTokens(message.tool_calls);
    messageTokens += estimateSerializedTokens(message.function_call);
    messageTokens += estimateTokens(message.reasoning_content || '');

    // Codex / OpenAI Responses adapters stash replayable output items
    // (encrypted reasoning blobs, function calls, assistant messages) on each
    // assistant message and replay them verbatim to the provider on the next
    // turn. They were previously invisible to context management even though
    // Codex counts every byte against the input window — so the preflight
    // saw, e.g., 60k while Codex saw 250k and rejected with
    // "input exceeds the context window". Count them now so manageContext
    // can shed whole oldest turns (Strategy 3) before the request fails.
    messageTokens += estimateSerializedTokens(message._responsesOutputItems);

    // Add overhead for role, name, tool_call_id, and provider framing.
    messageTokens += MESSAGE_OVERHEAD_TOKENS;
    if (message.name) messageTokens += estimateTokens(message.name);
    if (message.tool_call_id) messageTokens += estimateTokens(message.tool_call_id);

    return total + messageTokens;
  }, 0);
}

/**
 * Truncate content to fit within token limit
 */
function truncateContent(content, maxTokens) {
  if (!content) return content;

  const currentTokens = estimateTokens(content);
  if (currentTokens <= maxTokens) return content;

  // Calculate target character count
  const targetChars = maxTokens * CHARS_PER_TOKEN;

  if (typeof content === 'string') {
    // For strings, truncate and add indicator
    const truncated = content.substring(0, targetChars - 100);
    return truncated + '\n\n[Content truncated due to length - showing first ' + Math.round(truncated.length / 1000) + 'k characters]';
  }

  // For objects, stringify and truncate
  const stringified = JSON.stringify(content);
  if (stringified.length <= targetChars) return content;

  const truncated = stringified.substring(0, targetChars - 100);
  return truncated + '\n[Object truncated due to length]';
}

function truncateMessagePayload(message, maxTokens) {
  const truncateStructuredContent = (content) => {
    if (!content) return content;

    if (typeof content === 'string') {
      return truncateContent(content, maxTokens);
    }

    if (Array.isArray(content)) {
      const blockBudget = Math.max(100, Math.floor(maxTokens / Math.max(1, content.length)));
      return content.map((block) => {
        if (!block || typeof block !== 'object') return block;
        const next = { ...block };

        if (typeof next.text === 'string' && estimateTokens(next.text) > blockBudget) {
          next.text = truncateContent(next.text, blockBudget);
        }
        if (typeof next.content === 'string' && estimateTokens(next.content) > blockBudget) {
          next.content = truncateContent(next.content, blockBudget);
        } else if (next.content && typeof next.content === 'object' && estimateSerializedTokens(next.content) > blockBudget) {
          next.content = truncateContent(JSON.stringify(next.content), blockBudget);
        }
        if (next.functionResponse?.response && estimateSerializedTokens(next.functionResponse.response) > blockBudget) {
          next.functionResponse = {
            ...next.functionResponse,
            response: {
              success: false,
              _truncated: true,
              message: truncateContent(JSON.stringify(next.functionResponse.response), blockBudget),
            },
          };
        }

        return next;
      });
    }

    return truncateContent(JSON.stringify(content), maxTokens);
  };

  const next = { ...message };
  if (next.content && estimateContentTokens(next.content) > maxTokens) {
    next.content = truncateStructuredContent(next.content);
  }
  if (next.parts && estimateContentTokens(next.parts) > maxTokens) {
    next.parts = truncateStructuredContent(next.parts);
  }
  return next;
}

/**
 * Group messages into atomic units that must stay together.
 *
 * An assistant turn that issued tool calls MUST stay paired with the
 * messages carrying its tool results — otherwise summarization can drop one
 * side and the next provider request fails with "tool_use ids were found
 * without tool_result blocks" (Anthropic) or the OpenAI equivalent.
 *
 * Two wire shapes to recognize:
 *   OpenAI/Gemini: `{ role: 'assistant', tool_calls: [...] }` followed by
 *     one or more `{ role: 'tool', ... }` messages.
 *   Anthropic:     `{ role: 'assistant', content: [{ type: 'tool_use', ... }] }`
 *     followed by `{ role: 'user', content: [{ type: 'tool_result', ... }] }`.
 */
function assistantHasToolUseBlock(msg) {
  if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) return false;
  return msg.content.some((b) => b && b.type === 'tool_use');
}

function userHasToolResultBlock(msg) {
  if (!msg || msg.role !== 'user' || !Array.isArray(msg.content)) return false;
  return msg.content.some((b) => b && b.type === 'tool_result');
}

function groupMessageUnits(messages) {
  const units = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    // OpenAI/Gemini shape: assistant.tool_calls + following role:'tool' messages
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      const group = [msg];
      let j = i + 1;
      while (j < messages.length && messages[j].role === 'tool') {
        group.push(messages[j]);
        j++;
      }
      units.push(group);
      i = j;
    // Anthropic shape: assistant with tool_use block(s) + following user message
    // carrying tool_result block(s). All results for one assistant turn are
    // packed into a single user message, but stay defensive and absorb extras.
    } else if (assistantHasToolUseBlock(msg)) {
      const group = [msg];
      let j = i + 1;
      while (j < messages.length && userHasToolResultBlock(messages[j])) {
        group.push(messages[j]);
        j++;
      }
      units.push(group);
      i = j;
    } else {
      units.push([msg]);
      i++;
    }
  }
  return units;
}

/**
 * Summarize old messages to save tokens.
 * Keeps system message + recent message units (respecting tool call/result pairs).
 * Builds a meaningful summary of discarded messages.
 */
function summarizeMessages(messages, maxSummaryTokens = 500) {
  if (messages.length <= 2) return messages;

  const totalTokens = estimateMessagesTokens(messages);
  if (totalTokens <= maxSummaryTokens) return messages;

  const systemMessage = messages[0]?.role === 'system' ? messages[0] : null;
  const nonSystemMessages = systemMessage ? messages.slice(1) : [...messages];
  const units = groupMessageUnits(nonSystemMessages);

  if (units.length <= 1) return messages;

  // Keep as many recent units as fit, working backwards
  const systemTokens = systemMessage ? estimateMessagesTokens([systemMessage]) : 0;
  const summaryReserve = 200; // tokens for the summary message
  let budget = maxSummaryTokens - systemTokens - summaryReserve;
  const keptUnits = [];
  for (let i = units.length - 1; i >= 0; i--) {
    const unitTokens = estimateMessagesTokens(units[i]);
    if (budget - unitTokens < 0 && keptUnits.length > 0) break;
    keptUnits.unshift(units[i]);
    budget -= unitTokens;
  }

  const discardedUnits = units.slice(0, units.length - keptUnits.length);
  if (discardedUnits.length === 0) return messages;

  // Build meaningful summary from discarded messages
  const toolNames = new Set();
  let userTopics = [];
  for (const unit of discardedUnits) {
    for (const msg of unit) {
      if (msg.role === 'assistant' && msg.tool_calls) {
        msg.tool_calls.forEach((tc) => {
          const name = tc.function?.name || tc.name;
          if (name) toolNames.add(name);
        });
      }
      // Only HUMAN turns feed "User topics" — in group chat, foreign speakers
      // (agents/orchestrator) render as role:'user' with a speaker tag, and
      // labelling their chatter as the user's topics misstates the record.
      if (msg.role === 'user' && msg.content && (!msg.speaker || msg.speaker.type === 'human')) {
        // user content may be a string (OpenAI/Gemini) or an array of blocks
        // (Anthropic tool_result / multimodal). Calling .substring on an array
        // throws — extract a text-ish preview safely instead.
        let preview = '';
        if (typeof msg.content === 'string') {
          preview = msg.content;
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (!block) continue;
            if (typeof block === 'string') { preview = block; break; }
            if (typeof block.text === 'string') { preview = block.text; break; }
            if (typeof block.content === 'string') { preview = block.content; break; }
          }
          if (!preview) preview = `[${msg.content[0]?.type || 'structured'} content]`;
        }
        if (preview) userTopics.push(preview.substring(0, 80));
      }
    }
  }
  const toolList = toolNames.size > 0 ? ` Tools used: ${[...toolNames].join(', ')}.` : '';
  const topicList = userTopics.length > 0
    ? ` User topics: ${userTopics.map((t) => `"${t}"`).join('; ')}.`
    : '';
  const summaryContent = `[Previous conversation: ${discardedUnits.length} message groups were summarized to fit context.${toolList}${topicList} The conversation continues below with recent context.]`;

  // Use a user-role summary so provider adapters that extract a single system
  // prompt do not silently drop the compressed conversation context.
  const summaryMessage = { role: 'user', content: summaryContent };
  const recentMessages = keptUnits.flat();

  return [systemMessage, summaryMessage, ...recentMessages].filter(Boolean);
}

/**
 * Manage context size to fit within token limits
 */
function manageContext(messages, model, tools = [], provider = null, options = {}) {
  const { contextWindow, outputBuffer, availableTokens: tokenLimit } = getContextBudget(model, provider);

  // Ground-truth calibration. The chars-ratio estimator structurally
  // undercounts dense content (unicode-heavy transcripts, escaped code,
  // in-flight tool rounds) and the provider's tokenizer counts harsher than
  // o200k — measured 1.6x on a live conversation that sailed past the 94%
  // margin into a provider 400. The orchestrator derives this ratio from the
  // REAL prompt sizes the provider reports every round (see
  // updateEstimateCalibration); dividing the budget by it moves the
  // compression trigger to where the PROVIDER's count hits the wall.
  // Clamped >= 1: a generous estimator is safe, only tighten when it lies low.
  const calibration = Math.min(3, Math.max(1, Number(options.calibration) || 1));
  const calibratedLimit = Math.floor(tokenLimit / calibration);

  // Estimate tokens for tools using the dense-JSON ratio (see
  // CHARS_PER_TOKEN_JSON_SCHEMA) rather than the prose ratio.
  const toolTokens = estimateToolTokens(tools);

  // Calculate available tokens with safety check to prevent negative values.
  //
  // The floor is PROPORTIONAL, not a flat 1,000. A flat floor meant that any
  // caller whose tool surface exceeded the window (e.g. 295 schemas against a
  // 128k model) collapsed the conversation budget to ~1k tokens, which forces
  // Strategy 4 and destroys the chat. Reserving a fraction of the model's own
  // input budget instead keeps a usable conversation even when the caller has
  // not pre-capped its tools — this is the defence-in-depth backstop for paths
  // that call manageContext() directly (LlmExecutionService et al).
  const MIN_AVAILABLE_TOKENS = 1000;
  const CONVERSATION_FLOOR_FRACTION = 0.2;
  const conversationFloor = Math.max(
    MIN_AVAILABLE_TOKENS,
    Math.floor(calibratedLimit * CONVERSATION_FLOOR_FRACTION),
  );
  let availableTokens = calibratedLimit - toolTokens;
  if (availableTokens < conversationFloor) {
    console.warn(
      `[Context Manager] Tool surface (${toolTokens} tokens) leaves only ${availableTokens} ` +
      `of ${tokenLimit} for conversation; raising to the ${conversationFloor}-token floor. ` +
      `Cap the tool surface for this model to avoid provider-side overflow.`
    );
    availableTokens = conversationFloor;
  }

  let managedMessages = [...messages];
  let currentTokens = estimateMessagesTokens(managedMessages);

  console.log(`Context management: ${currentTokens} tokens, limit: ${availableTokens}, model: ${model}`);

  // ---- Chunked eviction with a persistent watermark (cache-stable) --------
  //
  // The old behaviour evicted the MINIMUM number of message units needed to
  // fit, recomputed fresh every turn against the caller's full history. Once
  // a conversation crossed the limit, the window slid forward one turn's
  // worth of messages on EVERY request — so the prompt prefix changed every
  // turn and the provider's prompt cache never hit again (measured: prefix
  // rewrites == compressed turns, exactly; 27 rewrites over 40 group-chat
  // turns). Anthropic bills cache writes at 1.25x, so that was a standing
  // money leak, not just latency.
  //
  // Fix: when we must evict, cut down to a LOW-WATER mark (~70% of budget)
  // and PERSIST the cut as a unit-count watermark the caller replays on
  // every subsequent turn (options.evictedUnits, stored per conversation by
  // OrchestratorService). Between cuts the prefix is byte-stable — the same
  // 40-turn sim drops to 6 rewrites (78% fewer full-price cache writes).
  //
  // The watermark counts UNITS (groupMessageUnits keeps assistant+tool pairs
  // atomic) from the FRONT of the non-system history. Unit grouping is
  // structural (roles + tool_calls, never content), and the conversation is
  // append-only, so the first N units are the same N units on every turn.
  //
  // Reset rule: if the FULL array fits the budget outright, the watermark is
  // forgotten. In normal append-only flow that never happens after a cut
  // (history only grows), so there is no oscillation. It fires exactly when
  // the budget grew (model switch — which changes cache namespace anyway) or
  // the history shrank (edit/regenerate — which already breaks the cache),
  // and restores full fidelity in both cases.
  const LOW_WATER_FRACTION = 0.7;
  let evictedUnits = Math.max(0, Math.floor(Number(options.evictedUnits) || 0));
  if (evictedUnits > 0 && currentTokens <= availableTokens) {
    evictedUnits = 0;
  }
  if (evictedUnits > 0 || currentTokens > availableTokens) {
    const evictionSystemMessage = managedMessages.find((m) => m.role === 'system') || null;
    const units = groupMessageUnits(managedMessages.filter((m) => m.role !== 'system'));
    // Clamp: the conversation may have been edited/truncated since the
    // watermark was recorded. Always keep at least the last unit.
    evictedUnits = Math.min(evictedUnits, Math.max(0, units.length - 1));
    if (evictedUnits > 0) {
      managedMessages = [evictionSystemMessage, ...units.slice(evictedUnits).flat()].filter(Boolean);
      currentTokens = estimateMessagesTokens(managedMessages);
    }
    if (currentTokens > availableTokens && units.length > 1) {
      // Over budget even after replaying the watermark — cut to low-water.
      const systemTokens = evictionSystemMessage ? estimateMessagesTokens([evictionSystemMessage]) : 0;
      const target = Math.floor(availableTokens * LOW_WATER_FRACTION);
      let keptTokens = systemTokens;
      let keepFrom = units.length;
      for (let i = units.length - 1; i >= 0; i--) {
        const unitTokens = estimateMessagesTokens(units[i]);
        if (keptTokens + unitTokens > target && keepFrom < units.length) break;
        keepFrom = i;
        keptTokens += unitTokens;
      }
      // The watermark only ever moves forward — retreating would rewrite the
      // prefix for no correctness gain.
      const nextEvicted = Math.min(Math.max(evictedUnits, keepFrom), units.length - 1);
      if (nextEvicted > evictedUnits) {
        evictedUnits = nextEvicted;
        managedMessages = [evictionSystemMessage, ...units.slice(evictedUnits).flat()].filter(Boolean);
        currentTokens = estimateMessagesTokens(managedMessages);
        console.log(`[Context Manager] Chunked eviction: dropped ${evictedUnits} oldest unit(s) to the ${Math.round(LOW_WATER_FRACTION * 100)}% low-water mark (${currentTokens} tokens); watermark persisted for prefix stability`);
      }
    }
  }

  // If we're over the limit, apply management strategies
  if (currentTokens > availableTokens) {
    console.log('Context over limit, applying management strategies...');

    // Strategy 1: Truncate large individual messages (but NEVER truncate system messages)
    managedMessages = managedMessages.map((message) => {
      // CRITICAL: Never truncate system messages as they contain essential workflow state
      if (message.role === 'system') {
        console.log('Preserving full system message (contains workflow state)');
        return message;
      }

      if (message.content || message.parts) {
        const messageTokens = estimateContentTokens(message.content) + estimateContentTokens(message.parts);
        // Tool messages get aggressive truncation (they're often huge JSON blobs)
        const maxTokensForRole = (message.role === 'tool' || (message.role === 'user' && Array.isArray(message.content))) ? 1000 : 2000;
        if (messageTokens > maxTokensForRole) {
          return truncateMessagePayload(message, maxTokensForRole);
        }
      }
      return message;
    });

    currentTokens = estimateMessagesTokens(managedMessages);

    // Strategy 2: Summarize old messages if still over limit
    if (currentTokens > availableTokens) {
      managedMessages = summarizeMessages(managedMessages, availableTokens);
      currentTokens = estimateMessagesTokens(managedMessages);
    }

    // Strategy 3: Keep system message + most recent message units (preserving tool call pairs)
    if (currentTokens > availableTokens) {
      const systemMessage = managedMessages.find((m) => m.role === 'system');
      const nonSystemMessages = managedMessages.filter((m) => m.role !== 'system');
      // Group messages into atomic units (assistant+tool pairs stay together)
      const units = groupMessageUnits(nonSystemMessages);
      let kept = [];
      let keptTokens = estimateMessagesTokens(systemMessage ? [systemMessage] : []);
      for (let i = units.length - 1; i >= 0; i--) {
        const unitTokens = estimateMessagesTokens(units[i]);
        if (keptTokens + unitTokens > availableTokens && kept.length > 0) break;
        kept.unshift(...units[i]);
        keptTokens += unitTokens;
      }

      managedMessages = [systemMessage, ...kept].filter(Boolean);
      currentTokens = estimateMessagesTokens(managedMessages);
    }

    // Strategy 4: Emergency shrink if still over limit.
    //
    // CRITICAL invariant: if the last user message carries Anthropic
    // tool_result blocks, the immediately preceding assistant message
    // (which owns the matching tool_use blocks) MUST travel with it.
    // Dropping the assistant partner produces an orphaned tool_use_id and
    // Anthropic rejects the request with:
    //   "unexpected tool_use_id found in tool_result blocks: toolu_..."
    // The OpenAI/Gemini equivalent (assistant.tool_calls + role:'tool') is
    // handled the same way for completeness.
    if (currentTokens > availableTokens) {
      console.warn('Emergency context recovery required');
      let systemMessage = managedMessages.find((m) => m.role === 'system');

      // NOTE: the system prompt is deliberately NOT touched here. It carries
      // the assistant's operating instructions, injected skills, and tool
      // guidance; truncating it produces an assistant that is both amnesiac
      // AND lobotomised. It is shrunk only as an absolute last resort, after
      // the message tail has already been reduced to its minimum (below).

      // Walk the non-system tail from the end to find the smallest safe
      // suffix that preserves tool-call pairing.
      const nonSystem = managedMessages.filter((m) => m.role !== 'system');
      let tail = [];

      // Prefer the last user message that is NOT a tool_result carrier -
      // it's the cleanest recovery point (a plain user turn).
      //
      // Group chat: foreign speakers (other agents, the orchestrator) are
      // rendered as role:'user' with a `speaker` tag. Emergency recovery must
      // keep the HUMAN's question, not the last piece of agent chatter — so
      // pass 1 prefers messages that are human (speaker absent = legacy =
      // human), and pass 2 falls back to today's any-plain-user behaviour.
      let plainUserIdx = -1;
      for (let i = nonSystem.length - 1; i >= 0; i--) {
        const m = nonSystem[i];
        if (m.role === 'user' && !userHasToolResultBlock(m) && (!m.speaker || m.speaker.type === 'human')) {
          plainUserIdx = i;
          break;
        }
      }
      if (plainUserIdx === -1) {
        for (let i = nonSystem.length - 1; i >= 0; i--) {
          const m = nonSystem[i];
          if (m.role === 'user' && !userHasToolResultBlock(m)) {
            plainUserIdx = i;
            break;
          }
        }
      }

      if (plainUserIdx !== -1) {
        tail = [nonSystem[plainUserIdx]];
      } else {
        // No plain user turn survived. The only user message is a
        // tool_result carrier - ship it WITH its paired assistant
        // tool_use message so Anthropic's invariant holds.
        for (let i = nonSystem.length - 1; i >= 0; i--) {
          const m = nonSystem[i];
          if (userHasToolResultBlock(m)) {
            const prev = i > 0 ? nonSystem[i - 1] : null;
            if (prev && assistantHasToolUseBlock(prev)) {
              tail = [prev, m];
            } else {
              // Orphaned tool_result with no companion - replace with a
              // plain-text stub so we don't ship a structurally invalid
              // request to the provider.
              tail = [{ role: 'user', content: '[Previous tool results dropped during emergency context recovery. Please continue.]' }];
            }
            break;
          }
          // OpenAI/Gemini shape: assistant.tool_calls followed by role:'tool'
          if (m.role === 'tool') {
            const prev = i > 0 ? nonSystem[i - 1] : null;
            if (prev && prev.role === 'assistant' && Array.isArray(prev.tool_calls) && prev.tool_calls.length > 0) {
              tail = [prev, m];
            } else {
              tail = [{ role: 'user', content: '[Previous tool results dropped during emergency context recovery. Please continue.]' }];
            }
            break;
          }
        }
      }

      // Fallback: nothing usable in the tail at all.
      if (tail.length === 0) {
        tail = [{ role: 'user', content: 'Please continue.' }];
      }

      managedMessages = [systemMessage, ...tail].filter(Boolean);
      currentTokens = estimateMessagesTokens(managedMessages);

      // LAST RESORT: the tail is already at its irreducible minimum and we are
      // still over budget, so the system prompt itself must be the thing that
      // does not fit. Give it everything the tail is not using.
      //
      // CRITICAL: clone before mutating. `managedMessages` is a shallow copy of
      // the caller's array, so writing to systemMessage.content in place would
      // corrupt the caller's `messages` — which OrchestratorService persists
      // verbatim to conversation_logs.full_history.
      if (currentTokens > availableTokens && systemMessage && typeof systemMessage.content === 'string') {
        const tailTokens = estimateMessagesTokens(tail);
        const sysAllowance = Math.max(MIN_AVAILABLE_TOKENS, availableTokens - tailTokens);
        if (estimateMessagesTokens([systemMessage]) > sysAllowance) {
          console.warn(
            `[Context Manager] LAST RESORT: message tail is minimal and still over budget; ` +
            `truncating the system prompt to ${sysAllowance} tokens.`
          );
          const shrunkSystem = { ...systemMessage, content: truncateContent(systemMessage.content, sysAllowance) };
          managedMessages = managedMessages.map((m) => (m === systemMessage ? shrunkSystem : m));
          systemMessage = shrunkSystem;
          currentTokens = estimateMessagesTokens(managedMessages);
        }
      }
    }

    // Final safety: ensure at least one non-system message exists
    const hasNonSystemMessage = managedMessages.some((m) => m.role !== 'system');
    if (!hasNonSystemMessage) {
      console.warn('No non-system messages after context management, adding fallback');
      managedMessages.push({ role: 'user', content: 'Please continue.' });
      currentTokens = estimateMessagesTokens(managedMessages);
    }

    console.log(`Context managed: reduced from ${estimateMessagesTokens(messages)} to ${currentTokens} tokens`);
  }

  // Per-component breakdown for UI reporting. Each request to the LLM
  // actually contains system + tools + non-system messages (not just
  // `managedTokens`, which is the full messages array estimate).
  const systemMessages = managedMessages.filter((m) => m.role === 'system');
  const systemTokens = estimateMessagesTokens(systemMessages);
  const nonSystemMessages = managedMessages.filter((m) => m.role !== 'system');
  const messagesTokens = estimateMessagesTokens(nonSystemMessages);
  const totalRequestTokens = systemTokens + toolTokens + messagesTokens;

  // Strip the `speaker` attribution field before the messages head to the
  // LLM adapters. It is metadata for context management (Strategy 4 human
  // preference, summary labelling) — the Anthropic/OpenAI adapters pass
  // unknown message fields through to the wire (verified: _normalizeHistory
  // pushes/spreads message objects verbatim), and providers reject or
  // mis-handle unrecognized fields. This is the single choke point every
  // outbound request passes through, so stripping here covers all providers.
  managedMessages = managedMessages.map((m) => {
    if (m && typeof m === 'object' && 'speaker' in m) {
      const { speaker: _speaker, ...rest } = m;
      return rest;
    }
    return m;
  });

  // Last-line-of-defence: scrub any unpaired UTF-16 surrogates from the
  // messages array before it heads to the LLM adapter. Without this, a
  // single broken character in conversation history (most commonly from
  // a tool result sliced mid-surrogate-pair) makes every subsequent turn
  // fail at the provider's JSON validation — Anthropic returns a verbose
  // "no low surrogate in string" 400, OpenAI's Responses API returns a
  // silent 400 with no body. Mutates managedMessages in place; no-op on
  // strings without lone surrogates.
  deepScrubLoneSurrogatesInPlace(managedMessages);

  return {
    messages: managedMessages,
    originalTokens: estimateMessagesTokens(messages),
    managedTokens: currentTokens,
    tokenLimit: availableTokens,
    contextWindow,
    wasManaged: currentTokens < estimateMessagesTokens(messages),
    // Persistent eviction watermark (unit count). The caller stores this per
    // conversation and replays it via options.evictedUnits on later turns so
    // the prompt prefix stays byte-stable between cuts.
    evictedUnits,
    // Effective estimate->real correction applied to the budget this turn.
    calibration,
    // Per-component breakdown for accurate "what Anthropic sees" reporting
    systemTokens,
    toolTokens,
    messagesTokens,
    outputBufferTokens: outputBuffer,
    totalRequestTokens,
  };
}

/**
 * Replace any unpaired UTF-16 surrogate with the Unicode replacement
 * character (U+FFFD). JavaScript strings are arrays of UTF-16 code units
 * and tolerate lone surrogates internally, but JSON parsers downstream
 * (notably Anthropic's API and OpenAI's Responses API) reject them with
 * either a verbose "no low surrogate in string" error or a silent 400.
 *
 * Sources of lone surrogates in this codebase tend to be tool outputs
 * sliced by character count without checking codepoint boundaries, PDF /
 * web-scrape parsers returning broken UTF-8 that gets decoded as a single
 * surrogate, and streaming SSE buffers chopped mid-pair. Once a lone
 * surrogate lands in conversation_logs.full_history every subsequent turn
 * replays it and the conversation becomes unusable on strict providers.
 */
function scrubLoneSurrogates(text) {
  if (typeof text !== 'string') return text;
  return text
    // high surrogate not followed by a low surrogate → orphan
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '�')
    // low surrogate not preceded by a high surrogate → orphan
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');
}

/**
 * Walk a messages array (or any nested structure) and scrub every string
 * field in place. In-place mutation keeps allocation cost to zero in the
 * common case where there's nothing to scrub — String.prototype.replace
 * is a no-op on a clean string and re-assignment to the same field is
 * free. We mutate `managedMessages` only (which is constructed inside
 * manageContext and not shared with callers), so this is safe.
 */
function deepScrubLoneSurrogatesInPlace(obj) {
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const v = obj[i];
      if (typeof v === 'string') obj[i] = scrubLoneSurrogates(v);
      else if (v && typeof v === 'object') deepScrubLoneSurrogatesInPlace(v);
    }
  } else if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'string') obj[k] = scrubLoneSurrogates(v);
      else if (v && typeof v === 'object') deepScrubLoneSurrogatesInPlace(v);
    }
  }
}

/**
 * Remove control characters from text, replacing common ones with spaces
 */
function sanitizeControlCharacters(text) {
  if (!text || typeof text !== 'string') return text;

  return text.replace(/[\x00-\x1F\x7F]/g, (match) => {
    const charCode = match.charCodeAt(0);
    switch (charCode) {
      case 9: // tab
      case 10: // newline
      case 13: // carriage return
        return ' '; // Replace with space
      default:
        return ''; // Remove other control characters
    }
  });
}

/**
 * Recursively sanitize all string values in an object/array
 */
function deepSanitizeObject(obj) {
  if (typeof obj === 'string') {
    return sanitizeControlCharacters(obj);
  } else if (Array.isArray(obj)) {
    return obj.map((item) => deepSanitizeObject(item));
  } else if (obj && typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = deepSanitizeObject(value);
    }
    return sanitized;
  }
  return obj;
}

/**
 * Sanitize JSON content by parsing, cleaning all strings, and re-stringifying
 */
function sanitizeJsonContent(jsonString) {
  try {
    const parsed = JSON.parse(jsonString);
    const sanitized = deepSanitizeObject(parsed);
    return JSON.stringify(sanitized);
  } catch (e) {
    // If not valid JSON, wrap it safely instead of just sanitizing as text
    console.log('Content is not valid JSON, wrapping safely');
    const sanitizedText = sanitizeControlCharacters(jsonString);
    return JSON.stringify({
      success: false,
      error: 'Content contained malformed JSON',
      raw_content: sanitizedText.length > 1000 ? sanitizedText.substring(0, 1000) + '...[truncated]' : sanitizedText,
      note: 'Original content was wrapped due to JSON parsing issues',
    });
  }
}

/**
 * Intelligently truncate JSON while preserving structure
 */
function truncateJsonSafely(jsonString, maxTokens) {
  try {
    const parsed = JSON.parse(jsonString);

    // If it's a tool response with common structure, truncate intelligently
    if (parsed.success !== undefined) {
      // For successful responses with data, truncate the data field
      if (parsed.success && parsed.data) {
        const dataTokens = estimateTokens(JSON.stringify(parsed.data));
        const wrapperTokens = estimateTokens(JSON.stringify({ ...parsed, data: '' }));
        const availableForData = maxTokens - wrapperTokens - 50; // Reserve some buffer

        if (dataTokens > availableForData) {
          const truncatedData = truncateContent(JSON.stringify(parsed.data), availableForData);
          return JSON.stringify({
            ...parsed,
            data: `${truncatedData}\n\n[Content truncated to fit context limits]`,
            _truncated: true,
            _original_size: jsonString.length,
            _truncated_field: 'data',
          });
        }
      }

      // For other successful responses, truncate less critical fields
      if (parsed.textContent && estimateTokens(parsed.textContent) > maxTokens * 0.7) {
        const availableForText = Math.floor(maxTokens * 0.7);
        return JSON.stringify({
          ...parsed,
          textContent: truncateContent(parsed.textContent, availableForText) + '\n\n[Content truncated]',
          _truncated: true,
          _original_size: jsonString.length,
          _truncated_field: 'textContent',
        });
      }
    }

    // If no intelligent truncation worked, truncate the whole JSON string
    // but ensure it remains valid JSON
    const targetChars = maxTokens * CHARS_PER_TOKEN;
    if (jsonString.length <= targetChars) {
      return jsonString;
    }

    // Truncate and wrap in a safe structure
    const truncatedContent = jsonString.substring(0, targetChars - 200);
    return JSON.stringify({
      success: true,
      data: truncatedContent + '\n\n[JSON truncated to prevent context overflow]',
      _truncated: true,
      _original_size: jsonString.length,
      note: 'Original JSON was too large and has been truncated safely',
    });
  } catch (e) {
    // If JSON parsing fails, treat as plain text
    return truncateContent(jsonString, maxTokens);
  }
}

/**
 * Safely sanitize tool output to prevent JSON parsing errors
 * NO TRUNCATION - FULL CONTENT ALWAYS
 */
function manageToolOutput(toolOutput, maxTokens = 999999999) {
  if (!toolOutput) return toolOutput;

  // ONLY sanitize, NEVER truncate
  let sanitizedOutput = toolOutput;

  if (typeof toolOutput === 'string') {
    const trimmed = toolOutput.trim();

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      // Looks like JSON - sanitize as JSON
      sanitizedOutput = sanitizeJsonContent(toolOutput);
      console.log('JSON content sanitized for control characters');
    } else {
      // Plain text - sanitize control characters
      sanitizedOutput = sanitizeControlCharacters(toolOutput);
      if (sanitizedOutput !== toolOutput) {
        console.log('Text content sanitized for control characters');
      }
    }
  }

  // NEVER TRUNCATE - RETURN FULL SANITIZED CONTENT
  console.log(`Tool output NOT truncated - full content preserved (${estimateTokens(sanitizedOutput)} tokens)`);
  return sanitizedOutput;
}

/**
 * The REAL prompt size the provider just billed, from any usage shape:
 *   Anthropic:        input_tokens (uncached only) + cache_read + cache_creation
 *   OpenAI Chat:      prompt_tokens (already the total)
 *   OpenAI Responses: input_tokens (already the total; no creation field)
 */
function extractRealPromptTokens(usage) {
  if (!usage) return 0;
  if (typeof usage.prompt_tokens === 'number' && usage.prompt_tokens > 0) {
    return usage.prompt_tokens;
  }
  return (
    (usage.input_tokens || 0) +
    (usage.cache_read_input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0)
  );
}

/**
 * Fold one round's ground truth into the per-conversation calibration ratio.
 *
 * ratio = real prompt tokens / our estimate of the same request. EMA (0.5/0.5)
 * so one anomalous round can't whipsaw the budget; clamped to [0.5, 3] so a
 * degenerate report can't collapse or explode it. Small rounds (<5k tokens on
 * either side) are ignored — fixed per-message overhead dominates there and
 * the ratio is noise.
 *
 * @returns {number|undefined} the updated calibration, or the prior unchanged
 * when this round carries no usable signal.
 */
function updateEstimateCalibration(prior, usage, estimatedTotal) {
  const real = extractRealPromptTokens(usage);
  if (!(real >= 5000) || !(estimatedTotal >= 5000)) return prior;
  const ratio = Math.min(3, Math.max(0.5, real / estimatedTotal));
  if (typeof prior !== 'number' || !Number.isFinite(prior)) return ratio;
  return prior * 0.5 + ratio * 0.5;
}

/**
 * How far off the estimate STILL is once the correction has been applied.
 *
 * updateEstimateCalibration learns the SIZE of the correction (real / raw
 * estimate). Reporting that number as "drift" told the user their figures
 * were wrong by 30% when the displayed figures had already been corrected by
 * exactly that amount — the panel was showing its own fix as if it were the
 * defect.
 *
 * What actually matters is the leftover: real / (raw estimate x calibration
 * we applied at request time). When calibration is working this sits at ~1.0,
 * and any move away from 1.0 is genuine, actionable error.
 *
 * @returns {number|null} null when the round is too small to carry signal.
 */
function computeResidualDrift(prior, usage, estimatedTotal) {
  const real = extractRealPromptTokens(usage);
  if (!(real >= 5000) || !(estimatedTotal >= 5000)) return null;
  const applied = Number.isFinite(prior) && prior > 0 ? prior : 1;
  return Math.min(3, Math.max(0.33, real / (estimatedTotal * applied)));
}

export {
  estimateTokens,
  estimateToolTokens,
  getTokenLimit,
  getContextBudget,
  estimateMessagesTokens,
  truncateContent,
  manageContext,
  manageToolOutput,
  extractRealPromptTokens,
  updateEstimateCalibration,
  computeResidualDrift,
};
