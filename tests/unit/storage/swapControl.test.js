// PR145 section D — tests/unit/storage/swapControl.test.js (R06/S4).
//
// DETERMINISTIC concurrent-swap controller, no races, no polling:
//   • The INNER process (fresh child) admits synthetic storage, signals
//     `ARMED <root>` on stdout, then parks on a stdin barrier.
//   • The CONTROLLER (this test process — outside the inner process, inside
//     the enclosing sandbox/run boundary) performs the swap at the barrier,
//     then releases the child, which imports the REAL database module.
//   • Variant V2 swaps the admitted ROOT itself (rename + decoy) between
//     validation and open → the child must refuse with typed
//     AGNT_TEST_STORAGE_IDENTITY_DRIFT BEFORE any effect: the decoy at the
//     root path must contain no Data/, and the stolen original (the
//     forbidden canary) must be byte-identical and untouched.
//   • Variant V3 swaps Data to a symlink → refused before the write probe;
//     the canary target dir must contain zero probe files.
//   • Variant V4 swaps dbPath to a symlink → alias refusal before the
//     constructor; canary untouched; no sidecars created.
//   • Variant V1 (positive) performs NO swap → the same child boots the real
//     schema and round-trips a native row (allowed open succeeds against the
//     synthetic store — the harness is not a blanket failer).
//
// SEAM HONESTY (R06 split): the deterministic seam proven here is
// admission-validation → module-open at process granularity. The
// intra-import probe seam (validate→probe→revalidate) is proven by
// preopenSafety.test.js (D5 vm ordering). Trusted mode NEVER claims
// race-safety for a swap landing inside a single import evaluation;
// concurrent-race enforcement is enforced-mode-only (contract §4 S4).
// Every path is synthetic and lives under this file's private scratch — no
// real store is ever touched.
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

// Inner child: admit → ARMED → stdin barrier → import db → OPENED/REFUSED.
const CHILD_SCRIPT = `
const t = await import(${JSON.stringify(CTX_URL)});
const c = t.initializeTestStorage();
process.stdout.write(${JSON.stringify(MARK)} + JSON.stringify({armed:true, root:c.root}) + '\\n');
await new Promise((resolve) => {
  let buf = '';
  process.stdin.on('data', (d) => { buf += d; if (buf.includes('\\n')) resolve(); });
  process.stdin.on('end', () => resolve());
});
process.stdin.destroy(); // release the read handle — the controller never closes the pipe
let out = { opened: false };
try {
  const db = await import(${JSON.stringify(DB_URL)});
  await db.dbReady;
  const sqlite3 = (await import('sqlite3')).default || (await import('sqlite3'));
  const p = (await import('node:path')).join(c.root, 'Data', 'agnt.db');
  const s = new sqlite3.Database(p);
  await new Promise((res, rej) => s.run("CREATE TABLE IF NOT EXISTS swap_probe(k TEXT PRIMARY KEY,v TEXT)", e => e ? rej(e) : res()));
  await new Promise((res, rej) => s.run("INSERT OR REPLACE INTO swap_probe VALUES ('k','allowed-open')", e => e ? rej(e) : res()));
  const row = await new Promise((res, rej) => s.get("SELECT v FROM swap_probe WHERE k='k'", (e, r) => e ? rej(e) : res(r)));
  await new Promise((res) => s.close(res));
  out = { opened: true, root: c.root, dbExists: (await import('node:fs')).existsSync(p), row: row && row.v };
} catch (e) {
  out = { refused: true, root: c.root, code: e && e.code, msg: String(e && e.message) };
  process.stdout.write(${JSON.stringify(MARK)} + JSON.stringify(out) + '\\n');
  process.exit(7);
}
process.stdout.write(${JSON.stringify(MARK)} + JSON.stringify(out) + '\\n');
process.exit(0);
`;

// Runs the barrier protocol: onArmed(root) performs the controller swap, then
// the barrier is released. Returns the child's final proof object.
function barrierRun(onArmed, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const parent = mk('agnt-swap-');
    const p = spawn(process.execPath, ['-e', CHILD_SCRIPT], {
      cwd: REPO,
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8', TMPDIR: parent, NODE_ENV: 'test' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    const proofs = [];
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} reject(new Error('swap child timed out after ' + timeoutMs + 'ms')); }, timeoutMs);
    const onLine = (chunk) => {
      const text = String(chunk);
      out += text;
      for (const line of text.split('\n')) {
        if (!line.startsWith(MARK)) continue;
        try { proofs.push(JSON.parse(line.slice(MARK.length))); } catch {}
      }
      const armed = proofs.find((x) => x.armed);
      if (armed && !barrierRun.released) {
        barrierRun.released = true;
        Promise.resolve()
          .then(() => onArmed(armed.root, parent))
          .catch((e) => reject(e))
          .then(() => p.stdin.write('\n'));
      }
    };
    barrierRun.released = false;
    p.stdout.on('data', onLine);
    p.stderr.on('data', (b) => (err += b));
    p.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, out, err, proofs, parent });
    });
  });
}

test('R06 V1 (positive): no swap → allowed open succeeds with a native row round-trip', async () => {
  const r = await barrierRun(() => { /* controller does nothing — the allowed case */ });
  assert.equal(r.code, 0, 'child must exit 0\nstdout: ' + r.out + '\nstderr: ' + r.err);
  const proof = r.proofs[r.proofs.length - 1];
  assert.equal(proof.opened, true);
  assert.equal(proof.dbExists, true);
  assert.equal(proof.row, 'allowed-open', 'write→readback through the synthetic store');
});

test('R06 V2: ROOT swapped at the validation/open barrier → typed IDENTITY_DRIFT before any effect; canary intact; decoy never adopted', async () => {
  const r = await barrierRun((root) => {
    // Seed the forbidden canary INSIDE the admitted root, then steal the root.
    fs.writeFileSync(path.join(root, 'canary-seed'), 'FORBIDDEN-ROWS');
    const stolen = root + '.stolen';
    fs.renameSync(root, stolen);
    const decoy = fs.mkdtempSync(path.join(path.dirname(root), 'agnt-swap-decoy-'));
    cleanup.push(decoy);
    fs.renameSync(decoy, root); // fresh empty dir now sits at the root path
    return { stolen };
  });
  assert.equal(r.code, 7, 'child must exit 7 (refusal)\nstdout: ' + r.out + '\nstderr: ' + r.err);
  const proof = r.proofs[r.proofs.length - 1];
  assert.equal(proof.refused, true);
  assert.equal(proof.code, 'AGNT_TEST_STORAGE_IDENTITY_DRIFT', 'typed drift refusal, not a generic failure');
  // Forbidden canary: the stolen original is byte-identical and untouched.
  const stolenPath = path.join(r.parent, path.basename(proof.root) + '.stolen');
  assert.ok(fs.existsSync(stolenPath), 'stolen original still exists (controller view)');
  assert.equal(fs.readFileSync(path.join(stolenPath, 'canary-seed'), 'utf8'), 'FORBIDDEN-ROWS', 'forbidden canary unchanged');
  // The decoy at the root path was never adopted: no Data/, no db, no probe.
  assert.equal(fs.existsSync(path.join(proof.root, 'Data')), false, 'decoy at the root path must not receive a Data/ directory');
  const decoyEntries = fs.readdirSync(proof.root);
  assert.deepEqual(decoyEntries, [], 'decoy untouched — zero effects from the refusal');
});

test('R06 V3: Data swapped to a symlink at the barrier → refused BEFORE the write probe; canary dir probe-free', async () => {
  // Canary dir is created by the TEST (outside the root, known path) before
  // the run; the controller only plants the symlink at the barrier.
  const realData = mk('agnt-swap-v3-realdata-');
  fs.writeFileSync(path.join(realData, 'canary-seed'), 'FORBIDDEN-ROWS');
  const r = await barrierRun((root) => {
    fs.symlinkSync(realData, path.join(root, 'Data'));
  });
  assert.equal(r.code, 7, 'child must exit 7 (refusal)\nstdout: ' + r.out + '\nstderr: ' + r.err);
  const proof = r.proofs[r.proofs.length - 1];
  assert.equal(proof.refused, true);
  assert.match(proof.msg, /not a real directory|through a symlink/, 'dbDir symlink refusal');
  // The canary dir received NO write probe (refusal precedes the probe):
  const probes = fs.readdirSync(realData).filter((f) => f.startsWith('.probe-'));
  assert.deepEqual(probes, [], 'no probe file in the symlinked canary dir');
  assert.equal(fs.readFileSync(path.join(realData, 'canary-seed'), 'utf8'), 'FORBIDDEN-ROWS', 'canary seed unchanged');
  // The root itself only holds the (still-symlink) Data — no real dir created:
  const rootEntries = fs.readdirSync(proof.root, { withFileTypes: true });
  assert.equal(rootEntries.length, 1);
  assert.equal(rootEntries[0].isSymbolicLink(), true, 'Data remains the planted symlink (zero effects)');
});

test('R06 V4: dbPath swapped to a symlink at the barrier → alias refusal before the constructor; canary untouched', async () => {
  const r = await barrierRun((root, parent) => {
    fs.mkdirSync(path.join(root, 'Data'), { recursive: true });
    const canary = path.join(parent, 'forbidden-canary.db');
    fs.writeFileSync(canary, 'FORBIDDEN-CANARY-DB');
    fs.symlinkSync(canary, path.join(root, 'Data', 'agnt.db'));
    return { canary };
  });
  assert.equal(r.code, 7, 'child must exit 7 (refusal)\nstdout: ' + r.out + '\nstderr: ' + r.err);
  const proof = r.proofs[r.proofs.length - 1];
  assert.equal(proof.refused, true);
  assert.match(proof.msg, /alias refused/, 'sidecar alias refusal names the guard');
  const canary = path.join(r.parent, 'forbidden-canary.db');
  assert.equal(fs.readFileSync(canary, 'utf8'), 'FORBIDDEN-CANARY-DB', 'canary byte-identical');
  assert.equal(fs.existsSync(canary + '-wal'), false, 'no -wal beside the canary');
  assert.equal(fs.existsSync(canary + '-shm'), false, 'no -shm beside the canary');
  // The probe (which legitimately runs before the sidecar check) left nothing:
  const probes = fs.readdirSync(path.join(proof.root, 'Data')).filter((f) => f.startsWith('.probe-'));
  assert.deepEqual(probes, [], 'probe file cleaned up; no residue in Data/');
});
