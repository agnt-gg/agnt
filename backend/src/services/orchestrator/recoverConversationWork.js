/** Recover durable intent, never blindly retry an externally ambiguous effect. */
export async function recoverConversationWork(store, now = Date.now()) {
  const preparing = await store.run(`UPDATE conversation_work SET status='paused',reason='admission_interrupted',updated_at=?
    WHERE status='preparing'`,[now]);
  const uncertain = await store.run(`UPDATE conversation_operations SET status='unknown',updated_at=?
    WHERE status='running' AND work_id IN (SELECT id FROM conversation_work WHERE status='running' AND lease_until<=?)`,[now,now]);
  const blocked = await store.run(`UPDATE conversation_work SET status='waiting_dependency',reason='reconciliation_required',
    lease_token=NULL,lease_until=NULL,generation=generation+1,updated_at=?
    WHERE status='running' AND lease_until<=? AND EXISTS
    (SELECT 1 FROM conversation_operations operation WHERE operation.work_id=conversation_work.id AND operation.status='unknown')`,[now,now]);
  return {interruptedAdmissions:preparing.changes,uncertainOperations:uncertain.changes,waitingWork:blocked.changes};
}
