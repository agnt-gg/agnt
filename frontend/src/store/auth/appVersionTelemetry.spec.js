import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Regression + systemic guard for app-version telemetry.
 *
 * THE BUG: `window.electron?.getAppVersion?.()` returns a Promise, because it
 * is an IPC round-trip. Without `await`, the Promise object itself was sent to
 * /license/validate and stored as the string "[object Object]".
 *
 * Measured on production 2026-07-30, distinct machines over 30 days:
 *     "1.0.0"           ->  99 machines   (browser: no window.electron, so the
 *                                          hardcoded fallback fired)
 *     "[object Object]" ->  92 machines   (Electron: un-awaited Promise)
 * package.json says 0.6.5, so NOT ONE install reported a real version. The
 * meter read as populated while being 100% dead — the worst failure mode for
 * an instrument, because it silently answers questions it cannot answer.
 *
 * Two tests, deliberately different in kind:
 *   1. BEHAVIOURAL — the composable resolves to a real string.
 *   2. SOURCE CONTRACT — every getAppVersion() call site is awaited.
 *
 * Test 2 exists because fixing one call site does not stop the next one being
 * written. The call looks synchronous at every site; the type system is not
 * here to object. So the rule is enforced across the tree instead.
 */

const SRC = path.resolve(__dirname, '../..');

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // directory vanished mid-walk (parallel workers write fixtures)
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '.git', 'libs', '__old-panels'].includes(entry.name)) continue;
      walk(full, out);
    } else if (/\.(js|vue)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// An INVOCATION, not a mere reference. `if (electron?.getAppVersion)` and
// `expect(mock.getAppVersion)` are property reads and must not be flagged;
// only a following `(` makes it a call.
const CALL = /getAppVersion\s*\??\.?\s*\(/;

// Prose is not code. The first run of this guard flagged the explanatory
// comment written directly above the fix it was written to protect -- a
// scanner that reads commentary is measuring the wrong artefact and will
// eventually be satisfied, or defeated, by wording.
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

// A version-shaped literal used as a fallback, e.g. `|| '1.0.0'`. There must be
// exactly ONE place that decides what to report when the version is unknown,
// and it must report something recognisably unknown. A local `|| '1.0.0'` is
// worse than no fallback at all: it manufactures a real-looking release number
// that cannot be distinguished from a true reading, which is precisely how 99
// installs reported a version no build has ever produced.
const FAKE_FALLBACK = /\|\|\s*['"]\d+\.\d+\.\d+['"]/;

function unawaitedCallSites() {
  const offenders = [];
  for (const file of walk(SRC)) {
    if (/\.(spec|test)\.js$/.test(file)) continue; // mocks legitimately define it
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue; // file removed between walk and read
    }
    text.split(/\r?\n/).forEach((line, i) => {
      if (isComment(line)) return;
      if (!CALL.test(line)) return;
      const where = `${path.relative(SRC, file)}:${i + 1}: ${line.trim()}`;
      if (!/\bawait\b/.test(line)) offenders.push(`UNAWAITED ${where}`);
      else if (FAKE_FALLBACK.test(line)) offenders.push(`FAKE_FALLBACK ${where}`);
    });
  }
  return offenders;
}

describe('app version telemetry', () => {
  let originalElectron;

  beforeEach(() => {
    originalElectron = globalThis.window?.electron;
    vi.resetModules();
  });

  afterEach(() => {
    if (globalThis.window) {
      if (originalElectron === undefined) delete globalThis.window.electron;
      else globalThis.window.electron = originalElectron;
    }
    vi.restoreAllMocks();
  });

  it('resolves the Electron version to a real string, not a Promise', async () => {
    globalThis.window.electron = { getAppVersion: vi.fn().mockResolvedValue('0.6.5') };

    const { useAppVersion } = await import('@/composables/useAppVersion.js');
    const { fetchVersion } = useAppVersion();
    const version = await fetchVersion();

    expect(version).toBe('0.6.5');
    expect(typeof version).toBe('string');
    // The exact production symptom, asserted directly.
    expect(String(version)).not.toBe('[object Object]');
  });

  it('falls back to the backend for non-Electron installs instead of faking 1.0.0', async () => {
    if (globalThis.window) delete globalThis.window.electron;
    globalThis.fetch = vi.fn().mockResolvedValue({ json: async () => ({ version: '0.6.5' }) });

    const { useAppVersion } = await import('@/composables/useAppVersion.js');
    const { fetchVersion } = useAppVersion();
    const version = await fetchVersion();

    expect(version).toBe('0.6.5');
    // '1.0.0' was a plausible-looking lie: it is a real-looking release number
    // that no build ever produced, so it could not be distinguished from truth.
    expect(version).not.toBe('1.0.0');
  });

  it('yields a distinguishable sentinel when the version is genuinely unknown', async () => {
    if (globalThis.window) delete globalThis.window.electron;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline'));

    const { useAppVersion } = await import('@/composables/useAppVersion.js');
    const { fetchVersion } = useAppVersion();

    expect(await fetchVersion()).toBe('0.0.0');
  });

  // --- systemic guard ------------------------------------------------------

  it('SOURCE CONTRACT: every getAppVersion() call site is awaited and defers its fallback', () => {
    expect(unawaitedCallSites()).toEqual([]);
  });

  it('the source contract is capable of failing (anti-vacuity)', () => {
    // If the scanner found no call sites at all, the guard above would pass
    // trivially forever — the failure mode that lets a dead test look healthy.
    const total = walk(SRC)
      .filter((f) => !/\.(spec|test)\.js$/.test(f))
      .flatMap((f) => {
        try {
          return fs.readFileSync(f, 'utf8').split(/\r?\n/);
        } catch {
          return [];
        }
      })
      .filter((line) => !isComment(line) && CALL.test(line));

    expect(total.length).toBeGreaterThan(0);
    // And the detector must actually reject an un-awaited line.
    expect(CALL.test("const v = window.electron?.getAppVersion?.() || '1.0.0';")).toBe(true);
    expect(/\bawait\b/.test("const v = window.electron?.getAppVersion?.() || '1.0.0';")).toBe(false);
    // ...while accepting a correct one, and ignoring a mere property read.
    expect(/\bawait\b/.test('appVersion.value = await electron.getAppVersion();')).toBe(true);
    expect(CALL.test('if (electron?.getAppVersion) {')).toBe(false);
    // ...and ignoring prose that merely names the function.
    expect(isComment('  // getAppVersion() is an IPC call and therefore a Promise.')).toBe(true);
    expect(isComment(' * const version = await electron.getAppVersion();')).toBe(true);
    expect(isComment('  const v = await electron.getAppVersion();')).toBe(false);
    // ...and rejecting a fallback that impersonates a real release.
    expect(FAKE_FALLBACK.test("const v = (await electron.getAppVersion()) || '1.0.0';")).toBe(true);
    expect(FAKE_FALLBACK.test('const v = await electron.getAppVersion();')).toBe(false);
  });
});
