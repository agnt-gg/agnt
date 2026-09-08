import {describe,it,expect,vi} from 'vitest';
import {createCodexVoiceController} from './codexVoiceController.js';
import {createRequestVoiceBridge} from './requestVoiceBridge.js';
const tick=()=>new Promise(r=>setTimeout(r,0));
const receipt={accepted:true,completed:true,conversationId:'c',assistantMessageId:'m',executionId:'e'};
function fixture(submitTurn) {
 let peer,onset; const track={stop:vi.fn(),enabled:true};
 const audio={play:vi.fn(async()=>{}),pause:vi.fn()};
 const output={speak:vi.fn(async()=>({ok:true})),cancel:vi.fn()};
 const errors=[];
 const vad={stop:vi.fn(),setEnabled:vi.fn()};
 class Peer {constructor(){peer=this;} addTrack(){} createDataChannel(){return this.channel={send:vi.fn(),close:vi.fn()};} async createOffer(){return {sdp:'v=0\r\n'};} async setLocalDescription(o){this.localDescription=o;} async setRemoteDescription(){this.channel.readyState='open';this.channel.onopen();}close(){}}
 const c=createCodexVoiceController({apiBase:'/api',getToken:()=> 'test-only',submitTurn,onError:code=>errors.push(code),Peer,getUserMedia:async()=>({getTracks:()=>[track]}),makeAudio:()=>audio,fetchImpl:async()=>new Response('v=0\r\n'),createNarrator:()=>output,monitorInput:(_stream,cb)=>{onset=cb;return vad;}});
 const send=async event=>{peer.channel.onmessage({data:JSON.stringify(event)});await tick();};
 const final=id=>send({type:'turn.done',turn:{role:'user',id,transcript:'Do not move the file.'}});
 return {c,output,audio,track,vad,errors,send,final,get peer(){return peer;},onset:()=>onset()};
}
describe('final-only controller playback permission',()=>{
 it('surfaces typed narration failure without calling it completed playback',async()=>{
  const f=fixture(async a=>{a.onAccepted(receipt);a.onSpeech('Answer.','m');return receipt;});f.output.speak.mockResolvedValue({ok:false,reason:'unavailable'});
  await f.c.start();await f.final('u');expect(f.errors).toContain('voice_narration_unavailable');expect(f.audio.muted).toBe(true);f.c.stop();
 });
 it('discards turns received during pause and delayed partial/final events after resume',async()=>{
  const submit=vi.fn(async()=>({accepted:false}));const f=fixture(submit);await f.c.start();f.c.setListening(false);await f.send({type:'turn.created',turn:{role:'user',id:'paused'}});f.c.setListening(true);await f.final('paused');await f.final('unknown-old');expect(submit).not.toHaveBeenCalled();await f.send({type:'turn.created',turn:{role:'user',id:'fresh'}});await f.final('fresh');expect(submit).toHaveBeenCalledOnce();f.c.stop();
 });
 it('uses the real request bridge final correction and never unmutes native media',async()=>{
  const f=fixture(async callbacks=>{const b=createRequestVoiceBridge(callbacks);b.event('conversation_started',{conversationId:'c'});b.event('agent_execution_started',{executionId:'e'});b.event('assistant_message',{id:'m'});b.event('content_delta',{assistantMessageId:'m',delta:'Yes, do it.'});b.event('final_content',{assistantMessageId:'m',content:'No, do not do it.'});b.event('done');return b.finish();});
  await f.c.start();await f.send({type:'turn.created',turn:{role:'assistant',id:'unsolicited'}});await f.final('u');
  expect(f.output.speak).toHaveBeenCalledTimes(1);expect(f.output.speak).toHaveBeenCalledWith('No, do not do it.');expect(f.audio.muted).toBe(true);
  await f.send({type:'turn.done',turn:{role:'assistant',id:'unsolicited',transcript:'Yes, do it.'}});expect(f.audio.muted).toBe(true);expect(f.output.speak).toHaveBeenCalledTimes(1);f.c.stop();
 });
 it.each([{...receipt,completed:false},{...receipt,executionId:'different'}, {accepted:true}])('does not narrate unconfirmed or contradictory completion %j',async result=>{
  const f=fixture(async a=>{a.onAccepted(receipt);a.onSpeech('Unverified answer.','m');return result;});await f.c.start();await f.final('u');expect(f.output.speak).not.toHaveBeenCalled();expect(f.audio.muted).toBe(true);f.c.stop();
 });
 it('stop playback invalidates queued callbacks, not the microphone or accepted task',async()=>{
  let args,resolve;const f=fixture(a=>{args=a;return new Promise(r=>resolve=r);});await f.c.start();await f.final('u');args.onAccepted(receipt);f.c.stopPlayback();args.onSpeech('Too late.','m');resolve(receipt);await tick();expect(f.output.speak).not.toHaveBeenCalled();expect(f.track.stop).not.toHaveBeenCalled();expect(f.c.active).toBe(true);f.c.stop();
 });
 it('local onset mutes synchronously and invalidates pending narration',async()=>{
  let args,resolve;const f=fixture(a=>{args=a;return new Promise(r=>resolve=r);});await f.c.start();await f.final('u');args.onAccepted(receipt);const before=f.output.cancel.mock.calls.length;f.onset();expect(f.output.cancel.mock.calls.length).toBe(before+1);args.onSpeech('Stale.','m');resolve(receipt);await tick();expect(f.output.speak).not.toHaveBeenCalled();expect(f.track.enabled).toBe(true);f.c.stop();expect(f.vad.stop).toHaveBeenCalledOnce();
 });
 it('pause listening disables tracks and rejects new finals while allowing accepted completion',async()=>{
  let args,resolve;const submit=vi.fn(a=>{args=a;return new Promise(r=>resolve=r);});const f=fixture(submit);await f.c.start();await f.final('u');f.c.setListening(false);expect(f.track.enabled).toBe(false);await f.final('paused');expect(submit).toHaveBeenCalledOnce();args.onAccepted(receipt);args.onSpeech('Completed before pause.','m');resolve(receipt);await tick();expect(f.output.speak).toHaveBeenCalledWith('Completed before pause.');f.c.setListening(true);expect(f.track.enabled).toBe(true);f.c.stop();
 });
 it('stale completion after stop/start cannot touch a new narrator',async()=>{
  let args,resolve;const f=fixture(a=>{args=a;return new Promise(r=>resolve=r);});await f.c.start();await f.final('u');f.c.stop();await f.c.start();args.onAccepted(receipt);args.onSpeech('Old.','m');resolve(receipt);await tick();expect(f.output.speak).not.toHaveBeenCalled();f.c.stop();
 });
});
