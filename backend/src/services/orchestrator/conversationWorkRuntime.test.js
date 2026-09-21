import {it,expect,vi} from 'vitest';
import sqlite3 from 'sqlite3';
import {createConversationWorkRuntime} from './conversationWorkRuntime.js';
it('composed scheduler runs five requirements to completion without another user message',async()=>{
 const database=new sqlite3.Database(':memory:');let runtime;
 try{
  let count=0;
  runtime=await createConversationWorkRuntime({database,runSegment:async()=>({checkpoint:{finished:++count}}),verify:async({checkpoint,work})=>({requirements:Array.from({length:5},(_,index)=>({id:String(index),targetVersion:'v1',evidence:index<checkpoint.finished?{passed:true,revision:work.revision,validator:'fixture',receipt:`check:${index}`,targetVersion:'v1'}:undefined}))})});
  const work=await runtime.store.create({conversationId:'teams',ownerId:'owner',objective:'Finish all five'});
  runtime.scheduler.intervalMs=10;runtime.start();
  await vi.waitFor(async()=>expect((await runtime.store.find(work.id,'owner')).status).toBe('succeeded'),{timeout:3000});
  expect(count).toBe(5);
 }finally{if(runtime)await runtime.scheduler.drain();await new Promise((resolve,reject)=>database.close(error=>error?reject(error):resolve()));}
});
