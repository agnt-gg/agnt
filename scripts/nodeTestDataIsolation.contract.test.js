/**
 * The node:test runner gets the same data-directory isolation as vitest.
 *
 * tests/setup/isolate-data-dir.mjs is vitest's setupFiles entry, so it never
 * ran for `npm run test:node` (node:test files). A shell spawned by AGNT, or a
 * developer who has run the app, has USER_DATA_PATH pointing at real user data,
 * so any node:test file that reached PathManager read and wrote the real
 * %APPDATA%/AGNT. Observed: a fake 'testprovider' entry (model-a, model-b) in
 * the user's live last-models.json, which the app then carried as a provider.
 *
 * The fix is the same file, loaded with `node --import`, which runs before any
 * test module — and node:test hands --import to every per-file subprocess.
 * This test runs the real command shape against a probe and fails if the probe
 * can see the "real" directory.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SETUP = './tests/setup/isolate-data-dir.mjs';
const PROBE = 'scripts/fixtures/nodeTestIsolationProbe.mjs';

function runProbe(extraArgs) {
  const fakeRealRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-real-userdata-'));
  // The runner's own isolation marker would make the setup a no-op, so the
  // child starts from the host's view: USER_DATA_PATH set, no marker.
  const env = { ...process.env, USER_DATA_PATH: fakeRealRoot, PROBE_REAL_USER_DATA: fakeRealRoot };
  delete env.__AGNT_TEST_DATA_DIR;
  delete env.AGNT_TEST_USE_REAL_DATA;
  try {
    return spawnSync(process.execPath, [...extraArgs, '--test', PROBE], { cwd: REPO_ROOT, env, encoding: 'utf8', timeout: 60_000 });
  } finally {
    fs.rmSync(fakeRealRoot, { recursive: true, force: true });
  }
}

describe('npm run test:node is isolated from real user data', () => {
  it('loads the isolation setup before any node:test file', () => {
    const { scripts } = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(scripts['test:node']).toMatch(/^node --import \.\/tests\/setup\/isolate-data-dir\.mjs --test /);
  });

  it('CONTROL: without it, a node:test file resolves into the real directory', () => {
    const result = runProbe([]);
    expect(result.status, result.stdout).not.toBe(0);
    expect(result.stdout).toContain('resolved into real user data');
  });

  it('with it, the same file resolves into a throwaway directory', () => {
    const result = runProbe(['--import', SETUP]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});
