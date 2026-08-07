import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Per-install secret resolution.
 *
 * The defect being prevented: every AGNT install shared one ENCRYPTION_KEY and
 * one SESSION_SECRET, both published in a public repository for 197 days, and
 * both read through a hand-rolled fs.readFileSync of a committed backend/.env
 * that threw at module scope when the file was missing.
 *
 * What these tests actually pin, in order of how much damage the alternative
 * would do:
 *   1. Two installs never share a key.
 *   2. A resolved key is STABLE across restarts — a key that regenerates is
 *      indistinguishable from data loss.
 *   3. process.env still wins, so no operator loses control.
 *   4. The ephemeral/throw split behaves as documented per secret.
 */

const ENV_KEYS = ['USER_DATA_PATH', 'AGNT_HOME', 'DOCKER_CONTAINER', 'ENCRYPTION_KEY', 'SESSION_SECRET'];

let saved;
let tmpRoot;

async function loadFresh() {
  vi.resetModules();
  return import('./secretResolver.js');
}

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];

  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-secret-'));
  // PathManager resolves once at import, so the data dir must be set BEFORE
  // the module graph loads. Electron tier: dataDir = USER_DATA_PATH/Data.
  process.env.USER_DATA_PATH = tmpRoot;
});

afterEach(() => {
  // Unconditional: a test that throws inside expect() never reaches its own
  // spy.mockRestore(), and a leaked fs mock silently fails the NEXT test for a
  // reason that has nothing to do with it.
  vi.restoreAllMocks();

  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe('resolveSecret', () => {
  it('generates a high-entropy secret when none exists', async () => {
    const { resolveSecret } = await loadFresh();
    const value = resolveSecret('ENCRYPTION_KEY');

    expect(value).toMatch(/^[0-9a-f]{64}$/);
  });

  it('persists it so the SAME value comes back after a restart', async () => {
    // The failure this prevents is total: a key that changes on restart makes
    // everything encrypted before the restart permanently unreadable.
    const first = await loadFresh();
    const original = first.resolveSecret('ENCRYPTION_KEY');

    const second = await loadFresh(); // fresh module registry == process restart
    expect(second.resolveSecret('ENCRYPTION_KEY')).toBe(original);
  });

  it('writes the keyfile 0600 so other local users cannot read it', async () => {
    const { resolveSecret, secretFilePath } = await loadFresh();
    resolveSecret('ENCRYPTION_KEY');

    const file = secretFilePath('ENCRYPTION_KEY');
    expect(fs.existsSync(file)).toBe(true);
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it('gives two different installs two different keys', async () => {
    // The entire point. One shared key meant one leaked database file
    // compromised every user, not one.
    const a = await loadFresh();
    const first = a.resolveSecret('ENCRYPTION_KEY');

    const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-secret-b-'));
    process.env.USER_DATA_PATH = otherRoot;
    const b = await loadFresh();
    const second = b.resolveSecret('ENCRYPTION_KEY');

    expect(second).not.toBe(first);
    fs.rmSync(otherRoot, { recursive: true, force: true });
  });

  it('lets process.env override, so operators keep control', async () => {
    process.env.ENCRYPTION_KEY = 'operator-supplied-value';
    const { resolveSecret, secretFilePath } = await loadFresh();

    expect(resolveSecret('ENCRYPTION_KEY')).toBe('operator-supplied-value');
    // And nothing is written — an override must not leave a stale keyfile that
    // would silently take over if the override were later removed.
    expect(fs.existsSync(secretFilePath('ENCRYPTION_KEY'))).toBe(false);
  });

  it('treats a blank environment variable as absent', async () => {
    process.env.ENCRYPTION_KEY = '   ';
    const { resolveSecret } = await loadFresh();

    expect(resolveSecret('ENCRYPTION_KEY')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('adopts an existing keyfile rather than overwriting it', async () => {
    const { resolveSecret, secretFilePath } = await loadFresh();
    const file = secretFilePath('ENCRYPTION_KEY');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'pre-existing-key-from-an-earlier-version');

    expect(resolveSecret('ENCRYPTION_KEY')).toBe('pre-existing-key-from-an-earlier-version');
  });

  it('keeps separate secrets separate', async () => {
    const { resolveSecret } = await loadFresh();

    expect(resolveSecret('ENCRYPTION_KEY')).not.toBe(resolveSecret('SESSION_SECRET'));
  });

  it('memoises within a process', async () => {
    const { resolveSecret } = await loadFresh();

    expect(resolveSecret('ENCRYPTION_KEY')).toBe(resolveSecret('ENCRYPTION_KEY'));
  });

  it('rejects a name that could escape the secrets directory', async () => {
    const { resolveSecret } = await loadFresh();

    // The name becomes a filename, so traversal is the obvious hazard.
    expect(() => resolveSecret('../../etc/passwd')).toThrow(/Invalid secret name/);
    expect(() => resolveSecret('lowercase')).toThrow(/Invalid secret name/);
  });
});

describe('when the secret cannot be persisted', () => {
  /** Force every write to fail, the way a read-only volume would. */
  function breakWrites() {
    return vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      const error = new Error('EROFS: read-only file system');
      error.code = 'EROFS';
      throw error;
    });
  }

  it('THROWS for data-at-rest secrets rather than silently losing data', async () => {
    // Continuing here would encrypt with a key that vanishes on restart —
    // silent, permanent, and discovered only when a user needs the credential.
    const { resolveSecret } = await loadFresh();
    const spy = breakWrites();

    expect(() => resolveSecret('ENCRYPTION_KEY', { onPersistFailure: 'throw' })).toThrow(
      /Could not persist ENCRYPTION_KEY/
    );
    spy.mockRestore();
  });

  it('degrades to an ephemeral value for session secrets rather than refusing to boot', async () => {
    // A session secret protects a 24-hour cookie that clients re-establish
    // transparently. Refusing to start the app over that would cause more harm
    // than it prevents.
    const { resolveSecret } = await loadFresh();
    const spy = breakWrites();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const value = resolveSecret('SESSION_SECRET', { bytes: 64, onPersistFailure: 'ephemeral' });

    expect(value).toMatch(/^[0-9a-f]{128}$/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SESSION_SECRET'));
    spy.mockRestore();
    warn.mockRestore();
  });

  it('adopts the winner when another process created the file first', async () => {
    // Two processes booting concurrently on one data directory. Whoever loses
    // the exclusive create MUST adopt the winner's value: two live processes
    // disagreeing about the encryption key means one of them writes ciphertext
    // the other cannot read.
    const { resolveSecret, secretFilePath } = await loadFresh();
    const file = secretFilePath('ENCRYPTION_KEY');

    // Node implements appendFileSync BY CALLING writeFileSync, so simulating
    // the other process with fs.appendFileSync would re-enter this very mock
    // and write nothing. Hold the real implementation and use that.
    const realWriteFileSync = fs.writeFileSync;
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation((target, contents, opts) => {
      if (String(target) === file && opts?.flag === 'wx') {
        // The other process wins the race between our check and our write.
        fs.mkdirSync(path.dirname(file), { recursive: true });
        realWriteFileSync(file, 'value-written-by-the-other-process');
        const error = new Error('EEXIST: file already exists');
        error.code = 'EEXIST';
        throw error;
      }
      return realWriteFileSync(target, contents, opts);
    });

    expect(resolveSecret('ENCRYPTION_KEY')).toBe('value-written-by-the-other-process');
    spy.mockRestore();
  });
});

describe('secretExists', () => {
  it('reports absence, then presence, without generating anything', async () => {
    const { secretExists, resolveSecret } = await loadFresh();

    expect(secretExists('ENCRYPTION_KEY')).toBe(false);
    resolveSecret('ENCRYPTION_KEY');
    expect(secretExists('ENCRYPTION_KEY')).toBe(true);
  });
});
