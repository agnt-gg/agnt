import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketServer } from 'ws';
vi.mock('../utils/realtimeSync.js', () => ({ broadcastToUser: vi.fn() }));
import { acquireViewer, releaseViewer, _releaseAll } from './BrowserViewerLeaseService.js';
import { streamsForUser, captureViewerFrame, _stopAll } from './BrowserScreencastService.js';
import { attachBrowserViewerSocket } from './browserViewerSocket.js';
let server, url, methods, pendingCapture, holdCapture, messages;
beforeEach(async () => {
  messages=[];methods=[]; pendingCapture=null; holdCapture=false;
  server=new WebSocketServer({port:0,host:'127.0.0.1'});
  await new Promise(r=>server.once('listening',r));
  url=`ws://127.0.0.1:${server.address().port}`;
  server.on('connection',s=>s.on('message',raw=>{
    const m=JSON.parse(raw); methods.push(m.method);messages.push(m);
    let result={};
    if(m.method==='Target.getTargets') result={targetInfos:[{targetId:'t',type:'page'}]};
    if(m.method==='Target.attachToTarget') result={sessionId:'s'};
    if(m.method==='Page.getLayoutMetrics') result={cssVisualViewport:{pageX:0,pageY:0,clientWidth:3840,clientHeight:2160}};
    if(m.method==='Page.captureScreenshot') result={data:'FRESH'};
    const reply=()=>{if(s.readyState===1)s.send(JSON.stringify({id:m.id,result}));};
    if(m.method==='Page.captureScreenshot' && holdCapture) pendingCapture=reply; else reply();
  }));
});
afterEach(async()=>{global.io=null;_releaseAll();_stopAll();for(const s of server.clients)s.terminate();await new Promise(r=>server.close(r));});
const acquire=()=>acquireViewer({userId:'u',instanceId:'i',cdpUrl:url});
function socket(userId='u', id='sock') {
  const handlers=new Map();
  const s={ userId,id,connected:true,on:(n,f)=>handlers.set(n,f),emit:vi.fn(),receive:(n,p,ack)=>handlers.get(n)?.(p,ack) };
  attachBrowserViewerSocket(s);return s;
}
describe('Given bounded backend observation',()=>{
 it('Given no owned viewer lease, When a same-user socket ACKs, Then capture is not advanced',async()=>{
  const lease=await acquire();const s=socket();
  [...server.clients][0].send(JSON.stringify({method:'Page.screencastFrame',params:{data:'IMG',sessionId:77}}));
  await new Promise(r=>setTimeout(r,20));
  s.receive('browser:ack',{instanceId:'i',streamId:lease.streamId,frameId:77});
  await new Promise(r=>setTimeout(r,30));expect(methods).not.toContain('Page.screencastFrameAck');
 });
 it('Given untrusted socket payloads, When null is sent, Then handlers do not throw or reject',async()=>{
  const s=socket();
  for(const event of ['browser:painted','browser:unwatching','browser:renew','browser:ack'])expect(()=>s.receive(event,null,()=>{})).not.toThrow();
  await expect(s.receive('browser:watching',null,()=>{})).resolves.toBeUndefined();
 });
 it('When five different streams capture concurrently, Then at most four captures execute',async()=>{
  holdCapture=true; const leases=await Promise.all(Array.from({length:5},(_,n)=>acquireViewer({userId:'u',instanceId:'i'+n,cdpUrl:url})));
  const work=leases.slice(0,4).map((_,n)=>captureViewerFrame({userId:'u',instanceId:'i'+n}).catch(e=>e));
  await vi.waitFor(()=>expect(methods.filter(m=>m==='Page.captureScreenshot')).toHaveLength(4));
  await expect(captureViewerFrame({userId:'u',instanceId:'i4'})).rejects.toThrow(/busy/);
  for(const c of server.clients)c.terminate();await Promise.all(work);
 });
 it('When an old frame ID is reused by a replacement stream, Then the old ACK cannot advance it',async()=>{
  const old=await acquire();_stopAll();const fresh=await acquire();const s=socket();await s.receive('browser:watching',{instanceId:'i',viewerId:fresh.viewerId});
  const c=[...server.clients].find(c=>c.readyState===1);
  c.send(JSON.stringify({method:'Page.screencastFrame',params:{data:'IMG',sessionId:99}}));
  await new Promise(r=>setTimeout(r,20));
  s.receive('browser:ack',{instanceId:'i',streamId:old.streamId,viewerId:fresh.viewerId,frameId:99});
  await new Promise(r=>setTimeout(r,20));expect(methods).not.toContain('Page.screencastFrameAck');
  s.receive('browser:ack',{instanceId:'i',streamId:fresh.streamId,viewerId:fresh.viewerId,frameId:99});
  await vi.waitFor(()=>expect(methods).toContain('Page.screencastFrameAck'));
 });
 it('When a frame is broadcast, Then it uses volatile delivery rather than a reliable image queue',async()=>{
  const lease=await acquire();const watcher=socket();await watcher.receive('browser:watching',{instanceId:'i',viewerId:lease.viewerId});const emit=vi.fn();const reliable=vi.fn();global.io={to:vi.fn(()=>({volatile:{emit},emit:reliable}))};
  [...server.clients][0].send(JSON.stringify({method:'Page.screencastFrame',params:{data:'IMG',sessionId:1}}));
  await vi.waitFor(()=>expect(emit).toHaveBeenCalled());expect(reliable).not.toHaveBeenCalled();
 });
 it('When reauthentication fails, Then the socket loses its old viewer leases and room identity',async()=>{
  const lease=await acquire();const s=socket();s.leave=vi.fn();await s.receive('browser:watching',{instanceId:'i',viewerId:lease.viewerId});
  const {revokeBrowserViewerIdentity}=await import('./browserViewerSocket.js');revokeBrowserViewerIdentity(s);
  expect(streamsForUser('u')).toEqual([]);expect(s.userId).toBeNull();expect(s.leave).toHaveBeenCalledWith('user:u');
 });
 it('When a large viewport is captured, Then both output dimensions are capped without changing the viewport',async()=>{
  await acquire();await captureViewerFrame({userId:'u',instanceId:'i'});
  const p=messages.find(m=>m.method==='Page.captureScreenshot').params;
  expect(p.captureBeyondViewport).toBe(false);expect(p.clip.width*p.clip.scale).toBeLessThanOrEqual(1280);expect(p.clip.height*p.clip.scale).toBeLessThanOrEqual(800);
  expect(methods).not.toContain('Emulation.setDeviceMetricsOverride');
 });
 it('When callers repeatedly request fresh captures, Then serial capture is rate limited',async()=>{
  await acquire();await captureViewerFrame({userId:'u',instanceId:'i'});
  await expect(captureViewerFrame({userId:'u',instanceId:'i'})).rejects.toThrow(/rate|busy/i);
  expect(methods.filter(m=>m==='Page.captureScreenshot')).toHaveLength(1);
 });
 it('When new viewers pile up without releasing, Then acquisition has a bounded per-user limit',async()=>{
  const results=await Promise.allSettled(Array.from({length:20},acquire));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(16);
 });
 it('When an expired or foreign viewer renews, Then the socket refuses it without capturing',async()=>{
  const lease=await acquire();const s=socket();await s.receive('browser:watching',{instanceId:'i',viewerId:lease.viewerId});
  const ack=vi.fn();s.receive('browser:renew',{instanceId:'i',viewerId:lease.viewerId},ack);expect(ack).toHaveBeenCalledWith({ok:true});
  releaseViewer({userId:'u',instanceId:'i',viewerId:lease.viewerId});ack.mockClear();
  s.receive('browser:renew',{instanceId:'i',viewerId:lease.viewerId},ack);expect(ack).toHaveBeenCalledWith(expect.objectContaining({ok:false}));
  expect(methods.filter(m=>m==='Page.captureScreenshot')).toHaveLength(1);
 });
});
