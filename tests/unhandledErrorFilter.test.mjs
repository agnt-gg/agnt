/**
 * Guards for tests/setup/unhandledErrorFilter.mjs — the onUnhandledError
 * filter that stops the vitest worker-teardown "onUserConsoleLog" rpc race
 * from failing CI with every test green.
 *
 * Two halves, both load-bearing:
 *   1. Predicate: suppresses EXACTLY the infrastructure race and nothing else.
 *      Over-matching would swallow real unhandled rejections — worse than the
 *      flake it fixes.
 *   2. Wiring: both vitest configs actually pass the filter. A correct filter
 *      imported nowhere is this repo's most repeated defect class (validator
 *      wired into 1 of 5 adapters, guard present but unregistered component).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isTeardownConsoleLogRace, onUnhandledError } from './setup/unhandledErrorFilter.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Reproduces vitest's construction (dist/chunks/init.*.js): a subclass of
 *  Error with name overridden — but errors also cross the worker boundary as
 *  plain serialized objects, so both shapes must match. */
function makeRaceError(method = 'onUserConsoleLog') {
  const err = new Error(`[vitest-worker]: Closing rpc while "${method}" was pending`);
  err.name = 'EnvironmentTeardownError';
  return err;
}

describe('isTeardownConsoleLogRace — suppresses exactly the infrastructure race', () => {
  it('matches the real error shape (Error instance)', () => {
    expect(isTeardownConsoleLogRace(makeRaceError())).toBe(true);
  });

  it('matches the serialized plain-object shape that crosses the worker boundary', () => {
    expect(
      isTeardownConsoleLogRace({
        name: 'EnvironmentTeardownError',
        message: '[vitest-worker]: Closing rpc while "onUserConsoleLog" was pending',
      })
    ).toBe(true);
  });

  it('does NOT match a teardown error for any other pending rpc method — a lost onTaskUpdate could hide real result loss', () => {
    expect(isTeardownConsoleLogRace(makeRaceError('onTaskUpdate'))).toBe(false);
    expect(isTeardownConsoleLogRace(makeRaceError('onCollected'))).toBe(false);
  });

  it('does NOT match ordinary unhandled rejections, even with a similar message', () => {
    expect(isTeardownConsoleLogRace(new Error('Closing rpc while "onUserConsoleLog" was pending'))).toBe(false);
    const wrongName = makeRaceError();
    wrongName.name = 'TypeError';
    expect(isTeardownConsoleLogRace(wrongName)).toBe(false);
  });

  it('tolerates garbage input without throwing', () => {
    expect(isTeardownConsoleLogRace(undefined)).toBe(false);
    expect(isTeardownConsoleLogRace(null)).toBe(false);
    expect(isTeardownConsoleLogRace('string')).toBe(false);
    expect(isTeardownConsoleLogRace({ name: 'EnvironmentTeardownError', message: 42 })).toBe(false);
  });
});

describe('onUnhandledError — vitest contract', () => {
  it('returns false (drop) for the race, undefined (stay fatal) for everything else', () => {
    // vitest keeps the error unless the hook returns exactly false.
    expect(onUnhandledError(makeRaceError())).toBe(false);
    expect(onUnhandledError(new Error('boom'))).toBeUndefined();
    expect(onUnhandledError(makeRaceError('onTaskUpdate'))).toBeUndefined();
  });
});

describe('wiring — both configs pass the shared filter (no mirror copies, no dead filter)', () => {
  for (const rel of ['vitest.config.js', 'frontend/vitest.config.js']) {
    it(`${rel} imports unhandledErrorFilter.mjs and sets onUnhandledError`, () => {
      const src = readFileSync(join(repoRoot, rel), 'utf8')
        .split(/\r?\n/)
        // Strip line comments so prose about the option can never satisfy the assertion.
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');
      expect(src).toMatch(/unhandledErrorFilter\.mjs/);
      expect(src).toMatch(/\bonUnhandledError\b\s*[,:]/);
      // No locally re-implemented predicate — the shared module is the single source.
      expect(src).not.toMatch(/EnvironmentTeardownError/);
    });
  }
});
