import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sqlite3 from 'sqlite3';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SERVER = path.join(REPO, 'backend/server.js');
const cleanup = [];
const mk = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); cleanup.push(d); return d; };
after(() => { for (const d of cleanup) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

function runServer(root, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SERVER], { cwd: REPO, env: {
      PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: mk('agnt-ready-home-'), TMPDIR: mk('agnt-ready-tmp-'),
      USER_DATA_PATH: root, PORT: '0', BIND_HOST: '127.0.0.1',
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', timedOut = false;
    p.stdout.on('data', b => out += b); p.stderr.on('data', b => err += b);
    const timer = setTimeout(() => { timedOut = true; try { p.kill('SIGKILL'); } catch {} }, timeoutMs);
    p.on('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, timedOut, out, err }); });
  });
}
function assertNoStartedEffects(r) {
  const all = r.out + '\n' + r.err;
  assert.doesNotMatch(all, /Master server listening/, 'listener must not start');
  assert.doesNotMatch(all, /Initializing plugins before spawning workflow process/, 'deferredInit must not start');
  assert.doesNotMatch(all, /Spawning workflow process|Workflow process spawned successfully|Starting workflow restart/, 'workflow child/restart must not start');
}
async function sqlite(file, sql) {
  await new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file);
    db.exec(sql, (e) => db.close(() => e ? reject(e) : resolve()));
  });
}

test('D-RV-4: connection-open failure exits deterministically before listener/deferred/workflow start', async () => {
  const root = mk('agnt-ready-open-');
  const data = path.join(root, 'Data'); fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(path.join(data, 'agnt.db'));
  const r = await runServer(root);
  assert.equal(r.timedOut, false, 'connection failure must settle, not hang');
  assert.equal(r.code, 1, `expected exact exit 1, signal=${r.signal}\n${r.out}\n${r.err}`);
  assert.equal(r.signal, null);
  assert.match(r.out + r.err, /production boot aborted|SQLITE_CANTOPEN/);
  assertNoStartedEffects(r);
});

test('D-RV-4: schema-chain failure rejects readiness before listener/deferred/workflow start', async () => {
  const root = mk('agnt-ready-schema-');
  const data = path.join(root, 'Data'); fs.mkdirSync(data, { recursive: true });
  const dbFile = path.join(data, 'agnt.db');
  await sqlite(dbFile, 'CREATE TABLE seed(x); CREATE INDEX agents ON seed(x);');
  const r = await runServer(root);
  assert.equal(r.timedOut, false, `schema failure must settle, not leave a server alive\n${r.out}\n${r.err}`);
  assert.equal(r.code, 1, `expected exact exit 1, signal=${r.signal}\n${r.out}\n${r.err}`);
  assert.equal(r.signal, null);
  assert.match(r.out + r.err, /already an index named agents|schema/i);
  assertNoStartedEffects(r);
});
