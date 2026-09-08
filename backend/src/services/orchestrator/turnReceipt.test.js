import { describe, it, expect } from 'vitest';
import { createTurnReceipt, wrapSendEventWithReceipt } from './turnReceipt.js';
import { createRequestVoiceBridge } from '../../../../frontend/src/voice/requestVoiceBridge.js';
const identity = {userId:'fixture-user', conversationId:'fixture-conversation', requestId:'fixture-request'};
const success = {executionPersisted:true, transcriptPersisted:true,provider:'selected-provider',model:'selected-model'};
function fixture() {
 const receipt=createTurnReceipt(identity), events=[], speech=[];
 const bridge=createRequestVoiceBridge({expected:identity,onSpeech:t=>speech.push(t)});
 const send=wrapSendEventWithReceipt(receipt,(n,d)=>{events.push([n,d]);bridge.event(n,d);});
 send('conversation_started',{conversationId:'forged',userId:'forged'});
 send('agent_execution_started',{executionId:'execution'});
 send('assistant_message',{id:'assistant'});
 send('content_delta',{delta:'Yes, do it.'});
 send('final_content',{assistantMessageId:'assistant',content:'No, do not do it.'});
 return {receipt,send,events,speech,bridge};
}
describe('actual server receipt to actual frontend bridge (no provider)',()=>{
 it('retains authoritative correction, selected model and authenticated server identity',()=>{
  const f=fixture(); const done=f.receipt.finish(success); f.send('done',done);
  expect(f.bridge.finish()).toMatchObject({accepted:true,completed:true,requestIdentity:identity});
  expect(f.speech).toEqual(['No, do not do it.']);
  expect(done).toMatchObject({...success,accountBinding:'unattested',status:'completed'});
  expect(f.events[0][1]).toEqual(identity);
 });
 for(const [name,override,status] of [
  ['cancel',{aborted:true},'cancelled'],['failure',{error:true},'failed'],
  ['execution write failed',{executionPersisted:false},'unknown'],
  ['transcript write failed or timed out',{transcriptPersisted:false},'unknown']]) {
  it(name+' retains acceptance but cannot authorize playback',()=>{
   const f=fixture(); f.send('done',f.receipt.finish({...success,...override}));
   expect(f.bridge.finish()).toMatchObject({accepted:true,completed:false}); expect(f.speech).toEqual([]);
   expect(f.events.at(-1)[1].status).toBe(status);
  });
 }
 it('error events cannot be laundered into successful persistence',()=>{
  const f=fixture();f.send('error',{error:'fixture'});expect(f.receipt.finish(success).status).toBe('failed');
 });
 it('missing execution or final never becomes completed',()=>{
  const r=createTurnReceipt(identity);expect(r.finish(success)).toMatchObject({accepted:false,completed:false,status:'unknown'});
 });
 it('final for unrelated assistant fails even with durable writes',()=>{
  const f=fixture();f.send('final_content',{assistantMessageId:'other',content:'yes'});expect(f.receipt.finish(success).status).toBe('failed');
 });
 it('terminal receipt seals outcome idempotently',()=>{
  const f=fixture(); const done=f.receipt.finish(success); f.receipt.observe('error',{});
  expect(f.receipt.finish({aborted:true})).toBe(done);expect(Object.isFrozen(done)).toBe(true);
 });
 it('request ids are server generated and unique by default',()=>{
  const a=createTurnReceipt({userId:'u',conversationId:'c'}).finish();
  const b=createTurnReceipt({userId:'u',conversationId:'c'}).finish();expect(a.requestId).not.toBe(b.requestId);
 });
});
