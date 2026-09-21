/** A scheduling boundary is not a prompt-reconstruction boundary. */
export function restoreSegmentHistory({ conversationId, checkpoint, continuation }) {
  if (checkpoint.conversationId !== conversationId) throw new Error('Checkpoint belongs to a different conversation');
  if (!Array.isArray(checkpoint.messages) || !checkpoint.messages.length) throw new Error('Prepared history is missing');
  if (checkpoint.messages[0]?.role !== 'system') throw new Error('Prepared history has no stable system prefix');
  const messages = structuredClone(checkpoint.messages);
  if (continuation !== undefined) {
    if (typeof continuation !== 'string' || !continuation.trim()) throw new Error('Continuation instruction is empty');
    messages.push({ role: 'user', content: continuation });
  }
  return messages;
}
