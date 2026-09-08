import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isAbsolute} from 'node:path';

/** Administrator-owned, CPU-only worker. One request lane, no pending queue.
 * stdout is pulled through one lifetime async iterator: pipe backpressure bounds
 * transport memory even while the consumer is paused. Only explicit done succeeds.
 */
export function createPocketAdapter({python,cacheDir,language='english',spawnImpl=spawn,onMetric=()=>{}}={}) {
 if(!isAbsolute(python||'')||!isAbsolute(cacheDir||'')||!['english','german'].includes(language))return null;
 let worker=null,busy=false,closed=false,idleTimer,generation=0;
 const metric=value=>{try{onMetric(value);}catch{/* Observability cannot break ownership. */}};
 const clearIdle=()=>{clearTimeout(idleTimer);idleTimer=null;};
 async function stop(w){
  if(!w)return;
  if(!w.stopping){
   w.stopping=(async()=>{
    // SIGKILL is intentional: cancellation must stop CPU computation, not just IO.
    if(!w.exited)w.child.kill('SIGKILL');
    // A paused stdout iterator can keep close pending behind unread pipe data.
    // Discard transport on cancellation, then await the OS child close receipt.
    w.child.stdin.destroy();w.child.stdout.destroy();w.child.stderr.destroy();
    await w.exit;
    if(worker===w)worker=null;
   })();
  }
  await w.stopping;
 }
 function start(){
  let child;
  try{child=spawnImpl(python,[fileURLToPath(new URL('./pocketWorker.py',import.meta.url))],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:cacheDir,LANG:'C.UTF-8',PYTHONUNBUFFERED:'1',CUDA_VISIBLE_DEVICES:'',HF_HOME:cacheDir,AGNT_POCKET_LANGUAGE:language,HF_HUB_OFFLINE:'1'}});}catch{throw new Error('worker-spawn');}
  const w={child,ready:false,buffer:'',exited:false,fault:null,stopping:null};
  w.exit=new Promise(resolve=>child.once('close',()=>{w.exited=true;resolve();}));
  child.on('error',()=>{w.fault='worker-spawn';void stop(w);});
  child.stdin.on('error',()=>{w.fault='worker-input';void stop(w);});
  child.stdout.on('error',()=>{w.fault='worker-output';void stop(w);});
  let stderrBytes=0;
  child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>1048576){w.fault='worker-stderr-limit';void stop(w);}});
  child.stderr.on('error',()=>{w.fault='worker-output';void stop(w);});
  w.iterator=child.stdout[Symbol.asyncIterator]();worker=w;return w;
 }
 async function readFrame(w){
  for(;;){
   const at=w.buffer.indexOf('\n');
   if(at!==-1){
    if(at>131072)throw new Error('worker-line-limit');
    const line=w.buffer.slice(0,at);w.buffer=w.buffer.slice(at+1);
    try{return JSON.parse(line);}catch{throw new Error('worker-json');}
   }
   if(w.buffer.length>131072)throw new Error('worker-line-limit');
   const {value,done}=await w.iterator.next();
   if(done)throw new Error('worker-incomplete');
   if(value.length>262144)throw new Error('worker-frame-limit');
   w.buffer+=value.toString('utf8');
   if(w.buffer.length>524288)throw new Error('worker-buffer-limit');
  }
 }
 return {id:'pocket-tts-cpu',sampleRate:24000,
  async close(){closed=true;clearIdle();await stop(worker);},
  async *generate({text,requestId,signal,voice}){
   if(voice&&voice!=='alba')throw new Error('unsupported-voice');
   signal?.throwIfAborted();
   if(closed)throw new Error('worker-closed');
   if(busy)throw new Error('worker-busy');
   if(typeof text!=='string'||!text.trim()||text.length>4096||typeof requestId!=='string'||!requestId||requestId.length>1024)throw new Error('worker-request');
   busy=true;clearIdle();
   let w,timer,done=false,sequence=0,samples=0,cancelled=false,timedOut=false;
   const currentGeneration=++generation;
   const abort=()=>{cancelled=true;void stop(w);};
   try{
    if(worker?.stopping||worker?.exited)await stop(worker);
    if(closed)throw new Error('worker-closed');
    signal?.throwIfAborted();
    w=worker||start();
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>{timedOut=true;void stop(w);},120000);
    if(!w.ready){
     const r=await readFrame(w);
     if(r.type!=='ready'||r.engine!=='pocket-tts-cpu'||r.sampleRate!==24000||r.language!==language)throw new Error('worker-identity');
     w.ready=true;
    }
    if(cancelled||timedOut||closed||w.stopping)throw new Error('worker-stopped');
    const payload=JSON.stringify({text,requestId,generation:currentGeneration})+'\n';
    if(Buffer.byteLength(payload)>20000)throw new Error('worker-request');
    await new Promise((resolve,reject)=>w.child.stdin.write(payload,error=>error?reject(new Error('worker-input')):resolve()));
    for(;;){
     const r=await readFrame(w);
     if(cancelled||timedOut||closed||w.fault||w.stopping)throw new Error('worker-stopped');
     if(r.requestId!==requestId||r.generation!==currentGeneration)throw new Error('worker-sequence');
     if(r.type==='error')throw new Error('worker-generation');
     if(r.type==='done'){
      if(r.chunks!==sequence||r.samples!==samples||!sequence)throw new Error('worker-terminal');
      done=true;metric({type:'complete',requestId,generation:currentGeneration,generationMs:r.generationMs,chunks:sequence});return;
     }
     if(r.type!=='audio'||r.sequence!==sequence||typeof r.pcm!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(r.pcm))throw new Error('worker-audio');
     const pcm=Buffer.from(r.pcm,'base64');
     if(!pcm.length||pcm.length%2||pcm.length>48000)throw new Error('worker-audio');
     samples+=pcm.length/2;if(samples>24000*300||sequence>=4096)throw new Error('worker-limit');
     metric({type:'chunk',requestId,generation:currentGeneration,sequence,generationMs:r.generationMs});sequence++;yield pcm;
    }
   }catch{
    // Never propagate Python stderr, prompt-bearing parse errors, or spawn paths.
    throw new Error(cancelled?'worker-aborted':timedOut?'worker-timeout':'worker-failure');
   }finally{
    clearTimeout(timer);signal?.removeEventListener('abort',abort);
    if(!done||cancelled||timedOut||closed)await stop(w);
    else {idleTimer=setTimeout(()=>{idleTimer=null;void stop(w);},120000);idleTimer.unref();}
    busy=false;
   }
  }
 };
}
export function createPocketResolver({python=process.env.AGNT_POCKET_PYTHON,cacheDir=process.env.AGNT_POCKET_CACHE,language=process.env.AGNT_POCKET_LANGUAGE||'english',users=(process.env.AGNT_POCKET_USERS||'').split(',').filter(Boolean)}={}){
 const adapter=createPocketAdapter({python,cacheDir,language});const allowed=new Set(users);
 return userId=>allowed.has(userId)?adapter:null;
}
