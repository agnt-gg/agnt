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
afterEach(async()=>{_releaseAll();_stopAll();for(const s of server.clients)s.terminate();await new Promise(r=>server.close(r));});
const acquire=()=>acquireViewer({userId:'u',instanceId:'i',cdpUrl:url});
function socket(userId='u', id='sock') {
  const handlers=new Map();
  const s={ userId,id,connected:true,on:(n,f)=>handlers.set(n,f),emit:vi.fn(),receive:(n,p,ack)=>handlers.get(n)?.(p,ack) };
  attachBrowserViewerSocket(s);return s;
}
describe('Given a static page that emits zero screencast events',()=>{
  it('Given a retired stream lease, When its browser ID is reused, Then registration cannot observe the replacement',async()=>{
    const old=await acquire(); _stopAll(); const replacement=await acquire();
    const s=socket(); const ack=vi.fn();
    await s.receive('browser:watching',{instanceId:'i',viewerId:old.viewerId},ack);
    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ok:false}));
    expect(s.emit).not.toHaveBeenCalled();
    expect(methods).not.toContain('Page.captureScreenshot');
  });
  it('Given an already registered viewer, When registration is repeated, Then capture and delivery occur only once',async()=>{
    const lease=await acquire(); const s=socket();
    await s.receive('browser:watching',{instanceId:'i',viewerId:lease.viewerId});
    await s.receive('browser:watching',{instanceId:'i',viewerId:lease.viewerId});
    expect(methods.filter(m=>m==='Page.captureScreenshot')).toHaveLength(1);
    expect(s.emit.mock.calls.filter(c=>c[0]==='browser:frame')).toHaveLength(1);
  });

});
