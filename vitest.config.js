import { defineConfig } from 'vitest/config';

/**
 * Root vitest config.
 *
 * The ONLY reason this file exists is tests/setup/isolate-data-dir.mjs: it
 * redirects every test worker into a throwaway data directory BEFORE any test
 * module is imported, so backend tests can never run the import-time database
 * boot (createTables, migrations, stale-run sweep) against a real user
 * database. See that file for the full history.
 *
 * Discovery is deliberately untouched — same include/exclude defaults as
 * running vitest with no config, so `npm test` collects exactly the same
 * files it always did. The frontend suite (`cd frontend && vitest`) resolves
 * its own config and is unaffected.
 */
export default defineConfig({
  test: {
    setupFiles: ['./tests/setup/isolate-data-dir.mjs'],
  },
});
