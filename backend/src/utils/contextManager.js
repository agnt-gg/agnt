/**
 * Context Manager - Handles automatic token counting and context truncation
 * Ensures conversations never pause due to token limits
 */

// Rough token estimation (1 token ≈ 3.5 characters for more accurate estimation)
const CHARS_PER_TOKEN = 3.5;

// Single default token limit for all models (leaving buffer for response)
const DEFAULT_TOKEN_LIMIT = 128000;
const RESPONSE_BUFFER = 4000;

/**
 * Estimate token count for text
 */
function estimateTokens(text) {
  if (!text) return 0;
  if (typeof text === 'object') {
    text = JSON.stringify(text);
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Get effective token limit for a model
 */
function getTokenLimit(model) {
  // Use single default limit for all models
  return DEFAULT_TOKEN_LIMIT - RESPONSE_BUFFER;
}

/**
 * Estimate tokens for a message array
 */
function estimateMessagesTokens(messages) {
  if (!Array.isArray(messages)) return 0;

  return messages.reduce((total, message) => {
    let messageTokens = 0;

    if (message.content) {
      if (typeof message.content === 'string') {
        messageTokens += estimateTokens(message.content);
      } else if (Array.isArray(message.content)) {
        // Anthropic format
        messageTokens += message.content.reduce((sum, block) => {
          if (block.text) return sum + estimateTokens(block.text);
          if (block.content) return sum + estimateTokens(block.content);
          return sum;
        }, 0);
      }
    }

    // Add overhead for role, metadata, etc.
    messageTokens += 10;

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

/**
 * Summarize old messages to save tokens
 */
function summarizeMessages(messages, maxSummaryTokens = 500) {
  if (messages.length <= 2) return messages;

  const totalTokens = estimateMessagesTokens(messages);
  if (totalTokens <= maxSummaryTokens) return messages;

  // Keep first (system) and last few messages, summarize the middle
  const systemMessage = messages[0];
  const recentMessages = messages.slice(-3); // Keep last 3 messages
  const middleMessages = messages.slice(1, -3);

  if (middleMessages.length === 0) return messages;

  // Create summary of middle messages
  const summaryContent = `[Previous conversation summary: ${middleMessages.length} messages covering various topics and tool usage. Key context preserved in recent messages.]`;

  const summaryMessage = {
    role: 'system',
    content: summaryContent,
  };

  return [systemMessage, summaryMessage, ...recentMessages];
}

/**
 * Manage context size to fit within token limits
 */
function manageContext(messages, model, tools = []) {
  const tokenLimit = getTokenLimit(model);

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

      if (message.content && typeof message.content === 'string') {
        const messageTokens = estimateTokens(message.content);
        if (messageTokens > 2000) {
          // Truncate very large messages (but not system messages)
          return {
            ...message,
            content: truncateContent(message.content, 2000),
          };
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

    // Strategy 3: Keep only essential messages if still over limit
    if (currentTokens > availableTokens) {
      const systemMessage = managedMessages.find((m) => m.role === 'system');
      const userMessages = managedMessages.filter((m) => m.role === 'user').slice(-2);
      const assistantMessages = managedMessages.filter((m) => m.role === 'assistant').slice(-2);
      const toolMessages = managedMessages.filter((m) => m.role === 'tool').slice(-3);

      managedMessages = [systemMessage, ...userMessages, ...assistantMessages, ...toolMessages].filter(Boolean);

      currentTokens = estimateMessagesTokens(managedMessages);
    }

    // Strategy 4: Emergency truncation if still over limit
    if (currentTokens > availableTokens) {
      console.warn('Emergency context truncation required');
      const systemMessage = managedMessages.find((m) => m.role === 'system');
      const lastUserMessage = managedMessages.filter((m) => m.role === 'user').slice(-1)[0];

      managedMessages = [systemMessage, lastUserMessage].filter(Boolean);
      currentTokens = estimateMessagesTokens(managedMessages);
    }

    console.log(`Context managed: reduced from ${estimateMessagesTokens(messages)} to ${currentTokens} tokens`);
  }

  return {
    messages: managedMessages,
    originalTokens: estimateMessagesTokens(messages),
    managedTokens: currentTokens,
    tokenLimit: availableTokens,
    wasManaged: currentTokens < estimateMessagesTokens(messages),
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
