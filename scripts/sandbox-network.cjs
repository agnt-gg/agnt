// Inside the private PID + network namespace. This exposes only the per-run
// Unix broker as local HTTP proxy and the AGNT API. The only credential in the
// workload is AGNT_AUTH_TOKEN: the run's temporary, instance-bound proxy key.
const net = require('node:net');
const {spawn} = require('node:child_process');
const servers=[];
function listen(port) { return new Promise((resolve,reject)=>{
  const server=net.createServer(client=>{
    const peer=net.connect('/run/agnt/proxy.sock');
    peer.on('error',()=>client.destroy());client.on('error',()=>peer.destroy());
    client.on('close',()=>peer.destroy());peer.on('close',()=>client.destroy());
    client.pipe(peer);peer.pipe(client);
  });server.once('error',reject);server.listen(port,'127.0.0.1',()=>{servers.push(server);resolve();});
});}
(async()=>{
 await listen(3128);await listen(3333);
 const [command,...args]=process.argv.slice(2);
 if(!command)throw Error('Missing tool command');
 const env={...process.env, HTTP_PROXY:'http://127.0.0.1:3128',HTTPS_PROXY:'http://127.0.0.1:3128',http_proxy:'http://127.0.0.1:3128',https_proxy:'http://127.0.0.1:3128',NO_PROXY:'localhost,127.0.0.1',no_proxy:'localhost,127.0.0.1',NODE_OPTIONS:'--require=/usr/local/lib/agnt/egress-fetch.cjs',PUPPETEER_EXECUTABLE_PATH:'/usr/local/bin/agnt-chromium'};
 delete env.NODE_CHANNEL_FD;delete env.NODE_CHANNEL_SERIALIZATION_MODE;
 const ipc=typeof process.send==='function';
 const child=spawn(command,args,{env,stdio:ipc?['inherit','inherit','inherit','ipc']:['inherit','inherit','inherit']});
 if(ipc){process.on('message',message=>{if(child.connected)child.send(message);});child.on('message',message=>{if(process.connected)process.send(message);});process.on('disconnect',()=>child.kill());}
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
 child.once('error',error=>{console.error('Sandbox command:',error.message);process.exit(126);});
 child.once('exit',(code,signal)=>{for(const server of servers)server.close();process.exit(code===null?128:(code||0));});
})().catch(error=>{console.error('Sandbox network:',error.message);process.exit(126);});
