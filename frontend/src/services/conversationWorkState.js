const labels = Object.freeze({queued:'Working…',running:'Working…',verifying:'Verifying…',retry_wait:'Retrying…',waiting_dependency:'Waiting for a prerequisite',waiting_auth:'Waiting for credentials',waiting_permission:'Waiting for permission',paused:'Paused',cancelled:'Cancelled',succeeded:'Complete'});
/** Ordered work state is distinct from message streaming. Replayed events are harmless. */
export function reduceConversationWork(current, event) {
  if (!event || typeof event.workId !== 'string' || !event.workId || !Number.isSafeInteger(event.sequence) || event.sequence < 1 || !Object.hasOwn(labels,event.status)) return current;
  if (current?.workId === event.workId && event.sequence <= current.sequence) return current;
  if (current?.workId && current.workId !== event.workId && !event.newObjective) return current;
  return {workId:event.workId,sequence:event.sequence,status:event.status,label:labels[event.status],active:!['paused','cancelled','succeeded'].includes(event.status)};
}
