import { it, expect, vi } from 'vitest';
import { settleTranscriptMirror } from './settleTranscriptMirror.js';
it('reports success only after settlement and handles errors',async()=>{
 expect(await settleTranscriptMirror(Promise.resolve({written:true}))).toEqual({written:true});
 expect(await settleTranscriptMirror(Promise.reject(new Error('test')))).toEqual({written:false,reason:'mirror_error'});
});
it('bounds hung writes without claiming compute cancellation and clears timers',async()=>{
 vi.useFakeTimers();
 try {
  let finish;const write=new Promise(r=>{finish=r;});
  const pending=settleTranscriptMirror(write,50);
  await vi.advanceTimersByTimeAsync(50);
  expect(await pending).toEqual({written:false,reason:'mirror_timeout_unknown'});
  finish({written:true});await Promise.resolve();
  expect(vi.getTimerCount()).toBe(0);
 } finally {vi.useRealTimers();}
});
