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
  it('When an old stream dies and is replaced, Then releasing its old lease cannot stop the replacement',async()=>{
    const old=await acquire(); _stopAll();
    const replacement=await acquire();
    releaseViewer({userId:'u',instanceId:'i',viewerId:old.viewerId});
    expect(streamsForUser('u')).toEqual([{instanceId:'i',viewers:1}]);
    releaseViewer({userId:'u',instanceId:'i',viewerId:replacement.viewerId});
    expect(streamsForUser('u')).toEqual([]);
  });
  it('When HTTP completed before watcher registration, Then a fresh frame is delivered only to that viewer',async()=>{
    const lease=await acquire();const s=socket();const ack=vi.fn();
    expect(methods).not.toContain('Page.captureScreenshot');
    await s.receive('browser:watching',{instanceId:'i',viewerId:lease.viewerId},ack);
    expect(ack).toHaveBeenCalledWith({ok:true});
    expect(s.emit).toHaveBeenCalledWith('browser:frame',expect.objectContaining({data:'FRESH',source:'snapshot',viewerId:lease.viewerId,capturedAt:expect.any(Number)}));
    expect(methods.filter(m=>m==='Page.captureScreenshot')).toHaveLength(1);
    expect(methods).not.toContain('Page.navigate');expect(methods).not.toContain('Page.reload');
  });
  it('When a viewer reconnects, Then a second fresh frame arrives and all refcounts balance',async()=>{
    const first=await acquire();const s=socket();
    await s.receive('browser:watching',{instanceId:'i',viewerId:first.viewerId});
    s.connected=false;s.receive('disconnect');expect(streamsForUser('u')).toEqual([]);
    const second=await acquire();const next=socket('u','new');
    await next.receive('browser:watching',{instanceId:'i',viewerId:second.viewerId});
    expect(next.emit).toHaveBeenCalledWith('browser:frame',expect.objectContaining({data:'FRESH'}));
    next.receive('disconnect');expect(streamsForUser('u')).toEqual([]);
    expect(methods.filter(m=>m==='Page.captureScreenshot')).toHaveLength(2);
  });
  it('When a stranger registers or captures, Then no frame leaks',async()=>{
    const lease=await acquire();const s=socket('stranger');const ack=vi.fn();
    await s.receive('browser:watching',{instanceId:'i',viewerId:lease.viewerId},ack);
    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ok:false}));
    expect(s.emit).not.toHaveBeenCalled();
    await expect(captureViewerFrame({userId:'stranger',instanceId:'i'})).rejects.toThrow();
    expect(methods).not.toContain('Page.captureScreenshot');
  });
  it('When capture completes after release, Then no image is delivered to the old viewer',async()=>{
    const a=await acquire();const b=await acquire();const s=socket();holdCapture=true;
    const watching=s.receive('browser:watching',{instanceId:'i',viewerId:a.viewerId});
    await vi.waitFor(()=>expect(pendingCapture).toBeTypeOf('function'));
    releaseViewer({userId:'u',instanceId:'i',viewerId:a.viewerId});pendingCapture();await watching;
    expect(s.emit).not.toHaveBeenCalled();expect(streamsForUser('u')[0].viewers).toBe(1);
    releaseViewer({userId:'u',instanceId:'i',viewerId:b.viewerId});
  });
});
