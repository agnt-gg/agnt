import {it,expect,vi} from 'vitest';
import sqlite3 from 'sqlite3';
import {createConversationWorkApplication} from './conversationWorkApplication.js';
it('normal admission reaches the existing segment interface and continues without another submission',async()=>{
 const database=new sqlite3.Database(':memory:');let runtime,calls=0;
 const messages=[{role:'system',content:'frozen'},{role:'user',content:'Finish both'}];
 try{
  runtime=await createConversationWorkApplication({database,
   executeSegment:async input=>{
    calls++;
    expect(input.authToken).toBe('Bearer fixture');
    if(calls===2)expect(input.preparedHistory.slice(0,2)).toEqual(messages);
    return {status:'response_ended',messages:[...(input.preparedHistory||messages),{role:'assistant',content:calls===1?'One remains':'Finished'}],finalContent:calls===1?'One remains':'Finished',runtimeSelection:{provider:'fixture',model:'fixture'},executionId:String(calls)};
   },
   authorityOptions:{capture:async()=>({kind:'personal',binding:{ownerId:'owner'},credential:'Bearer fixture'}),verifyCredential:async()=>({ok:true,ownerId:'owner'}),authorizeScope:async()=>{}},
   contracts:{create:async()=> 'contract',verify:async({work,checkpoint})=>{checkpoint.continuation='Complete the remaining requirement.';return {requirements:[{id:'all',targetVersion:'v1',evidence:calls===2?{passed:true,revision:work.revision,validator:'fixture',receipt:'receipt',targetVersion:'v1'}:undefined}]};}},
   transports:{attach:async()=>{},forWork:async()=>({})},authorize:async()=>{},
  });
  runtime.scheduler.intervalMs=10;runtime.start();
  const admitted=await runtime.admit({userId:'owner',body:{conversationId:'chat',message:'Finish both'},chatType:'orchestrator'});
  await vi.waitFor(async()=>expect((await runtime.store.find(admitted.workId,'owner')).status).toBe('succeeded'),{timeout:3000});
  expect(calls).toBe(2);
 }finally{if(runtime)await runtime.scheduler.drain();await new Promise((resolve,reject)=>database.close(error=>error?reject(error):resolve()));}
});
