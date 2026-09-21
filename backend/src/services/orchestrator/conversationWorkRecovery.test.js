import { it, expect } from 'vitest';
import sqlite3 from 'sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConversationWorkModel } from '../../models/ConversationWorkModel.js';
import { ConversationOperationModel } from '../../models/ConversationOperationModel.js';
const close = database => new Promise((resolve,reject)=>database.close(error=>error?reject(error):resolve()));
it('reopens on-disk work and reconciles an interrupted operation without redispatch',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'continuity-recovery-'));
 let database;
 try {
  const filename=path.join(directory,'work.db');database=new sqlite3.Database(filename);
  let store=new ConversationWorkModel(database);await store.initialize();
  let operations=new ConversationOperationModel(store);await operations.initialize();
  const work=await store.create({conversationId:'chat',ownerId:'owner',objective:'Deliver',now:0});
  const original=await store.claim(work.id,'owner',{now:1,leaseMs:10});
  const intent={key:'email',fingerprint:'args',toolName:'email',now:2};
  const operation=await operations.begin(original,intent);
  expect(operation.dispatch).toBe(true);
  await close(database);database=new sqlite3.Database(filename);
  store=new ConversationWorkModel(database);operations=new ConversationOperationModel(store);
  const recovered=await store.claim(work.id,'owner',{now:12});
  expect(recovered.generation).toBe(2);
  expect(await operations.begin(recovered,{...intent,now:13})).toMatchObject({dispatch:false,status:'unknown'});
  expect(await operations.finish(original,operation.id,{status:'completed',resultRef:'late',now:13})).toBe(false);
 } finally {if(database)await close(database);await rm(directory,{recursive:true,force:true});}
},30000);
it('persists 2000 actual operation intents and results over 100 lease checkpoints',async()=>{
 const database=new sqlite3.Database(':memory:');
 try {
  const store=new ConversationWorkModel(database);await store.initialize();
  const operations=new ConversationOperationModel(store);await operations.initialize();
  const work=await store.create({conversationId:'soak',ownerId:'owner',objective:'Scripted receipts',now:0});
  for(let segment=0;segment<100;segment++){
   const now=segment*1000+1;
   const claim=await store.claim(work.id,'owner',{now});
   for(let index=0;index<20;index++){
    const intent={key:`${segment}:${index}`,fingerprint:'fixed',toolName:'fixture',now:now+1};
    const operation=await operations.begin(claim,intent);
    expect(operation.dispatch).toBe(true);
    const result=await Promise.resolve({success:true,value:segment*20+index});
    expect(await operations.finish(claim,operation.id,{status:result.success?'completed':'failed',resultRef:`fixture:${result.value}`,now:now+2})).toBe(true);
    expect((await operations.begin(claim,intent)).dispatch).toBe(false);
   }
   expect(await store.checkpoint(claim,{status:segment===99?'succeeded':'queued',checkpoint:{segment},reason:'fixture',now:now+3})).toBe(true);
  }
  expect((await store.get("SELECT count(*) AS count FROM conversation_operations WHERE status='completed'")).count).toBe(2000);
 }finally{await close(database);}
},30000);
