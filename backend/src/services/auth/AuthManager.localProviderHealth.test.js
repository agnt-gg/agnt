/**
 * WHY EVERY CLI PROVIDER STARTED REPORTING AS A BROKEN CONNECTION.
 *
 * Reported as: all six local CLI providers showed as not connected after a
 * restart, on a machine where every one of them was signed in — the provider
 * page said available, the integration grid said there was a problem.
 *
 * The health ladder answers "is this connection working?" with
 * getValidAccessToken(), which looks in an env var, the encrypted api_keys
 * table, and the remote key store. A CLI provider's credential is in NONE of
 * those — it is a file in the user's home directory or an OS keychain item —
 * so that call returns null for all six and the ladder records "No valid token
 * available".
 *
 * That was inert only while CLI providers were absent from getConnectedApps().
 * The moment discovery added them, they became connections that the health
 * check was structurally incapable of validating, and the grid started calling
 * a working machine broken.
 *
 * A credential that lives outside the vault has to be ASKED for, not looked up.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ENV_KEY_MAP from './envKeyMap.js';

const h = vi.hoisted(() => ({ entries: {}, apiKeyRows: [], oauthRows: [] }));

vi.mock('./AuthDispatcher.js', () => ({
  getAuthEntry: (id) => h.entries[id] || null,
  getCliProviderIds: () => Object.keys(h.entries).filter((k) => h.entries[k].local),
}));

vi.mock('./sessionDiscovery.js', () => ({
  discoverSessions: () => ({ sessions: [], connected: [], adoptable: [] }),
}));

vi.mock('../../models/database/index.js', () => ({
  default: {
    all: (sql, params, cb) => {
      if (/api_keys/.test(sql)) return cb(null, h.apiKeyRows);
      if (/oauth_tokens/.test(sql)) return cb(null, h.oauthRows);
      return cb(null, []);
    },
  },
}));

vi.mock('../../routes/Middleware.js', () => ({ getUserTokenFromSession: () => null }));
vi.mock('./sessionTokenCache.js', () => ({ authHeader: () => ({}), getSessionToken: () => null }));

let AuthManager;

/** A local CLI provider whose manager answers checkApiUsable. */
function localProvider(id, status) {
  h.entries[id] = {
    local: true,
    manager: { checkApiUsable: vi.fn(async () => status) },
    config: { name: id },
  };
}

beforeEach(async () => {
  vi.resetModules();
  h.entries = {};
  h.apiKeyRows = [];
  h.oauthRows = [];

  // getConnectedApps reads the REAL process.env through ENV_KEY_MAP, so any
  // provider key exported on the developer's machine joins the connected list
  // and then gets health-checked. That made `overall` degraded here for a
  // reason unrelated to what is being tested, and would have passed in CI.
  for (const envVar of Object.values(ENV_KEY_MAP)) vi.stubEnv(envVar, '');

  ({ default: AuthManager } = await import('./AuthManager.js'));
  AuthManager.remoteUrl = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Every health-record-shaped object anywhere in a stream update. */
function healthRecordsFor(updates, providerId) {
  const found = [];
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 4) return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    if (node.provider === providerId && typeof node.status === 'string') found.push(node);
    Object.values(node).forEach((v) => walk(v, depth + 1));
  };
  updates.forEach((u) => walk(u));
  return found;
}

describe('getLocalProviderHealth', () => {
  it('REGRESSION: a signed-in CLI provider is healthy even though the vault has no token', async () => {
    localProvider('claude-code', { available: true, apiUsable: true, source: 'claude-credentials', sourceLabel: 'AGNT credentials file' });
    // The vault genuinely cannot produce a token for it — that is the whole point.
    vi.spyOn(AuthManager, 'getValidAccessToken').mockResolvedValue(null);

    const health = await AuthManager.getLocalProviderHealth('claude-code');

    expect(health.status).toBe('healthy');
    expect(health.provider).toBe('claude-code');
    expect(health.details.source).toBe('AGNT credentials file');
  });

  it('never consults the token vault for a local provider', async () => {
    // Asking the vault at all is the defect; a token there is neither necessary
    // nor sufficient for a CLI session.
    localProvider('cursor-cli', { available: true, apiUsable: true });
    const vault = vi.spyOn(AuthManager, 'getValidAccessToken');

    await AuthManager.getLocalProviderHealth('cursor-cli');

    expect(vault).not.toHaveBeenCalled();
  });

  it('reports a CLI provider that is genuinely signed out as an error', async () => {
    // Anti-vacuity partner: without it, "healthy" could be unconditional.
    localProvider('grok-build', { available: false, apiUsable: false, hint: 'grok-build is not connected' });

    const health = await AuthManager.getLocalProviderHealth('grok-build');

    expect(health.status).toBe('error');
    expect(health.error).toBe('grok-build is not connected');
  });

  it('surfaces a throwing manager as an error rather than crashing the sweep', async () => {
    h.entries['antigravity'] = {
      local: true,
      manager: { checkApiUsable: vi.fn(async () => { throw new Error('keychain wedged'); }) },
      config: { name: 'antigravity' },
    };

    const health = await AuthManager.getLocalProviderHealth('antigravity');

    expect(health.status).toBe('error');
    expect(health.error).toBe('keychain wedged');
  });

  it('returns null for a remote provider so the token ladder still runs', async () => {
    h.entries['github'] = { local: false, manager: null, config: { name: 'GitHub' } };
    expect(await AuthManager.getLocalProviderHealth('github')).toBeNull();
  });

  it('returns null for an unknown provider', async () => {
    expect(await AuthManager.getLocalProviderHealth('nope')).toBeNull();
  });

  it('returns null for a local provider whose manager cannot answer', async () => {
    h.entries['weird'] = { local: true, manager: {}, config: { name: 'weird' } };
    expect(await AuthManager.getLocalProviderHealth('weird')).toBeNull();
  });
});

describe('checkConnectionHealth end to end', () => {
  it('reports a signed-in CLI provider as healthy instead of "No valid token available"', async () => {
    localProvider('claude-code', { available: true, apiUsable: true, sourceLabel: 'AGNT credentials file' });
    h.oauthRows = [{ provider_id: 'claude-code' }];
    vi.spyOn(AuthManager, 'getValidAccessToken').mockResolvedValue(null);

    const report = await AuthManager.checkConnectionHealth('user-1', null);
    const entry = report.providers.find((p) => p.provider === 'claude-code');

    expect(entry.status).toBe('healthy');
    expect(report.overall).toBe('healthy');
  });

  it('still marks a non-local provider with no token as an error', async () => {
    // The fall-through path must be untouched.
    h.entries['notion'] = { local: false, manager: null, config: { name: 'Notion' } };
    h.oauthRows = [{ provider_id: 'notion' }];
    vi.spyOn(AuthManager, 'getValidAccessToken').mockResolvedValue(null);

    const report = await AuthManager.checkConnectionHealth('user-1', null);

    expect(report.providers.find((p) => p.provider === 'notion').status).toBe('error');
  });
});

describe('the streaming path agrees with the non-streaming one', () => {
  it('streams healthy for the same CLI provider', async () => {
    // Two copies of this ladder exist. The UI streams from the other one, so a
    // fix applied to only one leaves the grid contradicting the provider page.
    localProvider('openai-codex', { available: true, apiUsable: true });
    h.oauthRows = [{ provider_id: 'openai-codex' }];
    vi.spyOn(AuthManager, 'getValidAccessToken').mockResolvedValue(null);

    const updates = [];
    await AuthManager.checkConnectionHealthStream('user-1', null, (u) => updates.push(u));

    const seen = healthRecordsFor(updates, 'openai-codex');

    expect(seen.length, 'the stream never reported on this provider at all').toBeGreaterThan(0);
    expect(seen.every((x) => x.status === 'healthy')).toBe(true);
  });
});
