import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once, EventEmitter } from 'node:events';
import { executeLifecycle, parseOptions } from './app-lifecycle.mjs';
import { selectTransport, startLocalControl, localRequest } from '../electron/localLifecycle.mjs';
import { createLocalRestartController } from '../electron/localRestartController.mjs';

it('Given Ghostty without token When auto selected Then use local; AGNT context never downgrades', () => {
  expect(selectTransport({})).toBe('local');
  expect(selectTransport({ token: 'fixture' })).toBe('api');
  expect(() => selectTransport({ managed: true })).toThrow(/TOKEN/);
  expect(() => selectTransport({ token: '' })).toThrow();
  expect(() => selectTransport({ mode: 'local', token: 'fixture' })).toThrow();
});
it('Given CLI options When transport and preflight requested Then preserve explicit intent', () => {
  expect(parseOptions(['restart','--transport','local','--preflight'])).toMatchObject({ transport: 'local', preflight: true });
});
it('Given owned child When restart requested Then wait for exit, fresh PID AND completed renderer load', async () => {
  const signals = []; const child = { pid: 10, kill: s => { signals.push(s); return true; } };
  const control = createLocalRestartController({ getChild: () => child, canRestart: () => true });
  const promise = control.restart(10);
  expect(signals).toEqual(['SIGTERM']);
  expect(control.exit(0, null)).toBe(42);
  const page = new EventEmitter(); page.isDestroyed = () => false;
  control.beforeRendererReload(page, 11);
  let complete = false; promise.then(() => { complete = true; });
  await Promise.resolve(); expect(complete).toBe(false);
  page.emit('did-finish-load');
  await expect(promise).resolves.toMatchObject({ pid: 11, previousPid: 10, frontendReloaded: true });
  expect(page.listenerCount('did-fail-load')).toBe(0);
});
it('Given hung owned child When deadline reached Then fail without a second signal', async () => {
  const signals=[]; const c=createLocalRestartController({getChild:()=>({pid:10,kill:s=>{signals.push(s);return true;}}),canRestart:()=>true,timeoutMs:10});
  await expect(c.restart(10)).rejects.toThrow(/deadline/);expect(signals).toEqual(['SIGTERM']);
});

async function fixture(fn) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'r-'));
  // Short, private runtime for Unix socket tests, not a real app location.
  const runtime=dir; const checkout=path.join(dir,'repo');await fs.mkdir(checkout);
  let pid=101, posts=0, localRestarts=0;
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.method==='POST'){posts++;if(req.headers.authorization!=='Bearer fixture'){res.statusCode=401;res.end('{}');return;}pid=102;res.statusCode=202;res.end('{"success":true}');return;}
    res.end(JSON.stringify(req.url==='/api/health'?{status:'OK',pid}:{state:'running',pid,uptimeMs:100}));
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  const local=await startLocalControl({checkout,runtime,getPid:()=>pid,restart:async old=>{localRestarts++;pid=102;return {pid,previousPid:old,frontendReloaded:true};}});
  const options={command:'restart',url:`http://127.0.0.1:${server.address().port}`,timeoutMs:1000,requestTimeoutMs:200,pollMs:5};
  const dependencies={checkout,inspect:async()=>({verified:true,checkout,supervisorPid:process.pid,supervisorStart:'100'}),localControl:args=>localRequest({...args,runtime})};
  try{await fn({options,dependencies,counts:()=>({posts,localRestarts}),local,runtime,checkout});}
  finally{await local.close();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
}
it('Given external terminal with no token When restart runs Then local control succeeds with zero HTTP POSTs',async()=>{
  await fixture(async({options,dependencies,counts})=>{
    const result=await executeLifecycle(options,dependencies);
    expect(result).toMatchObject({success:true,pid:102,previousPid:101,transport:'local',frontendReloaded:true});
    expect(counts()).toEqual({posts:0,localRestarts:1});
  });
});
it('Given AGNT injected token When restart runs Then exactly one API POST and no local request',async()=>{
  await fixture(async({options,dependencies,counts})=>{
    const result=await executeLifecycle(options,{...dependencies,token:'fixture',managed:true});
    expect(result).toMatchObject({success:true,pid:102,transport:'api'});
    expect(counts()).toEqual({posts:1,localRestarts:0});expect(JSON.stringify(result)).not.toContain('fixture');
  });
});
it('Given rejected API token When restart runs Then never fall back to local control',async()=>{
  await fixture(async({options,dependencies,counts})=>{
    await expect(executeLifecycle(options,{...dependencies,token:'invalid'})).rejects.toThrow(/401/);
    expect(counts()).toEqual({posts:1,localRestarts:0});
  });
});
it('Given rebuild preflight When local control available Then no restart side effect occurs',async()=>{
  await fixture(async({options,dependencies,counts})=>{
    expect(await executeLifecycle({...options,preflight:true},dependencies)).toMatchObject({success:true,preflight:true,transport:'local'});
    expect(counts()).toEqual({posts:0,localRestarts:0});
  });
});
it('Given wrong checkout identity When local request sent Then no restart occurs',async()=>{
  await fixture(async({dependencies,counts,checkout,runtime})=>{
    await expect(localRequest({checkout,runtime,supervisorPid:process.pid,pid:999,operation:'restart'})).rejects.toThrow(/refused/);
    expect(counts()).toEqual({posts:0,localRestarts:0});
  });
});
it('Given active local socket When another listener starts Then never replace it',async()=>{
  await fixture(async({checkout,runtime,local})=>{
    const before=await fs.lstat(local.address.socket);
    await expect(startLocalControl({checkout,runtime,getPid:()=>101,restart:async()=>({})})).rejects.toThrow();
    const after=await fs.lstat(local.address.socket);expect(after.ino).toBe(before.ino);
  });
});
it('Given failed renderer load When local recovery waits Then never report success',async()=>{
  const c=createLocalRestartController({getChild:()=>({pid:10,kill:()=>true}),canRestart:()=>true});
  const p=c.restart(10);c.exit(0,null);const page=new EventEmitter();page.isDestroyed=()=>false;
  c.beforeRendererReload(page,11);page.emit('did-fail-load',{},-1,'fixture','fixture',true);
  await expect(p).rejects.toThrow(/Renderer/);expect(page.listenerCount('did-finish-load')).toBe(0);
});
it('Given unsafe socket permissions When terminal connects Then reject before control',async()=>{
  await fixture(async({options,dependencies,local,counts})=>{
    await fs.chmod(local.address.socket,0o666);
    await expect(executeLifecycle(options,dependencies)).rejects.toThrow(/unavailable/);
    expect(counts()).toEqual({posts:0,localRestarts:0});
  });
});
