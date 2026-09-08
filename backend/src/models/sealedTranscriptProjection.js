/** Fields consumed by the rendered transcript, not disposable UI metadata.
 * Restore these from the server-completed row without flattening tool ordering.
 * Missing fields must also stay missing (an autosave cannot introduce them).
 */
const RENDER_FIELDS = ['contentParts', 'toolCalls', 'tool_calls', 'reasoning', 'streamFinalized', 'streamTerminal'];
const isVoice = entry => entry?.type === 'voice-input';

/** Caller MUST compare-and-swap against storedContent in the actual SQL write.
 * Role/id/content conflicts are rejected by the writer, never repaired here.
 * Only matching prefix entries are restored; later turns remain writable.
 */
export function preserveSealedProjection(storedContent, incomingContent) {
  let stored, incoming;
  try { stored = JSON.parse(storedContent); incoming = JSON.parse(incomingContent); } catch { return incomingContent; }
  if (!stored?.serverCompletion || !Array.isArray(stored.messages) || !Array.isArray(incoming?.messages)) return incomingContent;
  const sealedAt = stored.messages.findIndex(m => m?.id === stored.serverCompletion.assistantMessageId);
  if (sealedAt < 0) return incomingContent;
  for (let i = 0; i <= sealedAt; i++) {
    const old = stored.messages[i], next = incoming.messages[i];
    if (!old || !next || old.role !== next.role || old.id !== next.id || old.content !== next.content) continue;
    for (const field of RENDER_FIELDS) {
      if (Object.hasOwn(old, field)) next[field] = old[field];
      else delete next[field];
    }
    // Do not freeze unrelated feature metadata. Remove ALL incoming voice
    // claims (including forged extra entries) then retain the accepted ones.
    const accepted = Array.isArray(old.metadata) ? old.metadata.filter(isVoice) : [];
    const unrelated = Array.isArray(next.metadata) ? next.metadata.filter(entry => !isVoice(entry)) : [];
    if (accepted.length || unrelated.length || Array.isArray(next.metadata)) next.metadata = [...unrelated, ...accepted];
    else delete next.metadata;
  }
  return JSON.stringify(incoming);
}
