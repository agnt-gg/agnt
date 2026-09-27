import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = path.join(root, 'tests/fixtures/node-test-stdout-banner.js');
const setup = './tests/setup/node-test-stdout.mjs';

function run(args) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env });
}

test('the node:test launcher keeps boot console.log off the worker stdout pipe', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['test:node'], /--import \.\/tests\/setup\/node-test-stdout\.mjs/);

  const guarded = run(['--import', setup, '--test', fixture]);
  const guardedText = guarded.stdout + guarded.stderr;
  assert.equal(guarded.status, 0, guardedText);
  assert.doesNotMatch(guardedText, /Unable to deserialize cloned data/);
  assert.match(guardedText, /console\.log reaches stderr/);
});
