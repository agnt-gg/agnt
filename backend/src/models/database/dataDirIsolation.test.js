/**
 * Tripwire: backend tests must NEVER resolve the real user data directory.
 *
 * This is the guard for tests/setup/isolate-data-dir.mjs. If the setup file
 * is removed from vitest.config.js, stops running first, or someone runs the
 * suite with AGNT_TEST_USE_REAL_DATA=1, PathManager resolves a real tier
 * (%APPDATA%/AGNT on Electron-spawned shells, ~/.agnt/data in a plain
 * terminal) and this file fails loudly — BEFORE anyone has to diagnose why
 * production rows changed after an `npm test`.
 *
 * Deliberately imports ONLY PathManager — never the database module — so the
 * tripwire itself cannot trigger the import-time boot sequence it guards
 * against, even when isolation is broken.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import pathManager from '../../utils/PathManager.js';

const lower = (p) => path.resolve(p).toLowerCase();

describe('test data-dir isolation (tests/setup/isolate-data-dir.mjs)', () => {
  it('resolves the data dir inside the OS temp sandbox', () => {
    expect(lower(pathManager.getDataDir()).startsWith(lower(os.tmpdir()))).toBe(true);
    expect(lower(pathManager.getRootDir()).startsWith(lower(os.tmpdir()))).toBe(true);
  });

  it('never points at a real data tier', () => {
    const dataDir = lower(pathManager.getDataDir());
    // Electron tier — %APPDATA%/AGNT (the live production database). NOTE:
    // the fragment must NOT go through lower() — path.resolve would anchor it
    // to the repo cwd and the check would vacuously pass.
    expect(dataDir).not.toContain(path.join('appdata', 'roaming', 'agnt').toLowerCase());
    // homedir / AGNT_HOME tiers — ~/.agnt/data.
    expect(dataDir).not.toContain(`${path.sep}.agnt${path.sep}`);
  });

  it('was redirected by the setup file, not by accident', () => {
    // The marker is only written by isolate-data-dir.mjs. Its absence means
    // the setup never ran and any temp-path match above was luck.
    expect(process.env.__AGNT_TEST_DATA_DIR).toBeTruthy();
    expect(lower(process.env.USER_DATA_PATH)).toBe(lower(process.env.__AGNT_TEST_DATA_DIR));
  });

  it('suppresses the legacy-DB migration shim with a pre-seeded target', () => {
    // Without this file, migrateLegacyDatabase() treats the sandbox as an
    // empty canonical dir and %APPDATA%/AGNT/Data as a legacy SOURCE — i.e.
    // it may try to copy a real database INTO the test sandbox.
    const seeded = path.join(pathManager.getDataDir(), 'agnt.db');
    expect(fs.existsSync(seeded)).toBe(true);
  });
});
