import {parseCodexEvent,codexContextFrames} from './codexVoiceProtocol.js';
import {createCodexFinalTurnBridge} from './codexFinalTurnBridge.js';
import {MIC_CONSTRAINTS} from './micConstraints.js';
/** Browser native media controller. No credentials other than AGNT session token.
 * Submit callback owns one real HTTP chat stream. No global-last-answer watcher.
 * Initial slice rejects overlapping commands instead of replaying uncertain work.
 */
export function createCodexVoiceController({apiBase,getToken,submitTurn,onState=()=>{},onTranscript=()=>{},onError=()=>{},getUserMedia=c=>navigator.mediaDevices.getUserMedia(c),Peer=globalThis.RTCPeerConnection,makeAudio=()=>new Audio(),fetchImpl=globalThis.fetch,timeoutMs=20000}){
 let generation=0,active=false,ready=false,pc=null,dc=null,mic=null,audio=null,setupAbort=null,pending=false;
 let turnBridge=null;
 const state=s=>onState(s);
 const stop=()=>{generation++;active=false;ready=false;setupAbort?.abort();setupAbort=null;pending=false;turnBridge?.close();turnBridge=null;if(dc){dc.onmessage=null;dc.onopen=null;dc.close();}if(pc){pc.ontrack=null;pc.onconnectionstatechange=null;pc.close();}mic?.getTracks().forEach(t=>t.stop());if(audio){audio.pause();audio.srcObject=null;}pc=dc=mic=audio=null;state('idle');};
 const fail=code=>{stop();onError(code);};
 const send=(frames,g)=>{if(!active||g!==generation||dc?.readyState!=='open')return;for(const frame of frames)dc.send(JSON.stringify(frame));};
 async function receive(raw,g){
  if(!active||g!==generation)return;
  let event;try{event=parseCodexEvent(raw);}catch{fail('voice_protocol_error');return;}
  try { await turnBridge?.handle(event); } catch { if(active&&g===generation)fail('voice_protocol_error'); }
 }
 async function start({provider='openai-codex',voice='cove'}={}){
  if(active)return ready;
  if(typeof submitTurn!=='function'||!Peer){onError('voice_surface_unsupported');return false;}
  active=true;const g=++generation;
  turnBridge=createCodexFinalTurnBridge({submitTurn,onState:state,onTranscript,onError,setPlaybackAllowed:allowed=>{if(audio)audio.muted=!allowed;},emit:(text,delegationId)=>send(codexContextFrames(delegationId??null,'speakable',text),g)});
  state('connecting');setupAbort=new AbortController();const controller=setupAbort;
  const timer=setTimeout(()=>{if(active&&g===generation)fail('voice_setup_timeout');},timeoutMs);
  try{
   // Permission precedes paid setup. No unattended room microphone in tests.
   const stream=await getUserMedia(MIC_CONSTRAINTS);
   if(!active||g!==generation){stream.getTracks().forEach(t=>t.stop());return false;}
   mic=stream;pc=new Peer();audio=makeAudio();audio.autoplay=true;audio.muted=true;
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
 return {start,stop,get active(){return active;},get ready(){return ready;}};
}
