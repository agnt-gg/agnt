// PR145 section D — tests/unit/storage/preopenAliases.native.test.js
// (R05/S4 native half; complements preopenSafety.test.js, which proves the
// same ORDERING with mocked fs inside a vm harness).
//
// REAL-FILESYSTEM negatives, one fresh child process per case: a native
// symlink / hardlink / FIFO is planted on the admitted Data directory, the
// database file, or a sidecar BEFORE the database module is imported. The
// requirement under test: the alias is refused BEFORE the SQLite constructor,
// any PRAGMA, or any write — and the refusal itself has zero effects on the
// forbidden target (a synthetic canary file with known bytes, never a real
// database).
//
// Positive control: the same import on a clean root boots the real schema and
// performs a native write/readback (R07) — proving these refusals are the
// guards working, not "import fails on any filesystem weirdness".
// Load-bearing control: the canary file is provably writable through plain
// sqlite3 — so a symlink refusal is the ONLY thing preventing writes through
// the alias (oracle sensitivity, R12: a removed guard flips a real test).
//
// Honest env limit: a character-device alias needs CAP_MKNOD; when mknod is
// unavailable the device case reports an explicit skip (never silently
// dropped, never counted as pass).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BASE = fs.realpathSync(os.tmpdir());
const CTX_URL = pathToFileURL(path.join(REPO, 'backend/src/utils/testStorageContext.js')).href;
const DB_URL = pathToFileURL(path.join(REPO, 'backend/src/models/database/index.js')).href;

const cleanup = [];
const mk = (prefix) => { const d = fs.mkdtempSync(path.join(BASE, prefix)); cleanup.push(d); return d; };
after(() => { for (const d of cleanup) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const MARK = '##PROOF## ';
function runChild(script, { env, timeoutMs = 90000 } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['-e', script], {
      cwd: REPO,
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '', killed = false;
    const t = setTimeout(() => { killed = true; try { p.kill('SIGKILL'); } catch {} }, timeoutMs);
    p.stdout.on('data', (b) => (out += b));
    p.stderr.on('data', (b) => (err += b));
    p.on('exit', (code, signal) => {
      clearTimeout(t);
      const proofs = out.split('\n').filter((l) => l.startsWith(MARK)).map((l) => { try { return JSON.parse(l.slice(MARK.length)); } catch { return { parseError: l }; } });
      resolve({ code, signal, killed, out, err, proof: proofs[proofs.length - 1] || null });
    });
  });
}
const P = (o) => 'console.log(' + JSON.stringify(MARK) + '+JSON.stringify(' + o + '));';
const ADMIT = `const t = await import(${JSON.stringify(CTX_URL)}); const c = t.initializeTestStorage();`;
// Node 26 has no fs.mkfifoSync — use the coreutils binary (absolute path, no
// PATH lookup). If mkfifo is absent the FIFO cases fail loudly rather than
// silently degrading into regular-file cases.
const MKFIFO = `const execSync=(await import('node:child_process')).execSync; const mkfifo=(p)=>execSync('/usr/bin/mkfifo '+JSON.stringify(p),{stdio:'pipe'});`;

// Child template: admit → plant the alias (case JS) → import the REAL db
// module → report refused/opened. Refusal is caught so the child exits 0 and
// prints structured proof; the PARENT asserts on the proof (an uncaught
// module-evaluation throw would also be a valid refusal signal but loses the
// structured evidence).
function aliasChild(plantJs) {
  return ADMIT + ' ' + MKFIFO + ' ' + plantJs + ' '
    + ` try { const db = await import(${JSON.stringify(DB_URL)}); await db.dbReady; ${P(`{refused:false, root:c.root}`)} }`
    + ` catch (e) { ${P(`{refused:true, msg:String(e && e.message), root:c.root}`)} }`;
}
const canaryBytes = () => Buffer.from('FORBIDDEN-CANARY-' + Math.random().toString(36).slice(2) + '-ROWS');

async function refusedCase(name, plantJs, { expectMsg, canaryPath, noProbeDir } = {}) {
  const parent = mk('agnt-alias-');
  const canary = canaryPath ? path.join(parent, 'forbidden-' + Math.random().toString(36).slice(2) + '.db') : null;
  const bytes = canaryBytes();
  if (canary) fs.writeFileSync(canary, bytes);
  const r = await runChild(aliasChild(plantJs(canary)), { env: { TMPDIR: parent, NODE_ENV: 'test' } });
  assert.ok(!r.killed, name + ': child must not hang (deadline 90s)');
  assert.equal(r.code, 0, name + ': child exited 0 with proof\nstdout: ' + r.out + '\nstderr: ' + r.err);
  assert.equal(r.proof.refused, true, name + ': the import must REFUSE');
  assert.match(r.proof.msg, expectMsg, name + ': refusal reason');
  if (canary) {
    assert.deepEqual(fs.readFileSync(canary), bytes, name + ': forbidden canary byte-identical');
    assert.equal(fs.existsSync(canary + '-wal'), false, name + ': no -wal created next to the canary');
    assert.equal(fs.existsSync(canary + '-shm'), false, name + ': no -shm created next to the canary');
  }
  if (noProbeDir) {
    const probes = fs.readdirSync(noProbeDir).filter((n) => n.startsWith('.probe-'));
    assert.deepEqual(probes, [], name + ': no write-probe file left in the refused target');
  }
  // No fallback database anywhere else in the private parent:
  const fall = fs.readdirSync(parent).filter((n) => n.endsWith('agnt.db') || n === 'Data');
  assert.deepEqual(fall, [], name + ': no fallback db/Data created outside the admitted root');
  return r.proof.root;
}

test('R05-native A1: Data directory replaced by a symlink is refused BEFORE the write probe', async () => {
  const parent = mk('agnt-a1-src-'); // holds the symlink target
  await refusedCase('A1',
    (canary) => `const fs=(await import('node:fs')),path=(await import('node:path'));`
      + `fs.mkdirSync(${JSON.stringify(parent)},{recursive:true});`
      + `fs.symlinkSync(${JSON.stringify(parent)}, path.join(c.root,'Data'));`,
    { expectMsg: /not a real directory|through a symlink/, noProbeDir: parent });
});

test('R05-native A2: dbPath is a symlink to a forbidden canary — refused before the constructor, canary untouched', async () => {
  await refusedCase('A2',
    (canary) => `const fs=(await import('node:fs')),path=(await import('node:path'));`
      + `fs.mkdirSync(path.join(c.root,'Data'),{recursive:true});`
      + `fs.symlinkSync(${JSON.stringify(canary)}, path.join(c.root,'Data','agnt.db'));`,
    { expectMsg: /alias refused/, canaryPath: true });
});

test('R05-native A3: dbPath is a HARDLINK to a forbidden canary (nlink=2) — refused, canary untouched', async () => {
  await refusedCase('A3',
    (canary) => `const fs=(await import('node:fs')),path=(await import('node:path'));`
      + `fs.mkdirSync(path.join(c.root,'Data'),{recursive:true});`
      + `fs.linkSync(${JSON.stringify(canary)}, path.join(c.root,'Data','agnt.db'));`,
    { expectMsg: /alias refused/, canaryPath: true });
});

test('R05-native A4: dbPath is a FIFO — refused (non-regular file), FIFO left in place', async () => {
  const root = await refusedCase('A4',
    () => `const fs=(await import('node:fs')),path=(await import('node:path'));`
      + `fs.mkdirSync(path.join(c.root,'Data'),{recursive:true});`
      + `mkfifo(path.join(c.root,'Data','agnt.db'));`,
    { expectMsg: /alias refused/ });
  assert.equal(fs.statSync(path.join(root, 'Data', 'agnt.db')).isFIFO(), true, 'refusal must not delete the FIFO (zero effects)');
});

test('R05-native A5: -wal sidecar is a symlink to a canary — refused, canary untouched', async () => {
  await refusedCase('A5',
    (canary) => `const fs=(await import('node:fs')),path=(await import('node:path'));`
      + `fs.mkdirSync(path.join(c.root,'Data'),{recursive:true});`
      + `fs.symlinkSync(${JSON.stringify(canary)}, path.join(c.root,'Data','agnt.db-wal'));`,
    { expectMsg: /alias refused/, canaryPath: true });
});

test('R05-native A6: -shm sidecar is a hardlink (nlink=2) — refused', async () => {
  await refusedCase('A6',
    (canary) => `const fs=(await import('node:fs')),path=(await import('node:path'));`
      + `fs.mkdirSync(path.join(c.root,'Data'),{recursive:true});`
      + `fs.linkSync(${JSON.stringify(canary)}, path.join(c.root,'Data','agnt.db-shm'));`,
    { expectMsg: /alias refused/, canaryPath: true });
});

test('R05-native A7: -journal sidecar is a FIFO — refused', async () => {
  await refusedCase('A7',
    () => `const fs=(await import('node:fs')),path=(await import('node:path'));`
      + `fs.mkdirSync(path.join(c.root,'Data'),{recursive:true});`
      + `mkfifo(path.join(c.root,'Data','agnt.db-journal'));`,
    { expectMsg: /alias refused/ });
});

test('R05-native A8: ancestor component on the admitted path is a symlink → typed ALIAS at admission, zero effects', async () => {
  const parent = mk('agnt-a8-');
  const realB = mk('agnt-a8-realb-');
  const realA = path.join(parent, 'realA');
  fs.mkdirSync(realA);
  fs.symlinkSync(realB, path.join(realA, 'symB'));
  const r = await runChild(
    ADMIT + ` try { t.admitTestRoot(${JSON.stringify(path.join(realA, 'symB'))}); ${P('{refused:false}')} }`
      + ` catch (e) { ${P(`{refused:true, code:e.code, msg:String(e && e.message)}`)} }`,
    { env: { TMPDIR: parent, NODE_ENV: 'test' } });
  assert.equal(r.code, 0, 'child exited 0 with proof\n' + r.out + r.err);
  assert.equal(r.proof.refused, true, 'admitTestRoot must refuse a symlinked component');
  assert.equal(r.proof.code, 'AGNT_TEST_STORAGE_ALIAS');
  assert.deepEqual(fs.readdirSync(realB), [], 'zero effects in the symlink target');
});

// Device alias: honest env-limited case (needs CAP_MKNOD).
test('R05-native A9: dbPath is a character device — refused (skip with reason when mknod is unavailable)', async (t) => {
  const parent = mk('agnt-a9-');
  const r = await runChild(
    ADMIT + ' ' + MKFIFO + ' '
      + ` (await import('node:fs')).mkdirSync((await import('node:path')).join(c.root,'Data'),{recursive:true});`
      + ` let mknod='ok';`
      + ` try { (await import('node:child_process')).execSync('/usr/bin/mknod '+JSON.stringify((await import('node:path')).join(c.root,'Data','agnt.db'))+' c 1 3',{stdio:'pipe'}); }`
      + ` catch (e) { mknod = (e && e.status !== undefined && e.status !== null) ? ('exit ' + e.status) : ('error: ' + String((e && e.stderr || '') + '').slice(0, 60) || String(e && e.message).slice(0, 60)); }`
      + ` if (mknod !== 'ok') { ${P(`{mknod, refused:null}`)} } else {`
      + ` try { const db = await import(${JSON.stringify(DB_URL)}); await db.dbReady; ${P(`{mknod, refused:false, root:c.root}`)} }`
      + ` catch (e) { ${P(`{mknod, refused:true, msg:String(e && e.message), root:c.root}`)} } }`,
    { env: { TMPDIR: parent, NODE_ENV: 'test' } });
  assert.equal(r.code, 0, 'child exited 0 with proof\n' + r.out + '\n' + r.err);
  assert.ok(r.proof && typeof r.proof.mknod === 'string', 'structured mknod status required');
  if (r.proof.mknod !== 'ok') {
    t.skip('mknod unavailable on this platform/jail (' + r.proof.mknod + ') — device-node alias case stays OPEN, not passed');
    return;
  }
  assert.equal(r.proof.refused, true, 'device alias must be refused');
  assert.match(r.proof.msg, /alias refused/);
});

test('R05-native P1 (positive): clean root → real schema boot + native write/readback (R07)', async () => {
  const parent = mk('agnt-a-p1-');
  const r = await runChild(
    ADMIT + ` const db = await import(${JSON.stringify(DB_URL)}); await db.dbReady;`
      + ` const sqlite3=(await import('sqlite3')).default || (await import('sqlite3'));`
      + ` const p=(await import('node:path')).join(c.root,'Data','agnt.db');`
      + ` const s=new sqlite3.Database(p);`
      + ` await new Promise((res,rej)=>s.run('CREATE TABLE IF NOT EXISTS native_probe(k TEXT PRIMARY KEY,v TEXT)',e=>e?rej(e):res()));`
      + ` await new Promise((res,rej)=>s.run("INSERT OR REPLACE INTO native_probe VALUES('k1','native-roundtrip')",e=>e?rej(e):res()));`
      + ` const row=await new Promise((res,rej)=>s.get("SELECT v FROM native_probe WHERE k='k1'",(e,r2)=>e?rej(e):res(r2)));`
      + ` await new Promise((res)=>s.close(res));`
      + P(`{root:c.root, dbPath:p, dbExists:(await import('node:fs')).existsSync(p), row:row && row.v}`),
    { env: { TMPDIR: parent, NODE_ENV: 'test' } });
  assert.equal(r.code, 0, 'positive child exited 0\nstdout: ' + r.out + '\nstderr: ' + r.err);
  assert.equal(r.proof.dbExists, true);
  assert.equal(r.proof.row, 'native-roundtrip', 'native write→readback through a second real connection');
  const st = fs.lstatSync(path.join(r.proof.root, 'Data', 'agnt.db'));
  assert.equal(st.isFile() && st.nlink, 1, 'the real database is a plain single-link regular file');
});

test('R05-native C1 (load-bearing): the canary file is writable through plain sqlite — the alias guard is the only barrier', async () => {
  const parent = mk('agnt-a-c1-');
  const canary = path.join(parent, 'canary-writable.db');
  const r = await runChild(
    ` const sqlite3=(await import('sqlite3')).default || (await import('sqlite3'));`
      + ` const s=new sqlite3.Database(${JSON.stringify(canary)});`
      + ` await new Promise((res,rej)=>s.run('CREATE TABLE t(x)',e=>e?rej(e):res()));`
      + ` await new Promise((res,rej)=>s.run('INSERT INTO t VALUES (42)',e=>e?rej(e):res()));`
      + ` await new Promise((res)=>s.close(res));`
      + P(`{wrote:(await import('node:fs')).existsSync(${JSON.stringify(canary)})}`),
    { env: { TMPDIR: parent, NODE_ENV: 'test' } });
  assert.equal(r.code, 0, 'control child exited 0\n' + r.out + r.err);
  assert.equal(r.proof.wrote, true, 'plain sqlite CAN create/write the canary file — A2/A3/A5 refusals are load-bearing');
});
