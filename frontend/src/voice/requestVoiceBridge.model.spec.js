import {describe,it,expect} from 'vitest';
import {createRequestVoiceBridge} from './requestVoiceBridge.js';
const identity={userId:'u',conversationId:'c',requestId:'r',provider:'selected-provider',model:'selected-model'};
function fixture() {
 const speech=[];const b=createRequestVoiceBridge({expected:identity,requireAuthenticatedReceipt:true,onSpeech:t=>speech.push(t)});
 b.event('conversation_started',{conversationId:'c'});b.event('agent_execution_started',{executionId:'e'});b.event('assistant_message',{id:'m'});b.event('final_content',{assistantMessageId:'m',content:'No.'});
 return {b,speech,done:{...identity,receiptVersion:1,binding:'authenticated-user-execution',executionId:'e',assistantMessageId:'m',status:'completed',accepted:true,completed:true,success:true,executionPersisted:true,transcriptPersisted:true}};
}
describe('requested versus observed model identity',()=>{
 it('allows the explicitly selected model without changing final text',()=>{const {b,speech,done}=fixture();b.event('done',done);expect(b.finish()).toMatchObject({completed:true,requestIdentity:identity});expect(speech).toEqual(['No.']);});
 for(const model of ['fallback-model','',null,undefined,'x'.repeat(257)]) it('rejects model mismatch or invalid value '+String(model).slice(0,20),()=>{const {b,speech,done}=fixture();b.event('done',{...done,model});expect(b.finish().completed).toBe(false);expect(speech).toEqual([]);});
 it('rejects omission rather than calling requested model attested',()=>{const {b,speech,done}=fixture();delete done.model;b.event('done',done);expect(b.finish()).toMatchObject({accepted:true,completed:false,reason:'request_identity_unattested'});expect(speech).toEqual([]);});
 it('seals observed model after done',()=>{const {b,speech,done}=fixture();b.event('done',done);b.event('heartbeat',{model:'other'});expect(b.finish().completed).toBe(false);expect(speech).toEqual([]);});
 it('rejects within-stream model switching',()=>{const {b,speech,done}=fixture();b.event('heartbeat',{model:'other'});b.event('done',done);expect(b.finish().completed).toBe(false);expect(speech).toEqual([]);});
});
