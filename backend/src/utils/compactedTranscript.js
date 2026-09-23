// Shared by the client fold and server/client recovery. No runtime dependencies.
export const WIRE_PREAMBLE = '[Conversation compressed. The messages before this point were distilled into the summary below. Treat it as the authoritative record of what happened so far and continue from it.]';
export const WIRE_ACK = 'Understood. Continuing from that summary.';

/** Preserve originals when projecting a completed provider turn after a fold.
 * Null means this projection cannot be bound to the current saved fold. */
export function reconcileCompactedTranscript(stored, projected) {
  const index = stored.findLastIndex(message => message?.role === 'compaction');
  if (index < 0) return projected;
  const marker = stored[index];
  if (projected[0]?.role !== 'user' || projected[0]?.content !== `${WIRE_PREAMBLE}\n\n${marker.content}` ||
      projected[1]?.role !== 'assistant' || projected[1]?.content !== WIRE_ACK) return null;
  const tail = projected.slice(2);
  const users = messages => messages.filter(m => m?.role === 'user').map(m => JSON.stringify(m.content));
  const before = users(stored.slice(index + 1)), after = users(tail);
  if (before.length > after.length || before.some((content, i) => content !== after[i])) return null;
  return [...stored.slice(0, index + 1), ...tail];
}
