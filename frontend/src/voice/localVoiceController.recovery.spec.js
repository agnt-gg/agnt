import { describe, it, expect, vi } from 'vitest';
import { createLocalVoiceController } from './localVoiceController.js';
import { createLocalPcmCapture } from './localPcmCapture.js';
import { createNativeVoiceSubmit } from './nativeVoiceSubmit.js';
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const flush = async () => { for(let i=0;i<30;i++) await Promise.resolve(); };
const acceptance = id => ({accepted:true,executionId:'e',conversationId:'c',assistantMessageId:id});
function setup(submitTurn, extra={}) {
 const states=[], order=[], captures=[];
 const narrator={cancel:vi.fn(()=>order.push('cancel')),speak:vi.fn(async()=>({ok:true}))};
 const asr={stopListening:vi.fn(),transcribe:vi.fn(async()=>({ok:true,turn:{text:'test',transcript:'test',utteranceId:'u',commitKind:'local-asr-hard-final'}}))};
 const onError=vi.fn();
 const c=createLocalVoiceController({submitTurn,createNarrator:()=>narrator,createAsr:()=>asr,onError,onState:s=>states.push(s),createCapture:callbacks=>{const cap={callbacks,start:vi.fn(async()=>{order.push('capture');return true;}),stop:vi.fn(),finish:()=>new Uint8Array([1,0])};captures.push(cap);return cap;},...extra});
 return {c,narrator,asr,onError,states,order,captures};
}
function native(events) {
 const identity={userId:'user',requestId:'request',provider:'selected',model:'selected',accountId:'account2'};
 return createNativeVoiceSubmit({getExpectedIdentity:()=>identity,send:async(_,o)=>{
  const event=o.onVoiceStreamEvent;
  event('conversation_started',{conversationId:'c'});event('agent_execution_started',{executionId:'e'});
  events(event,identity);
 }});
}
const terminal = (event,identity,id='m2',changes={}) => {
 event('final_content',{assistantMessageId:id,content:'Do not proceed.'});
 event('done',{...identity,receiptVersion:1,binding:'authenticated-user-execution',conversationId:'c',executionId:'e',assistantMessageId:id,accepted:true,completed:true,success:true,status:'completed',executionPersisted:true,transcriptPersisted:true,...changes});
};
describe('R24 receipt identity and explicit resume recovery',()=>{
 it('production native adapter accepts same-run m1 to m2 and narrates terminal m2 once',async()=>{
  const s=setup(native((event,identity)=>{event('assistant_message',{id:'m1'});event('assistant_message',{id:'m2'});terminal(event,identity);}));
  await s.c.start();const r=await s.c.commit();expect(r.completed).toBe(true);expect(s.narrator.speak.mock.calls).toHaveLength(1);expect(s.narrator.speak).toHaveBeenCalledWith('Do not proceed.');expect(s.onError).not.toHaveBeenCalled();expect(s.states.at(-1)).toBe('paused');s.c.stop();
 });
 it.each(['execution','account','stale-final','failure','backward'])('native adapter fails closed on %s',async kind=>{
  const s=setup(native((event,identity)=>{
   event('assistant_message',{id:'m1'});event('assistant_message',{id:'m2'});
   if(kind==='backward') event('assistant_message',{id:'m1'});
   if(kind==='failure') event('error',{});
   terminal(event,identity,kind==='stale-final'?'m1':'m2',kind==='execution'?{executionId:'other'}:kind==='account'?{accountId:'other'}:{});
  }));
  await s.c.start();const r=await s.c.commit();expect(r.completed).toBe(false);expect(s.narrator.speak).not.toHaveBeenCalled();expect(s.onError).toHaveBeenCalledWith('local_turn_unconfirmed');s.c.stop();
 });
 it('idempotent acceptance is allowed; callbacks after terminal settlement cannot replay',async()=>{
  let callbacks;
  const s=setup(async args=>{callbacks=args;args.onAccepted(acceptance('m1'));args.onAccepted(acceptance('m1'));args.onAccepted(acceptance('m2'));args.onAccepted(acceptance('m2'));args.onSpeech('final','m2');return {...acceptance('m2'),completed:true};});
  await s.c.start();await s.c.commit();callbacks.onAccepted(acceptance('old'));callbacks.onSpeech('late','old');expect(s.narrator.speak.mock.calls).toHaveLength(1);expect(s.narrator.speak).toHaveBeenCalledWith('final');expect(s.onError).not.toHaveBeenCalled();s.c.stop();
 });
 it.each(['executionId','conversationId','accountId','requestId','userId','provider','model','backward','stale-final'])('controller independently rejects conflicting %s',async key=>{
  const s=setup(async args=>{
   const first={...acceptance('m1'),accountId:'a',requestId:'r',userId:'u',provider:'p',model:'m'};
   args.onAccepted(first);args.onAccepted({...first,assistantMessageId:'m2',...(key==='backward'||key==='stale-final'?{}:{[key]:'wrong'})});
   if(key==='backward')args.onAccepted(first);
   args.onSpeech('unsafe',key==='stale-final'?'m1':'m2');return {...first,assistantMessageId:'m2',completed:true};
  });
  await s.c.start();await s.c.commit();expect(s.narrator.speak).not.toHaveBeenCalled();expect(s.onError).toHaveBeenCalledWith('local_turn_unconfirmed');s.c.stop();
 });
 it('Resume cancels narration before capture and old narration cannot unlock newer pending ASR',async()=>{
  const speech=defer(), secondAsr=defer();
  const s=setup(async args=>{args.onAccepted(acceptance('m1'));args.onSpeech('final','m1');return {...acceptance('m1'),completed:true};});
  s.narrator.speak.mockReturnValue(speech.promise);
  await s.c.start();const old=s.c.commit();await flush();expect(s.narrator.speak).toHaveBeenCalledTimes(1);
  s.order.length=0;expect(await s.c.setListening(true)).toBe(true);expect(s.order).toEqual(['cancel','capture']);
  s.asr.transcribe.mockReturnValueOnce(secondAsr.promise);const next=s.c.commit();await flush();speech.resolve({ok:true});await old;
  expect(await s.c.setListening(true)).toBe(false);expect(s.states.at(-1)).toBe('working');
  secondAsr.resolve({ok:false,reason:'test'});await next;expect(s.states.at(-1)).toBe('paused');s.c.stop();
 });
 it('local onset cancels output without resubmitting accepted work',async()=>{
  const submit=vi.fn(async args=>{args.onAccepted(acceptance('m'));args.onSpeech('final','m');return {...acceptance('m'),completed:true};});
  const s=setup(submit);await s.c.start();await s.c.commit();await s.c.setListening(true);s.narrator.cancel.mockClear();s.captures.at(-1).callbacks.onOnset();expect(s.narrator.cancel).toHaveBeenCalledTimes(1);expect(submit).toHaveBeenCalledTimes(1);s.c.stop();
 });
});
describe('R24 actual capture resource ownership (synthetic devices only)',()=>{
 it.each(['resolve','reject'])('stop settles pending permission promptly and handles late %s without touching new session',async outcome=>{
  const permission=defer(), tracks=[], contexts=[];let calls=0;
  const node=()=>({connect(){},disconnect(){}});
  class Context {constructor(){this.sampleRate=16000;this.destination={};this.closed=false;contexts.push(this);}async resume(){}async close(){this.closed=true;}createMediaStreamSource(){return node();}createScriptProcessor(){return node();}createGain(){return {...node(),gain:{value:1}};}}
  const stream=()=>{const t={stopped:false,stop(){this.stopped=true;}};tracks.push(t);return {getTracks:()=>[t]};};
  const s=setup(async()=>({}),{createCapture:callbacks=>createLocalPcmCapture({...callbacks,AudioContext:Context,getUserMedia:()=>++calls===1?permission.promise:Promise.resolve(stream())})});
  const old=s.c.start();await flush();s.c.stop();await flush();expect(await old).toBe(false);expect(await s.c.start()).toBe(true);
  if(outcome==='resolve')permission.resolve(stream());else permission.reject(new Error('denied'));await flush();
  expect(s.c.active).toBe(true);expect(s.c.listening).toBe(true);expect(tracks[0].stopped).toBe(false);if(outcome==='resolve')expect(tracks[1].stopped).toBe(true);
  s.c.stop();expect(tracks.every(t=>t.stopped)).toBe(true);expect(contexts.every(c=>c.closed)).toBe(true);
 });
});
