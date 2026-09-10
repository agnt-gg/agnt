import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { CdpConnection } from './cdpConnection.js';
import { performBrowserAction, _resetDrivers } from './browserActDriver.js';
const cleanup=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(delayMs){
 const server=http.createServer();const wss=new WebSocketServer({noServer:true});const sockets=new Set(),timers=new Set();let upgrades=0,commands=0;
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
 server.on('upgrade',(req,socket,head)=>{upgrades++;if(delayMs===null)return;const timer=setTimeout(()=>{timers.delete(timer);if(!socket.destroyed)wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));},delayMs);timers.add(timer);});
 wss.on('connection',ws=>ws.on('message',raw=>{commands++;const msg=JSON.parse(raw);ws.send(JSON.stringify({id:msg.id,result:{product:'fixture'}}));}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 cleanup.push(async()=>{for(const t of timers)clearTimeout(t);for(const ws of wss.clients)ws.terminate();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));wss.close();});
 return {url:`ws://127.0.0.1:${server.address().port}`,counts:()=>({upgrades,commands})};
}
describe('bounded cold CDP handshake',()=>{
 it('production browser driver supplies the startup budget and never retries a failed handshake',async()=>{
  const connect=vi.spyOn(CdpConnection.prototype,'connect').mockRejectedValue(new Error('fixture handshake failure'));
  try {await expect(performBrowserAction('startup-budget-test','ws://127.0.0.1:1','navigate',{url:'http://127.0.0.1/fixture'})).rejects.toThrow('fixture handshake failure');expect(connect).toHaveBeenCalledExactlyOnceWith({timeoutMs:15000});}
  finally {connect.mockRestore();_resetDrivers();}
 });
 it('allows an explicitly budgeted cold handshake longer than the old four seconds without retrying',async()=>{
  const f=await fixture(4300);const c=new CdpConnection(f.url);cleanup.push(()=>c.close());
  await c.connect({timeoutMs:10000});expect(await c.send('Browser.getVersion')).toEqual({product:'fixture'});expect(f.counts()).toEqual({upgrades:1,commands:1});
 },15000);
 it('still rejects a silent handshake within the requested bound without sending commands or reconnecting',async()=>{
  const f=await fixture(null);const c=new CdpConnection(f.url);cleanup.push(()=>c.close());
  await expect(c.connect({timeoutMs:100})).rejects.toThrow(/handshake/i);expect(c.closed).toBe(true);expect(f.counts()).toEqual({upgrades:1,commands:0});
 },2000);
 it.each([0,-1,NaN,Infinity,30001])('rejects invalid connect budget %s before opening a socket',async timeoutMs=>{
  const f=await fixture(0);const c=new CdpConnection(f.url);cleanup.push(()=>c.close());
  await expect(c.connect({timeoutMs})).rejects.toThrow(/timeout/i);expect(f.counts().upgrades).toBe(0);
 });
});
