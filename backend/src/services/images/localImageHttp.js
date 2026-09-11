import http from 'node:http';

/** Local facade transport only. One POST, no redirects or retries, no auth.
 * Cold loading precedes response headers in this facade. Separate connection,
 * header, body-idle and total deadlines; never change global HTTP defaults.
 */
export function localImageJson(url, { method = 'POST', body, signal } = {}, {
  connectMs = 5000, headersMs = 600000, bodyMs = 15000, totalMs = 620000, maxBytes = 1048576,
} = {}) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
      if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password || target.search || target.hash || target.pathname !== '/image/generate') throw new Error('Invalid local image destination');
      for (const n of [connectMs, headersMs, bodyMs, totalMs, maxBytes]) if (!Number.isSafeInteger(n) || n < 1) throw new Error('Invalid local image budget');
      if (totalMs > 660000 || headersMs > totalMs || maxBytes > 1048576) throw new Error('Local image budget exceeds limit');
      if (method !== 'POST' || typeof body !== 'string') throw new Error('Invalid local image request');
      if (signal?.aborted) throw Object.assign(new Error('Local image wait cancelled; server may continue if dispatched'), {code:'ABORT_ERR'});
    } catch (error) { reject(error); return; }
    let request, response, settled = false, connectTimer, headerTimer, bodyTimer;
    const clear = () => { for (const t of [connectTimer, headerTimer, bodyTimer, totalTimer]) clearTimeout(t); signal?.removeEventListener('abort', abort); };
    const finish = (error, result) => {
      if (settled) return; settled = true; clear();
      if (error) { response?.destroy(); request?.destroy(); reject(error); } else resolve(result);
    };
    const deadline = kind => finish(Object.assign(new Error(`Local image ${kind} deadline exceeded; do not automatically regenerate`), {code:'LOCAL_IMAGE_TIMEOUT',phase:kind}));
    const abort = () => finish(Object.assign(new Error('Local image wait cancelled; server may continue'), {code:'ABORT_ERR'}));
    const totalTimer = setTimeout(() => deadline('total'), totalMs);
    connectTimer = setTimeout(() => deadline('connect'), connectMs);
    signal?.addEventListener('abort', abort, {once:true});
    request = http.request(target, {method:'POST',agent:false,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}}, res => {
      response=res; clearTimeout(headerTimer); clearTimeout(connectTimer);
      const chunks=[]; let bytes=0;
      const bodyDeadline = () => {clearTimeout(bodyTimer);bodyTimer=setTimeout(()=>deadline('body'),bodyMs);};
      bodyDeadline();
      res.on('data', chunk => {bytes+=chunk.length;if(bytes>maxBytes){finish(new Error('Local image response exceeds limit'));return;}chunks.push(chunk);bodyDeadline();});
      res.on('aborted',()=>finish(new Error('Local image response interrupted')));
      res.on('error',error=>finish(error));
      res.on('end',()=>{try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));finish(null,{ok:res.statusCode>=200&&res.statusCode<300,status:res.statusCode,json:async()=>data});}catch{finish(new Error('Invalid local image JSON response'));}});
    });
    request.on('socket', socket => socket.once('connect',()=>{clearTimeout(connectTimer);headerTimer=setTimeout(()=>deadline('headers'),headersMs);}));
    request.on('error',error=>finish(error));
    if (signal?.aborted) {abort();return;}
    request.end(body);
  });
}
