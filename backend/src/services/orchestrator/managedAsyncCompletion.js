/** Async callbacks persist their outcome and wake the same work order. No new model turn. */
export function createManagedAsyncCompletion({ work, store, inbox, snapshots, scheduler }) {
  async function settle(execution, result) {
    const receipt = await snapshots.forWork(work).write({executionId:execution.executionId,result});
    const inserted = await inbox.append(work.id,work.owner_id,{
      key:`async-complete:${execution.executionId}`,kind:'operation_completed',payload:{executionId:execution.executionId,receipt},
    });
    if(inserted)await store.wake(work.id,work.owner_id,'operation_completed');
    await scheduler.tick();
  }
  return {
    onComplete:(result,execution)=>settle(execution,result),
    onError:(error,execution)=>settle(execution,{success:false,error:error.message||String(error)}),
  };
}
