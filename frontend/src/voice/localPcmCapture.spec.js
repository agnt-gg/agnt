import {it,expect,vi} from 'vitest';
import {createLocalPcmCapture} from './localPcmCapture.js';
function setup(options={}){
 const track={stop:vi.fn()}, node=()=>({connect:vi.fn(),disconnect:vi.fn()});let processor;
 class Context {sampleRate=16000;destination={};close=vi.fn();resume=vi.fn(async()=>{});createMediaStreamSource(){return node();}createScriptProcessor(){processor=node();return processor;}createGain(){return {...node(),gain:{value:1}};}}
 const onError=vi.fn(),onOnset=vi.fn();const c=createLocalPcmCapture({AudioContext:Context,getUserMedia:async()=>({getTracks:()=>[track]}),onError,onOnset,...options});
 return {c,track,onError,onOnset,frame(values){processor.onaudioprocess?.({inputBuffer:{getChannelData:()=>new Float32Array(values)}});}};
}
it('captures actual little-endian 16k PCM; output remains disconnected after finish',async()=>{const s=setup();expect(await s.c.start()).toBe(true);s.frame([1,-1,0]);expect([...s.c.finish()]).toEqual([255,127,0,128,0,0]);expect(s.track.stop).toHaveBeenCalled();});
it('hard cap discards whole utterance, never returns truncated instruction',async()=>{const s=setup({maxSamples:3});await s.c.start();s.frame([1,1]);s.frame([1,1]);expect(s.c.finish()).toBeNull();expect(s.onError).toHaveBeenCalledWith('utterance-too-long');});
it('stop during permission wait closes late stream',async()=>{let resolve;const track={stop:vi.fn()};const s=setup({getUserMedia:()=>new Promise(r=>resolve=r)});const p=s.c.start();await Promise.resolve();s.c.stop();resolve({getTracks:()=>[track]});expect(await p).toBe(false);expect(track.stop).toHaveBeenCalled();});
it('stop settles a permission prompt that never resolves',async()=>{const s=setup({getUserMedia:()=>new Promise(()=>{})});const p=s.c.start();await Promise.resolve();s.c.stop();expect(await Promise.race([p,new Promise(r=>setTimeout(()=>r('hung'),25))])).toBe(false);});
it('local energy onset calls playback stop without remote VAD',async()=>{const s=setup();await s.c.start();s.frame([0,0]);expect(s.onOnset).not.toHaveBeenCalled();s.frame([.2,.2]);expect(s.onOnset).toHaveBeenCalledTimes(1);s.c.stop();});
