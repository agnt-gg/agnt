import { describe, expect, it } from 'vitest';
import { observationImages, captureComputerImages, appendComputerImages } from './observationImages.js';
import { createComputerOperationQueue, mapOrderedComputerCalls } from './operationQueue.js';
import { createEagerToolRuns } from '../orchestrator/eagerToolRuns.js';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZdU0v8AAAAASUVORK5CYII=';

describe('bounded model image contract',()=>{
 it('display image survives as a local reference without base64 in text',()=>{
  const context={};const original=JSON.stringify({success:true,modelImages:observationImages(png),imageHtml:`<img src="data:image/png;base64,${png}">`});
  const text=captureComputerImages(original,'computer_observe','call',context,()=> 'C:/fixture/image.png');
  expect(text).not.toContain(png);expect(JSON.parse(text).imageHtml).toContain('file:///C:/fixture/image.png');
  expect(context.computerImages[0].data).toBe(png);
 });
 it('detaches pixels before offloading and retains target metadata',()=>{
  const context={};const original={success:true,pid:12,windowId:34,modelImages:observationImages(png,{pid:12,windowId:34,snapshotId:'s1'})};
  const text=captureComputerImages(JSON.stringify(original),'computer_observe','call-1',context);
  expect(text).not.toContain(png);expect(JSON.parse(text).modelImageCount).toBe(1);
  expect(context.computerImages[0]).toMatchObject({width:1,height:1,pid:12,windowId:34,snapshotId:'s1',toolCallId:'call-1'});
 });
 it('replaces rather than accumulates; failed and tree-only observations clear prior pixels',()=>{
  const context={};for(let index=0;index<50;index++)captureComputerImages(JSON.stringify({success:true,modelImages:observationImages(png,{snapshotId:String(index)})}),'computer-observe',String(index),context);
  expect(context.computerImages).toHaveLength(1);expect(context.computerImages[0].snapshotId).toBe('49');
  captureComputerImages('{"success":false}','computer_observe','failure',context);expect(context.computerImages).toHaveLength(0);
 });
 it('does not interpret arbitrary HTML or other tools as images',()=>{
  const context={};const text=JSON.stringify({success:true,imageHtml:`<img src="data:image/png;base64,${png}">`});
  expect(captureComputerImages(text,'web_scrape','x',context)).toBe(text);expect(context.computerImages).toBeUndefined();
 });
 it.each(['openai','anthropic','gemini'])('%s appends after tool results without mutating history',format=>{
  const messages=[{role:'user',content:'task'},{role:'tool',tool_call_id:'a',content:'result'}];
  const next=appendComputerImages(messages,observationImages(png),format);
  expect(next).toHaveLength(3);expect(messages).toHaveLength(2);expect(JSON.stringify(next[2])).toContain(png);
 });
 it('Claude rejects oversized images locally with an actionable warning',()=>{
  const image={mimeType:'image/png',data:'A'.repeat(7_000_000),width:2000,height:1000};
  const messages=appendComputerImages([],[image],'anthropic');
  expect(messages[0].content.some(part=>part.type==='image')).toBe(false);
  expect(JSON.stringify(messages)).toContain('image limit');
 });
 it('unsupported models get an explicit no-pixels warning',()=>{
  const next=appendComputerImages([],observationImages(png),'openai',false);
  expect(JSON.stringify(next)).not.toContain(png);expect(next[0].content).toContain('VISUAL INPUT UNAVAILABLE');
 });
});
describe('desktop operation lane',()=>{
 it('orders calls through async preflight while letting search proceed',async()=>{
  const events=[];let release;const wait=new Promise(resolve=>release=resolve);
  const calls=['computer_observe','computer_input','web_search'].map(name=>({function:{name}}));
  const results=mapOrderedComputerCalls(calls,async call=>{const name=call.function.name;events.push(name);if(name==='computer_observe')await wait;return name;});
  await Promise.resolve();expect(events).toEqual(['web_search','computer_observe']);release();await Promise.all(results);expect(events.at(-1)).toBe('computer_input');
 });
 it('never runs computer work speculatively while keeping ordinary tools eager',()=>{
  const ran=[];const eager=createEagerToolRuns(call=>ran.push(call.function.name));
  expect(eager.start({id:'a',function:{name:'computer_observe'}})).toBe(false);
  expect(eager.start({id:'b',function:{name:'computer-input'}})).toBe(false);
  expect(eager.start({id:'c',function:{name:'web_search'}})).toBe(true);
  expect(ran).toEqual(['web_search']);
 });
 it('serializes observation and input, including async verification',async()=>{
  const enqueue=createComputerOperationQueue(),events=[];let release;const held=new Promise(resolve=>release=resolve);
  const first=enqueue(async()=>{events.push('observe');await held;events.push('observed');});
  const second=enqueue(async()=>{events.push('input');events.push('verify');});
  await Promise.resolve();expect(events).toEqual(['observe']);release();await Promise.all([first,second]);expect(events).toEqual(['observe','observed','input','verify']);
 });
 it('recovers after rejection and cancels queued work before dispatch',async()=>{
  const enqueue=createComputerOperationQueue();await expect(enqueue(()=>{throw Error('driver failed')})).rejects.toThrow('driver failed');
  const controller=new AbortController();controller.abort();let ran=false;
  await expect(enqueue(()=>{ran=true},controller.signal)).rejects.toThrow('cancelled');expect(ran).toBe(false);expect(await enqueue(()=>42)).toBe(42);
 });
});
