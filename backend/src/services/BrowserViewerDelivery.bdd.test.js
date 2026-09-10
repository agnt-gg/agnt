import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketServer } from 'ws';
vi.mock('../utils/realtimeSync.js', () => ({ broadcastToUser: vi.fn() }));
import { acquireViewer, releaseViewer, _releaseAll } from './BrowserViewerLeaseService.js';
import { streamsForUser, captureViewerFrame, _stopAll } from './BrowserScreencastService.js';
import { attachBrowserViewerSocket } from './browserViewerSocket.js';
let server, url, methods, pendingCapture, holdCapture;
beforeEach(async () => {
  methods=[]; pendingCapture=null; holdCapture=false;
  server=new WebSocketServer({port:0,host:'127.0.0.1'});
  await new Promise(r=>server.once('listening',r));
  url=`ws://127.0.0.1:${server.address().port}`;
  server.on('connection',s=>s.on('message',raw=>{
    const m=JSON.parse(raw); methods.push(m.method);
    let result={};
    if(m.method==='Target.getTargets') result={targetInfos:[{targetId:'t',type:'page'}]};
    if(m.method==='Target.attachToTarget') result={sessionId:'s'};
    if(m.method==='Page.getLayoutMetrics') result={cssVisualViewport:{pageX:0,pageY:0,clientWidth:800,clientHeight:600}};
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
describe('Given static-page recovery with bounded delivery',()=>{
 it('When paint is confirmed, Then delivery retries stop while frame membership remains until release',async()=>{
  const lease=await acquire();const s=socket();await s.receive('browser:watching',{instanceId:'i',viewerId:lease.viewerId});
  const image=s.emit.mock.calls.find(c=>c[0]==='browser:frame')[1];
  s.receive('browser:painted',{...image,viewerId:lease.viewerId});
  await new Promise(r=>setTimeout(r,850));expect(s.emit.mock.calls.filter(c=>c[0]==='browser:frame')).toHaveLength(1);
 });
 it('When the first bootstrap is dropped, Then an unacknowledged image is retried without another capture',async()=>{
  const lease=await acquire();const s=socket();await s.receive('browser:watching',{instanceId:'i',viewerId:lease.viewerId});
  await vi.waitFor(()=>expect(s.emit.mock.calls.filter(c=>c[0]==='browser:frame').length).toBeGreaterThan(1),{timeout:1800});
  expect(methods.filter(m=>m==='Page.captureScreenshot')).toHaveLength(1);
 });
 it('When a second viewer joins within the capture cooldown, Then it automatically receives a fresh bootstrap',async()=>{
  const first=await acquire();const a=socket('u','a');await a.receive('browser:watching',{instanceId:'i',viewerId:first.viewerId});
  const second=await acquire();const b=socket('u','b');await b.receive('browser:watching',{instanceId:'i',viewerId:second.viewerId});
  await vi.waitFor(()=>expect(b.emit.mock.calls.some(c=>c[0]==='browser:frame')).toBe(true),{timeout:2300});
 });
 it('When pixels are broadcast, Then only registered viewer sockets receive traffic and release removes them',async()=>{
  const lease=await acquire();const s=socket('u','watcher');await s.receive('browser:watching',{instanceId:'i',viewerId:lease.viewerId});
  const emit=vi.fn();const to=vi.fn(()=>({volatile:{emit}}));global.io={to};
  [...server.clients][0].send(JSON.stringify({method:'Page.screencastFrame',params:{data:'IMG',sessionId:9}}));
  await vi.waitFor(()=>expect(emit).toHaveBeenCalled());expect(to).toHaveBeenCalledWith(['watcher']);
  const other=await acquire();releaseViewer({userId:'u',instanceId:'i',viewerId:lease.viewerId});to.mockClear();
  [...server.clients][0].send(JSON.stringify({method:'Page.screencastFrame',params:{data:'IMG',sessionId:10}}));
  await new Promise(r=>setTimeout(r,80));expect(to).not.toHaveBeenCalled();
 });
 it('When delivery never succeeds, Then retries terminate with a visible failure within the budget',async()=>{
  const lease=await acquire();const s=socket();await s.receive('browser:watching',{instanceId:'i',viewerId:lease.viewerId});
  await vi.waitFor(()=>expect(s.emit.mock.calls.some(c=>c[0]==='browser:frame-unavailable')).toBe(true),{timeout:7500});
  expect(s.emit.mock.calls.filter(c=>c[0]==='browser:frame').length).toBeLessThanOrEqual(8);
 },9000);
});
