import { describe, it, expect, vi } from 'vitest';
import { createNativeVoiceSubmit } from './nativeVoiceSubmit.js';
const identity = {userId:'user',requestId:'request',provider:'chosen-provider',model:'chosen-model',conversationId:'conversation'};
function emit(o, overrides={}) {
 const e=o.onVoiceStreamEvent;
 e('conversation_started',{conversationId:'conversation'});e('agent_execution_started',{executionId:'execution'});e('assistant_message',{id:'assistant'});
 e('final_content',{assistantMessageId:'assistant',content:'No, do not do it.'});
 e('done',{...identity,receiptVersion:1,binding:'authenticated-user-execution',accountBinding:'unattested',executionId:'execution',assistantMessageId:'assistant',accepted:true,completed:true,success:true,status:'completed',executionPersisted:true,transcriptPersisted:true,...overrides});
}
describe('native authenticated origin boundary',()=>{
 it('an empty host cannot authenticate itself from receipt fields',async()=>{
  const speech=vi.fn();const submit=createNativeVoiceSubmit({send:async(_,o)=>emit(o)});
  expect((await submit({text:'Question',onSpeech:speech})).completed).toBe(false);expect(speech).not.toHaveBeenCalled();
 });
 it('binds before events, snapshots identity, and preserves exact final',async()=>{
  const speech=vi.fn();const submit=createNativeVoiceSubmit({send:async(_,o)=>{const expected={...identity};o.bindVoiceRequest(expected);expected.model='changed';emit(o);}});
  expect(await submit({text:'Question',onSpeech:speech})).toMatchObject({completed:true,expectedIdentity:identity});expect(speech).toHaveBeenCalledWith('No, do not do it.','assistant');
 });
 it.each(['userId','requestId','conversationId','provider','model'])('rejects mismatching %s without speech',async key=>{
  const speech=vi.fn();const submit=createNativeVoiceSubmit({send:async(_,o)=>{o.bindVoiceRequest(identity);emit(o,{[key]:'other'});}});
  expect((await submit({text:'Question',onSpeech:speech})).completed).toBe(false);expect(speech).not.toHaveBeenCalled();
 });
 it.each(['userId','requestId','provider','model'])('requires expected %s before sending',async key=>{
  const submit=createNativeVoiceSubmit({send:async(_,o)=>{const expected={...identity};delete expected[key];o.bindVoiceRequest(expected);emit(o);}});
  expect((await submit({text:'Question'})).completed).toBe(false);
 });
 it('does not permit late binding to launder an already observed stream',async()=>{
  const speech=vi.fn();const submit=createNativeVoiceSubmit({send:async(_,o)=>{emit(o);o.bindVoiceRequest(identity);}});
  expect((await submit({text:'Question',onSpeech:speech})).completed).toBe(false);expect(speech).not.toHaveBeenCalled();
 });
 it('rejects a second binding even if the first stream completed',async()=>{
  const speech=vi.fn();const submit=createNativeVoiceSubmit({send:async(_,o)=>{o.bindVoiceRequest(identity);emit(o);o.bindVoiceRequest(identity);}});
  expect((await submit({text:'Question',onSpeech:speech})).completed).toBe(false);expect(speech).not.toHaveBeenCalled();
 });
});
