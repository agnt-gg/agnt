import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import { ConversationWorkModel } from '../../models/ConversationWorkModel.js';
import { ConversationWorkInbox } from '../../models/ConversationWorkInbox.js';
import { createConversationAdmission } from './conversationAdmission.js';
let database, store, inbox;
beforeEach(async () => {
  database = new sqlite3.Database(':memory:'); store = new ConversationWorkModel(database);
  await store.initialize(); inbox = new ConversationWorkInbox(store); await inbox.initialize();
});
afterEach(() => new Promise((resolve, reject) => database.close(error => error ? reject(error) : resolve())));
const input = { userId: 'owner', body: { conversationId: 'chat', message: 'Finish all five' }, transport: {} };
it('cannot schedule partially persisted input; attaches before waking', async () => {
  const order = [];
  const admit = createConversationAdmission({runtime: {store,inbox,scheduler:{tick:async()=>order.push('wake')}}, authorize:async()=>order.push('authorize'),
    saveInput:async work=>{expect(await store.claim(work.id,'owner')).toBeNull();order.push('save');return {snapshotRef:'saved'};},
    attach:async()=>order.push('attach')});
  await admit(input);
  expect(order).toEqual(['authorize','save','attach','wake']);
  const work = await store.findActiveConversation('chat','owner');
  expect(JSON.parse(work.checkpoint_json)).toEqual({snapshotRef:'saved'});
});
it('new instructions steer existing work instead of starting a competing generation', async () => {
  const work=await store.create({conversationId:'chat',ownerId:'owner',objective:'Original',checkpoint:{snapshotRef:'saved'}});
  const saveInput=vi.fn();
  const admit=createConversationAdmission({runtime:{store,inbox,scheduler:{tick:async()=>{}}},authorize:async()=>{},saveInput,attach:async()=>{}});
  await admit({...input,messageId:'message-1'});await admit({...input,messageId:'message-1'});
  const claim=await store.claim(work.id,'owner');
  expect(await inbox.pending(claim)).toHaveLength(1);expect(saveInput).not.toHaveBeenCalled();
  expect(claim.objective).toBe('Original');
});
it('failed persistence never leaves runnable work', async()=>{
  const admit=createConversationAdmission({runtime:{store,inbox,scheduler:{tick:vi.fn()}},authorize:async()=>{},saveInput:async()=>{throw Error('Disk unavailable');},attach:vi.fn()});
  await expect(admit(input)).rejects.toThrow('Disk unavailable');
  expect(await store.due()).toEqual([]);
});
it('authorization failure creates no work',async()=>{
  const admit=createConversationAdmission({runtime:{store},authorize:async()=>{throw Error('Forbidden');}});
  await expect(admit(input)).rejects.toThrow('Forbidden');expect(await store.findActiveConversation('chat','owner')).toBeNull();
});
