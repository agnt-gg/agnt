import {it,expect} from 'vitest';
import sqlite3 from 'sqlite3';
import {ConversationWorkModel} from '../../models/ConversationWorkModel.js';
import {ConversationOperationModel} from '../../models/ConversationOperationModel.js';
import {recoverConversationWork} from './recoverConversationWork.js';
it('recovery leaves uncertain effects waiting and interrupted admissions paused',async()=>{
 const database=new sqlite3.Database(':memory:');
 try{
  const store=new ConversationWorkModel(database);await store.initialize();
  const operations=new ConversationOperationModel(store);await operations.initialize();
  const work=await store.create({conversationId:'active',ownerId:'owner',objective:'Send',now:0});
  const claim=await store.claim(work.id,'owner',{now:1,leaseMs:10});
  await operations.begin(claim,{key:'send',fingerprint:'args',toolName:'email',now:2});
  const preparing=await store.create({conversationId:'preparing',ownerId:'owner',objective:'Prepare',status:'preparing',now:0});
  expect(await recoverConversationWork(store,12)).toEqual({interruptedAdmissions:1,uncertainOperations:1,waitingWork:1});
  expect((await store.find(work.id,'owner')).status).toBe('waiting_dependency');
  expect((await store.find(preparing.id,'owner')).status).toBe('paused');
  expect(await store.due({now:13})).toEqual([]);
 }finally{await new Promise((resolve,reject)=>database.close(error=>error?reject(error):resolve()));}
});
