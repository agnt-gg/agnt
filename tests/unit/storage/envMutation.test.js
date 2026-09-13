// PR145 section D — tests/unit/storage/envMutation.test.js (R04/S3/S8).
//
// REAL-BEHAVIOR TEST, fresh child process per case (no vm, no mocks): each
// child admits synthetic storage under its OWN private tmpdir parent, mutates
// the environment exactly as the threat table allows, then imports the REAL
// PathManager / database module. Asserted behavior (the requirement, not the
// current bug):
//   • Test-mode storage resolution reads NO environment variable (D1): a
//     contaminated parent env, a post-setup override, or a post-setup
//     deletion of USER_DATA_PATH / __AGNT_TEST_DATA_DIR / TMPDIR / HOME can
//     never select, re-home or escape the admitted synthetic root.
//   • AGNT_HOME and AGNT_TEST_USE_REAL_DATA are refused LOUDLY in test mode.
//   • An escape decoy outside the admitted parent is never written.
//   • ORACLE SENSITIVITY (mutant control): in PRODUCTION mode the same
//     USER_DATA_PATH env IS honored (tier 'electron') — proving this test
//     detects env-driven selection whenever it exists. If test-mode
//     resolution ever regressed to env-driven, the positive/override cases
//     below would fail.
//   • FAIL-CLOSED control: test mode with NO admission refuses (no fallback).
//
// Every decoy is a synthetic directory created by this file — no real home,
// config, credential or daily path is ever read or written.
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
const PM_URL = pathToFileURL(path.join(REPO, 'backend/src/utils/PathManager.js')).href;
const DB_URL = pathToFileURL(path.join(REPO, 'backend/src/models/database/index.js')).href;

const cleanup = [];
const mk = (prefix) => { const d = fs.mkdtempSync(path.join(BASE, prefix)); cleanup.push(d); return d; };
after(() => { for (const d of cleanup) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const MARK = '##PROOF## ';
function runChild(script, { env, timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['-e', script], {
      cwd: REPO,
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    let killed = false;
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

// Shared child prelude: private tmpdir parent comes from the spawned env
// (TMPDIR), so the frozen admitted parent is private to this child.
const ADMIT = `const t = await import(${JSON.stringify(CTX_URL)}); const c = t.initializeTestStorage();`;

// ── P1 positive: clean admission resolves context-only, decoy HOME inert ──
test('R04 P1: clean test process resolves root/Data from the context only; decoy HOME never used', async () => {
  const parent = mk('agnt-env-p1-'); const home = mk('agnt-env-p1-home-');
  const r = await runChild(
    ADMIT + ` const pm = await import(${JSON.stringify(PM_URL)});`
      + P(`{root:c.root, dataDir:pm.default.getDataDir(), source:pm.default.getDataDirSource(), homeRead:(await import('node:os')).homedir()}`),
    { env: { TMPDIR: parent, NODE_ENV: 'test', HOME: home } });
  assert.equal(r.code, 0, 'child exited 0\nstdout: ' + r.out + '\nstderr: ' + r.err);
  assert.equal(r.proof.source, 'test-context');
  assert.equal(r.proof.dataDir, path.join(r.proof.root, 'Data'));
  assert.ok(r.proof.root.startsWith(parent + path.sep), 'root under the private parent');
  assert.equal(fs.readdirSync(home).length, 0, 'decoy HOME untouched');
});

// ── N1: post-setup OVERRIDE of every legacy selector cannot re-home ────────
test('R04 N1: post-setup USER_DATA_PATH/__AGNT_TEST_DATA_DIR/HOME/TMPDIR overrides are inert', async () => {
  const parent = mk('agnt-env-n1-'); const decoy = mk('agnt-env-n1-decoy-');
  const r = await runChild(
    ADMIT
      + ` process.env.USER_DATA_PATH=${JSON.stringify(decoy)};`
      + ` process.env.__AGNT_TEST_DATA_DIR=${JSON.stringify(decoy)};`
      + ` process.env.HOME=${JSON.stringify(decoy)};`
      + ` process.env.TMPDIR=${JSON.stringify(decoy)};`
      + ` const pm = await import(${JSON.stringify(PM_URL)});`
      + P(`{root:c.root, dataDir:pm.default.getDataDir(), source:pm.default.getDataDirSource()}`),
    { env: { TMPDIR: parent, NODE_ENV: 'test', HOME: mk('agnt-env-n1-home-') } });
  assert.equal(r.code, 0, 'child exited 0\nstdout: ' + r.out + '\nstderr: ' + r.err);
  assert.equal(r.proof.source, 'test-context');
  assert.equal(r.proof.dataDir, path.join(r.proof.root, 'Data'));
  assert.ok(r.proof.root.startsWith(parent + path.sep), 'still the admitted root, not the decoy');
  const stray = fs.readdirSync(decoy).filter((n) => n === 'Data' || n === '.agnt' || n === 'agnt.db');
  assert.deepEqual(stray, [], 'decoy contains no storage artifacts');
});

// ── N1-native: the real database open follows the context, not the env ─────
test('R04 N1-native: native SQLite opens on the admitted root after env override (dbReady resolves, decoys clean)', async () => {
  const parent = mk('agnt-env-n1n-'); const decoy = mk('agnt-env-n1n-decoy-');
  const r = await runChild(
    ADMIT
      + ` process.env.USER_DATA_PATH=${JSON.stringify(decoy)};`
      + ` const db = await import(${JSON.stringify(DB_URL)}); await db.dbReady;`
      + P(`{root:c.root, dbPath:(await import('node:path')).join(c.root,'Data','agnt.db'), dbExists:(await import('node:fs')).existsSync((await import('node:path')).join(c.root,'Data','agnt.db'))}`),
    { env: { TMPDIR: parent, NODE_ENV: 'test' }, timeoutMs: 90000 });
  assert.equal(r.code, 0, 'child exited 0\nstdout: ' + r.out + '\nstderr: ' + r.err);
  assert.equal(r.proof.dbExists, true, 'agnt.db created under the admitted root');
  assert.equal(fs.existsSync(path.join(decoy, 'Data')), false, 'no Data/ in the decoy');
  assert.equal(fs.existsSync(path.join(decoy, 'agnt.db')), false, 'no agnt.db in the decoy');
});

// ── N2: post-setup DELETION of the mirrors cannot unpin resolution ─────────
test('R04 N2: deleting USER_DATA_PATH/__AGNT_TEST_DATA_DIR/TMPDIR after admission changes nothing', async () => {
  const parent = mk('agnt-env-n2-');
  const r = await runChild(
    ADMIT
      + ` delete process.env.USER_DATA_PATH; delete process.env.__AGNT_TEST_DATA_DIR;`
      + ` const hadTmpdir = !!process.env.TMPDIR; delete process.env.TMPDIR;`
      + ` const pm = await import(${JSON.stringify(PM_URL)});`
      + P(`{root:c.root, dataDir:pm.default.getDataDir(), hadTmpdir}`),
    { env: { TMPDIR: parent, NODE_ENV: 'test', USER_DATA_PATH: mk('agnt-env-n2-mirror-') } });
  assert.equal(r.code, 0, 'child exited 0\nstdout: ' + r.out + '\nstderr: ' + r.err);
  assert.equal(r.proof.hadTmpdir, true);
  assert.equal(r.proof.dataDir, path.join(r.proof.root, 'Data'));
});

// ── N3: AGNT_HOME in a test process is refused loudly (never silently) ─────
test('R04 N3: AGNT_HOME at PathManager import is a loud typed refusal with zero effects', async () => {
  const parent = mk('agnt-env-n3-'); const decoy = mk('agnt-env-n3-decoy-');
  const r = await runChild(
    ADMIT + ` process.env.AGNT_HOME=${JSON.stringify(decoy)};`
      + ` try { await import(${JSON.stringify(PM_URL)}); ${P(`{opened:true}`)} }`
      + ` catch (e) { ${P(`{opened:false, msg:String(e && e.message)}`)} }`,
    { env: { TMPDIR: parent, NODE_ENV: 'test' } });
  assert.equal(r.code, 0, 'child exited 0 (proof printed)\nstdout: ' + r.out + '\nstderr: ' + r.err);
  assert.equal(r.proof.opened, false, 'PathManager must refuse');
  assert.match(r.proof.msg, /AGNT_HOME is refused/, 'refusal names AGNT_HOME');
  assert.equal(fs.existsSync(path.join(decoy, '.agnt')), false, 'no .agnt created under the AGNT_HOME decoy');
});

// ── N4: the real-data escape switch is refused ─────────────────────────────
test('R04 N4: AGNT_TEST_USE_REAL_DATA=1 is refused before any resolution', async () => {
  const parent = mk('agnt-env-n4-');
  const r = await runChild(
    ` try { await import(${JSON.stringify(PM_URL)}); ${P(`{opened:true}`)} }`
      + ` catch (e) { ${P(`{opened:false, msg:String(e && e.message)}`)} }`,
    { env: { TMPDIR: parent, NODE_ENV: 'test', AGNT_TEST_USE_REAL_DATA: '1' } });
  assert.equal(r.code, 0, 'child exited 0 (proof printed)\nstdout: ' + r.out + '\nstderr: ' + r.err);
  assert.equal(r.proof.opened, false);
  assert.match(r.proof.msg, /real-data escape refused/);
});

// ── N5: escape decoy OUTSIDE the admitted parent (pre- and post-setup) ─────
test('R04 N5: USER_DATA_PATH pointing outside the parent (pre- and post-setup) never selects it', async () => {
  const parent = mk('agnt-env-n5-'); const escape = mk('agnt-env-n5-escape-');
  assert.ok(!escape.startsWith(parent + path.sep), 'fixture: escape dir is outside the child parent');
  const pre = await runChild(
    ADMIT + ` const pm = await import(${JSON.stringify(PM_URL)});`
      + P(`{root:c.root, dataDir:pm.default.getDataDir()}`),
    { env: { TMPDIR: parent, NODE_ENV: 'test', USER_DATA_PATH: escape } });
  assert.equal(pre.code, 0, 'pre-setup child exited 0\n' + pre.out + pre.err);
  assert.equal(pre.proof.dataDir, path.join(pre.proof.root, 'Data'), 'pre-setup env is inert');
  assert.ok(pre.proof.root.startsWith(parent + path.sep));
  const post = await runChild(
    ADMIT + ` process.env.USER_DATA_PATH=${JSON.stringify(escape)};`
      + ` const pm = await import(${JSON.stringify(PM_URL)});`
      + P(`{root:c.root, dataDir:pm.default.getDataDir()}`),
    { env: { TMPDIR: parent, NODE_ENV: 'test' } });
  assert.equal(post.code, 0, 'post-setup child exited 0\n' + post.out + post.err);
  assert.equal(post.proof.dataDir, path.join(post.proof.root, 'Data'), 'post-setup env is inert');
  assert.deepEqual(fs.readdirSync(escape), [], 'escape decoy untouched (no Data/, no agnt.db)');
});

// ── S1 oracle sensitivity: production mode HONORS USER_DATA_PATH ───────────
test('R04 S1 (oracle/mutant): production mode honors USER_DATA_PATH (electron tier) — this test detects env-driven selection', async () => {
  const prodRoot = mk('agnt-env-s1-prod-'); const home = mk('agnt-env-s1-home-');
  const r = await runChild(
    ` const pm = await import(${JSON.stringify(PM_URL)});`
      + P(`{source:pm.default.getDataDirSource(), rootDir:pm.default.getRootDir(), dataDir:pm.default.getDataDir()}`),
    { env: { TMPDIR: mk('agnt-env-s1-tmp-'), HOME: home, USER_DATA_PATH: prodRoot } }); // NO NODE_ENV, NO VITEST → production
  assert.equal(r.code, 0, 'production child exited 0\nstdout: ' + r.out + '\nstderr: ' + r.err);
  assert.equal(r.proof.source, 'electron', 'production tier IS env-driven by design');
  assert.equal(r.proof.rootDir, prodRoot);
  assert.equal(r.proof.dataDir, path.join(prodRoot, 'Data'));
  assert.ok(fs.existsSync(path.join(prodRoot, 'Data')), 'production tier created Data/ in the synthetic decoy (env honored)');
});

// ── S2 fail-closed: test mode without admission refuses, no fallback ───────
test('R04 S2 (fail-closed): test mode with NO admission refuses with the explicit-storage error', async () => {
  const parent = mk('agnt-env-s2-');
  const r = await runChild(
    ` try { await import(${JSON.stringify(PM_URL)}); ${P(`{opened:true}`)} }`
      + ` catch (e) { ${P(`{opened:false, msg:String(e && e.message)}`)} }`,
    { env: { TMPDIR: parent, NODE_ENV: 'test' } }); // never admits
  assert.equal(r.code, 0, 'child exited 0 (proof printed)\nstdout: ' + r.out + '\nstderr: ' + r.err);
  assert.equal(r.proof.opened, false);
  assert.match(r.proof.msg, /explicit-storage|test storage boundary|no storage registration|test-storage/i, 'named typed refusal, not a silent fallback');
  assert.equal(fs.existsSync(path.join(parent, 'Data')), false, 'no Data/ was created by the refusal');
});
