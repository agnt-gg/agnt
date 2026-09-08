import {it,expect,vi} from 'vitest';
import {createPcmPlaybackSink} from './pcmPlaybackSink.js';
it('observes the actual post-gain graph once and closes its tracks on stop',async()=>{
 const track={stop:vi.fn()},tap={stream:{getTracks:()=>[track]},disconnect:vi.fn()};
 const gain={gain:{},connect:vi.fn(),disconnect:vi.fn()},source={connect:vi.fn(),start:vi.fn(),stop:vi.fn(),disconnect:vi.fn()};
 const ctx={resume:async()=>{},close:vi.fn(async()=>{}),destination:{},createBuffer:()=>({copyToChannel(){}}),createBufferSource:()=>source,createGain:()=>gain,createMediaStreamDestination:vi.fn(()=>tap)};
 const capture=vi.fn(),sink=createPcmPlaybackSink({createContext:()=>ctx,volume:0,onRenderedStream:capture});
 const p=sink.write(new Float32Array([0.5]),24000);const rejected=expect(p).rejects.toThrow('cancelled');await Promise.resolve();
 expect(gain.gain.value).toBe(0);expect(gain.connect).toHaveBeenCalledWith(tap);expect(capture).toHaveBeenCalledWith({stream:tap.stream,context:ctx,stage:'rendered-post-gain-stream'});
 sink.stop();await rejected;expect(track.stop).toHaveBeenCalledTimes(1);expect(ctx.close).toHaveBeenCalledTimes(1);
});
