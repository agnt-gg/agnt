import {describe,it,expect,vi} from 'vitest';
import {createCodexVoiceController} from './codexVoiceController.js';
import {parseCodexEvent,codexContextFrames} from './codexVoiceProtocol.js';
import {createRequestVoiceBridge} from './requestVoiceBridge.js';
const SDP='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const wait=()=>new Promise(r=>setTimeout(r,0));
const delegation=id=>JSON.stringify({type:'delegation.created',item:{type:'delegation',target:'client',id,content:[{type:'input_text',text:'Check the status.'}]}});
const final=id=>JSON.stringify({type:'turn.done',turn:{id,role:'user',transcript:'Check the status.'}});
function fixture(submitTurn=vi.fn(async()=>({accepted:false}))) {
 let peer;const track={stop:vi.fn()},mic={getTracks:()=>[track]},audio={play:vi.fn(async()=>{}),pause:vi.fn()},states=[],errors=[];
 class Peer{constructor(){peer=this;this.connectionState='new';}addTrack(){}createDataChannel(){return this.channel={readyState:'connecting',send:vi.fn(),close:vi.fn()};}async createOffer(){return {sdp:SDP,type:'offer'};}async setLocalDescription(o){this.localDescription=o;}async setRemoteDescription(){this.channel.readyState='open';this.channel.onopen();}close(){this.connectionState='closed';}}
 const getUserMedia=vi.fn(async()=>mic),fetchImpl=vi.fn(async()=>new Response(SDP));
 const c=createCodexVoiceController({apiBase:'/api',getToken:()=> 'fixture',submitTurn,Peer,getUserMedia,makeAudio:()=>audio,fetchImpl,onState:s=>states.push(s),onError:e=>errors.push(e)});
 return {c,submitTurn,track,audio,states,errors,getUserMedia,fetchImpl,get peer(){return peer;}};
}

const partial=id=>JSON.stringify({type:'input_transcript.added',item:{turn_id:id,text:'I do not buy two more'}});
const emit=(f,data)=>f.peer.channel.onmessage({data});
describe('native stranded input watchdog',()=>{
 it('fails visible after 20s, releases media, never submits partial',async()=>{vi.useFakeTimers();try{const f=fixture();await f.c.start();emit(f,partial('u'));await vi.advanceTimersByTimeAsync(19999);expect(f.c.active).toBe(true);await vi.advanceTimersByTimeAsync(1);expect(f.errors).toContain('voice_input_unconfirmed');expect(f.c.active).toBe(false);expect(f.track.stop).toHaveBeenCalled();expect(f.submitTurn).not.toHaveBeenCalled();expect(f.fetchImpl).toHaveBeenCalledTimes(1);}finally{vi.useRealTimers();}});
 it('refreshes recent evidence but caps utterance lifetime at 60s',async()=>{vi.useFakeTimers();try{const f=fixture();await f.c.start();emit(f,partial('u'));for(let n=0;n<5;n++){await vi.advanceTimersByTimeAsync(10000);emit(f,partial('u'));expect(f.c.active).toBe(true);}await vi.advanceTimersByTimeAsync(9999);expect(f.c.active).toBe(true);await vi.advanceTimersByTimeAsync(1);expect(f.errors).toContain('voice_input_unconfirmed');expect(f.submitTurn).not.toHaveBeenCalled();}finally{vi.useRealTimers();}});
 it('final submission clears timer without cancelling task',async()=>{vi.useFakeTimers();try{const f=fixture();await f.c.start();emit(f,partial('u'));emit(f,final('u'));await vi.advanceTimersByTimeAsync(60001);expect(f.submitTurn).toHaveBeenCalledTimes(1);expect(f.errors).not.toContain('voice_input_unconfirmed');f.c.stop();}finally{vi.useRealTimers();}});
 it('stopped session timer cannot close restarted session',async()=>{vi.useFakeTimers();try{const f=fixture();await f.c.start();emit(f,partial('u'));f.c.stop();await f.c.start();await vi.advanceTimersByTimeAsync(60001);expect(f.c.active).toBe(true);expect(f.errors).not.toContain('voice_input_unconfirmed');f.c.stop();}finally{vi.useRealTimers();}});
 it('pause clears stranded input and never submits',async()=>{vi.useFakeTimers();try{const f=fixture();await f.c.start();emit(f,partial('u'));f.c.setListening(false);await vi.advanceTimersByTimeAsync(60001);expect(f.errors).not.toContain('voice_input_unconfirmed');expect(f.submitTurn).not.toHaveBeenCalled();f.c.stop();}finally{vi.useRealTimers();}});
});
