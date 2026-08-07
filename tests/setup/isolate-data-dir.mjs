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

/**
 * Deployment flags and secrets the HOST may have set, which must never decide
 * a test outcome.
 *
 * WHY THIS LIST EXISTS (2026-08-07)
 * ─────────────────────────────────
 * The data directory was not the only thing leaking in from the host. A test
 * runner spawned by the running AGNT backend inherits that backend's entire
 * environment — including TRUST_REMOTE_AUTH, which switches auth from
 * `jwt.verify` to `jwt.decode`.
 *
 * Observed: four suites failed on a machine whose backend happened to have
 * TRUST_REMOTE_AUTH=true, and they failed in the most misleading way possible.
 * `LocalFileRoutes > refuses a forged token signed with the wrong secret` and
 * `mediaRouteAuth > rejects a forged cookie` both went red because the forged
 * tokens were ACCEPTED — the suite was reporting a genuine security failure
 * that existed only in that shell. `rateLimit > IGNORES a spoofed XFF` failed
 * for the same reason, since TRUST_REMOTE_AUTH also implies trust-proxy.
 *
 * The same class of leak had already produced two false results elsewhere in
 * this project: an OAuth ship gate that passed with its constants empty, and
 * a JWT fixture that verified against an inherited secret. Three instances is
 * a pattern, so it is fixed here once, at the runner, rather than in each
 * suite's beforeEach where the next one will forget.
 *
 * A test that needs one of these sets it explicitly — and every test that
 * needs them already does, in its own setup.
 */
const HOST_ENV_TO_SCRUB = [
  // Auth model switches. The most dangerous: they turn verification off, so a
  // leaked value makes security tests pass or fail for reasons unrelated to
  // the code under test.
  'TRUST_REMOTE_AUTH',
  'TRUST_PROXY',
  // Secrets. A suite asserting "generates one when absent" cannot be trusted
  // if the host already supplied one.
  'JWT_SECRET',
  'SESSION_SECRET',
  'ENCRYPTION_KEY',
  'AGNT_LEGACY_ENCRYPTION_KEY',
];

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

  // See HOST_ENV_TO_SCRUB. Same principle as the data directory: the host
  // must not be able to change what a test means.
  for (const key of HOST_ENV_TO_SCRUB) delete process.env[key];

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
