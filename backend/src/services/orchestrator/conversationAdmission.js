import { randomUUID } from 'node:crypto';

/** Admission does not run a second chat engine. Only the supervisor owns execution. */
export function createConversationAdmission({ runtime, attach, authorize, saveInput }) {
  return async function admit(input) {
    if (!input.userId) throw new Error('Authenticated owner required');
    const conversationId = input.body.conversationId || randomUUID();
    await authorize({ ...input, conversationId });
    const messages = input.body.messages || [];
    const objective = input.body.message || [...messages].reverse().find(message => message.role === 'user')?.content;
    if (typeof objective !== 'string' || !objective.trim()) throw new Error('A text objective is required');
    let work = await runtime.store.findActiveConversation(conversationId, input.userId);
    if (work?.status === 'preparing') throw new Error('This conversation is still being admitted');
    if (work) {
      if (!JSON.parse(work.checkpoint_json).snapshotRef) {
        throw new Error('Original request persistence is incomplete; it cannot be resumed');
      }
      await runtime.inbox.append(work.id, input.userId, {
        key: input.messageId || randomUUID(), kind: 'steering', payload: { text: objective },
      });
      // A new explicit user message can resume their pause; a timer cannot.
      if (work.status === 'paused') await runtime.store.resume(work.id, input.userId);
    } else {
      // Hold admission until all input/attachment persistence has completed.
      work = await runtime.store.create({ conversationId, ownerId: input.userId, objective, status: 'preparing' });
      try {
        const checkpoint = await saveInput(work, { ...input, body: { ...input.body, conversationId } });
        const admitted = await runtime.store.admit(work.id, input.userId, checkpoint);
        if (!admitted) throw new Error('Admission was cancelled before persistence completed');
      } catch (error) {
        await runtime.store.pause(work.id, input.userId);
        throw error;
      }
    }
    // Attach before waking, so fast initial responses cannot outrun the subscriber.
    await attach(work, input.transport);
    await runtime.scheduler.tick();
    return { workId: work.id, conversationId };
  };
}
