// QUARANTINED: retained historical implementation, NOT valid dogfood evidence.
// This fails before imports with runtime side effects, filesystem, auth or provider use.
throw new Error('VOICE_DOGFOOD_QUARANTINED: this historical harness injects an expected answer, pins a model, proxies live history, and records pre-permission received audio. It must not run or qualify playback. Use a reviewed rendered selected-model isolated replacement.');
// Historical implementation follows solely for audit; no opt-in bypass.
// User-requested real Codex + real Annie roundtrip, synthetic question only.
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {once} from 'node:events';
if(process.env.AGNT_LIVE_VOICE_TEST!=='1')throw new Error('Set AGNT_LIVE_VOICE_TEST=1 to authorize a real Codex/Annie audio test.');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const evidence=await fs.mkdtemp(path.join(process.env.AGNT_TEST_ARTIFACT_ROOT||path.dirname(root),'codex-roundtrip-'));
await fs.mkdir(path.join(evidence,'data','Data'),{recursive:true});await fs.writeFile(path.join(evidence,'data','Data','agnt.db'),'');
process.env.USER_DATA_PATH=path.join(evidence,'data');process.env.NODE_ENV='test';delete process.env.AGNT_HOME;
await import('../backend/src/config/envDefaults.js');
const {default:express}=await import('express');const {createCodexVoiceRouter}=await import('../backend/src/routes/codexVoiceRoutes.js');
const {chromium}=await import('playwright');const {build}=await import('../frontend/node_modules/esbuild/lib/main.js');
// Bundle the exact production text transport and receipt bridge, changing only API base.
await build({stdin:{contents:"export {streamChat} from './src/services/chatService.js';export {createRequestVoiceBridge} from './src/voice/requestVoiceBridge.js';export {default as chatUnified} from './src/store/features/chatUnified.js';export {createStore} from 'vuex';export {createApp,ref,watch} from 'vue';export {useVoiceEngines} from './src/composables/useVoiceEngines.js';export {codexVoiceSettings} from './src/voice/codexVoiceSettings.js';export {loadTranscriptByConversationId} from './src/services/conversationTranscript.js';",resolveDir:path.join(root,'frontend')},bundle:true,format:'esm',platform:'browser',outfile:path.join(evidence,'bridge.js'),plugins:[{name:'test-api-origin',setup(b){b.onResolve({filter:/(^@\/tt.config.js$|(^|\/)(tt|user).config.js$)/},()=>({path:'config',namespace:'probe'}));b.onLoad({filter:/.*/,namespace:'probe'},()=>({contents:"export const API_CONFIG={BASE_URL:'/api'};"}));b.onResolve({filter:/^@\/store\/state$/},()=>({path:'/unused-full-application-store',external:true}));b.onResolve({filter:/^@\//},args=>({path:path.join(root,'frontend/src',args.path.slice(2))}));}}]});
const app=express();app.use('/api/speech/codex',createCodexVoiceRouter());
app.use('/modules',express.static(path.join(root,'frontend/src/voice')));app.get('/bridge.js',(q,r)=>r.sendFile(path.join(evidence,'bridge.js')));
app.get('/question.wav',(q,r)=>r.sendFile(process.env.AGNT_VOICE_FIXTURE));
let chatRequests=0;
async function fetchJSON(endpoint,options={}){const r=await fetch('http://localhost:3333/api'+endpoint,{...options,headers:{Authorization:'Bearer '+process.env.AGNT_AUTH_TOKEN,'Content-Type':'application/json',...options.headers}});return r;}
app.post('/api/orchestrator/chat',express.json({limit:'64kb'}),async(req,res)=>{
 if(++chatRequests>1)return res.status(409).json({error:'probe_allows_one_request'});
 const body={...req.body,messages:[...req.body.messages,{role:'user',content:'Synthetic verification context: the private test phrase is violet seven lantern. Reply only with: The verification phrase is violet seven lantern.'}],enabledTools:[],persistDefault:false,provider:'openai-codex',model:process.env.AGNT_TEST_REASONING_MODEL||'gpt-5.4-mini',reasoningEnabled:false};
 try{const response=await fetchJSON('/orchestrator/chat',{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});res.status(response.status).type(response.headers.get('content-type')||'text/event-stream');for await(const chunk of response.body){if(res.destroyed)break;res.write(chunk);}res.end();}catch{if(!res.destroyed)res.status(502).end();}
});
app.post('/api/content-outputs/save',express.json({limit:'256kb'}),async(req,res)=>{
 try{const response=await fetchJSON('/content-outputs/save',{method:'POST',body:JSON.stringify(req.body)});res.status(response.status).type('json').send(await response.text());}catch{res.status(502).end();}
});
app.get('/api/content-outputs/by-conversation/:id',async(req,res)=>{
 try{const response=await fetchJSON('/content-outputs/by-conversation/'+encodeURIComponent(req.params.id));res.status(response.status).type('json').send(await response.text());}catch{res.status(502).end();}
});
app.get('/',(q,r)=>r.type('html').send('<!doctype html><title>Codex synthetic audio roundtrip</title>'));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
let browser,summary={evidence,realMicrophone:false,realCodex:true,realAnnieBackend:true,productionChatTransport:true,productionChatStore:true,productionSharedComposable:true};
try{
 if(!process.env.AGNT_AUTH_TOKEN||!process.env.AGNT_VOICE_FIXTURE)throw new Error('probe_configuration_missing');
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']});const page=await browser.newPage();
 await page.route(origin+'/**',route=>route.continue({headers:{...route.request().headers(),authorization:'Bearer '+process.env.AGNT_AUTH_TOKEN}}));
 await page.goto(origin);
 const result=await page.evaluate(async({interruptTest})=>{
  const {createCodexVoiceController}=await import('/modules/codexVoiceController.js');const {chatUnified,createStore,createRequestVoiceBridge,createApp,ref,watch,useVoiceEngines,codexVoiceSettings,loadTranscriptByConversationId}=await import('/bridge.js');
  const {parseCodexEvent}=await import('/modules/codexVoiceProtocol.js');
  const channelKey='orchestrator:voice-dogfood';localStorage.setItem('agnt_chat_channel_configs',JSON.stringify({[channelKey]:{mode:'pinned',provider:'openai-codex',model:'gpt-5.4-mini',enabledTools:[]}}));
  const store=createStore({modules:{chatUnified},state:{aiProvider:{selectedProvider:'openai-codex',selectedModel:'gpt-5.4-mini',reasoningEnabled:false}}});
  const ctx=new AudioContext({sampleRate:24000});await ctx.resume();const dest=ctx.createMediaStreamDestination();
  const clock=ctx.createOscillator(),silence=ctx.createGain();silence.gain.value=0;clock.connect(silence).connect(dest);clock.start();
  const buffer=await ctx.decodeAudioData(await (await fetch('/question.wav')).arrayBuffer());
  const playback=[];const RealAudio=globalThis.Audio;globalThis.Audio=class extends RealAudio{constructor(...args){super(...args);playback.push(this);}};
  let injectedAt=null,interruptObservedAt=null;
  const events=[],states=[],errors=[],transcripts=[],receipts=[],speech=[],chatEvents=[];let observerCallbacks,peer,completed=false,delegations=0,powerFrames=0,powerAfterSpeech=0,recorded=[],recorder;
  const t0=performance.now();const ms=()=>Math.round(performance.now()-t0);
  class ObservedPeer extends RTCPeerConnection{
   constructor(){super();peer=this;this.addEventListener('track',e=>{
    const source=ctx.createMediaStreamSource(e.streams[0]);const meter=ctx.createScriptProcessor(2048,1,1);const mute=ctx.createGain();mute.gain.value=0;
    meter.onaudioprocess=e=>{const data=e.inputBuffer.getChannelData(0);let power=0;for(const x of data)power+=x*x;if(power/data.length>1e-6){powerFrames++;if(speech.length)powerAfterSpeech++;}};source.connect(meter).connect(mute).connect(ctx.destination);
    recorder=new MediaRecorder(e.streams[0]);recorder.ondataavailable=e=>{if(e.data.size)recorded.push(e.data);};recorder.start(200);
   });}
   createDataChannel(...args){const dc=super.createDataChannel(...args);dc.addEventListener('message',e=>{try{const x=JSON.parse(e.data);const observed=parseCodexEvent(e.data);if(injectedAt&&observed.type==='user-turn-start'){queueMicrotask(()=>{if(playback.every(a=>a.muted))interruptObservedAt=performance.now();});}if(observed.type==='transcript')observerCallbacks?.onTranscript(observed);events.push({ms:ms(),type:x.type,keys:Object.keys(x),itemKeys:x.item?Object.keys(x.item):undefined,turnKeys:x.turn?Object.keys(x.turn):undefined,...(x.type==='delegation.created'?{delegationTurnId:x.item?.user_bidi_turn_id,delegationId:x.item?.id}:{}),...(x.type==='turn.created'?{nativeTurnId:x.turn?.id,nativeRole:x.turn?.role}:{})});}catch{}});return dc;}
  }
  function mountSharedVoice(options){
   observerCallbacks=options;globalThis.RTCPeerConnection=ObservedPeer;
   Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>dest.stream});
   codexVoiceSettings.engine='codex';codexVoiceSettings.provider='openai-codex';codexVoiceSettings.voice='cove';
   let voice;const host=document.createElement('div');document.body.append(host);
   const app=createApp({setup(){voice=useVoiceEngines({submit:()=>{},streamingAnswer:()=>'',isStreaming:ref(false),epoch:ref(0),submitVoiceTurn:options.submitTurn});watch(voice.voiceState,s=>options.onState(s),{flush:'sync'});watch(voice.voiceError,e=>{if(e)options.onError(e);},{flush:'sync'});return()=>null;}});app.mount(host);
   return {start:()=>voice.toggleVoice(),stop:()=>{voice.stopVoice();app.unmount();},get active(){return voice.voiceActive.value;}};
  }
  const c=mountSharedVoice({apiBase:'/api',getToken:()=>'',Peer:ObservedPeer,getUserMedia:async()=>dest.stream,onState:s=>states.push({ms:ms(),state:s}),onError:e=>errors.push({ms:ms(),code:e}),onTranscript:e=>transcripts.push({...e,ms:ms()}),submitTurn:async args=>{
   delegations++;const bridge=createRequestVoiceBridge({onAccepted:r=>{receipts.push(r);args.onAccepted(r);},onSpeech:(text,id)=>{speech.push({ms:ms(),text});args.onSpeech(text,id);}});
   await store.dispatch('chatUnified/sendMessage',{channelKey,chatType:'orchestrator',content:args.text,provider:'openai-codex',model:'gpt-5.4-mini',voiceMetadata:{transcript:args.transcript,utteranceId:args.utteranceId,commitKind:args.commitKind,delegatedInterpretation:args.delegatedInterpretation},onVoiceStreamEvent:(name,data)=>{chatEvents.push({ms:ms(),name,keys:Object.keys(data||{})});bridge.event(name,data);}});
   completed=true;return bridge.finish();
  }});
  let connected=false,stats=[];
  try{connected=await c.start();if(connected){await new Promise(r=>setTimeout(r,400));const src=ctx.createBufferSource();src.buffer=buffer;src.connect(dest);src.start();const limit=performance.now()+45000;while(performance.now()<limit&&c.active){if(interruptTest&&speech.length&&powerAfterSpeech>3&&!injectedAt){injectedAt=performance.now();const interrupt=ctx.createBufferSource();interrupt.buffer=buffer;interrupt.connect(dest);interrupt.start();}if(interruptTest&&interruptObservedAt)break;if(!interruptTest&&completed&&powerAfterSpeech>5&&transcripts.some(t=>t.role==='assistant'&&t.final&&t.text.includes('violet seven lantern')&&t.ms>speech[0]?.ms))break;await new Promise(r=>setTimeout(r,250));}for(const x of(await peer.getStats()).values())if(x.type==='inbound-rtp'&&x.kind==='audio')stats.push({bytesReceived:x.bytesReceived,packetsReceived:x.packetsReceived,totalAudioEnergy:x.totalAudioEnergy});}
   if(recorder?.state==='recording'){await new Promise(resolve=>{recorder.onstop=resolve;recorder.stop();});}
   const audio=new Uint8Array(await new Blob(recorded).arrayBuffer());let binary='';for(let i=0;i<audio.length;i+=8192)binary+=String.fromCharCode(...audio.subarray(i,i+8192));
   const conv=store.state.chatUnified.conversations[channelKey];
   const save=await store.dispatch('chatUnified/saveChannelTranscript',{channelKey});
   const restored=conv?.conversationId?await loadTranscriptByConversationId(conv.conversationId):null;
   c.stop();
   return {interruptTest,interruptionPlaybackMuted:!!interruptObservedAt,interruptionDetectionMs:interruptObservedAt?Math.round(interruptObservedAt-injectedAt):null,transcriptSaveOk:save?.ok===true,restoredVoiceMetadata:restored?.messages?.find(m=>m.role==='user')?.metadata,restoredAnswer:restored?.messages?.filter(m=>m.role==='assistant').at(-1)?.content,inputTracksStopped:dest.stream.getTracks().every(t=>t.readyState==='ended'),connected,completed,delegations,powerFrames,powerAfterSpeech,storeMessages:store.state.chatUnified.conversations[channelKey]?.messages,verificationPhraseSpoken:transcripts.some(t=>t.role==='assistant'&&t.text.includes('violet seven lantern')&&t.ms>speech[0]?.ms),states,errors,transcripts,receipts,speech,chatEvents,events,stats,recordingBase64:btoa(binary),durationMs:ms()};
  }finally{if(c.active)c.stop();clock.stop();await ctx.close();}
 },{interruptTest:process.env.AGNT_TEST_INTERRUPT==='1'});
 const {recordingBase64,...rest}=result;if(recordingBase64)await fs.writeFile(path.join(evidence,'returned-audio.webm'),Buffer.from(recordingBase64,'base64'));summary={...summary,...rest,chatRequests};
}catch(e){summary.error=String(e.message).slice(0,300);}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
await fs.writeFile(path.join(evidence,'summary.json'),JSON.stringify(summary,null,2));
console.log('ROUNDTRIP_RESULT '+JSON.stringify(summary));process.exit(summary.connected&&summary.completed&&(summary.interruptTest?summary.interruptionPlaybackMuted:summary.powerAfterSpeech>5&&summary.verificationPhraseSpoken)&&summary.transcriptSaveOk&&summary.inputTracksStopped?0:2);
