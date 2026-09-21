import {beforeEach,afterEach,it,expect} from 'vitest';
import sqlite3 from 'sqlite3';
import {ConversationWorkModel} from './ConversationWorkModel.js';
import {ConversationSnapshotModel} from './ConversationSnapshotModel.js';
import {ConversationWorkInbox} from './ConversationWorkInbox.js';
let database,store,work;
beforeEach(async()=>{database=new sqlite3.Database(':memory:');store=new ConversationWorkModel(database);await store.initialize();work=await store.create({conversationId:'chat',ownerId:'owner',objective:'Finish'});});
afterEach(()=>new Promise((resolve,reject)=>database.close(error=>error?reject(error):resolve())));
it('immutable snapshots are scoped to work and owner',async()=>{
 const snapshots=new ConversationSnapshotModel(store,{encode:text=>`encoded:${text}`,decode:text=>text.slice(8)});await snapshots.initialize();
 const own=snapshots.forWork(work);const reference=await own.write({messages:['private']});
 expect(await own.read(reference)).toEqual({messages:['private']});
 await expect(snapshots.forWork({...work,owner_id:'stranger'}).read(reference)).rejects.toThrow();
 const row=await store.get('SELECT payload FROM conversation_snapshots WHERE id=?',[reference]);expect(row.payload.startsWith('encoded:')).toBe(true);
});
it('steering is ordered and duplicate events are ignored',async()=>{
 const inbox=new ConversationWorkInbox(store);await inbox.initialize();
 const event={key:'user-message',kind:'steering',payload:{text:'Also test'}};
 expect(await inbox.append(work.id,'owner',event)).toBe(true);
 expect(await inbox.append(work.id,'owner',event)).toBe(false);
 const claim=await store.claim(work.id,'owner');const pending=await inbox.pending(claim);expect(pending).toHaveLength(1);
 expect(await store.checkpoint(claim,{status:'queued',checkpoint:{inboxThrough:pending[0].sequence},reason:'steering_applied'})).toBe(true);
 const next=await store.claim(work.id,'owner');expect(await inbox.pending(next)).toHaveLength(0);
 await store.pause(work.id,'owner');expect(await inbox.pending(next)).toHaveLength(0);
});
it('credential updates do not resurrect user-paused work',async()=>{
 await store.pause(work.id,'owner');
 expect(await store.wake(work.id,'owner','credential_updated')).toBe(false);
 expect((await store.find(work.id,'owner')).status).toBe('paused');
});
