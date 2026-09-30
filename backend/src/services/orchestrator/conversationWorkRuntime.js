import { ConversationWorkModel } from '../../models/ConversationWorkModel.js';
import { ConversationOperationModel } from '../../models/ConversationOperationModel.js';
import { ConversationSnapshotModel } from '../../models/ConversationSnapshotModel.js';
import { ConversationWorkInbox } from '../../models/ConversationWorkInbox.js';
import { ConversationWorkSupervisor } from './conversationWorkSupervisor.js';
import { ConversationWorkScheduler } from './conversationWorkScheduler.js';

/** Explicit boot composition: callers must supply real execution and verification. */
export async function createConversationWorkRuntime({ database, runSegment, verify, onError = console.error, concurrency = 1 }) {
  const store = new ConversationWorkModel(database);
  await store.initialize();
  // conversation_work may have just been created; the fleet's due-work view
  // only includes tables that existed when it was built. See dueWorkView.js.
  try {
    const { refreshDueWorkView } = await import('../../models/dueWorkView.js');
    await refreshDueWorkView(database);
  } catch (error) {
    onError(error);
  }
  const operations = new ConversationOperationModel(store);
  const snapshots = new ConversationSnapshotModel(store);
  const inbox = new ConversationWorkInbox(store);
  await operations.initialize();
  await snapshots.initialize();
  await inbox.initialize();
  const supervisor = new ConversationWorkSupervisor({store,runSegment,verify,onError});
  const scheduler = new ConversationWorkScheduler({store,supervisor,concurrency,onError});
  return {
    store,operations,snapshots,inbox,supervisor,scheduler,
    start:()=>scheduler.start(),
    stopAdmissions:()=>scheduler.stop(),
    pause:async(id,ownerId)=>supervisor.pause(id,ownerId),
    resume:async(id,ownerId)=>{
      const resumed=await store.resume(id,ownerId);
      if(resumed)await scheduler.tick();
      return resumed;
    },
    wake:async(id,ownerId,reason)=>{
      const changed=await store.wake(id,ownerId,reason);
      if(changed)await scheduler.tick();
      return changed;
    },
  };
}
