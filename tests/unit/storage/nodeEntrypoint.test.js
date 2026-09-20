// PR145 approval B items 33/49/50 (AR-3): proves the WIRED node:test
// entrypoint admits synthetic storage in the process that runs each test
// file. package.json test:node runs:
//   node --import ./tests/setup/node-test-setup.mjs --test <positive native-runner selectors>
// The second test below makes those positive selectors self-enforcing: adding a
// future node:test file outside them, or selecting a Vitest-owned file, fails.
//
// This file deliberately does NOT self-admit: if the preload failed to run in
// this per-file child process, getStorageContext() throws and this suite
// fails honestly (no masked pass). The t8*/storageContext* suites self-admit
// and therefore cannot prove the wiring by themselves.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStorageContext } from '../../../backend/src/utils/testStorageContext.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function testFilesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return testFilesUnder(full);
    return entry.isFile() && entry.name.endsWith('.test.js') ? [full] : [];
  });
}

function nodeTestSelectors(script) {
  const selectors = [];
  const token = /"([^"]+\.test\.js)"|'([^']+\.test\.js)'|([^\s"']+\.test\.js)/g;
  for (const match of script.matchAll(token)) selectors.push(match[1] || match[2] || match[3]);
  return selectors;
}

describe('node:test entrypoint storage admission (R01, AR-3)', () => {
  it('the wired preload admitted this process\'s synthetic storage before this file ran', () => {
    const ctx = getStorageContext(); // throws if nothing admitted this process
    const tmp = fs.realpathSync(os.tmpdir());
    assert.ok(
      path.resolve(ctx.root).startsWith(tmp + path.sep),
      `admitted root ${ctx.root} must live under the frozen tmpdir parent ${tmp}`
    );
    assert.match(path.basename(ctx.root), /^agnt-v3-/, 'root is a v3 admission root');
    assert.equal(process.env.NODE_ENV, 'test', 'preload set the runner posture');
    // The setup scrubbed ambient storage authority: a stray AGNT_HOME would be
    // a D1 tripwire at resolution time.
    assert.equal(process.env.AGNT_HOME, undefined, 'no ambient AGNT_HOME in an admitted test process');
    assert.ok(fs.statSync(ctx.root).isDirectory(), 'admitted root exists');
  });

  it('test:node selectors cover every native test and no Vitest-owned test', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    const script = pkg.scripts?.['test:node'];
    assert.equal(typeof script, 'string', 'package.json must define test:node');
    const selectors = nodeTestSelectors(script);
    assert.ok(selectors.length > 0, 'test:node must declare positive test-file selectors');

    const inventory = testFilesUnder(path.join(REPO, 'tests/unit')).map((file) => {
      const relative = path.relative(REPO, file).split(path.sep).join('/');
      const source = fs.readFileSync(file, 'utf8');
      return {
        relative,
        native: /from\s+['"]node:test['"]|require\(\s*['"]node:test['"]\s*\)/.test(source),
        vitest: /from\s+['"]vitest['"]|require\(\s*['"]vitest['"]\s*\)/.test(source),
        selected: selectors.some((selector) => path.matchesGlob(relative, selector)),
      };
    });
    const omitted = inventory.filter((file) => file.native && !file.selected).map((file) => file.relative);
    const wrongRunner = inventory.filter((file) => file.vitest && file.selected).map((file) => file.relative);
    assert.deepEqual(omitted, [], `native node:test files omitted by test:node: ${omitted.join(', ')}`);
    assert.deepEqual(wrongRunner, [], `Vitest-owned files selected by test:node: ${wrongRunner.join(', ')}`);
  });
});
