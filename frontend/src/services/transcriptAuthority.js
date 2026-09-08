/** Reconciliation authority comes from an authenticated server response, never
 * from local voice metadata. User-turn identity prevents an old completed run
 * overwriting a later local question; revisions prevent rollback once adopted. */
export function canAdoptCompletedTranscript(remote, localMessages, conversationId, localRevision = 0) {
  if (remote?.conversationId !== conversationId || remote.status !== 'completed'
    || typeof remote.executionId !== 'string' || !remote.executionId
    || !Array.isArray(remote.messages)) return false;
  if (localRevision > 0 && (!Number.isSafeInteger(remote.revision) || remote.revision < localRevision)) return false;
  const users = messages => (messages || []).filter(m => m?.role === 'user');
  const local = users(localMessages), incoming = users(remote.messages);
  if (incoming.length !== local.length) return false;
  if (!local.every((m, i) => m.content === incoming[i].content
    && (!m.id || !incoming[i].id || m.id === incoming[i].id))) return false;
  const final = remote.messages.at(-1), localFinal = localMessages?.at(-1);
  if (final?.role !== 'assistant' || typeof final.content !== 'string') return false;
  if (!remote.revision && localFinal?.role === 'assistant' && localFinal.id !== final.id) return false;
  return true;
}
