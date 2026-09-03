import { defineConfig, configDefaults } from 'vitest/config';
import { onUnhandledError } from './tests/setup/unhandledErrorFilter.mjs';

/**
 * Root vitest config — owns the BACKEND suite.
 *
 * setupFiles
 * ──────────
 * tests/setup/isolate-data-dir.mjs redirects every test worker into a throwaway
 * data directory BEFORE any test module is imported, so backend tests can never
 * run the import-time database boot (createTables, migrations, stale-run sweep)
 * against a real user database. See that file for the full history.
 *
 * exclude
 * ───────
 * Default discovery (`**\/*.{test,spec}.?(c|m)[jt]s?(x)`) also swept up four
 * groups of files this runner structurally cannot execute. They produced ~140
 * permanent failures — which is precisely how a suite becomes unreadable, and
 * how 128 genuinely-broken frontend tests sat unnoticed for six months behind
 * "that's just the known baseline". A test run that is never green teaches
 * people to ignore it. Each exclusion below has its own working runner:
 *
 *   frontend/**              Vue SFCs needing @vitejs/plugin-vue, jsdom and the
 *                            '@' alias — none of which exist here. Run with
 *                            `npm --prefix frontend test`.
 *   tests/e2e/**             Playwright specs. `test.describe()` throws under
 *                            vitest. Run with `npm run test:e2e`.
 *   tests/unit/**            node:test files (`import { describe } from
 *                            'node:test'`). Vitest imports them, node:test
 *                            registers the suites, vitest sees none →
 *                            "No test suite found". Run with `npm run test:node`.
 *   backend/plugins/tests/** Standalone `#!/usr/bin/env node` scripts (the
 *                            shebang alone is a parse error here) plus more
 *                            node:test files. Run with `npm run test:node`.
 *   backend/tests/providers/{providers,suites}/**
 *                            A bespoke provider gauntlet: modules that
 *                            `export default { name, provider, ... }` for a
 *                            custom runner and require live API credentials.
 *                            (GenericProviderService.test.js in the parent
 *                            directory IS a real vitest suite and still runs.)
 *
 * Anything excluded here MUST have a runner named above. Silently dropping a
 * suite is the same failure as silently ignoring one.
 *
 * **\/.worktrees/** is the one exclusion that drops nothing, because it is not
 * a suite — it is a SECOND COPY of this one. A linked worktree is a full
 * checkout living under the repo root, so default discovery walks into it and
 * collects every test file a second time. Worse, every pattern above is
 * root-relative: 'frontend/**' does not match '.worktrees/wt-x/frontend/**',
 * so a worktree smuggles back in precisely the four groups this config
 * deliberately drops, and they fail exactly as documented above.
 *
 * Measured on 2026-09-01 with a single worktree checked out: 963 files
 * collected, 625 of them duplicates from .worktrees — a 338-file suite
 * reporting 662 failures. The failure scales with parallelism, so the more
 * branches in flight the redder the gate gets, which is backwards. And because
 * .worktrees/ is gitignored (.gitignore:34), nothing in git, CI or review ever
 * mentions it; the only symptom is a suite that cannot go green.
 *
 * Guarded by scripts/vitestDiscoveryScope.contract.test.js.
 */
export default defineConfig({
  test: {
    setupFiles: ['./tests/setup/isolate-data-dir.mjs'],

    /**
     * maxWorkers
     * ──────────
     * This suite is I/O-bound, not CPU-bound: each worker opens a real sqlite
     * database and writes real files, and several tests assert on wall-clock
     * behaviour (freeze detection, log flushes, 40-way concurrent blob writes).
     * At vitest's default width (one worker per core — 20 here) those tests get
     * starved of scheduling and fail. Measured on a 20-core machine: three
     * consecutive default-width runs failed 1, 2 and 4 tests, and a DIFFERENT
     * set each time; the same commit at maxWorkers=4 passed 1290/1290.
     *
     * Capped at 4 rather than tuning each test's timeout upward, because the
     * timeouts are not the bug — nothing here parallelises usefully past the
     * disk, so the extra workers buy contention and nothing else. A flaky gate
     * gets ignored exactly like a permanently-red one, which is the failure
     * this config is meant to prevent.
     */
    maxWorkers: 4,

    /**
     * onUnhandledError
     * ────────────────
     * Drops exactly one vitest-infrastructure flake: the worker-teardown
     * "Closing rpc while onUserConsoleLog was pending" race, which failed CI
     * with all tests green (runs 30491707902, 30554297330). Everything else
     * stays fatal. See tests/setup/unhandledErrorFilter.mjs.
     */
    onUnhandledError,
    exclude: [
      ...configDefaults.exclude,
      'frontend/**',
      'tests/e2e/**',
      'tests/unit/**',
      'backend/plugins/tests/**',
      'backend/tests/providers/providers/**',
      'backend/tests/providers/suites/**',
      '**/.worktrees/**',
    ],
  },
});
