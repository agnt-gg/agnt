/**
 * Apply a user's in-place edit of the latest assistant reply to a persisted
 * provider transcript (conversation_logs.full_history).
 *
 * The client edits only a reply's CLOSING text — the words after its last tool
 * call (frontend/src/services/assistantReplyEdit.js explains why that is the
 * one region an edit cannot disturb the prompt cache). In the provider
 * transcript that text is exactly the final row: an assistant row carrying no
 * tool calls. Anything else at the tail means this transcript is not the one
 * the client edited, and the edit is refused rather than guessed at.
 *
 * Rows are provider-shaped and carry no UI message ids, so identity is proven
 * by content: the row's current text must equal the text being replaced.
 *
 * Pure: never mutates its input.
 */

const THINKING_BLOCK_TYPES = new Set(['thinking', 'redacted_thinking', 'reasoning']);

function isToolCallBlock(block) {
  return block && (block.type === 'tool_use' || block.type === 'function_call' || block.type === 'tool_call');
}

/** The words of a provider row: string content, or its text blocks joined. */
export function rowText(row) {
  if (!row) return '';
  if (typeof row.content === 'string') return row.content;
  if (!Array.isArray(row.content)) return '';
  return row.content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

function rowHasToolCalls(row) {
  if (Array.isArray(row.tool_calls) && row.tool_calls.length > 0) return true;
  return Array.isArray(row.content) && row.content.some(isToolCallBlock);
}

/**
 * @param {Array<object>} messages  parsed full_history
 * @param {{ previousText: string, content: string }} edit
 * @returns {{ ok: true, messages: Array<object> } | { ok: false, reason: string }}
 */
export function replaceLastReplyText(messages, { previousText, content } = {}) {
  if (typeof previousText !== 'string' || typeof content !== 'string' || !content.trim()) {
    return { ok: false, reason: 'invalid-edit' };
  }
  if (!Array.isArray(messages) || messages.length === 0) return { ok: false, reason: 'empty-transcript' };

  const lastIndex = messages.length - 1;
  const row = messages[lastIndex];
  if (!row || row.role !== 'assistant') return { ok: false, reason: 'last-row-not-assistant' };
  if (rowHasToolCalls(row)) return { ok: false, reason: 'last-row-has-tool-calls' };
  if (rowText(row).trim() !== previousText.trim()) return { ok: false, reason: 'text-mismatch' };

  // Reasoning argued toward the old words; keeping it would contradict the
  // edit (and the client drops its copy for the same reason).
  const { reasoning_content: _reasoningContent, reasoning: _reasoning, ...edited } = row;

  if (Array.isArray(row.content)) {
    const firstTextIndex = row.content.findIndex((block) => block && block.type === 'text');
    const blocks = [];
    row.content.forEach((block, index) => {
      if (index === firstTextIndex) blocks.push({ type: 'text', text: content });
      else if (block && block.type !== 'text' && !THINKING_BLOCK_TYPES.has(block.type)) blocks.push(block);
    });
    edited.content = blocks;
  } else {
    edited.content = content;
  }

  return { ok: true, messages: [...messages.slice(0, lastIndex), edited] };
}

/**
 * final_response mirrors the turn's closing words. Swap the edited tail when
 * it is there; otherwise leave the column as it was rather than invent one.
 */
export function replaceFinalResponse(finalResponse, { previousText, content }) {
  if (typeof finalResponse !== 'string' || !finalResponse) return finalResponse;
  if (finalResponse.trim() === previousText.trim()) return content;
  if (finalResponse.endsWith(previousText)) {
    return finalResponse.slice(0, finalResponse.length - previousText.length) + content;
  }
  return finalResponse;
}
