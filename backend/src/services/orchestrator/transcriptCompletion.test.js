import { describe, it, expect } from 'vitest';
import { projectCompletedTranscript, textDigest, completionSeal } from './transcriptCompletion.js';
const user={id:'u',role:'user',content:'May I move it?'};
const receipt={assistantMessageId:'a',requestId:'r',executionId:'e',finalContentSha256:textDigest('No.')};
describe('final payload binding',()=>{
 it.each([
  [{id:'wrong',role:'assistant',content:'No.'}],
  [{id:'a',role:'assistant',content:'Yes.'}],
  [{id:'a',role:'assistant',content:'No.'},{id:'a',role:'assistant',content:'No.'}],
  [{id:'a',role:'assistant',content:'No.'},{id:'u2',role:'user',content:'Later'}],
 ])('rejects mismatched or ambiguous payload %j', (...tail)=>{
  expect(projectCompletedTranscript([user,...tail],receipt)).toBeNull();
 });
 it.each(['No.',''])('projects exact final %j over tool-round prose',text=>{
  const messages=[user,{id:'draft',role:'assistant',content:'Yes, proceed.',tool_calls:[{id:'t',type:'function',function:{name:'read',arguments:'{}'}}]},
   {role:'tool',tool_call_id:'t',content:'read-only result'}, {id:'a',role:'assistant',content:text}];
  const result=projectCompletedTranscript(messages,{...receipt,finalContentSha256:textDigest(text)});
  expect(result.at(-1).id).toBe('a'); expect(result.at(-1).content).toBe(text);
  expect(result.at(-1).contentParts.filter(p=>p.type==='text').map(p=>p.text).join('')).toBe(text);
  expect(result.at(-1).toolCalls).toHaveLength(1);
  expect(messages[1].content).toBe('Yes, proceed.');
 });
 it('seals stable user identity and revision independently of answer length',()=>{
  expect(completionSeal(receipt,[user],2)).toMatchObject({revision:2,executionId:'e',userTurnCount:1});
  expect(completionSeal(receipt,[user],2).userTurnsSha256).not.toBe(completionSeal(receipt,[{...user,id:'fresh'}],2).userTurnsSha256);
 });
});
