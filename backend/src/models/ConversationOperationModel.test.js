import { beforeEach, afterEach, it, expect } from 'vitest';
import sqlite3 from 'sqlite3';
import { ConversationWorkModel } from './ConversationWorkModel.js';
import { ConversationOperationModel } from './ConversationOperationModel.js';
let database, store, operations, claim;
beforeEach(async () => {
 database = new sqlite3.Database(':memory:'); store = new ConversationWorkModel(database);
 await store.initialize(); operations = new ConversationOperationModel(store); await operations.initialize();
 const work = await store.create({conversationId:'chat', ownerId:'owner', objective:'Finish', now:0});
 claim = await store.claim(work.id,'owner',{now:1,leaseMs:100});
});
afterEach(() => new Promise((resolve,reject) => database.close(error => error ? reject(error) : resolve())));
const input = {key:'send-1',fingerprint:'sha256-args',toolName:'send_email',now:2};
it('duplicate dispatch cannot repeat an uncertain effect',async()=>{
 const first=await operations.begin(claim,input); const second=await operations.begin(claim,input);
 expect(first.dispatch).toBe(true);expect(second).toMatchObject({id:first.id,dispatch:false,status:'unknown'});
});
it('completed operation returns its existing receipt',async()=>{
 const first=await operations.begin(claim,input);
 expect(await operations.finish(claim,first.id,{status:'completed',resultRef:'trace/result',now:3})).toBe(true);
 expect(await operations.begin(claim,input)).toMatchObject({dispatch:false,status:'completed',resultRef:'trace/result'});
});
it('a changed argument cannot reuse an operation key',async()=>{
 await operations.begin(claim,input);
 await expect(operations.begin(claim,{...input,fingerprint:'different'})).rejects.toThrow('different input');
});
it('Stop fences new dispatches and completion',async()=>{
 const first=await operations.begin(claim,input);await store.pause(claim.id,'owner',3);
 expect(await operations.finish(claim,first.id,{status:'completed',resultRef:'receipt',now:4})).toBe(false);
 await expect(operations.begin(claim,{...input,key:'next',now:4})).rejects.toThrow('ownership lost');
});
it('takeover cannot replay the prior attempt',async()=>{
 await operations.begin(claim,input);
 const next=await store.claim(claim.id,'owner',{now:102});
 expect(await operations.begin(next,{...input,now:103})).toMatchObject({dispatch:false,status:'unknown'});
});
