import {it,expect,vi,afterEach} from 'vitest';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createPocketAdapter} from './pocketAdapter.js';
const adapters=[];afterEach(async()=>{vi.useRealTimers();await Promise.all(adapters.splice(0).map(a=>a.close()));});
function fixture(mode='normal'){
 const children=[];
 const spawnImpl=vi.fn((python,args,opts)=>{
  const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.requests=[];c.options=opts;children.push(c);
  const emit=r=>c.stdout.write(JSON.stringify(r)+'\n');
  c.stdin=new Writable({write(bytes,enc,cb){const r=JSON.parse(bytes);c.requests.push(r);cb();if(mode==='hang')return;const base={requestId:r.requestId,generation:r.generation};
   const audio={type:'audio',...base,sequence:0,pcm:'AAA=',generationMs:70};
   if(mode==='wrong-generation')audio.generation--;
   if(mode==='wrong-id')audio.requestId='other';
   if(mode==='wrong-sequence')audio.sequence=2;
   emit(audio);if(mode==='eof'){c.stdout.end();return;}
   emit({type:'done',...base,chunks:1,samples:1,generationMs:80});
  }});
  c.kill=vi.fn(()=>{setImmediate(()=>{c.stdout.end();c.emit('close',null,'SIGKILL');});return true;});
  queueMicrotask(()=>emit({type:'ready',engine:'pocket-tts-cpu',sampleRate:24000,language:'english'}));return c;
 });
 const adapter=createPocketAdapter({python:'/cpu/python',cacheDir:'/cache',spawnImpl});adapters.push(adapter);return {adapter,children,spawnImpl};
}
async function consume(a,requestId='same',signal){let chunks=0;for await(const b of a.generate({text:'Hello.',requestId,signal})){expect(b.length).toBe(2);chunks++;}return chunks;}
it('two requests finish at done without EOF, reuse process and increment generation even same ID',async()=>{const {adapter,children,spawnImpl}=fixture();expect(await consume(adapter)).toBe(1);expect(await consume(adapter)).toBe(1);expect(spawnImpl).toHaveBeenCalledTimes(1);expect(children[0].requests.map(r=>r.generation)).toEqual([1,2]);expect(children[0].stdin.writableEnded).toBe(false);await adapter.close();expect(children[0].kill).toHaveBeenCalledWith('SIGKILL');});
it('single lane rejects overlap and early return kills before releasing lane',async()=>{const {adapter,children}=fixture();const stream=adapter.generate({text:'Hi',requestId:'one'});await stream.next();await expect(consume(adapter,'two')).rejects.toThrow('worker-busy');let exited=false;children[0].once('close',()=>exited=true);await stream.return();expect(exited).toBe(true);expect(await consume(adapter,'three')).toBe(1);expect(children).toHaveLength(2);});
it('abort waits actual close before rejection and restart; no inherited secrets',async()=>{const {adapter,children}=fixture('hang');const c=new AbortController();const p=consume(adapter,'one',c.signal);await new Promise(r=>setImmediate(r));let exited=false;children[0].once('close',()=>exited=true);c.abort();await expect(p).rejects.toThrow('worker-aborted');expect(exited).toBe(true);expect(children[0].options.env).toEqual({PATH:'/usr/bin:/bin',HOME:'/cache',LANG:'C.UTF-8',PYTHONUNBUFFERED:'1',CUDA_VISIBLE_DEVICES:'',HF_HOME:'/cache',AGNT_POCKET_LANGUAGE:'english',HF_HUB_OFFLINE:'1'});});
for(const mode of ['wrong-generation','wrong-id','wrong-sequence','eof'])it('fails closed and exits on '+mode,async()=>{const {adapter,children}=fixture(mode);await expect(consume(adapter)).rejects.toThrow('worker-failure');expect(children[0].kill).toHaveBeenCalled();});
it('missing executable and synchronous spawn failure are sanitized',async()=>{const a=createPocketAdapter({python:'/missing/secret-python',cacheDir:'/cache'});adapters.push(a);await expect(consume(a)).rejects.toThrow(/^worker-failure$/);const b=createPocketAdapter({python:'/missing/python',cacheDir:'/cache',spawnImpl(){throw Error('private prompt secret');}});adapters.push(b);await expect(consume(b)).rejects.toThrow(/^worker-failure$/);});
it('120s idle timer is unref and expires owned worker',async()=>{const {adapter,children}=fixture();const timer=vi.spyOn(globalThis,'setTimeout');await consume(adapter);const call=timer.mock.calls.findIndex(x=>x[1]===120000&&timer.mock.results[timer.mock.calls.indexOf(x)]?.value?.hasRef?.()===false);expect(call).toBeGreaterThanOrEqual(0);timer.mock.calls[call][0]();await adapter.close();expect(children[0].kill).toHaveBeenCalled();timer.mockRestore();});
it('timeout kills worker while iterator is paused',async()=>{const {adapter,children}=fixture();const timer=vi.spyOn(globalThis,'setTimeout');const stream=adapter.generate({text:'hi',requestId:'one'});await stream.next();timer.mock.calls.find(x=>x[1]===120000)[0]();await new Promise(r=>setImmediate(r));expect(children[0].kill).toHaveBeenCalled();await expect(stream.next()).rejects.toThrow('worker-timeout');timer.mockRestore();});

it('cancel destroys unread stdout before waiting for close (real pipe regression)',async()=>{
 const {adapter,children}=fixture();const c=new AbortController();const stream=adapter.generate({text:'hi',requestId:'one',signal:c.signal});await stream.next();
 const child=children[0];child.kill.mockImplementation(()=>{child.stdout.once('close',()=>child.emit('close',null,'SIGKILL'));return true;});
 c.abort();await expect(stream.next()).rejects.toThrow('worker-aborted');expect(child.stdout.destroyed).toBe(true);
});
