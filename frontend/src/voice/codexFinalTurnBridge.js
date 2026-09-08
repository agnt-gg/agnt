/** Correlate native user finals and delegations into one authoritative turn.
 * Separate transport identity from text equality: repeat words with fresh ID valid.
 * Speech epochs advance on native turn.created, never a delayed final transcript.
 */
export function createCodexFinalTurnBridge({submitTurn,emit,onState=()=>{},onTranscript=()=>{},onError=()=>{},setPlaybackAllowed=()=>{},maxTurns=1024}){
 let closed=false,epoch=0,pending=false,assistantActive=false,hasIssuedSpeech=false,queuedSpeech=[];
 const begun=new Set(),committed=new Set();let partial='',lastWasUserPartial=false;
 function begin(id){
  if(begun.has(id))return;
  if(begun.size>=maxTurns)throw new Error('voice_session_limit');
  if(!lastWasUserPartial)partial='';
  begun.add(id);epoch++;queuedSpeech=[];hasIssuedSpeech=false;setPlaybackAllowed(false);onState('listening');
 }
 async function handle(event){
  if(closed)return;
  if(event.type==='user-turn-start'){begin(event.id);return;}
  let delegationId=null;
  if(event.type==='delegation'){
   if(!event.turnId||!begun.has(event.turnId)){onError('voice_uncorrelated_delegation');return;}
   delegationId=event.id;
   event={type:'transcript',role:'user',final:true,id:event.turnId,text:partial.trim()||event.text,delegatedInterpretation:event.text,observedTranscript:partial.trim()||null,commitKind:'correlated-delegation'};
  }else{
   if(event.type!=='transcript')return;
   onTranscript(event);
   if(event.role==='user'&&!event.final){if(!lastWasUserPartial)partial='';partial=(partial+event.text).slice(-16384);lastWasUserPartial=true;return;}
  }
  if(event.role==='assistant'){
   if(!event.final)assistantActive=true;
   if(event.final){
    assistantActive=false;setPlaybackAllowed(false);
    if(queuedSpeech.length){const text=queuedSpeech.join(' ');queuedSpeech=[];hasIssuedSpeech=true;emit(text,null);setPlaybackAllowed(true);onState('speaking');}
    else{hasIssuedSpeech=false;onState(pending?'working':'listening');}
   }
   return;
  }
  if(!event.final)return;
  if(!event.id)throw new Error('voice_final_missing_id');
  if(committed.has(event.id))return;
  begin(event.id);
  // End events for older turns must not dispatch after a newer native start.
  const latest=[...begun].at(-1);
  if(latest!==event.id){committed.add(event.id);onError('voice_stale_final');return;}
  if(committed.size>=maxTurns)throw new Error('voice_session_limit');
  committed.add(event.id);
  if(!event.text.trim())return;
  if(pending){onError('voice_turn_busy');return;}
  pending=true;const ownEpoch=epoch;partial='';lastWasUserPartial=false;let accepted=false,messageId=null;
  onState('working');
  try{
   const result=await submitTurn({text:event.text.trim(),transcript:delegationId?event.observedTranscript:event.text.trim(),commitKind:event.commitKind||'native-final',utteranceId:event.id,delegationId,delegatedInterpretation:event.delegatedInterpretation||null,onAccepted:receipt=>{
    if(closed||ownEpoch!==epoch)return;
    if(receipt?.accepted&&typeof receipt.conversationId==='string'&&receipt.conversationId&&typeof receipt.assistantMessageId==='string'&&receipt.assistantMessageId){accepted=true;messageId=receipt.assistantMessageId;}
   },onSpeech:(text,id)=>{
    if(closed||ownEpoch!==epoch||!accepted||id!==messageId||!text?.trim())return;
    // A pre-existing voice response is not authorized by a later Annie result.
    // Defer the real result until that muted response ends, then use a new context.
    if(assistantActive&&!hasIssuedSpeech){queuedSpeech.push(text);if(queuedSpeech.join(' ').length>16384)throw new Error('voice_narration_limit');return;}
    hasIssuedSpeech=true;emit(text,delegationId);setPlaybackAllowed(true);onState('speaking');
   }});
   if(!closed&&ownEpoch===epoch&&(!accepted||!result?.accepted))onError(result?.reason||'voice_turn_unconfirmed');
  }catch{if(!closed)onError('voice_turn_failed');}
  finally{pending=false;if(!closed&&ownEpoch===epoch&&!hasIssuedSpeech)onState(queuedSpeech.length?'working':'listening');}
 }
 return {handle,close(){closed=true;epoch++;queuedSpeech=[];setPlaybackAllowed(false);}};
}
