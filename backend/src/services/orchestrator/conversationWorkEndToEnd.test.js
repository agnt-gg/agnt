import {it,expect,vi} from 'vitest';
import sqlite3 from 'sqlite3';
import {createConversationWorkRuntime} from './conversationWorkRuntime.js';
import {createDurableToolDispatch} from './durableToolDispatch.js';
import {RequirementValidators} from './requirementValidators.js';

it('Teams: a summary with four unfinished requirements schedules the remaining real dispatches',async()=>{
 const database=new sqlite3.Database(':memory:');let runtime;let dispatched=0;
 const outcomes=new Map();
 const requirements=Array.from({length:5},(_,index)=>({id:`requirement-${index}`,validator:'fixture-state',targetVersion:'v1'}));
 const validators=new RequirementValidators([['fixture-state',async({requirement})=>({passed:outcomes.has(requirement.id),targetVersion:'v1',reference:`receipt:${requirement.id}`})]]);
 try{
  runtime=await createConversationWorkRuntime({database,
   runSegment:async({work,checkpoint,assertOwnership})=>{
    const index=checkpoint.next||0;
    const storage=runtime.snapshots.forWork(work);
    const dispatch=createDurableToolDispatch({claim:work,operations:runtime.operations,segmentId:`segment-${index}`,assertOwnership,receipts:{write:(_id,value)=>storage.write(value),read:reference=>storage.read(reference)}});
    await dispatch({toolCallId:'call',name:'fixture-action',args:{index},execute:async()=>{dispatched++;outcomes.set(requirements[index].id,true);return {success:true};}});
    return {checkpoint:{next:index+1,summary:index===0?'Four requirements remain.':'Progress'}};
   },
   verify:async({work,signal})=>({requirements:await validators.verify({work,requirements,signal})}),
  });
  const work=await runtime.store.create({conversationId:'teams',ownerId:'owner',objective:'Finish all five requirements'});
  runtime.scheduler.intervalMs=10;runtime.start();
  await vi.waitFor(async()=>expect((await runtime.store.find(work.id,'owner')).status).toBe('succeeded'),{timeout:5000});
  expect(dispatched).toBe(5);
  expect((await runtime.store.get('SELECT count(*) AS count FROM conversation_operations')).count).toBe(5);
  const events=await runtime.store.events(work.id,'owner');expect(events.filter(event=>event.status==='succeeded')).toHaveLength(1);
  expect(events.filter(event=>event.status==='queued')).toHaveLength(4);
 }finally{if(runtime)await runtime.scheduler.drain();await new Promise((resolve,reject)=>database.close(error=>error?reject(error):resolve()));}
},15000);
