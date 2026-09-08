import { describe, it, expect } from 'vitest';
import { createRequestVoiceBridge } from './requestVoiceBridge.js';
import { createNativeVoiceSubmit } from './nativeVoiceSubmit.js';
import { createTurnReceipt, wrapSendEventWithReceipt } from '../../../backend/src/services/orchestrator/turnReceipt.js';
const identity={userId:'user',conversationId:'conversation',requestId:'request'};
function setup(override={}) {
 const speech=[]; const server=createTurnReceipt(identity);
 const bridge=createRequestVoiceBridge({expected:identity,requireAuthenticatedReceipt:true,onSpeech:t=>speech.push(t),...override});
 const send=wrapSendEventWithReceipt(server,bridge.event);
 send('conversation_started',{});send('agent_execution_started',{executionId:'execution'});
 send('assistant_message',{id:'answer'});send('final_content',{assistantMessageId:'answer',content:'No.'});
 return {server,bridge,send,speech};
}
const persisted={executionPersisted:true,transcriptPersisted:true};
describe('strict terminal receipt contract',()=>{
 it('real server stamps are accepted without rewriting the answer',()=>{const f=setup();f.send('done',f.server.finish(persisted));expect(f.bridge.finish().completed).toBe(true);expect(f.speech).toEqual(['No.']);});
 for(const status of ['failed','cancelled','unknown',undefined]) it(`latches execution outcome ${status}`,()=>{
  const f=setup();f.send('agent_execution_completed',{executionId:'execution',status});
  expect(f.server.finish(persisted).completed).toBe(false);
  f.send('done',{...f.server.finish(),completed:true,success:true,status:'completed'});
  expect(f.bridge.finish()).toMatchObject({accepted:true,completed:false});expect(f.speech).toEqual([]);
 });
 for(const field of ['accepted','completed','success','executionPersisted','transcriptPersisted']) it(`rejects false ${field}`,()=>{
  const f=setup();f.send('done',{...f.server.finish(persisted),[field]:false});expect(f.bridge.finish()).toMatchObject({accepted:true,completed:false});expect(f.speech).toEqual([]);
 });
 for(const field of ['accountId','requestId','userId','provider']) it(`seals ${field} for arbitrary events`,()=>{
  const f=setup();f.send('done',f.server.finish(persisted));f.bridge.event('heartbeat',{[field]:'late'});expect(f.bridge.finish().completed).toBe(false);expect(f.speech).toEqual([]);
 });
 it('native submission refuses a legacy done receipt',async()=>{
  const speech=[];const submit=createNativeVoiceSubmit({send:async(_,o)=>{for(const [name,data] of [['conversation_started',{conversationId:'c'}],['agent_execution_started',{executionId:'e'}],['assistant_message',{id:'m'}],['final_content',{assistantMessageId:'m',content:'No.'}],['done',{}]])o.onVoiceStreamEvent(name,data);}});
  expect((await submit({text:'Question',onSpeech:t=>speech.push(t)})).completed).toBe(false);expect(speech).toEqual([]);
 });
});
