import { restoreSegmentHistory } from './segmentHistory.js';

/** Dependencies resolve current authority and durable snapshots, never fake HTTP. */
export function createConversationSegmentAdapter({ executeSegment, snapshots, credentials, transports, dispatchers, asyncCallbacks }) {
  return async ({ work, checkpoint, signal, assertOwnership }) => {
    await assertOwnership();
    // This resolver must revalidate scope/grants and execute within their context.
    const authority = await credentials.resolve(work);
    if (!authority || typeof authority.run !== 'function') throw Object.assign(new Error('Execution authority unavailable'), {code:'waiting_auth'});
    const snapshot = await snapshots.read(checkpoint.snapshotRef);
    if (snapshot.ownerId !== work.owner_id || snapshot.conversationId !== work.conversation_id) throw new Error('Snapshot ownership mismatch');
    const savedHistory = checkpoint.historyRef ? await snapshots.read(checkpoint.historyRef) : null;
    const preparedHistory = savedHistory
      ? restoreSegmentHistory({conversationId:work.conversation_id,checkpoint:savedHistory,continuation:checkpoint.continuation})
      : undefined;
    const transport = await transports.forWork(work);
    const dispatchTool = await dispatchers.forWork({work,checkpoint,assertOwnership});
    const managedAsyncCallbacks = asyncCallbacks ? await asyncCallbacks({work,signal}) : undefined;
    const outcome = await authority.run(() => executeSegment({
      userId:work.owner_id,authToken:authority.authToken,body:{...snapshot.body,...savedHistory?.runtimeSelection,conversationId:work.conversation_id},
      files:savedHistory ? [] : (snapshot.files || []).map(file => ({...file,buffer:Buffer.from(file.buffer,'base64')})),chatType:snapshot.chatType,originClientId:snapshot.originClientId,
      transport,signal,assertOwnership,dispatchTool,preparedHistory,preparedState:savedHistory?.prefixState,managedAsyncCallbacks,
    }));
    await assertOwnership();
    if (!outcome || !['response_ended', 'segment_budget'].includes(outcome.status)) {
      throw Object.assign(new Error(outcome?.error || 'Segment did not finish normally'),{code:outcome?.status || 'segment_error'});
    }
    const historyRef = await snapshots.write({conversationId:work.conversation_id,messages:outcome.messages,prefixState:outcome.prefixState,runtimeSelection:outcome.runtimeSelection,finalContent:outcome.finalContent});
    return {checkpoint:{...checkpoint,historyRef,executionId:outcome.executionId,stopReason:outcome.status}};
  };
}
