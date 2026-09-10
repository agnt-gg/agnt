import {describe,it,expect,afterEach} from 'vitest';
import http from 'node:http';
import {localImageJson} from './localImageHttp.js';
const stops=[];
afterEach(async()=>{for(const stop of stops.splice(0))await stop();});
async function server(handler){let posts=0;const sockets=new Set();const timers=[];const s=http.createServer((req,res)=>{posts++;handler(req,res,(f,ms)=>timers.push(setTimeout(f,ms)));});s.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise(r=>s.listen(0,'127.0.0.1',r));stops.push(async()=>{timers.forEach(clearTimeout);sockets.forEach(s=>s.destroy());await new Promise(r=>s.close(r));});return {url:`http://127.0.0.1:${s.address().port}/image/generate`,posts:()=>posts};}
const options={method:'POST',body:'{}'};
const budget={connectMs:500,headersMs:1000,bodyMs:200,totalMs:1500};
describe('bounded cold image HTTP transport',()=>{
 it('accepts delayed headers with one credential-free POST',async()=>{const s=await server((req,res,later)=>{expect(req.headers.authorization).toBeUndefined();later(()=>res.end('{"done":true}'),100);});const r=await localImageJson(s.url,options,budget);expect(await r.json()).toEqual({done:true});expect(s.posts()).toBe(1);});
 it('silent server times out without retry',async()=>{const s=await server(()=>{});await expect(localImageJson(s.url,options,{...budget,headersMs:50})).rejects.toMatchObject({phase:'headers'});expect(s.posts()).toBe(1);});
 it('stalled body terminates',async()=>{const s=await server((req,res)=>{res.writeHead(200);res.write('{');});await expect(localImageJson(s.url,options,{...budget,bodyMs:50})).rejects.toMatchObject({phase:'body'});});
 it('abort stops waiting, not a claim of server cancellation',async()=>{const c=new AbortController();const s=await server(()=>c.abort());await expect(localImageJson(s.url,{...options,signal:c.signal},budget)).rejects.toMatchObject({code:'ABORT_ERR'});expect(s.posts()).toBe(1);});
 it('pre-abort dispatches nothing',async()=>{const s=await server(()=>{});const c=new AbortController();c.abort();await expect(localImageJson(s.url,{...options,signal:c.signal},budget)).rejects.toThrow();expect(s.posts()).toBe(0);});
 it('does not follow redirect',async()=>{const s=await server((req,res)=>{res.writeHead(302,{Location:'/elsewhere'});res.end('{}');});expect((await localImageJson(s.url,options,budget)).status).toBe(302);expect(s.posts()).toBe(1);});
 it('bounds response size',async()=>{const s=await server((req,res)=>res.end('123456789'));await expect(localImageJson(s.url,options,{...budget,maxBytes:4})).rejects.toThrow(/limit/);});
 it('bounds total duration despite arriving body chunks',async()=>{const s=await server((req,res,later)=>{res.write('{');for(let i=1;i<8;i++)later(()=>res.write(' '),i*30);});await expect(localImageJson(s.url,options,{...budget,headersMs:100,totalMs:150})).rejects.toMatchObject({phase:'total'});});
});
