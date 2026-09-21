/** Reconciliation probes are trusted tool-specific adapters; never ask the model to guess. */
export class OperationReconciliation {
  constructor({ store, probes = new Map(), receipts }) { Object.assign(this,{store,probes,receipts}); }
  async reconcile(work, operationId, signal) {
    const operation=await this.store.get(`SELECT operation.* FROM conversation_operations operation
      JOIN conversation_work work ON work.id=operation.work_id
      WHERE operation.id=? AND work.id=? AND work.owner_id=? AND operation.status='unknown'`,[operationId,work.id,work.owner_id]);
    if(!operation)return false;
    const probe=this.probes.get(operation.tool_name);
    if(!probe)return false;
    signal?.throwIfAborted();
    const result=await probe({work,operation,signal});
    signal?.throwIfAborted();
    if(!result || !['completed','failed'].includes(result.status))return false;
    const reference=await this.receipts.write({operationId,result});
    const updated=await this.store.run(`UPDATE conversation_operations SET status=?,result_ref=?,updated_at=?
      WHERE id=? AND work_id=? AND status='unknown'`,[result.status,reference,Date.now(),operationId,work.id]);
    return updated.changes===1;
  }
}
