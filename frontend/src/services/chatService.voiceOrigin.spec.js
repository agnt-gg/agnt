import { it, expect, vi, afterEach } from 'vitest';
import { streamChat } from './chatService.js';
import { createNativeVoiceSubmit } from '../voice/nativeVoiceSubmit.js';
import { createTurnReceipt, wrapSendEventWithReceipt } from '../../../backend/src/services/orchestrator/turnReceipt.js';
afterEach(()=>vi.unstubAllGlobals());
it.each([false,true])('binds actual transport to server-owned receipt, multipart=%s',async multipart=>{
 const speech=[];let wire;
 vi.stubGlobal('fetch',vi.fn(async(_,request)=>{
  wire=request;
  const frames=[];const receipt=createTurnReceipt({userId:'user',conversationId:'conversation',requestId:request.headers['X-AGNT-Voice-Request-Id']});
  const emit=wrapSendEventWithReceipt(receipt,(name,data)=>frames.push(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
  emit('conversation_started',{});emit('agent_execution_started',{executionId:'execution'});emit('assistant_message',{id:'assistant'});emit('final_content',{assistantMessageId:'assistant',content:'No.'});
  emit('done',receipt.finish({executionPersisted:true,transcriptPersisted:true,provider:'selected',model:'selected-model'}));
  let n=0;return {ok:true,body:{getReader:()=>({read:async()=>++n===1?{done:false,value:new TextEncoder().encode(frames.join(''))}:{done:true}})}};
 }));
 const submit=createNativeVoiceSubmit({send:(text,o)=>streamChat({chatType:'agent',messages:[{role:'user',content:text}],provider:'selected',model:'selected-model',conversationId:'conversation',voiceUserId:'user',bindVoiceRequest:o.bindVoiceRequest,onEvent:o.onVoiceStreamEvent,files:multipart?[new File(['test'],'fixture.txt')]:[]})});
 const result=await submit({text:'Question',onSpeech:t=>speech.push(t)});
 expect(result).toMatchObject({completed:true,expectedIdentity:{userId:'user',provider:'selected',model:'selected-model',conversationId:'conversation'}});
 expect(result.expectedIdentity.requestId).toBe(wire.headers['X-AGNT-Voice-Request-Id']);expect(speech).toEqual(['No.']);
});
it('missing verified user prevents network dispatch',async()=>{
 vi.stubGlobal('fetch',vi.fn());
 const submit=createNativeVoiceSubmit({send:(_,o)=>streamChat({chatType:'agent',messages:[],provider:'selected',model:'selected-model',bindVoiceRequest:o.bindVoiceRequest,onEvent:o.onVoiceStreamEvent})});
 expect((await submit({text:'Question'})).completed).toBe(false);expect(fetch).not.toHaveBeenCalled();
});
