import { describe, it, expect, vi } from 'vitest';
import * as picker from './imageReferencePicker.js';
const message = (id = 'img-gen-a', extra = {}) => ({ id: 'm1', role: 'assistant', toolCalls: [{ name: 'generate_image', result: JSON.stringify({ success: true, savedImageIds: [id], ...extra }) }] });
const png = new Uint8Array(33);
png.set([137,80,78,71,13,10,26,10]);
png.set([0,0,0,13,73,72,68,82],8);png[19]=1;png[23]=1;
function response(bytes=png, headers={}) {
 let read=false;
 return {ok:true,status:200,headers:{get:key=>headers[key]??(key==='content-type'?'image/png':null)},body:{getReader:()=>({read:vi.fn(async()=>read?{done:true}:(read=true,{done:false,value:bytes})),cancel:vi.fn(async()=>{}),releaseLock:vi.fn()})}};
}
describe('Feature: explicitly reuse a saved image as an attachment',()=>{
 it('Given native generated outputs, Then list stable IDs once, newest first',()=>{
  const rows=picker.collectImageReferences([message('img-gen-old'),{...message('img-gen-new'),id:'m2'},message('img-gen-old')]);
  expect(rows.map(r=>r.imageId)).toEqual(['img-gen-old','img-gen-new']);
 });
 it.each([null,{},[{role:'user',content:'{{IMAGE_REF:img-gen-prose}}'}],[{...message(),role:'user'}],[message('../../secret')],[message('img-gen-a',{success:false})],[{...message(),toolCalls:[{name:'web_scrape',result:JSON.stringify({success:true,savedImageIds:['img-gen-a']})}]}]])('Given untrusted or missing output %j, Then list nothing',messages=>expect(picker.collectImageReferences(messages)).toEqual([]));
 it('Given an explicit selection, When loading, Then use only the configured media GET and return a File',async()=>{
  const fetcher=vi.fn(async()=>response());
  const file=await picker.loadImageReference('img-gen-a',{apiBase:'https://agnt.example/api',fetcher});
  expect(file.name).toBe('reference-img-gen-a.png');expect(file.type).toBe('image/png');expect(file.size).toBe(33);
  expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0][0]).toBe('https://agnt.example/api/images/img-gen-a');
  expect(fetcher.mock.calls[0][1]).toMatchObject({method:'GET',redirect:'error',credentials:'include'});
 });
 it.each(['https://other/x','file:///etc/passwd','../x','img-gen-x?redirect=evil',''])('Given external/path selector %s, Then never fetch',async id=>{
  const fetcher=vi.fn();await expect(picker.loadImageReference(id,{apiBase:'/api',fetcher})).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
 });
 it('Given cancelled selection, Then do not start GET',async()=>{
  const c=new AbortController();c.abort();const fetcher=vi.fn();await expect(picker.loadImageReference('img-gen-a',{apiBase:'/api',fetcher,signal:c.signal})).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
 });
 it('Given a stalled media request, Then settle by deadline without retry',async()=>{
  const fetcher=vi.fn(()=>new Promise(()=>{}));await expect(picker.loadImageReference('img-gen-a',{apiBase:'/api',fetcher,timeoutMs:10})).rejects.toThrow(/timed out/);expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
 });
 it.each([['404',()=>({...response(),ok:false,status:404})],['mime',()=>response(png,{'content-type':'text/html'})],['size',()=>response(png,{'content-length':'999999999'})],['signature',()=>response(new Uint8Array(33))]])('Given invalid media %s, Then reject rather than attach',async(_,make)=>{
  await expect(picker.loadImageReference('img-gen-a',{apiBase:'/api',fetcher:async()=>make()})).rejects.toThrow();
 });
 it('Given a stalled body, Then cancel the reader and reject at deadline',async()=>{
  const reader={read:()=>new Promise(()=>{}),cancel:vi.fn(async()=>{}),releaseLock:vi.fn()};
  await expect(picker.loadImageReference('img-gen-a',{apiBase:'/api',fetcher:async()=>({...response(),body:{getReader:()=>reader}}),timeoutMs:10})).rejects.toThrow(/timed out/);
  expect(reader.cancel).toHaveBeenCalled();
 });
});
