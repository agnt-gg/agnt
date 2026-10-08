import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import { toolRequestPermitted, issueToolToken, currentToolAuthorization } from './toolRunAuthority.js';
import { redactToolSecrets } from './redactToolSecrets.js';

const ROOT = '/app/data/.tool-network';
export function publicIPv4(address) {
  if (net.isIP(address) !== 4) return false; // IPv6 fail-closed until an equally strict classifier is provided
  const [a,b,c]=address.split('.').map(Number);
  return !(a===0 || a===10 || a===127 || a>=224 || (a===100&&b>=64&&b<=127) || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&(b===168 || b===0 || (b===2))) || (a===198&&(b===18||b===19||(b===51&&c===100))) || (a===203&&b===0&&c===113));
}
export async function resolvePublicDestination(hostname, lookup = dns.lookup) {
  const addresses = await lookup(hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some(({address}) => !publicIPv4(address))) throw new Error('Private or reserved destination refused');
  return addresses[0].address; // connect to THIS address, never resolve twice
}

export function createToolNetwork(actor, { lifetimeMs = 300000, authorization = currentToolAuthorization() } = {}) {
  fs.mkdirSync(ROOT,{recursive:true,mode:0o700});
  if (fs.realpathSync(ROOT)!==ROOT) throw new Error('Tool network directory must not be a symlink');
  const dir=fs.mkdtempSync(ROOT+'/run-');
  const socketPath=dir+'/proxy.sock';
  const connections=new Set();
  let closed=false;
  const server=http.createServer(async(req,res)=>{
    try {
      // The private API port inside the sandbox uses origin-form URLs.
      const api = !/^https?:\/\//i.test(req.url || '');
      if(api){
        if(!actor || !toolRequestPermitted(req.method,req.url)) { res.writeHead(403);res.end('Tool API scope denied');return; }
        // Business/team authorization is still evaluated by the normal API.
        // The real caller's bearer NEVER crosses the Unix socket to code.
        const bearer = authorization ? authorization.replace(/^Bearer\s+/i, '') : issueToolToken(actor);
        const upstream=http.request({hostname:'127.0.0.1',port:Number(process.env.PORT||3333),path:req.url,method:'GET',headers:{authorization:'Bearer '+bearer}},r=>{
          // Never forward cookies/auth headers or raw credential-shaped fields.
          // These read APIs return JSON; bound buffering prevents a large result
          // from turning the broker into an unbounded allocation.
          let body = ''; let bytes = 0;
          r.setEncoding('utf8');
          r.on('data', chunk => {
            if (res.writableEnded) return;
            bytes += Buffer.byteLength(chunk);
            if (bytes > 1024 * 1024) { r.destroy(); res.writeHead(502); res.end('API response too large'); }
            else body += chunk.toString('utf8');
          });
          r.on('end', () => {
            if (res.writableEnded) return;
            try {
              const safe = redactToolSecrets(JSON.parse(body));
              res.writeHead(r.statusCode, {'content-type':'application/json'}); res.end(JSON.stringify(safe));
            } catch { res.writeHead(502); res.end('Unexpected API response'); }
          });
          r.on('error', () => { if (!res.writableEnded) { res.writeHead(502); res.end('API response unavailable'); } });
        });
        upstream.setTimeout(30000,()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('API unavailable');});upstream.end();return;
      }
      const url=new URL(req.url);
      if(url.protocol!=='http:' || url.username || url.password || (url.port&&url.port!=='80'))throw new Error('Use HTTP/80 or HTTPS/443');
      const address=await resolvePublicDestination(url.hostname);
      const headers={...req.headers,host:url.host};delete headers['proxy-authorization'];delete headers['proxy-connection'];
      const upstream=http.request({host:address,port:80,method:req.method,path:url.pathname+url.search,headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
      upstream.setTimeout(60000,()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Upstream unavailable');});req.pipe(upstream);
    }catch{res.writeHead(403);res.end('Destination refused');}
  });
  server.maxConnections = 64;
  server.maxRequestsPerSocket = 100;
  server.requestTimeout = 60000;
  server.headersTimeout = 15000;
  server.on('connect',async(req,client,head)=>{
    try{
      const match=/^([^\s:/]+):(80|443)$/.exec(req.url||'');
      if(!match)throw new Error('CONNECT destination refused');
      const address=await resolvePublicDestination(match[1]);
      if(closed)throw new Error('Expired');
      const upstream=net.connect({host:address,port:Number(match[2])});connections.add(upstream);
      upstream.once('connect',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);});
      upstream.setTimeout(60000,()=>upstream.destroy());upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy());client.on('close',()=>upstream.destroy());upstream.on('close',()=>{connections.delete(upstream);client.destroy();});
    }catch{client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');}
  });
  server.on('connection',socket=>{connections.add(socket);socket.setTimeout(60000,()=>socket.destroy());socket.on('close',()=>connections.delete(socket));});
  server.on('clientError',(_error,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
  server.listen(socketPath);server.unref();
  // listen(path) binds synchronously on Unix. Refuse a launch if no socket was made.
  if(!fs.existsSync(socketPath)){server.close();throw new Error('Tool proxy did not bind');}
  fs.chmodSync(socketPath,0o600);
  const close=()=>{if(closed)return;closed=true;clearTimeout(timer);for(const socket of connections)socket.destroy();server.close();try{fs.unlinkSync(socketPath);}catch(e){if(e.code!=='ENOENT')console.error('tool proxy cleanup:',e.code);}try{fs.rmdirSync(dir);}catch(e){if(e.code!=='ENOENT')console.error('tool proxy dir cleanup:',e.code);}};
  const timer=setTimeout(close,Math.min(Math.max(lifetimeMs,1000),3600000));timer.unref();
  return {socketPath,close};
}
