/**
 * Vitest setup: force every test worker into a throwaway data directory.
 *
 * WHY THIS EXISTS (2026-07-26)
 * ────────────────────────────
 * backend/src/models/database/index.js is a boot sequence disguised as an
 * import: the moment anything in its import chain loads, it opens the DB and
 * runs createTables(), ~25 ALTER TABLE probes, FTS setup, dedupe migrations,
 * the stale-run sweep (UPDATE agent_executions SET status='interrupted'
 * WHERE status='running'), and webhook sync — as module side effects.
 *
 * PathManager's cascade (USER_DATA_PATH → AGNT_HOME → ~/.agnt/data → cwd)
 * resolves to REAL user data in every tier; there is no test tier. So a plain
 * `npm test` ran the full migration pipeline against the production database —
 * observed: one vitest run initialized %APPDATA%/AGNT/Data/agnt.db 15 times
 * (once per worker) while the live server held it open, and flipped any
 * genuinely-running execution to 'interrupted'.
 *
 * THE FIX: isolation is the DEFAULT, at the runner level. This file runs in
 * each worker BEFORE any test module is imported (vitest setupFiles contract),
 * so the env is already pointed at a temp dir when database/index.js executes
 * its import-time boot. Tests exercise the real schema pipeline — real
 * sqlite3, real migrations — just against a database that doesn't matter.
 *
 * Escape hatch: AGNT_TEST_USE_REAL_DATA=1 skips isolation. It is deliberately
 * loud and greppable; dataDirIsolation.test.js fails when it is set, so real
 * data can never be hit silently.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ESCAPE_HATCH = 'AGNT_TEST_USE_REAL_DATA';
const MARKER = '__AGNT_TEST_DATA_DIR';

// setupFiles re-run for every test FILE in a worker; the worker keeps one
// process (and one cached database module), so the redirect must happen
// exactly once per process.
if (process.env[ESCAPE_HATCH] !== '1' && !process.env[MARKER]) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-vitest-'));

  // USER_DATA_PATH is the highest non-Docker tier in PathManager's cascade,
  // so it beats AGNT_HOME/homedir no matter what the host environment says.
  // Under it, PathManager uses the Electron layout: rootDir + rootDir/Data.
  const dataDir = path.join(rootDir, 'Data');
  fs.mkdirSync(dataDir, { recursive: true });

  // Disarm the legacy-DB migration shim. Its source list includes the REAL
  // %APPDATA%/AGNT/Data, and a fresh canonical dir with no agnt.db invites it
  // to copy a real database INTO the sandbox (today only the >2 GB opt-in
  // gate blocks that — a size coincidence, not a guarantee). A present
  // agnt.db short-circuits it immediately ('target-exists'), and a zero-byte
  // file IS a valid empty SQLite database.
  fs.writeFileSync(path.join(dataDir, 'agnt.db'), '');

  process.env.USER_DATA_PATH = rootDir;
  delete process.env.AGNT_HOME;

  // The Docker tier fires on NODE_ENV=production + /app/data (Linux CI could
  // plausibly have both). Tests are tests.
  if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'test';

  process.env[MARKER] = rootDir;

  // Best-effort cleanup. sqlite3 may still hold the file on Windows when the
  // worker exits; leftovers are zero-to-few-MB dirs under the OS temp path
  // with a greppable 'agnt-vitest-' prefix.
  process.on('exit', () => {
    try {
      fs.rmSync(rootDir, { recursive: true, force: true });
    } catch {
      /* locked on Windows — OS temp cleanup will get it */
    }
  });
}
