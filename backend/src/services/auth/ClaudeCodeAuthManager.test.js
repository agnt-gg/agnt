/**
 * ClaudeCodeAuthManager — credential discovery, ownership, and the write path.
 *
 * This file did not exist before. 560 lines of credential handling with no
 * coverage is why BOTH of the defects it now pins went unnoticed:
 *   · issue #82 — a keychain-era CLI session was invisible to AGNT
 *   · the write path REPLACED the CLI's 7-key oauth block with AGNT's 4-key one
 *
 * Real fs against a temp HOME, real AGNT store (PathManager is already
 * redirected by tests/setup/isolate-data-dir.mjs). Only the process boundaries
 * — spawnSync for the keychain, axios for the network — are mocked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import realOs from 'os';
import path from 'path';

const h = vi.hoisted(() => ({
  home: '',
  keychainPayload: null,
  axiosPost: null,
}));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal();
  const patched = {
    ...actual.default,
    homedir: () => h.home,
    userInfo: () => ({ username: 'tester' }),
  };
  return { ...actual, default: patched, homedir: patched.homedir, userInfo: patched.userInfo };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    spawnSync: vi.fn(() => (h.keychainPayload === null
      ? { status: 44, stdout: '', stderr: '' }
      : { status: 0, stdout: h.keychainPayload, stderr: '' })),
  };
});

vi.mock('axios', () => ({
  default: { post: (...args) => h.axiosPost(...args) },
}));

vi.mock('../ai/clientVersions.js', () => ({
  getClientIdentity: async () => 'claude-cli/test',
  getClientVersion: async () => '2.1.231',
}));

const { default: manager } = await import('./ClaudeCodeAuthManager.js');
const agntStore = await import('./agntCredentialStore.js');
const { clearSecretCache } = await import('./secretStore.js');

const PROVIDER = 'claude-code';

// AGNT has only ever written these four keys.
const AGNT_SHAPED = {
  accessToken: 'sk-ant-oat-agnt-legacy',
  refreshToken: 'refresh-agnt',
  expiresAt: Date.now() + 3_600_000,
  scopes: ['user:inference'],
};

// The real file-era CLI writes those plus three of its own.
const CLI_SHAPED = {
  ...AGNT_SHAPED,
  accessToken: 'sk-ant-oat-cli-file',
  refreshToken: 'refresh-cli',
  subscriptionType: 'max',
  rateLimitTier: 'default',
  refreshTokenExpiresAt: Date.now() + 30 * 86_400_000,
};

function vendorPath() {
  return path.join(h.home, '.claude', '.credentials.json');
}

function writeVendorFile(contents) {
  fs.mkdirSync(path.join(h.home, '.claude'), { recursive: true });
  fs.writeFileSync(vendorPath(), JSON.stringify(contents, null, 2));
}

let platformSpy;

beforeEach(() => {
  h.home = fs.mkdtempSync(path.join(realOs.tmpdir(), 'agnt-claude-'));
  h.keychainPayload = null;
  h.axiosPost = vi.fn(async () => { throw new Error('no network call expected'); });

  agntStore.clearCredential(PROVIDER);
  clearSecretCache();
  manager.apiCheckCache = null;

  // readSecret is platform-gated; the dev box is win32.
  platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
});

afterEach(() => {
  platformSpy?.mockRestore();
  agntStore.clearCredential(PROVIDER);
  clearSecretCache();
  fs.rmSync(h.home, { recursive: true, force: true });
});

// ── Discovery ──────────────────────────────────────────────────────────

describe('discovery cascade', () => {
  it('reports nothing when the machine has no Claude session at all', () => {
    expect(manager.getAccessTokenSync()).toBeNull();
    expect(manager.describeCredential().connected).toBe(false);
  });

  it('ISSUE #82: finds a CLI session that exists ONLY in the keychain', () => {
    h.keychainPayload = JSON.stringify({ claudeAiOauth: CLI_SHAPED });

    expect(manager.getAccessTokenSync()).toBe('sk-ant-oat-cli-file');
    const described = manager.describeCredential();
    expect(described.connected).toBe(true);
    expect(described.source).toBe('claude-keychain');
    expect(described.ownedByAgnt).toBe(false);
  });

  it('prefers the vendor file over the keychain', () => {
    writeVendorFile({ claudeAiOauth: CLI_SHAPED });
    h.keychainPayload = JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-keychain' } });

    expect(manager.getAccessTokenSync()).toBe('sk-ant-oat-cli-file');
  });

  it("prefers AGNT's own store over everything — an in-app connect is the strongest intent", () => {
    agntStore.writeCredential(PROVIDER, { claudeAiOauth: { accessToken: 'sk-ant-oat-in-agnt' } });
    writeVendorFile({ claudeAiOauth: CLI_SHAPED });
    h.keychainPayload = JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-keychain' } });

    expect(manager.getAccessTokenSync()).toBe('sk-ant-oat-in-agnt');
    expect(manager.describeCredential().ownedByAgnt).toBe(true);
  });

  it('still reads legacy flat token fields', () => {
    writeVendorFile({ oauth_token: 'sk-ant-flat' });
    expect(manager.getAccessTokenSync()).toBe('sk-ant-flat');
  });

  it('ignores a keychain item that is not JSON', () => {
    h.keychainPayload = 'this is not json';
    expect(manager.getAccessTokenSync()).toBeNull();
  });

  it('ignores a keychain item with no token in it', () => {
    h.keychainPayload = JSON.stringify({ somethingElse: true });
    expect(manager.getAccessTokenSync()).toBeNull();
  });

  it('survives an unreadable vendor file and falls through to the keychain', () => {
    fs.mkdirSync(path.join(h.home, '.claude'), { recursive: true });
    fs.writeFileSync(vendorPath(), '{ truncated');
    h.keychainPayload = JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-keychain' } });

    expect(manager.getAccessTokenSync()).toBe('sk-ant-oat-keychain');
  });

  it('never touches the keychain when the opt-out is set', () => {
    vi.stubEnv('AGNT_DISABLE_SECRET_STORE', '1');
    h.keychainPayload = JSON.stringify({ claudeAiOauth: CLI_SHAPED });
    try {
      expect(manager.getAccessTokenSync()).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// ── Ownership ──────────────────────────────────────────────────────────

describe('ownership discriminator — shape is the evidence', () => {
  it('treats a 4-key block in ~/.claude as AGNT\'s own legacy write', () => {
    // AGNT wrote this path for its entire history. Getting this wrong strands
    // every existing user at their next token expiry.
    writeVendorFile({ claudeAiOauth: AGNT_SHAPED });
    expect(manager.describeCredential().ownedByAgnt).toBe(true);
  });

  it.each(['subscriptionType', 'rateLimitTier', 'refreshTokenExpiresAt'])(
    'treats a block carrying %s as the CLI\'s',
    (cliKey) => {
      writeVendorFile({ claudeAiOauth: { ...AGNT_SHAPED, [cliKey]: 'present' } });
      expect(manager.describeCredential().ownedByAgnt).toBe(false);
    },
  );

  it('always treats a keychain session as the CLI\'s', () => {
    h.keychainPayload = JSON.stringify({ claudeAiOauth: AGNT_SHAPED });
    expect(manager.describeCredential().ownedByAgnt).toBe(false);
  });
});

// ── Refresh guard ──────────────────────────────────────────────────────

describe('refresh must never rotate a credential AGNT does not own', () => {
  it('refuses to refresh a CLI-shaped vendor credential', async () => {
    writeVendorFile({ claudeAiOauth: { ...CLI_SHAPED, expiresAt: Date.now() + 1000 } });

    const result = await manager.refreshAccessToken();

    expect(result.success).toBe(false);
    expect(result.revoked).toBe(false);
    expect(h.axiosPost).not.toHaveBeenCalled();
  });

  it('refuses to refresh a keychain credential', async () => {
    h.keychainPayload = JSON.stringify({ claudeAiOauth: { ...CLI_SHAPED, expiresAt: Date.now() + 1000 } });

    const result = await manager.refreshAccessToken();

    expect(result.success).toBe(false);
    expect(h.axiosPost).not.toHaveBeenCalled();
  });

  it('returns the CLI token as-is when it is near expiry instead of rotating it', async () => {
    // The owning CLI refreshes on its own schedule; we re-read the result.
    writeVendorFile({ claudeAiOauth: { ...CLI_SHAPED, expiresAt: Date.now() + 1000 } });

    const token = await manager.getAccessToken({ autoRefresh: true });

    expect(token).toBe('sk-ant-oat-cli-file');
    expect(h.axiosPost).not.toHaveBeenCalled();
  });

  it('does not even ENTER the refresh machinery for a credential it does not own', async () => {
    // There are deliberately two guards: getAccessToken() short-circuits, and
    // _doRefresh() refuses. Either alone prevents the network call, so a test
    // that only asserts "axios was not called" cannot tell them apart — a
    // mutation removing the outer one survived exactly that assertion.
    //
    // The observable difference is that the outer guard keeps a hot-path token
    // read out of the refresh mutex entirely, instead of queueing on it to be
    // told no. That is what this pins.
    writeVendorFile({ claudeAiOauth: { ...CLI_SHAPED, expiresAt: Date.now() + 1000 } });
    const refreshSpy = vi.spyOn(manager, 'refreshAccessToken');

    try {
      const token = await manager.getAccessToken({ autoRefresh: true });
      expect(token).toBe('sk-ant-oat-cli-file');
      expect(refreshSpy).not.toHaveBeenCalled();
    } finally {
      refreshSpy.mockRestore();
    }
  });

  it('DOES enter the refresh machinery for a credential it owns — the guard is not "never refresh"', async () => {
    // Anti-vacuity partner for the test above: without this, "never calls
    // refreshAccessToken" would pass against a manager that never refreshes.
    agntStore.writeCredential(PROVIDER, {
      claudeAiOauth: { ...AGNT_SHAPED, expiresAt: Date.now() + 1000 },
    });
    h.axiosPost = vi.fn(async () => ({
      data: { access_token: 'sk-ant-oat-refreshed', refresh_token: 'r', expires_in: 28800 },
    }));
    const refreshSpy = vi.spyOn(manager, 'refreshAccessToken');

    try {
      const token = await manager.getAccessToken({ autoRefresh: true });
      expect(refreshSpy).toHaveBeenCalled();
      expect(token).toBe('sk-ant-oat-refreshed');
    } finally {
      refreshSpy.mockRestore();
    }
  });

  it('DOES refresh a credential in AGNT\'s own store', async () => {
    agntStore.writeCredential(PROVIDER, {
      claudeAiOauth: { ...AGNT_SHAPED, accessToken: 'old', expiresAt: Date.now() + 1000 },
    });
    h.axiosPost = vi.fn(async () => ({
      data: { access_token: 'sk-ant-oat-fresh', refresh_token: 'refresh-2', expires_in: 28800, scope: 'user:inference' },
    }));

    const result = await manager.refreshAccessToken();

    expect(result.success).toBe(true);
    expect(result.accessToken).toBe('sk-ant-oat-fresh');
    expect(agntStore.readCredential(PROVIDER).claudeAiOauth.accessToken).toBe('sk-ant-oat-fresh');
  });

  it('MIGRATION: refreshing a legacy AGNT block moves it into the store and leaves ~/.claude untouched', async () => {
    writeVendorFile({
      claudeAiOauth: { ...AGNT_SHAPED, expiresAt: Date.now() + 1000 },
      unrelatedSetting: 'must survive',
    });
    const before = fs.readFileSync(vendorPath(), 'utf8');
    h.axiosPost = vi.fn(async () => ({
      data: { access_token: 'sk-ant-oat-migrated', refresh_token: 'r2', expires_in: 28800 },
    }));

    const result = await manager.refreshAccessToken();

    expect(result.success).toBe(true);
    expect(agntStore.readCredential(PROVIDER).claudeAiOauth.accessToken).toBe('sk-ant-oat-migrated');
    expect(fs.readFileSync(vendorPath(), 'utf8')).toBe(before);
  });

  it('reports a transient network failure without clearing anything', async () => {
    agntStore.writeCredential(PROVIDER, {
      claudeAiOauth: { ...AGNT_SHAPED, expiresAt: Date.now() + 1000 },
    });
    h.axiosPost = vi.fn(async () => { throw Object.assign(new Error('socket hang up'), { response: undefined }); });

    const result = await manager.refreshAccessToken();

    expect(result.success).toBe(false);
    expect(result.revoked).toBe(false);
    expect(agntStore.readCredential(PROVIDER)).not.toBeNull();
  });
});

// ── Write path ─────────────────────────────────────────────────────────

describe('AGNT writes only to its own store', () => {
  it('saveManualToken never creates or modifies ~/.claude', async () => {
    h.axiosPost = vi.fn(async () => ({ status: 200 }));

    const result = await manager.saveManualToken('sk-ant-oat-pasted');

    expect(result.success).toBe(true);
    expect(agntStore.readCredential(PROVIDER).claudeAiOauth.accessToken).toBe('sk-ant-oat-pasted');
    expect(fs.existsSync(vendorPath())).toBe(false);
  });

  it('REGRESSION: a refresh no longer strips the CLI\'s extra keys', async () => {
    // The old writeClaudeCredentials() did `existing.claudeAiOauth = oauthData`,
    // destroying subscriptionType / rateLimitTier / refreshTokenExpiresAt.
    writeVendorFile({ claudeAiOauth: CLI_SHAPED });
    agntStore.writeCredential(PROVIDER, {
      claudeAiOauth: { ...AGNT_SHAPED, expiresAt: Date.now() + 1000 },
    });
    h.axiosPost = vi.fn(async () => ({ data: { access_token: 'new', refresh_token: 'r', expires_in: 28800 } }));

    await manager.refreshAccessToken();

    const vendorBlock = JSON.parse(fs.readFileSync(vendorPath(), 'utf8')).claudeAiOauth;
    expect(vendorBlock.subscriptionType).toBe('max');
    expect(vendorBlock.rateLimitTier).toBe('default');
    expect(vendorBlock.refreshTokenExpiresAt).toBeDefined();
  });

  it('getCredentialsPath points at the AGNT store, not the vendor directory', () => {
    expect(manager.getCredentialsPath()).not.toContain('.claude');
    expect(manager.getCredentialsPath()).toContain('provider-credentials');
  });
});

// ── Disconnect ─────────────────────────────────────────────────────────

describe('disconnect is honest about what it can and cannot revoke', () => {
  it('removes AGNT\'s own credential', async () => {
    agntStore.writeCredential(PROVIDER, { claudeAiOauth: AGNT_SHAPED });

    const result = await manager.logout();

    expect(result.success).toBe(true);
    expect(result.stillDetected).toBeFalsy();
    expect(manager.getAccessTokenSync()).toBeNull();
  });

  it('does NOT delete the CLI\'s keychain session, and says so', async () => {
    agntStore.writeCredential(PROVIDER, { claudeAiOauth: AGNT_SHAPED });
    h.keychainPayload = JSON.stringify({ claudeAiOauth: CLI_SHAPED });

    const result = await manager.logout();

    expect(result.success).toBe(true);
    expect(result.stillDetected).toBe(true);
    expect(result.message).toMatch(/claude logout/);
    // Still discoverable — we removed ours, not theirs.
    expect(manager.getAccessTokenSync()).toBe('sk-ant-oat-cli-file');
  });

  it('does NOT delete the CLI\'s credentials file, and says so', async () => {
    writeVendorFile({ claudeAiOauth: CLI_SHAPED });

    const result = await manager.logout();

    expect(result.stillDetected).toBe(true);
    expect(fs.existsSync(vendorPath())).toBe(true);
  });

  it('DOES clear a legacy AGNT block from ~/.claude, preserving unrelated keys', async () => {
    writeVendorFile({ claudeAiOauth: AGNT_SHAPED, unrelatedSetting: 'must survive' });

    const result = await manager.logout();

    expect(result.success).toBe(true);
    const remaining = JSON.parse(fs.readFileSync(vendorPath(), 'utf8'));
    expect(remaining.claudeAiOauth).toBeUndefined();
    expect(remaining.unrelatedSetting).toBe('must survive');
    expect(manager.getAccessTokenSync()).toBeNull();
  });

  it('succeeds when there is nothing to disconnect', async () => {
    await expect(manager.logout()).resolves.toMatchObject({ success: true });
  });
});

// ── Status ─────────────────────────────────────────────────────────────

describe('status reports real provenance', () => {
  it('names the source instead of a constant, so the UI can explain itself', async () => {
    h.keychainPayload = JSON.stringify({ claudeAiOauth: CLI_SHAPED });
    h.axiosPost = vi.fn(async () => ({ status: 200 }));

    const status = await manager.checkApiUsable({ forceRefresh: true });

    expect(status.available).toBe(true);
    expect(status.source).toBe('claude-keychain');
    expect(status.sourceLabel).toBe('CLI session in OS keychain');
    expect(status.ownedByAgnt).toBe(false);
  });

  it('distinguishes an in-app connect', async () => {
    agntStore.writeCredential(PROVIDER, { claudeAiOauth: AGNT_SHAPED });
    h.axiosPost = vi.fn(async () => ({ status: 200 }));

    const status = await manager.checkApiUsable({ forceRefresh: true });

    expect(status.source).toBe('agnt-store');
    expect(status.sourceLabel).toBe('connected in AGNT');
    expect(status.ownedByAgnt).toBe(true);
  });

  it('reports disconnected cleanly with no credential', async () => {
    const status = await manager.checkApiUsable({ forceRefresh: true });
    expect(status.available).toBe(false);
    expect(status.source).toBeNull();
  });
});
