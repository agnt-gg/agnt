import {describe,it,expect,vi} from 'vitest';
import {monitorLocalInput} from './localInputMonitor.js';
function fixture(){
 let tick,amplitude=0,time=0;const events=[];
 const source={connect:vi.fn(),disconnect:vi.fn()},analyser={disconnect:vi.fn(),getFloatTimeDomainData:frame=>frame.fill(amplitude)};
 const context={createMediaStreamSource:vi.fn(()=>source),createAnalyser:()=>analyser,resume:vi.fn(async()=>{}),close:vi.fn(async()=>{})};
 const cancel=vi.fn();const monitor=monitorLocalInput({},()=>events.push(time),{AudioContext:class{constructor(){return context;}},schedule:fn=>{tick=fn;return 7;},cancel});
 return {monitor,events,source,analyser,context,cancel,push(value,count=1){amplitude=value;for(let i=0;i<count;i++){time+=20;tick();}},get time(){return time;}};
}
describe('local PCM monitor, no microphone acquisition or speaker graph',()=>{
 it('20 synthetic warm trials: onset <=150 ms, no phantom retrigger during speech',()=>{
  const f=fixture(),latencies=[];f.push(0,15);
  for(let i=0;i<20;i++){const start=f.time;const before=f.events.length;f.push(.1,10);expect(f.events).toHaveLength(before+1);latencies.push(f.events.at(-1)-start);f.push(0,10);}
  latencies.sort((a,b)=>a-b);expect(latencies[18]).toBeLessThanOrEqual(150);expect(latencies).toEqual(Array(20).fill(60));f.monitor.stop();
 });
 it('never connects source to destination and releases its graph/timer exactly once',()=>{
  const f=fixture();expect(f.source.connect).toHaveBeenCalledWith(f.analyser);expect(f.source.connect).toHaveBeenCalledTimes(1);f.monitor.stop();f.monitor.stop();
  expect(f.cancel).toHaveBeenCalledTimes(1);expect(f.cancel).toHaveBeenCalledWith(7);expect(f.context.close).toHaveBeenCalledTimes(1);expect(f.source.disconnect).toHaveBeenCalledTimes(1);f.push(.2,30);expect(f.events).toHaveLength(0);
 });
 it('disabled monitor cannot interrupt playback and resume recalibrates',()=>{const f=fixture();f.monitor.setEnabled(false);f.push(.5,40);expect(f.events).toHaveLength(0);f.monitor.setEnabled(true);f.push(0,15);f.push(.1,3);expect(f.events).toHaveLength(1);f.monitor.stop();});
 it('partial graph setup failure closes acquired context',()=>{const close=vi.fn(async()=>{});const monitor=monitorLocalInput({},()=>{},{AudioContext:class{createMediaStreamSource(){throw Error('setup');}close=close;}});expect(monitor).toBe(null);expect(close).toHaveBeenCalledOnce();});
});
