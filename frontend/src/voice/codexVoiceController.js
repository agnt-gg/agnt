import {parseCodexEvent,codexContextFrames} from './codexVoiceProtocol.js';
import {createCodexFinalTurnBridge} from './codexFinalTurnBridge.js';
import {MIC_CONSTRAINTS} from './micConstraints.js';
import {validCodexAudioConfig} from './codexVoiceConfig.js';
import {createSpeechOut} from './speechOut.js';
import {validNarrationConfig} from './codexVoiceConfig.js';
import {monitorLocalInput} from './localInputMonitor.js';
/** Browser native media controller. No credentials other than AGNT session token.
 * Submit callback owns one real HTTP chat stream. No global-last-answer watcher.
 * Initial slice rejects overlapping commands instead of replaying uncertain work.
 */
export function createCodexVoiceController({apiBase,getToken,submitTurn,onState=()=>{},onTranscript=()=>{},onError=()=>{},getUserMedia=c=>navigator.mediaDevices.getUserMedia(c),Peer=globalThis.RTCPeerConnection,makeAudio=()=>new Audio(),fetchImpl=globalThis.fetch,timeoutMs=20000,createNarrator=config=>createSpeechOut(config,{getToken}),monitorInput=monitorLocalInput}){
 let generation=0,active=false,ready=false,pc=null,dc=null,mic=null,audio=null,setupAbort=null,pending=false;
 let turnBridge=null,narrator=null,inputMonitor=null,listening=true,playbackEpoch=0;
 let inputWatch=null,inputWatchStarted=0;
 const clearInputWatch=()=>{clearTimeout(inputWatch);inputWatch=null;inputWatchStarted=0;};
 const noteInput=()=>{
  if(!inputWatchStarted)inputWatchStarted=Date.now();
  clearTimeout(inputWatch);
  const g=generation;
  inputWatch=setTimeout(()=>{if(active&&g===generation)fail('voice_input_unconfirmed');},Math.max(0,Math.min(20000,60000-(Date.now()-inputWatchStarted))));
 };
 const state=s=>onState(s);
 // Playback, listening and task lifetime are deliberately independent.
 const stopPlayback=()=>{playbackEpoch++;if(audio)audio.muted=true;narrator?.cancel();if(active)state(pending?'working':'listening');};
 const setListening=value=>{const next=Boolean(value);if(next!==listening){clearInputWatch();turnBridge?.invalidateInput();}listening=next;mic?.getTracks().forEach(t=>{t.enabled=listening;});inputMonitor?.setEnabled(listening);};
 async function submitForNarration(args,g){
  clearInputWatch();
  const ownPlayback=playbackEpoch;let accepted=null,speech=null,invalid=false;
  pending=true;
  const live=()=>active&&g===generation&&ownPlayback===playbackEpoch;
  try{
   const result=await submitTurn({...args,onAccepted:receipt=>{accepted=receipt;args.onAccepted(receipt);},onSpeech:(text,id)=>{
    if(typeof text!=='string'||text.length>16384||id!==accepted?.assistantMessageId||(speech!==null&&speech!==text)){invalid=true;return;}
    speech=text;
   }});
   const confirmed=!invalid&&result?.accepted===true&&result.completed===true&&accepted?.accepted===true&&
    ['executionId','conversationId','assistantMessageId'].every(key=>typeof result[key]==='string'&&result[key]&&result[key]===accepted[key]);
   if(live()&&confirmed&&speech?.trim()){
    state('speaking');
    // Notify the bridge (and resolve native delegation causality), but NEVER
    // grant native media permission. Only final text enters the TTS engine.
    args.onSpeech(speech,result.assistantMessageId);
    void Promise.resolve().then(()=>live()?narrator.speak(speech):{ok:false,reason:'stale'}).then(result=>{
     if(!live())return;
     state('listening');
     if(result?.ok!==true)onError(`voice_narration_${result?.reason||'unconfirmed'}`);
    },()=>{if(live()){state('listening');onError('voice_narration_failed');}});
   }else if(live()&&!confirmed)onError(result?.reason||'voice_turn_unconfirmed');
   return result;
  }finally{if(g===generation)pending=false;}
 }
 const stop=()=>{clearInputWatch();generation++;active=false;ready=false;setupAbort?.abort();setupAbort=null;pending=false;stopPlayback();inputMonitor?.stop();inputMonitor=null;narrator=null;turnBridge?.close();turnBridge=null;if(dc){dc.onmessage=null;dc.onopen=null;dc.close();}if(pc){pc.ontrack=null;pc.onconnectionstatechange=null;pc.close();}mic?.getTracks().forEach(t=>t.stop());if(audio){audio.pause();audio.srcObject=null;}pc=dc=mic=audio=null;state('idle');};
 const fail=code=>{stop();onError(code);};
 const send=(frames,g)=>{if(!active||g!==generation||dc?.readyState!=='open')return;for(const frame of frames)dc.send(JSON.stringify(frame));};
 async function receive(raw,g){
  if(!active||g!==generation)return;
  let event;try{event=parseCodexEvent(raw);}catch{fail('voice_protocol_error');return;}
  try {
   if(!listening&&(event.type==='user-turn-start'||event.type==='delegation'||(event.type==='transcript'&&event.role==='user'))){turnBridge?.discardInput(event);return;}
   if(event.type==='user-turn-start'||(event.type==='transcript'&&event.role==='user'&&!event.final))noteInput();
   await turnBridge?.handle(event);
  } catch { if(active&&g===generation)fail('voice_protocol_error'); }
 }
 async function start({provider='openai-codex',voice='cove',output='webspeech',providerEngine}={}){
  if(!validCodexAudioConfig({provider,voice})||!validNarrationConfig({output,providerEngine})){onError('voice_invalid_settings');return false;}
  if(active)return ready;
  if(typeof submitTurn!=='function'||!Peer){onError('voice_surface_unsupported');return false;}
  active=true;const g=++generation;
  listening=true;narrator=createNarrator({engine:output,apiBase,...(providerEngine === undefined ? {} : {providerEngine})});
  turnBridge=createCodexFinalTurnBridge({submitTurn:args=>submitForNarration(args,g),nativePlayback:false,onState:state,onTranscript,onError,setPlaybackAllowed:allowed=>{if(audio)audio.muted=true;if(!allowed)stopPlayback();},emit:(text,delegationId)=>send(codexContextFrames(delegationId??null,'speakable',text),g)});
  state('connecting');setupAbort=new AbortController();const controller=setupAbort;
  const timer=setTimeout(()=>{if(active&&g===generation)fail('voice_setup_timeout');},timeoutMs);
  try{
   // Permission precedes paid setup. No unattended room microphone in tests.
   const stream=await getUserMedia(MIC_CONSTRAINTS);
   if(!active||g!==generation){stream.getTracks().forEach(t=>t.stop());return false;}
   mic=stream;inputMonitor=monitorInput(mic,()=>{if(active&&g===generation&&listening){stopPlayback();if(inputWatchStarted)noteInput();}});pc=new Peer();audio=makeAudio();audio.autoplay=true;audio.muted=true;
   pc.ontrack=e=>{if(active&&g===generation&&e.streams?.[0]){audio.srcObject=e.streams[0];audio.play()?.catch(()=>onError('voice_playback_blocked'));}};
   pc.onconnectionstatechange=()=>{if(active&&g===generation&&['failed','closed','disconnected'].includes(pc.connectionState))fail('voice_connection_lost');};
   for(const track of mic.getTracks())pc.addTrack(track,mic);
   dc=pc.createDataChannel('oai-events');
   const opened=new Promise((resolve,reject)=>{dc.onopen=()=>resolve();controller.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});opened.catch(()=>{});
   dc.onmessage=e=>{void receive(e.data,g);};
   const offer=await pc.createOffer();await pc.setLocalDescription(offer);
   const response=await fetchImpl(`${apiBase}/speech/codex/call?provider=${encodeURIComponent(provider)}&voice=${encodeURIComponent(voice)}`,{method:'POST',headers:{Authorization:`Bearer ${getToken()}`,'Content-Type':'application/sdp'},body:pc.localDescription.sdp,signal:controller.signal});
   if(!response.ok){const code=response.status===403?'voice_entitlement_denied':response.status===401?'voice_login_required':response.status===429?'voice_rate_limited':'voice_setup_failed';throw new Error(code);}
   const reader=response.body.getReader();let bytes=0;const chunks=[];
   try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>262144)throw new Error('voice_answer_oversized');chunks.push(value);}}catch(e){await reader.cancel();throw e;}finally{reader.releaseLock();}
   if(!active||g!==generation)return false;
   const joined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
   await pc.setRemoteDescription({type:'answer',sdp:new TextDecoder().decode(joined)});
   await opened;
   if(!active||g!==generation)return false;ready=true;state('listening');return true;
  }catch(error){if(active&&g===generation)fail(error.name==='NotAllowedError'?'voice_microphone_denied':/^voice_/.test(error.message)?error.message:'voice_setup_failed');return false;}
  finally{clearTimeout(timer);if(setupAbort===controller)setupAbort=null;}
 }
 return {start,stop,stopPlayback,setListening,get listening(){return listening;},get active(){return active;},get ready(){return ready;}};
}
