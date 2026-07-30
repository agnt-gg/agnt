/**
 * Shared vitest `onUnhandledError` filter for the backend (root) and frontend
 * configs.
 *
 * THE FLAKE THIS EXISTS FOR
 * ─────────────────────────
 * Vitest workers forward console output to the host over an rpc channel. When
 * a test (or anything it started — DB migration logging, a spawned shell
 * command's stdout relay) emits a console line at the exact moment the worker
 * is tearing down, the in-flight `onUserConsoleLog` rpc call is rejected with:
 *
 *   EnvironmentTeardownError: [vitest-worker]: Closing rpc while
 *   "onUserConsoleLog" was pending
 *
 * (thrown in vitest/dist/chunks/init.*.js when the channel closes with pending
 * methods). Vitest counts that as an unhandled error and exits 1 even when
 * every test passed — CI showed "Tests 1831 passed / Errors 1 / exit 1" twice
 * in two days (run 30491707902 on main, run 30554297330 on a PR branch). The
 * reported "originated in <file>" is misattribution: vitest blames whatever
 * file the dying worker happened to be running, not the late logger.
 *
 * WHY SUPPRESS, AND WHY THIS NARROWLY
 * ───────────────────────────────────
 * Losing one console line during teardown is harmless; a red gate that fires
 * randomly on green code is not — a flaky gate gets ignored exactly like a
 * permanently-red one (see the maxWorkers comment in the root config). We
 * suppress ONLY this exact vitest-infrastructure race:
 *   - name must be EnvironmentTeardownError (vitest's own class), AND
 *   - the pending method must be onUserConsoleLog (log forwarding).
 * A pending onTaskUpdate/onCollected at close could hide real result loss, so
 * other methods stay fatal. Real unhandled rejections from product or test
 * code are untouched.
 *
 * Vitest contract (v4): returning `false` from `onUnhandledError` drops the
 * error; any other return keeps the default fatal behaviour.
 */
export function isTeardownConsoleLogRace(error) {
  return (
    error?.name === 'EnvironmentTeardownError' &&
    typeof error?.message === 'string' &&
    error.message.includes('Closing rpc while "onUserConsoleLog" was pending')
  );
}

/** Pass directly as vitest's test.onUnhandledError. */
export function onUnhandledError(error) {
  if (isTeardownConsoleLogRace(error)) return false;
}
