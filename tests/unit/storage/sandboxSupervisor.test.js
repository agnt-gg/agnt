import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RUNNER = path.join(REPO, 'scripts/test-sandbox.mjs');
const WATCH = path.join(os.tmpdir(), `pr145-watch-${process.pid}.txt`);
const cleanup = [];
fs.writeFileSync(WATCH, '');
cleanup.push(WATCH);

function runRunner(plan, label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr145-supervisor-'));
  const planPath = path.join(root, 'plan.json');
  const evidence = path.join(root, 'evidence');
  fs.mkdirSync(evidence);
  fs.writeFileSync(planPath, JSON.stringify(plan));
  cleanup.push(root);
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [RUNNER, 'run', '--label', label, '--plan', planPath,
      '--evidence-root', evidence, '--repo', REPO, '--watch-manifest', WATCH], {
      cwd: REPO, env: { PATH: process.env.PATH, LANG: 'C.UTF-8' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    p.stdout.on('data', (b) => (out += b));
    p.stderr.on('data', (b) => (err += b));
    p.on('exit', (code, signal) => {
      const runDir = fs.readdirSync(evidence).map((n) => path.join(evidence, n)).find((p2) => fs.statSync(p2).isDirectory());
      const manifest = runDir && fs.existsSync(path.join(runDir, 'manifest.json'))
        ? JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8')) : null;
      resolve({ code, signal, out, err, runDir, manifest });
    });
  });
}

process.on('exit', () => { for (const p of cleanup) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} } });

const fdAdversary = String.raw`for fd in 3 4 5 6 7 8 9 10 11 12 13 14 15 16; do eval "printf '%s\n' '{\"code\":0,\"signal\":null,\"forged\":true}' >&$fd" 2>/dev/null || true; eval "exec $fd>&-" 2>/dev/null || true; done; exit 23`;
test('D-RV-2 control: an all-green plan preserves exit 0', async () => {
  const r = await runRunner({ commands: [{ name: 'green', argv: [process.execPath, '-e', 'process.exit(0)'] }] }, 'drv2-green');
  assert.equal(r.code, 0, `green runner exit must remain 0, stdout=${r.out} stderr=${r.err}`);
  assert.equal(r.signal, null);
  assert.deepEqual(r.manifest.commands[0].innerExit, { code: 0, signal: null });
});

test('D-RV-1: direct tested command cannot forge or close the supervisory result channel', async () => {
  const r = await runRunner({ commands: [{ name: 'fd-adversary', argv: ['/bin/sh', '-c', fdAdversary] }] }, 'drv1-direct');
  assert.equal(r.code, 23, `runner must preserve the tested command failure, stdout=${r.out} stderr=${r.err}`);
  assert.equal(r.signal, null);
  assert.deepEqual(r.manifest.commands[0].innerExit, { code: 23, signal: null });
});

test('D-RV-1: shell tested command cannot forge or close the supervisory result channel', async () => {
  const encoded = Buffer.from(fdAdversary).toString('base64');
  const cmd = `printf '%s' '${encoded}' | base64 -d | /bin/sh`;
  const r = await runRunner({ commands: [{ name: 'fd-adversary-shell', cmd }] }, 'drv1-shell');
  assert.equal(r.code, 23, `runner must preserve the tested command failure, stdout=${r.out} stderr=${r.err}`);
  assert.deepEqual(r.manifest.commands[0].innerExit, { code: 23, signal: null });
});

test('D-RV-2: signal is fail-fast and no later command launches or writes', async () => {
  const marker = path.join(os.tmpdir(), `pr145-forbidden-marker-${process.pid}-${Date.now()}`);
  cleanup.push(marker);
  const r = await runRunner({ commands: [
    { name: 'signal-first', argv: [process.execPath, '-e', "process.kill(process.pid,'SIGTERM')"] },
    { name: 'must-not-run', argv: [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)},'BAD')`] },
  ] }, 'drv2-signal');
  assert.equal(r.signal, 'SIGTERM', `outer runner must preserve SIGTERM, code=${r.code} stdout=${r.out} stderr=${r.err}`);
  assert.equal(fs.existsSync(marker), false, 'downstream marker command must not execute');
  assert.equal(r.manifest.commands.length, 1, 'only the signalled command is recorded as launched');
  assert.equal(r.manifest.commands[0].innerExit.signal, 'SIGTERM');
});

test('D-RV-2: numeric nonzero is fail-fast and preserves exact status', async () => {
  const marker = path.join(os.tmpdir(), `pr145-forbidden-marker-${process.pid}-${Date.now()}-nz`);
  cleanup.push(marker);
  const r = await runRunner({ commands: [
    { name: 'nonzero-first', argv: [process.execPath, '-e', 'process.exit(37)'] },
    { name: 'must-not-run', argv: [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)},'BAD')`] },
  ] }, 'drv2-nonzero');
  assert.equal(r.code, 37, `outer runner must preserve numeric status, stdout=${r.out} stderr=${r.err}`);
  assert.equal(r.signal, null);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(r.manifest.commands.length, 1);
  assert.deepEqual(r.manifest.commands[0].innerExit, { code: 37, signal: null });
});
