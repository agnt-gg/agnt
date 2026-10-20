/**
 * Every test run is a TEST-mode run, whoever launches it.
 *
 * Imported FIRST by both vitest configs (root and frontend), so it runs before
 * vite, vitest or any plugin reads the environment.
 *
 * WHY
 * ───
 * Vitest only sets NODE_ENV=test when it is unset. A shell that inherits
 * NODE_ENV=production — every shell the packaged AGNT app spawns, which is
 * where its own agents build and test this repo — kept production, and the
 * frontend suite fell apart in two different-looking ways:
 *
 *   - Vite resolved for production, so Node built-ins (url, path, fs, os) in
 *     source-scanning specs became empty browser stubs:
 *     "fileURLToPath is not a function", "default.resolve is not a function".
 *   - Vue loaded its production build, so component specs that rely on dev
 *     behaviour failed with empty DOM wrappers and undefined reads.
 *
 * Measured 2026-10-19: 189 of 508 frontend files failed under the inherited
 * NODE_ENV=production and passed with it cleared, while CI (which never sets
 * it) stayed green. A suite whose result depends on who started it proves
 * nothing, so the mode is fixed here rather than at every call site.
 *
 * Pinned by tests/setup/forceTestMode.test.js (root) and
 * frontend/src/__guards__/testMode.spec.js.
 */
if (process.env.NODE_ENV !== 'test') process.env.NODE_ENV = 'test';
