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
 */
function getResponseBuffer(model, provider) {
  if (provider === 'openai-codex') return REASONING_RESPONSE_BUFFER;
  if (!model) return RESPONSE_BUFFER;
  if (/^gpt-5/i.test(model) || /^o[34]/i.test(model)) return REASONING_RESPONSE_BUFFER;
  return RESPONSE_BUFFER;
}

/**
 * Multiplier on the available-input budget. The chars/3.5 * 1.12 estimator
 * undercounts what the Codex Responses API actually charges for tool
 * schemas, instruction framing, and reasoning content — reserving an extra
 * ~7% of budget keeps compression ahead of the provider's hard limit.
 */
function getProviderSafetyMargin(model, provider) {
  if (provider === 'openai-codex') return 0.93;
  return 1.0;
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
  const outputBuffer = getResponseBuffer(model, provider);
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
 * An assistant message with tool_calls + its following tool result messages form one unit.
 * Everything else is its own unit.
 */
function groupMessageUnits(messages) {
  const units = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // Collect this assistant message + all following tool results
      const group = [msg];
      let j = i + 1;
      while (j < messages.length && messages[j].role === 'tool') {
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
      if (msg.role === 'user' && msg.content) {
        userTopics.push(msg.content.substring(0, 80));
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
function manageContext(messages, model, tools = [], provider = null) {
  const { contextWindow, outputBuffer, availableTokens: tokenLimit } = getContextBudget(model, provider);

  // Estimate tokens for tools
  const toolTokens = estimateTokens(JSON.stringify(tools));

  // Calculate available tokens with safety check to prevent negative values
  let availableTokens = tokenLimit - toolTokens;
  const MIN_AVAILABLE_TOKENS = 1000;
  if (availableTokens < MIN_AVAILABLE_TOKENS) {
    console.warn(`Available tokens (${availableTokens}) below minimum, adjusting to ${MIN_AVAILABLE_TOKENS}`);
    availableTokens = MIN_AVAILABLE_TOKENS;
  }

  let managedMessages = [...messages];
  let currentTokens = estimateMessagesTokens(managedMessages);

  console.log(`Context management: ${currentTokens} tokens, limit: ${availableTokens}, model: ${model}`);

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

    // Strategy 4: Emergency truncation if still over limit
    if (currentTokens > availableTokens) {
      console.warn('Emergency context truncation required');
      const systemMessage = managedMessages.find((m) => m.role === 'system');
      let lastUserMessage = managedMessages.filter((m) => m.role === 'user').slice(-1)[0];

      // Truncate the system message if it alone exceeds the limit
      if (systemMessage) {
        const sysTokens = estimateMessagesTokens([systemMessage]);
        if (sysTokens > availableTokens * 0.7) {
          console.warn('System message too large, truncating for emergency recovery');
          if (typeof systemMessage.content === 'string') {
            systemMessage.content = truncateContent(systemMessage.content, Math.floor(availableTokens * 0.5));
          }
        }
      }

      // Ensure we always have at least one user message for API compatibility
      if (!lastUserMessage) {
        lastUserMessage = { role: 'user', content: 'Please continue.' };
      }

      managedMessages = [systemMessage, lastUserMessage].filter(Boolean);
      currentTokens = estimateMessagesTokens(managedMessages);
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

  return {
    messages: managedMessages,
    originalTokens: estimateMessagesTokens(messages),
    managedTokens: currentTokens,
    tokenLimit: availableTokens,
    contextWindow,
    wasManaged: currentTokens < estimateMessagesTokens(messages),
    // Per-component breakdown for accurate "what Anthropic sees" reporting
    systemTokens,
    toolTokens,
    messagesTokens,
    outputBufferTokens: outputBuffer,
    totalRequestTokens,
  };
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

export { estimateTokens, getTokenLimit, estimateMessagesTokens, truncateContent, manageContext, manageToolOutput };
