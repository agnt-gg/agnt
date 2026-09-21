import { foldBlocksIntoLastToolResult } from './turnContinuity.js';

/**
 * A scheduling boundary is not a prompt-reconstruction boundary.
 *
 * WHERE THE CONTINUATION TEXT GOES, AND WHY IT IS NOT A PUSH
 * ---------------------------------------------------------
 * Appending `{role:'user'}` after a turn that ends in tool_result blocks
 * produces the exact shape turnContinuity.js exists to prevent: Anthropic
 * requires strict alternation, and a user message shaped
 * [tool_result..., text] is the documented PRD-082 degenerate-response
 * anti-pattern. A resumed segment is the MOST likely place to hit it, because
 * a segment that ran out of budget mid-work ends on tool results by
 * definition.
 *
 * So the continuation is folded INTO the last tool_result, behind a label that
 * identifies it as supervisor input. That shape is legal for every provider,
 * is not an assistant turn, and cannot be imitated. Only when the history
 * does NOT end on tool results is a real user turn correct.
 */
export function restoreSegmentHistory({ conversationId, checkpoint, continuation }) {
  if (checkpoint.conversationId !== conversationId) throw new Error('Checkpoint belongs to a different conversation');
  if (!Array.isArray(checkpoint.messages) || !checkpoint.messages.length) throw new Error('Prepared history is missing');
  if (checkpoint.messages[0]?.role !== 'system') throw new Error('Prepared history has no stable system prefix');
  const messages = structuredClone(checkpoint.messages);
  if (continuation === undefined) return messages;
  if (typeof continuation !== 'string' || !continuation.trim()) throw new Error('Continuation instruction is empty');

  const last = messages[messages.length - 1];
  const endsOnToolResults = last?.role === 'user'
    && Array.isArray(last.content)
    && last.content.some((block) => block?.type === 'tool_result');

  if (endsOnToolResults) {
    messages[messages.length - 1] = foldBlocksIntoLastToolResult(
      last,
      [{ type: 'text', text: continuation }],
    );
    return messages;
  }

  // An OpenAI-style history ends on role:'tool' messages, where a following
  // user turn is both legal and semantically honest.
  messages.push({ role: 'user', content: continuation });
  return messages;
}
