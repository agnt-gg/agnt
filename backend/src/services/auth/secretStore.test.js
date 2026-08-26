/**
 * secretStore — the OS secret store reader.
 *
 * Redirecting HOME does NOT relocate the real macOS keychain (it lives under
 * $HOME/Library/Keychains only by convention; the security tool talks to the
 * running securityd), so there is no way to stand up a real keychain item in
 * CI. An injected spawnSync is the only honest way to test both platform paths,
 * and it lets the macOS and Linux branches both run from a Windows dev box.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readSecret, readSecretJson, clearSecretCache, secretStoreSupported } from './secretStore.js';

const PAYLOAD = JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-from-keychain' } });

function okSpawn(stdout) {
  return vi.fn(() => ({ status: 0, stdout, stderr: '', error: null }));
}

beforeEach(() => {
  clearSecretCache();
});

describe('platform gating', () => {
  it('reads on darwin', () => {
    const spawnSync = okSpawn(PAYLOAD);
    const value = readSecret({ service: 'svc', platform: 'darwin', env: {}, spawnSync });
    expect(value).toBe(PAYLOAD);
    expect(spawnSync).toHaveBeenCalled();
  });

  it('reads on linux via secret-tool', () => {
    const spawnSync = okSpawn('linux-secret');
    const value = readSecret({ service: 'svc', platform: 'linux', env: {}, spawnSync });
    expect(value).toBe('linux-secret');
    expect(spawnSync.mock.calls[0][0]).toBe('secret-tool');
  });

  it('never spawns on win32 — no readable user secret store there', () => {
    const spawnSync = okSpawn(PAYLOAD);
    expect(readSecret({ service: 'svc', platform: 'win32', env: {}, spawnSync })).toBeNull();
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('secretStoreSupported reflects the platform and the opt-out', () => {
    expect(secretStoreSupported('darwin', {})).toBe(true);
    expect(secretStoreSupported('linux', {})).toBe(true);
    expect(secretStoreSupported('win32', {})).toBe(false);
    expect(secretStoreSupported('darwin', { AGNT_DISABLE_SECRET_STORE: '1' })).toBe(false);
  });
});

describe('every failure path returns null — a working install cannot be made worse', () => {
  const cases = [
    ['non-zero exit (item not found)', () => ({ status: 44, stdout: '', stderr: 'not found' })],
    ['spawn error (binary absent)', () => ({ status: null, stdout: '', error: new Error('ENOENT') })],
    ['timeout', () => ({ status: null, stdout: '', error: new Error('ETIMEDOUT') })],
    ['empty stdout', () => ({ status: 0, stdout: '', stderr: '' })],
    ['throwing spawn', () => { throw new Error('EACCES'); }],
  ];

  for (const [name, impl] of cases) {
    it(name, () => {
      clearSecretCache();
      expect(readSecret({ service: 'svc', platform: 'darwin', env: {}, spawnSync: vi.fn(impl) })).toBeNull();
    });
  }

  it('opt-out disables lookups entirely', () => {
    const spawnSync = okSpawn(PAYLOAD);
    const value = readSecret({
      service: 'svc', platform: 'darwin', env: { AGNT_DISABLE_SECRET_STORE: '1' }, spawnSync,
    });
    expect(value).toBeNull();
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('missing service name is a no-op', () => {
    const spawnSync = okSpawn(PAYLOAD);
    expect(readSecret({ service: '', platform: 'darwin', env: {}, spawnSync })).toBeNull();
    expect(spawnSync).not.toHaveBeenCalled();
  });
});

describe('darwin lookup shape', () => {
  it('tries the account-scoped lookup first, then retries without -a', () => {
    // Real CLIs disagree about what goes in the account attribute. An item
    // written with a different account than we guessed is still ours to read.
    const spawnSync = vi.fn()
      .mockReturnValueOnce({ status: 44, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: PAYLOAD, stderr: '' });

    const value = readSecret({ service: 'svc', account: 'tester', platform: 'darwin', env: {}, spawnSync });

    expect(value).toBe(PAYLOAD);
    expect(spawnSync).toHaveBeenCalledTimes(2);
    expect(spawnSync.mock.calls[0][1]).toEqual(['find-generic-password', '-s', 'svc', '-a', 'tester', '-w']);
    expect(spawnSync.mock.calls[1][1]).toEqual(['find-generic-password', '-s', 'svc', '-w']);
  });

  it('honours AGNT_SECURITY_BIN so the binary can be stubbed', () => {
    const spawnSync = okSpawn(PAYLOAD);
    readSecret({ service: 'svc', platform: 'darwin', env: { AGNT_SECURITY_BIN: '/tmp/fake' }, spawnSync });
    expect(spawnSync.mock.calls[0][0]).toBe('/tmp/fake');
  });

  it('passes a bounded timeout — a wedged keychain daemon must not hang a token read', () => {
    const spawnSync = okSpawn(PAYLOAD);
    readSecret({ service: 'svc', platform: 'darwin', env: {}, spawnSync });
    expect(spawnSync.mock.calls[0][2].timeout).toBeGreaterThan(0);
    expect(spawnSync.mock.calls[0][2].timeout).toBeLessThanOrEqual(5000);
  });

  it('decodes a hex payload — `security -w` prints binary items as hex', () => {
    const hex = Buffer.from(PAYLOAD, 'utf8').toString('hex');
    const value = readSecret({ service: 'svc', platform: 'darwin', env: {}, spawnSync: okSpawn(hex) });
    expect(value).toBe(PAYLOAD);
  });

  it('leaves a JSON payload alone — it can never be mistaken for hex', () => {
    const value = readSecret({ service: 'svc', platform: 'darwin', env: {}, spawnSync: okSpawn(PAYLOAD) });
    expect(value).toBe(PAYLOAD);
  });
});

describe('caching — a keychain ACL prompt must not become a prompt storm', () => {
  it('serves repeat reads from cache within the TTL', () => {
    const spawnSync = okSpawn(PAYLOAD);
    const opts = { service: 'svc', platform: 'darwin', env: {}, spawnSync, now: () => 1000 };

    readSecret(opts);
    readSecret(opts);
    readSecret(opts);

    expect(spawnSync).toHaveBeenCalledTimes(1);
  });

  it('caches misses too — a missing item is re-checked no more often than a hit', () => {
    const spawnSync = vi.fn(() => ({ status: 44, stdout: '', stderr: '' }));
    const opts = { service: 'svc', platform: 'darwin', env: {}, spawnSync, now: () => 1000 };

    expect(readSecret(opts)).toBeNull();
    expect(readSecret(opts)).toBeNull();

    // Two spawns for the FIRST call only (account-scoped, then unscoped).
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });

  it('re-reads once the TTL expires', () => {
    const spawnSync = okSpawn(PAYLOAD);
    let clock = 1000;
    const opts = { service: 'svc', platform: 'darwin', env: {}, spawnSync, now: () => clock };

    readSecret(opts);
    clock += 31_000;
    readSecret(opts);

    expect(spawnSync).toHaveBeenCalledTimes(2);
  });

  it('clearSecretCache forces the next read to hit the store', () => {
    const spawnSync = okSpawn(PAYLOAD);
    const opts = { service: 'svc', platform: 'darwin', env: {}, spawnSync, now: () => 1000 };

    readSecret(opts);
    clearSecretCache();
    readSecret(opts);

    expect(spawnSync).toHaveBeenCalledTimes(2);
  });

  it('does not confuse two different services', () => {
    const spawnSync = okSpawn(PAYLOAD);
    const base = { platform: 'darwin', env: {}, spawnSync, now: () => 1000 };

    readSecret({ ...base, service: 'a' });
    readSecret({ ...base, service: 'b' });

    expect(spawnSync).toHaveBeenCalledTimes(2);
  });
});

describe('readSecretJson', () => {
  it('parses a JSON payload', () => {
    const parsed = readSecretJson({ service: 'svc', platform: 'darwin', env: {}, spawnSync: okSpawn(PAYLOAD) });
    expect(parsed.claudeAiOauth.accessToken).toBe('sk-ant-oat-from-keychain');
  });

  it('returns null for a non-JSON payload rather than throwing', () => {
    const parsed = readSecretJson({ service: 'svc', platform: 'darwin', env: {}, spawnSync: okSpawn('not json') });
    expect(parsed).toBeNull();
  });

  it('returns null for a JSON scalar — only an object is a credential', () => {
    const parsed = readSecretJson({ service: 'svc', platform: 'darwin', env: {}, spawnSync: okSpawn('42') });
    expect(parsed).toBeNull();
  });
});
