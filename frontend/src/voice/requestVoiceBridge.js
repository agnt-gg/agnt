import {createSentenceChunker} from './sentenceChunker.js';
import {spokenRegister} from './voiceReplyPolicy.js';
/** Bind speech to this submit's callback stream, never global last-message state.
 * Tracks server conversation/message identity; not yet a durable execution ID.
 */
export function createRequestVoiceBridge({onAccepted=()=>{},onSpeech=()=>{}}={}){
 let conversationId=null,messageId=null,executionId=null,accepted=false,failed=false,accumulated='',chunker=createSentenceChunker();
 const speak=chunks=>{if(!failed&&accepted)for(const text of chunks)if(text.trim())onSpeech(text,messageId);};
 const accept=()=>{if(conversationId&&messageId){accepted=true;onAccepted({accepted:true,conversationId,assistantMessageId:messageId,...(executionId?{executionId}:{}),identityKind:executionId?'server-execution':'server-message'});}};
 return {
  event(name,data={}){
   if(name==='agent_execution_started'&&typeof data.executionId==='string'){executionId=data.executionId;accept();}
   if(name==='conversation_started'){conversationId=data.conversationId;accept();}
   if(name==='assistant_message'){speak(chunker.flush());messageId=data.id||data.assistantMessageId;accumulated='';chunker=createSentenceChunker();accept();}
   if(name==='content_delta'&&data.assistantMessageId===messageId){accumulated+=data.delta||'';speak(chunker.push(spokenRegister(accumulated)));}
   if(name==='final_content'&&data.assistantMessageId===messageId&&typeof data.content==='string'){
    if(data.content.startsWith(accumulated)){accumulated=data.content;speak(chunker.push(spokenRegister(accumulated)));}
    speak(chunker.flush());
   }
   if(name==='done')speak(chunker.flush());
   if(name==='error'||name==='run_ended')failed=true;
  },
  finish(){speak(chunker.flush());return {accepted:accepted&&!failed,conversationId,assistantMessageId:messageId,...(executionId?{executionId}:{}),identityKind:executionId?'server-execution':'server-message',reason:failed?'request_failed':accepted?null:'request_unconfirmed'};},
 };
}
