import { test, afterEach } from 'node:test';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const source = path.join(repo, 'Justfile');
const just = 'just';
const fixtures = [];
// Dedicated Linux CI installs pinned Just. Missing tools fail; no skip fallback.
afterEach(async () => {
  for (const root of fixtures.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
// Only our disposable recorder executables run: never target live services.
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agnt-just-'));
  fixtures.push(root);
  await fs.copyFile(source, path.join(root, 'Justfile'));
  await fs.mkdir(path.join(root, 'bin'));
  await fs.mkdir(path.join(root, 'nested'));
  const stub = `#!${process.execPath}\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst args = process.argv.slice(2);\nfs.appendFileSync(process.env.RECORD, JSON.stringify({tool:path.basename(process.argv[1]),args,cwd:process.cwd(),dotenv:process.env.DOTENV_SENTINEL ?? null})+'\\n');\nif(process.env.FAIL_ARGS === JSON.stringify(args)) process.exit(23);\n`;
  for (const name of ['npm', 'git', 'node']) await fs.writeFile(path.join(root, 'bin', name), stub, { mode: 0o755 });
  await fs.writeFile(path.join(root, '.env'), 'DOTENV_SENTINEL=must-not-be-loaded\n');
  async function run(args, extra = {}, subdir = '') {
    const record = path.join(root, `calls-${randomUUID()}.jsonl`);
    const env = { ...process.env, ...extra, RECORD: record, PATH: path.join(root, 'bin') + ':' + process.env.PATH };
    for (const key of Object.keys(env)) if (/TOKEN|SECRET|API_KEY|AUTH|DOTENV_SENTINEL|^JUST_/.test(key)) delete env[key];
    const r = spawnSync(just, args, { cwd: path.join(root, subdir), env, encoding: 'utf8', timeout: 5000 });
    if (r.error) throw new Error(`Just runner unavailable or timed out: ${r.error.code}`);
    const calls = await fs.readFile(record, 'utf8').then(x => x.trim().split('\n').filter(Boolean).map(JSON.parse)).catch(e => { if(e.code === 'ENOENT') return []; throw e; });
    return { ...r, calls };
  }
  return { root, run };
}
const commandMap = {
  restart: ['--silent','run','restart:backend','--'],
  status: ['--silent','run','app:status','--'],
  'restart-backend': ['--silent','run','restart:backend','--'],
  start: ['start','--'],
  dev: ['run','dev:frontend','--'],
  'dev-frontend': ['run','dev:frontend','--'],
  'dev-backend': ['run','dev','--'],
  build: ['run','build:frontend','--'],
  'build-frontend': ['run','build:frontend','--'],
  'test-backend': ['test','--'],
  'test-frontend': ['--prefix','frontend','test','--'],
  wt: ['run','wt','--'],
};
for (const [recipe, args] of Object.entries(commandMap)) {
  test(`${recipe} delegates exactly once without dotenv or cwd leakage`, async () => {
    const { root, run } = await fixture();
    const r = await run([recipe], {}, 'nested');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.calls, [{ tool:'npm',args,cwd:root,dotenv:null }]);
  });
}
test('default/help lists recipes without invoking tools', async () => {
  const { run } = await fixture();
  for (const args of [[], ['help']]) {
    const r = await run(args);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /restart-backend/);
    assert.match(r.stdout, /doctor/);
    assert.deepEqual(r.calls, []);
  }
});
test('quoted metacharacters and spaces are forwarded as data', async () => {
  const { run } = await fixture();
  const values = ['file with spaces', '$(touch PWNED)', '; touch PWNED', 'a"b', "x'y", '--json'];
  const r = await run(['status', ...values]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls[0].args, [...commandMap.status, ...values]);
});
test('metacharacter argument did not create a side effect', async () => {
  const { root, run } = await fixture();
  const r = await run(['dev', '$(touch PWNED)']);
  assert.equal(r.status, 0, r.stderr);
  await assert.rejects(fs.stat(path.join(root, 'PWNED')), { code:'ENOENT' });
});
test('CI runs checks/tests/build/browser once in fail-fast order', async () => {
  const { run } = await fixture();
  const r = await run(['ci']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls.map(x => [x.tool,...x.args]), [
    ['npm','run','eol:check'], ['git','diff','--check'], ['git','diff','--cached','--check'],
    ['npm','test','--'], ['npm','--prefix','frontend','test','--'],
    ['node','--test','tests/unit/justfile.test.js'],
    ['npm','run','build:frontend','--'], ['npm','run','test:e2e','--','--grep','@ci'],
  ]);
});
test('failed backend test stops before frontend/build/browser', async () => {
  const { run } = await fixture();
  const r = await run(['ci'], { FAIL_ARGS:JSON.stringify(['test','--']) });
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.calls.map(x => x.args), [['run','eol:check'], ['diff','--check'], ['diff','--cached','--check'], ['test','--']]);
});
test('test-browser builds once then forwards its selection args', async () => {
  const { run } = await fixture();
  const r = await run(['test-browser','--workers','2']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls.map(x => x.args), [['run','build:frontend','--'], ['run','test:e2e','--','--grep','@ci','--workers','2']]);
});
test('packaging builds frontend then delegates to desktop packaging', async () => {
  const { run } = await fixture();
  const r = await run(['package','--linux']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls.map(x => x.args), [['run','build:frontend','--'], ['run','build','--','--linux']]);
});
test('doctor reports versions without services or validation', async () => {
  const { run } = await fixture();
  const r = await run(['doctor']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls.map(x => [x.tool,...x.args]), [['node','--version'], ['npm','--version'], ['git','--version']]);
});
test('all delegated npm scripts exist and critical aliases forward arguments', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
  const frontend = JSON.parse(await fs.readFile(path.join(repo, 'frontend/package.json'), 'utf8'));
  for (const name of ['app:status', 'restart:backend', 'start', 'dev:frontend', 'dev', 'build:frontend', 'build', 'test', 'test:e2e', 'eol:check', 'wt']) {
    assert.equal(typeof pkg.scripts[name], 'string', `Missing npm script ${name}`);
  }
  assert.equal(typeof frontend.scripts.test, 'string');
  assert.equal(pkg.scripts['build:frontend'], 'npm --prefix frontend run build --');
  assert.equal(pkg.scripts['dev:frontend'], 'npm --prefix frontend run dev --');
});
test('every failed CI dimension prevents all downstream work', async () => {
  const stages = [
    ['run','eol:check'], ['diff','--check'], ['diff','--cached','--check'],
    ['test','--'], ['--prefix','frontend','test','--'],
    ['--test','tests/unit/justfile.test.js'],
    ['run','build:frontend','--'], ['run','test:e2e','--','--grep','@ci'],
  ];
  const { run } = await fixture();
  for (let i = 0; i < stages.length; i++) {
    const r = await run(['ci'], { FAIL_ARGS: JSON.stringify(stages[i]) });
    assert.notEqual(r.status, 0);
    assert.deepEqual(r.calls.map(x => x.args), stages.slice(0, i + 1));
  }
});
test('test-recipes delegates to the exact dedicated suite', async () => {
  const { root, run } = await fixture();
  const r = await run(['test-recipes']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls, [{ tool: 'node', args: ['--test', 'tests/unit/justfile.test.js'], cwd: root, dotenv: null }]);
});
test('failed frontend build prevents packaging', async () => {
  const { run } = await fixture();
  const r = await run(['package'], { FAIL_ARGS: JSON.stringify(['run','build:frontend','--']) });
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.calls.map(x => x.args), [['run','build:frontend','--']]);
});
for (const fail of ['preflight', 'build', 'none']) {
  test(`Given ${fail} outcome When rebuild-restart Then preflight and build gate the restart`, async () => {
    const { run } = await fixture();
    const stages = [
      ['--silent','run','restart:backend','--','--preflight','--json'],
      ['run','build:frontend'],
      ['--silent','run','restart:backend','--','--json'],
    ];
    const failure = fail === 'preflight' ? stages[0] : fail === 'build' ? stages[1] : [];
    const r = await run(['rebuild-restart','--json'], { FAIL_ARGS: JSON.stringify(failure) });
    assert.equal(r.status === 0, fail === 'none', r.stderr);
    assert.deepEqual(r.calls.map(c => c.args), stages.slice(0, fail === 'preflight' ? 1 : fail === 'build' ? 2 : 3));
  });
}
test('unsupported lint/fmt/restart-both are not fake-green recipes', async () => {
  const { run } = await fixture();
  for (const target of ['lint','fmt','restart-both']) {
    const r = await run([target]);
    assert.notEqual(r.status, 0);
    assert.deepEqual(r.calls, []);
  }
});
