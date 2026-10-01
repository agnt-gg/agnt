import {Worker} from 'node:worker_threads';
// Files are untrusted input: a malformed PDF or a pathological spreadsheet must cost one
// request, never the worker. Each conversion runs in its own thread with a heap ceiling and
// a deadline, and the thread is terminated on the first outcome.
export function runConversion(bytes,options,{timeoutMs,heapMb=768}={}){
 return new Promise((resolve,reject)=>{
  const copy=new Uint8Array(bytes).buffer;// a private copy the thread owns outright
  let thread;
  try{thread=new Worker(new URL('./convert-thread.mjs',import.meta.url),{workerData:{bytes:copy,options},transferList:[copy],resourceLimits:{maxOldGenerationSizeMb:heapMb,maxYoungGenerationSizeMb:64}});}
  catch{return reject(Error('worker_unavailable'));}
  let settled=false;
  const finish=(settle,value)=>{if(settled)return;settled=true;clearTimeout(timer);thread.terminate().catch(()=>{});settle(value);};
  const timer=setTimeout(()=>finish(reject,Error('scrape_timeout')),Math.max(1,timeoutMs));
  thread.once('message',message=>message.ok?finish(resolve,message.result):finish(reject,Error(message.error)));
  thread.once('error',error=>finish(reject,Error(error?.code==='ERR_WORKER_OUT_OF_MEMORY'?'result_too_large':'extraction_failed')));
  thread.once('exit',()=>finish(reject,Error('extraction_failed')));
 });
}
