import { describe, it, expect, vi } from 'vitest';
import { createNativeVoiceSubmit } from './nativeVoiceSubmit.js';
const getExpectedIdentity=()=>({userId:'user',requestId:'r',provider:'selected',model:'selected-model',conversationId:'c'});
const turn={text:'Move it only after backup.',transcript:'Move it',utteranceId:'u',commitKind:'correlated-delegation',delegatedInterpretation:'Move it only after backup.'};
function events(emit) {
 emit('conversation_started',{conversationId:'c'});
 emit('agent_execution_started',{executionId:'e'});
 emit('assistant_message',{id:'m'});
 emit('final_content',{assistantMessageId:'m',content:'No, do not do it.'});
 emit('done',{receiptVersion:1,binding:'authenticated-user-execution',requestId:'r',userId:'user',provider:'selected',model:'selected-model',conversationId:'c',executionId:'e',assistantMessageId:'m',accepted:true,completed:true,success:true,status:'completed',executionPersisted:true,transcriptPersisted:true});
}
describe('native request adapter',()=>{
 it('keeps the full instruction/provenance and waits for settlement',async()=>{
  let release;const onSpeech=vi.fn(), onAccepted=vi.fn();
  const submit=createNativeVoiceSubmit({getExpectedIdentity,send:async(text,options)=>{
   expect(text).toBe(turn.text);expect(options.voiceMetadata.commitKind).toBe('correlated-delegation');
   events(options.onVoiceStreamEvent);await new Promise(r=>release=r);
  }});
  const pending=submit({...turn,onSpeech,onAccepted});expect(onAccepted).toHaveBeenCalledTimes(1);expect(onSpeech).not.toHaveBeenCalled();
  release();expect(await pending).toMatchObject({accepted:true,completed:true,executionId:'e'});expect(onSpeech).toHaveBeenCalledWith('No, do not do it.','m');
 });
 it('rejects busy and double sends without mutating the draft',async()=>{
  let release;const send=vi.fn(()=>new Promise(r=>release=r));const submit=createNativeVoiceSubmit({getExpectedIdentity,send});
  const first=submit(turn);expect(await submit(turn)).toMatchObject({accepted:false,reason:'voice_turn_busy'});release();await first;expect(send).toHaveBeenCalledTimes(1);
  expect(await createNativeVoiceSubmit({getExpectedIdentity,send,isBusy:()=>true})(turn)).toMatchObject({accepted:false});expect(send).toHaveBeenCalledTimes(1);
 });
 it('preserves acceptance but fails closed on thrown transport after done',async()=>{
  const onSpeech=vi.fn();const submit=createNativeVoiceSubmit({getExpectedIdentity,send:async(_,o)=>{events(o.onVoiceStreamEvent);throw Error('disconnect');}});
  expect(await submit({...turn,onSpeech})).toMatchObject({accepted:true,completed:false,status:'failed'});expect(onSpeech).not.toHaveBeenCalled();
 });
 it('EOF cannot narrate a draft or invent completion',async()=>{
  const onSpeech=vi.fn();const submit=createNativeVoiceSubmit({getExpectedIdentity,send:async(_,o)=>o.onVoiceStreamEvent('content_delta',{delta:'unsafe'})});
  expect(await submit({...turn,onSpeech})).toMatchObject({completed:false,status:'unknown'});expect(onSpeech).not.toHaveBeenCalled();
 });
});
