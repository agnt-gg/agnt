import {beforeEach,afterEach,it,expect} from 'vitest';
import sqlite3 from 'sqlite3';
import {ConversationWorkModel} from '../../models/ConversationWorkModel.js';
import {ConversationWorkSupervisor} from './conversationWorkSupervisor.js';
let database,store,work;
beforeEach(async()=>{database=new sqlite3.Database(':memory:');store=new ConversationWorkModel(database);await store.initialize();work=await store.create({conversationId:'chat',ownerId:'owner',objective:'Finish',now:0});});
afterEach(()=>new Promise((resolve,reject)=>database.close(error=>error?reject(error):resolve())));
it('status events are committed with changes and ordered for reconnect',async()=>{
 const claim=await store.claim(work.id,'owner',{now:1});
 await store.checkpoint(claim,{status:'queued',checkpoint:{},reason:'unmet',now:2});
 await store.pause(work.id,'owner',3);
 const events=await store.events(work.id,'owner');
 expect(events.map(event=>event.status)).toEqual(['running','queued','paused']);
 expect(await store.events(work.id,'stranger')).toEqual([]);
 expect(await store.events(work.id,'owner',events[1].sequence)).toEqual([events[2]]);
});
it('unchanged evidence backs off without marking work complete',async()=>{
 let now=1;
 const supervisor=new ConversationWorkSupervisor({store,clock:()=>now,runSegment:async()=>({checkpoint:{}}),verify:async()=>({requirements:[{id:'one'}]})});
 for(let index=0;index<4;index++){expect((await supervisor.run(work.id,'owner')).status).toBe('queued');now++;}
 expect((await supervisor.run(work.id,'owner')).status).toBe('not_claimed');
 const pending=await store.find(work.id,'owner');expect(pending.next_wake).toBeGreaterThan(now);expect(pending.status).toBe('queued');
});
it('auth waits resume only on the matching wake reason',async()=>{
 const claim=await store.claim(work.id,'owner',{now:1});
 await store.checkpoint(claim,{status:'waiting_auth',checkpoint:{},reason:'expired',now:2});
 expect(await store.wake(work.id,'owner','operation_completed',3)).toBe(false);
 expect(await store.wake(work.id,'owner','credential_updated',3)).toBe(true);
 expect((await store.find(work.id,'owner')).status).toBe('queued');
});
