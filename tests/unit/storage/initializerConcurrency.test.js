import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DB_URL = pathToFileURL(path.join(REPO, 'backend/src/models/database/index.js')).href;
const cleanup = [];
after(() => { for (const d of cleanup) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });
const mk = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); cleanup.push(d); return d; };
const MARK = '##PROOF## ';
function run(script, root) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['-e', script], { cwd: REPO,
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: mk('agnt-init-home-'), TMPDIR: mk('agnt-init-tmp-'), USER_DATA_PATH: root },
      stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', b => out += b); p.stderr.on('data', b => err += b);
    p.on('exit', (code, signal) => {
      const line = out.split('\n').filter(x => x.startsWith(MARK)).pop();
      resolve({ code, signal, out, err, proof: line ? JSON.parse(line.slice(MARK.length)) : null });
    });
  });
}
const proof = (expr) => `console.log(${JSON.stringify(MARK)}+JSON.stringify(${expr}));`;
const policy = `{schema:false,widgetDedupe:false,staleRunSweep:'all-running',webhookSync:false,imageBackfill:false,walCheckpoint:false}`;

test('D-RV-3: concurrent and sequential identical initialization joins one execution', async () => {
  const root = mk('agnt-init-same-');
  const r = await run(`
    const m=await import(${JSON.stringify(DB_URL)}); await m.dbReady;
    let statements=0; const orig=m.default.run.bind(m.default);
    m.default.run=function(sql,...args){if(String(sql).includes("UPDATE agent_executions"))statements++;return orig(sql,...args)};
    const a=m.initializeApplicationStorage(null,${policy});
    const b=m.initializeApplicationStorage(null,${policy});
    const samePromise=a===b; const [ra,rb]=await Promise.all([a,b]);
    const c=m.initializeApplicationStorage(null,${policy}); const sameAfter=c===a; await c;
    ${proof('{samePromise,sameAfter,statements,ra,rb}')}
  `, root);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(r.proof.samePromise, true, 'same in-flight call returns the same promise');
  assert.equal(r.proof.sameAfter, true, 'settled call returns the same sticky promise');
  assert.equal(r.proof.statements, 1, 'maintenance executes once');
  assert.deepEqual(r.proof.ra, r.proof.rb);
});

test('D-RV-3: conflicting policy rejects while first initialization remains authoritative', async () => {
  const root = mk('agnt-init-conflict-');
  const r = await run(`
    const m=await import(${JSON.stringify(DB_URL)}); await m.dbReady;
    const first=m.initializeApplicationStorage(null,${policy});
    let conflict=null; try{await m.initializeApplicationStorage(null,{...${policy},staleRunSweep:'none'})}catch(e){conflict=e.message}
    await first; ${proof('{conflict}')}
  `, root);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.proof.conflict, /conflicting boot policy/);
});

test('D-RV-3: initialization failure is sticky and is not automatically retried', async () => {
  const root = mk('agnt-init-failure-');
  const data = path.join(root, 'Data'); fs.mkdirSync(data, { recursive: true });
  await new Promise((resolve, reject) => {
    import('sqlite3').then(({ default: sqlite3 }) => {
      const db = new sqlite3.Database(path.join(data, 'agnt.db'));
      db.exec('CREATE TABLE seed(x); CREATE INDEX agents ON seed(x);', (e) => db.close(() => e ? reject(e) : resolve()));
    }, reject);
  });
  const r = await run(`
    const m=await import(${JSON.stringify(DB_URL)});
    const cfg={schema:false,widgetDedupe:false,staleRunSweep:'none',webhookSync:false,imageBackfill:false,walCheckpoint:false};
    const p1=m.initializeApplicationStorage(null,cfg);
    const p2=m.initializeApplicationStorage(null,cfg);
    let e1=null,e2=null;try{await p1}catch(e){e1=e.message} try{await p2}catch(e){e2=e.message}
    const p3=m.initializeApplicationStorage(null,cfg); try{await p3}catch(e){}
    ${proof('{same12:p1===p2,same13:p1===p3,e1,e2}')}
  `, root);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(r.proof.same12, true);
  assert.equal(r.proof.same13, true, 'failed initialization remains memoized; no retry promise is created');
  assert.match(r.proof.e1, /already an index named agents/);
  assert.equal(r.proof.e2, r.proof.e1);
});
