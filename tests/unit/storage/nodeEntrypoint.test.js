// PR145 approval B items 33/49/50 (AR-3): proves the WIRED node:test
// entrypoint admits synthetic storage in the process that runs each test
// file. package.json test:node runs:
//   node --import tests/setup/node-test-setup.mjs --test "tests/unit/**/*.test.js"
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
import { getStorageContext } from '../../../backend/src/utils/testStorageContext.js';

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
});
