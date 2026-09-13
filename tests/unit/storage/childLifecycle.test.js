// PR145 Stage C (STAGED COPY — not applied) — tests/unit/storage/childLifecycle.test.js
// R08/R09/S7: shared synthetic parent/child over real SQLite, explicit APIs only.
// Self-provisioning (R01 direct test entry): this node:test process admits its
// own storage before spawning children; no ambient env authority anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sqlite3 from 'sqlite3';
import { initializeTestStorage, admitTestRoot, getStorageContext } from '../../../backend/src/utils/testStorageContext.js';
import { sharedStoreChildEnv, CHILD_STORE_ENV } from '../../../backend/src/utils/syntheticChild.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../../..');
const CHILD = path.join(here, 'childLifecycle.child.mjs');
const PRELOAD = path.join(REPO, 'backend/src/utils/syntheticChild.mjs');

// Parent admission (launcher-owned decision for a direct node:test entry).
const setup = initializeTestStorage();
const sharedRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'agnt-child-shared-'));
admitTestRoot(sharedRoot);

fs.mkdirSync(path.join(sharedRoot, 'Data'), { recursive: true });
const q = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));
const db = new sqlite3.Database(path.join(sharedRoot, 'Data', 'agnt.db'));

function runChild(args, env, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, {
      cwd: REPO,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, timeoutMs);
    p.stdout.on('data', (b) => (out += b));
    p.stderr.on('data', (b) => (err += b));
    p.on('exit', (code, signal) => { clearTimeout(t); resolve({ code, signal, out, err }); });
  });
}

test('parent writes A → shared child (explicit descriptor) reads A and writes B → parent reads B', async () => {
  await q(`CREATE TABLE IF NOT EXISTS markers (k TEXT PRIMARY KEY, v TEXT)`);
  await q(`INSERT OR REPLACE INTO markers (k, v) VALUES ('A','from-parent')`);

  const r = await runChild(
    ['--import', pathToFileURL(PRELOAD).href, CHILD, 'shared'],
    { NODE_ENV: 'test', ...sharedStoreChildEnv() },
  );
  assert.equal(r.code, 0, 'shared child exited 0\nstdout: ' + r.out + '\nstderr: ' + r.err);
  const proof = JSON.parse(r.out.trim().split('\n').pop());
  assert.equal(proof.bootRole, 'attach');
  assert.equal(proof.sharedRoot, sharedRoot);
  assert.equal(proof.root, sharedRoot, 'child ACTIVE root is the shared root');
  assert.equal(proof.dataDir, path.join(sharedRoot, 'Data'));
  assert.equal(proof.markerA, 'from-parent');

  const b = await q(`SELECT v FROM markers WHERE k='B'`);
  assert.equal(b[0]?.v, 'from-child', 'parent reads child marker B from the shared store');
});

test('unrelated child (own admission) sees no parent rows and writes only to its own root', async () => {
  const r = await runChild([CHILD, 'own'], { NODE_ENV: 'test' });
  assert.equal(r.code, 0, 'own child exited 0\nstdout: ' + r.out + '\nstderr: ' + r.err);
  const proof = JSON.parse(r.out.trim().split('\n').pop());
  assert.equal(proof.seesMarkerTable, false, 'sibling sees no marker table');
  assert.notEqual(proof.root, sharedRoot);
  assert.equal(proof.sharedStore, null);
  const sib = await q(`SELECT v FROM markers WHERE k='SIBLING'`);
  assert.equal(sib.length, 0, 'unrelated child write did NOT land in the shared store');
});

test('stale lease: descriptor whose parent is dead is refused (STALE_LEASE), zero shared writes', async () => {
  // Forge a descriptor whose parentPid points at a process that has exited.
  const dead = spawn(process.execPath, ['-e', 'process.exit(0)']);
  await new Promise((r) => dead.on('exit', r));
  const forged = JSON.stringify({ root: sharedRoot, parentPid: dead.pid, runId: 'x', generation: 1, policy: 'parent-exit' });
  const before = (await q(`SELECT COUNT(*) AS n FROM markers`))[0].n;
  const r = await runChild(
    ['--import', pathToFileURL(PRELOAD).href, CHILD, 'shared'],
    { NODE_ENV: 'test', [CHILD_STORE_ENV]: forged },
  );
  assert.notEqual(r.code, 0, 'child with stale lease must fail');
  assert.ok(/STALE_LEASE|shared-store lease/i.test(r.err + r.out), 'failure names the stale lease');
  const after = (await q(`SELECT COUNT(*) AS n FROM markers`))[0].n;
  assert.equal(after, before, 'no shared-store write happened through the stale lease');
});

test('descriptor is single-use: adoption removes the env var (no re-adoption authority)', async () => {
  const r = await runChild(
    ['--import', pathToFileURL(PRELOAD).href, '-e',
     `const m = await import(${JSON.stringify(pathToFileURL(PRELOAD).href)});`
     + `console.log('env-after-import=' + (process.env[${JSON.stringify(CHILD_STORE_ENV)}] === undefined));`],
    { NODE_ENV: 'test', ...sharedStoreChildEnv() },
  );
  assert.equal(r.code, 0, 'preload child exited 0\n' + r.err);
  assert.ok(r.out.includes('env-after-import=true'), 'descriptor env removed after adoption: ' + r.out);
});

test('parent context stays valid and shared root intact across the whole lifecycle', () => {
  const ctx = getStorageContext();
  assert.equal(ctx.root, sharedRoot);
  assert.equal(ctx.bootRole, 'owner');
  assert.ok(fs.existsSync(path.join(sharedRoot, 'Data', 'agnt.db')));
});
