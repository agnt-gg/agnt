import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import { toolRequestPermitted, issueToolToken, currentToolAuthorization, TOOL_SCOPE_DENIED } from './toolRunAuthority.js';
import { redactToolSecrets } from './redactToolSecrets.js';

const ROOT = '/app/data/.tool-network';
const JSON_REDACTION_LIMIT = 32 * 1024 * 1024;
// Long API calls (an agent turn, a plugin install) and quiet streams are normal.
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
// Credentials and hop-by-hop fields never cross the broker; the broker sets auth itself.
const DROPPED_REQUEST_HEADERS = new Set(['authorization', 'cookie', 'host', 'connection', 'keep-alive', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'upgrade', 'accept-encoding', 'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'x-agnt-control-token']);
const DROPPED_RESPONSE_HEADERS = new Set(['set-cookie', 'connection', 'keep-alive', 'transfer-encoding', 'content-length']);

function forwardableHeaders(headers, dropped) {
  const kept = {};
  for (const [name, value] of Object.entries(headers || {})) if (!dropped.has(name.toLowerCase())) kept[name] = value;
  return kept;
}

// JSON is redacted before code sees it; other bodies (files, images, SSE) stream as-is.
function relayApiResponse(upstream, res) {
  const headers = forwardableHeaders(upstream.headers, DROPPED_RESPONSE_HEADERS);
  if (!/\bjson\b/i.test(String(upstream.headers['content-type'] || ''))) {
    res.writeHead(upstream.statusCode, headers);
    upstream.pipe(res);
    return;
  }
  const chunks = []; let bytes = 0;
  upstream.on('data', (chunk) => {
    if (res.writableEnded) return;
    bytes += chunk.length;
    if (bytes > JSON_REDACTION_LIMIT) { upstream.destroy(); res.writeHead(502); res.end('API response too large to redact'); }
    else chunks.push(chunk);
  });
  upstream.on('end', () => {
    if (res.writableEnded) return;
    const text = Buffer.concat(chunks).toString('utf8');
    let body;
    try { body = JSON.stringify(redactToolSecrets(JSON.parse(text))); } catch { body = redactToolSecrets(text); }
    res.writeHead(upstream.statusCode, { ...headers, 'content-length': Buffer.byteLength(body) });
    res.end(body);
  });
  upstream.on('error', () => { if (!res.writableEnded) { if (!res.headersSent) res.writeHead(502); res.end('API response unavailable'); } });
}
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
        if(!actor || !toolRequestPermitted(req.method,req.url)) {
          res.writeHead(403,{'content-type':'application/json'});
          res.end(JSON.stringify({ success:false, reason:'tool_scope_denied', error:TOOL_SCOPE_DENIED }));
          return;
        }
        // The API authorizes this exactly as it would the user's own session.
        // The real caller's bearer NEVER crosses the Unix socket to code.
        const bearer = authorization ? authorization.replace(/^Bearer\s+/i, '') : issueToolToken(actor);
        const headers = { ...forwardableHeaders(req.headers, DROPPED_REQUEST_HEADERS), authorization: 'Bearer ' + bearer, 'accept-encoding': 'identity' };
        const upstream=http.request({hostname:'127.0.0.1',port:Number(process.env.PORT||3333),path:req.url,method:req.method,headers},r=>relayApiResponse(r,res));
        upstream.setTimeout(IDLE_TIMEOUT_MS,()=>upstream.destroy());
        upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);if(!res.writableEnded)res.end('API unavailable');});
        req.pipe(upstream);
        return;
      }
      const url=new URL(req.url);
      if(url.protocol!=='http:' || url.username || url.password)throw new Error('Only plain HTTP is proxied; use CONNECT for TLS');
      const port=Number(url.port||80);
      const address=await resolvePublicDestination(url.hostname);
      const headers={...req.headers,host:url.host};delete headers['proxy-authorization'];delete headers['proxy-connection'];
      const upstream=http.request({host:address,port,method:req.method,path:url.pathname+url.search,headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
      upstream.setTimeout(IDLE_TIMEOUT_MS,()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Upstream unavailable');});req.pipe(upstream);
    }catch{res.writeHead(403);res.end('Destination refused');}
  });
  server.maxConnections = 64;
  server.maxRequestsPerSocket = 100;
  server.requestTimeout = 0; // a request body may legitimately take long to upload; sockets still idle out
  server.headersTimeout = 15000;
  server.on('connect',async(req,client,head)=>{
    try{
      // Any public port, as tools had before the sandbox. Private and reserved
      // addresses stay refused below, matching the fleet's own egress rules.
      const match=/^([^\s:/]+):(\d{1,5})$/.exec(req.url||'');
      if(!match || Number(match[2])<1 || Number(match[2])>65535)throw new Error('CONNECT destination refused');
      const address=await resolvePublicDestination(match[1]);
      if(closed)throw new Error('Expired');
      const upstream=net.connect({host:address,port:Number(match[2])});connections.add(upstream);
      upstream.once('connect',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);});
      upstream.setTimeout(IDLE_TIMEOUT_MS,()=>upstream.destroy());upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy());client.on('close',()=>upstream.destroy());upstream.on('close',()=>{connections.delete(upstream);client.destroy();});
    }catch{client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');}
  });
  server.on('connection',socket=>{connections.add(socket);socket.setTimeout(IDLE_TIMEOUT_MS,()=>socket.destroy());socket.on('close',()=>connections.delete(socket));});
  server.on('clientError',(_error,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
  server.listen(socketPath);server.unref();
  // listen(path) binds synchronously on Unix. Refuse a launch if no socket was made.
  if(!fs.existsSync(socketPath)){server.close();throw new Error('Tool proxy did not bind');}
  fs.chmodSync(socketPath,0o600);
  const close=()=>{if(closed)return;closed=true;clearTimeout(timer);for(const socket of connections)socket.destroy();server.close();try{fs.unlinkSync(socketPath);}catch(e){if(e.code!=='ENOENT')console.error('tool proxy cleanup:',e.code);}try{fs.rmdirSync(dir);}catch(e){if(e.code!=='ENOENT')console.error('tool proxy dir cleanup:',e.code);}};
  const timer=setTimeout(close,Math.min(Math.max(lifetimeMs,1000),3600000));timer.unref();
  return {socketPath,close};
}
