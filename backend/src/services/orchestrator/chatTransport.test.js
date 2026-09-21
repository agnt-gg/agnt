import {it,expect,vi} from 'vitest';
import http from 'node:http';
import {once} from 'node:events';
import {createChatTransport} from './chatTransport.js';
it('a real HTTP disconnect does not cancel backend work',async()=>{
 let transport;let completed=false;let complete;
 const completion=new Promise(resolve=>{complete=resolve;});
 const server=http.createServer((_request,response)=>{
  transport=createChatTransport(response);transport.start();transport.send('started',{});
  completion.then(()=>{completed=true;transport.send('finished',{});transport.finish();});
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const request=http.get(`http://127.0.0.1:${server.address().port}`,response=>{
   response.once('data',()=>response.destroy());
  });
  await once(request,'response');
  await vi.waitFor(()=>expect(transport).toBeDefined());
  request.destroy();complete();
  await vi.waitFor(()=>expect(completed).toBe(true));
 }finally{complete();transport?.finish();await new Promise(resolve=>server.close(resolve));}
});
