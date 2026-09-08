import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createTurnReceipt } from './turnReceipt.js';
const identity={userId:'u',conversationId:'c',requestId:'r'};
const durable={executionPersisted:true,transcriptPersisted:true};
function fixture() {
 const r=createTurnReceipt(identity);
 r.observe('agent_execution_started',{executionId:'e'});
 r.observe('assistant_message',{id:'m'});
 r.observe('final_content',{assistantMessageId:'m',content:'No.'});
 return r;
}
describe('server terminal authority boundaries',()=>{
 for(const executionId of ['other','',null,undefined]) it('rejects mismatched/missing completion execution '+executionId,()=>{
  const r=fixture();r.observe('agent_execution_completed',{executionId,status:'completed'});
  expect(r.finish(durable)).toMatchObject({accepted:true,completed:false,status:'failed'});
 });
 for(const content of ['Yes.',null,42,'x'.repeat(262145)]) it('rejects contradictory or invalid final '+String(content).slice(0,10),()=>{
  const r=fixture();r.observe('final_content',{assistantMessageId:'m',content});
  expect(r.finish(durable)).toMatchObject({accepted:true,completed:false,status:'failed'});
 });
 it('allows identical final and completion replay, binding exact final bytes',()=>{
  const r=fixture();r.observe('final_content',{assistantMessageId:'m',content:'No.'});
  r.observe('agent_execution_completed',{executionId:'e',status:'completed'});
  r.observe('agent_execution_completed',{executionId:'e',status:'completed'});
  expect(r.finish(durable)).toMatchObject({completed:true,finalContentSha256:createHash('sha256').update('No.').digest('hex')});
 });
 for(const [key,value] of [['executionId','other'],['requestId','other'],['conversationId','other'],['userId','other']]) it('latches explicit final '+key+' conflict',()=>{
  const r=fixture();r.observe('final_content',{assistantMessageId:'m',content:'No.',[key]:value});
  expect(r.finish(durable).completed).toBe(false);
 });
 it('rejects switching assistant identity after final',()=>{
  const r=fixture();r.observe('assistant_message',{id:'other'});r.observe('final_content',{assistantMessageId:'other',content:'Yes.'});
  expect(r.finish(durable).completed).toBe(false);
 });
 it('rejects stale assistant replay before final',()=>{
  const r=createTurnReceipt(identity);r.observe('agent_execution_started',{executionId:'e'});
  for(const id of ['m1','m2','m1']) r.observe('assistant_message',{id});
  r.observe('final_content',{assistantMessageId:'m1',content:'No.'});expect(r.finish(durable).completed).toBe(false);
 });
 it('allows a fresh continuation before final',()=>{
  const r=createTurnReceipt(identity);r.observe('agent_execution_started',{executionId:'e'});
  for(const id of ['m1','m2']) r.observe('assistant_message',{id});
  r.observe('final_content',{assistantMessageId:'m2',content:''});expect(r.finish(durable)).toMatchObject({completed:true,assistantMessageId:'m2',finalContentSha256:createHash('sha256').update('').digest('hex')});
 });
 for(const data of [null,[],42]) it('malformed event fails closed without throwing '+String(data),()=>{
  const r=fixture();expect(()=>r.observe('final_content',data)).not.toThrow();expect(r.finish(durable).completed).toBe(false);
 });
});
