/**
 * ClaudeCodeAuthManager — keychain fallback.
 *
 * Claude Code 2.1.231+ stores its session in the macOS Keychain rather than
 * ~/.claude/.credentials.json, so a successful `claude auth login` used to be
 * invisible to AGNT and the provider reported disconnected.
 *
 * These tests never touch a real keychain. CLAUDE_CODE_SECURITY_BIN points the
 * lookup at a stub that stands in for `security find-generic-password`, which
 * is also what lets the suite run on the Linux CI runner.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const OAUTH = {
  accessToken: 'sk-ant-oat-test-access',
  refreshToken: 'sk-ant-ort-test-refresh',
  expiresAt: Date.now() + 60 * 60 * 1000,
  scopes: ['user:inference', 'user:profile'],
  subscriptionType: 'max',
};

// `security` is a macOS binary; the stub is a POSIX shell script.
describe.skipIf(process.platform === 'win32')('ClaudeCodeAuthManager keychain fallback', () => {
  let tmpHome;
  let credPath;
  let stubBin;
  let payloadPath;
  const saved = {};

  /** Point the lookup at a stub that prints `body` and exits with `code`. */
  function stubKeychain(body, code = 0) {
    fs.writeFileSync(payloadPath, body ?? '', 'utf8');
    fs.writeFileSync(
      stubBin,
      `#!/bin/sh\nexit_code=${code}\nif [ "$exit_code" -ne 0 ]; then exit "$exit_code"; fi\ncat "${payloadPath}"\n`,
      { mode: 0o755 },
    );
    process.env.CLAUDE_CODE_SECURITY_BIN = stubBin;
  }

  /** No keychain item at all — `security` exits non-zero. */
  function stubKeychainMissing() {
    stubKeychain('', 44);
  }

  async function loadManager() {
    vi.resetModules();
    const manager = (await import('./ClaudeCodeAuthManager.js')).default;
    manager.apiCheckCache = null;
    return manager;
  }

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-claude-keychain-'));
    fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
    credPath = path.join(tmpHome, '.claude', '.credentials.json');
    stubBin = path.join(tmpHome, 'security-stub.sh');
    payloadPath = path.join(tmpHome, 'keychain-payload.json');

    for (const key of ['HOME', 'USERPROFILE', 'CLAUDE_CODE_SECURITY_BIN',
      'CLAUDE_CODE_KEYCHAIN_SERVICE', 'CLAUDE_CODE_DISABLE_KEYCHAIN']) {
      saved[key] = process.env[key];
    }
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    delete process.env.CLAUDE_CODE_DISABLE_KEYCHAIN;
    delete process.env.CLAUDE_CODE_KEYCHAIN_SERVICE;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('reads the session from the keychain when no credentials file exists', async () => {
    stubKeychain(JSON.stringify({ claudeAiOauth: OAUTH }));
    const manager = await loadManager();

    expect(fs.existsSync(credPath)).toBe(false);
    expect(manager.getAccessTokenSync()).toBe(OAUTH.accessToken);
  });

  it('prefers the credentials file over the keychain', async () => {
    fs.writeFileSync(
      credPath,
      JSON.stringify({ claudeAiOauth: { ...OAUTH, accessToken: 'sk-ant-oat-from-file' } }),
      'utf8',
    );
    stubKeychain(JSON.stringify({ claudeAiOauth: OAUTH }));
    const manager = await loadManager();

    expect(manager.getAccessTokenSync()).toBe('sk-ant-oat-from-file');
  });

  it('returns null when neither the file nor the keychain has a session', async () => {
    stubKeychainMissing();
    const manager = await loadManager();

    expect(manager.getAccessTokenSync()).toBeNull();
  });

  it('adopts only the OAuth block, never a console apiKey from the same item', async () => {
    // The real keychain item carries an `apiKey` field alongside the OAuth
    // block. Promoting it would silently swap a subscription login for a
    // billed console key.
    stubKeychain(JSON.stringify({ apiKey: 'sk-ant-api-should-be-ignored', provider: 'anthropic' }));
    const manager = await loadManager();

    expect(manager.getAccessTokenSync()).toBeNull();
  });

  it('ignores a keychain item whose OAuth block has no access token', async () => {
    stubKeychain(JSON.stringify({ claudeAiOauth: { refreshToken: 'sk-ant-ort-only' } }));
    const manager = await loadManager();

    expect(manager.getAccessTokenSync()).toBeNull();
  });

  it('ignores unparseable keychain output instead of throwing', async () => {
    stubKeychain('not json at all {{{');
    const manager = await loadManager();

    expect(() => manager.getAccessTokenSync()).not.toThrow();
    expect(manager.getAccessTokenSync()).toBeNull();
  });

  it('skips the keychain entirely when CLAUDE_CODE_DISABLE_KEYCHAIN is set', async () => {
    stubKeychain(JSON.stringify({ claudeAiOauth: OAUTH }));
    process.env.CLAUDE_CODE_DISABLE_KEYCHAIN = '1';
    const manager = await loadManager();

    expect(manager.getAccessTokenSync()).toBeNull();
  });

  it('keeps a disconnect disconnected even though the keychain still has the session', async () => {
    // The regression this guards: logout() used to delete the file, the
    // fallback would then answer from the keychain, and the provider would pop
    // straight back to connected — making disconnect unreachable.
    fs.writeFileSync(credPath, JSON.stringify({ claudeAiOauth: OAUTH }), 'utf8');
    stubKeychain(JSON.stringify({ claudeAiOauth: OAUTH }));
    const manager = await loadManager();
    expect(manager.getAccessTokenSync()).toBe(OAUTH.accessToken);

    const result = await manager.logout();

    expect(result.success).toBe(true);
    expect(manager.getAccessTokenSync()).toBeNull();
  });

  it('records the disconnect even when no credentials file was on disk', async () => {
    stubKeychain(JSON.stringify({ claudeAiOauth: OAUTH }));
    const manager = await loadManager();
    expect(manager.getAccessTokenSync()).toBe(OAUTH.accessToken);

    await manager.logout();

    expect(manager.getAccessTokenSync()).toBeNull();
  });

  it('lets a fresh login clear a previous disconnect', async () => {
    stubKeychain(JSON.stringify({ claudeAiOauth: OAUTH }));
    const manager = await loadManager();
    await manager.logout();
    expect(manager.getAccessTokenSync()).toBeNull();

    // A reconnect writes through the same path the OAuth exchange uses.
    fs.writeFileSync(
      credPath,
      JSON.stringify({ claudeAiOauth: { ...OAUTH, accessToken: 'sk-ant-oat-reconnected' } }),
      'utf8',
    );

    expect(manager.getAccessTokenSync()).toBe('sk-ant-oat-reconnected');
  });
});
