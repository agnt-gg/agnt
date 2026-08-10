// SAME ISOLATION THE VITEST RUNNER ALREADY HAS — the Playwright runner had none.
//
// tests/e2e/mobile-lite-pair.spec.js imports backend/src/routes/PairingRoutes.js
// at module scope, and backend/src/models/database/index.js is a boot sequence
// disguised as an import: opening it runs createTables, ~25 ALTER TABLE probes,
// FTS setup and the stale-run sweep (UPDATE agent_executions SET
// status='interrupted' WHERE status='running'). Playwright COLLECTS every spec
// before it runs any, so `npx playwright test` — with any filter, even one that
// excludes that file — booted the developer's REAL database. Observed on a live
// machine: "📁 AGNT data: ~/.agnt/data (source: homedir)".
//
// tests/setup/isolate-data-dir.mjs is the guard written for exactly this, for
// vitest, in July. It is imported rather than reimplemented: it already knows
// that USER_DATA_PATH outranks AGNT_HOME in PathManager's cascade, that a
// zero-byte agnt.db is needed to disarm the legacy-migration shim, and which
// host env vars must be scrubbed so a developer's shell cannot change what a
// test means. A second copy of that reasoning would drift from the first.
//
// Playwright loads this config in every worker process, so the redirect is in
// place before any spec module is imported. Its own marker makes it idempotent.
import './tests/setup/isolate-data-dir.mjs';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000, // Electron apps might take a while to start
  retries: 0,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  outputDir: 'test-results/',
});
