// Inside the private PID + network namespace. This exposes only the per-run
// Unix broker as local HTTP proxy and the AGNT API. The only credential in the
// workload is AGNT_AUTH_TOKEN: the run's temporary, instance-bound proxy key.
const net = require('node:net');
const fs = require('node:fs');
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
// AGNT_TOOL_EXPOSE='<port>=<socket>': expose one loopback port of this namespace as a Unix socket, so the
// server can reach it (the launched browser's debugging port; backend hostedCdpBridge.js). The socket must
// be inside the mounted workspace, the only folder the server also sees.
function expose(spec){
 const match=/^(\d{4,5})=(\/[A-Za-z0-9._\/-]+\.sock)$/.exec(spec||'');
 const workspace=process.env.AGNT_TOOL_WORKSPACE_MOUNTED||'';
 if(!match||!workspace||!match[2].startsWith(workspace+'/')||match[2].includes('/../')||Number(match[1])<1024)throw Error('Invalid AGNT_TOOL_EXPOSE');
 const [,port,socketPath]=match;
 try{if(fs.lstatSync(socketPath).isSocket())fs.unlinkSync(socketPath);}catch{/* none */}
 return new Promise((resolve,reject)=>{
  const server=net.createServer(client=>{
   const peer=net.connect(Number(port),'127.0.0.1');
   peer.on('error',()=>client.destroy());client.on('error',()=>peer.destroy());
   client.on('close',()=>peer.destroy());peer.on('close',()=>client.destroy());
   client.pipe(peer);peer.pipe(client);
  });server.once('error',reject);server.listen(socketPath,()=>{servers.push(server);resolve();});
 });
}
(async()=>{
 await listen(3128);await listen(3333);
 if(process.env.AGNT_TOOL_EXPOSE)await expose(process.env.AGNT_TOOL_EXPOSE);
 const [command,...args]=process.argv.slice(2);
 if(!command)throw Error('Missing tool command');
 const env={...process.env, HTTP_PROXY:'http://127.0.0.1:3128',HTTPS_PROXY:'http://127.0.0.1:3128',http_proxy:'http://127.0.0.1:3128',https_proxy:'http://127.0.0.1:3128',NO_PROXY:'localhost,127.0.0.1',no_proxy:'localhost,127.0.0.1',NODE_OPTIONS:'--require=/usr/local/lib/agnt/egress-fetch.cjs',PUPPETEER_EXECUTABLE_PATH:'/usr/local/bin/agnt-chromium'};
 // The workload's own folder (a path, not a credential): file tools resolve paths against it
 // (backend utils/workspaceRoot.js sandboxMountedRoot); without it a member's tools looked for the owner's.
 env.AGNT_TOOL_ROOT=process.env.AGNT_TOOL_WORKSPACE_MOUNTED||'';
 delete env.NODE_CHANNEL_FD;delete env.NODE_CHANNEL_SERIALIZATION_MODE;delete env.AGNT_TOOL_EXPOSE;delete env.AGNT_TOOL_WORKSPACE_MOUNTED;
 const ipc=typeof process.send==='function';
 const child=spawn(command,args,{env,stdio:ipc?['inherit','inherit','inherit','ipc']:['inherit','inherit','inherit']});
 if(ipc){process.on('message',message=>{if(child.connected)child.send(message);});child.on('message',message=>{if(process.connected)process.send(message);});process.on('disconnect',()=>child.kill());}
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
 child.once('error',error=>{console.error('Sandbox command:',error.message);process.exit(126);});
 child.once('exit',(code,signal)=>{for(const server of servers)server.close();process.exit(code===null?128:(code||0));});
})().catch(error=>{console.error('Sandbox network:',error.message);process.exit(126);});
