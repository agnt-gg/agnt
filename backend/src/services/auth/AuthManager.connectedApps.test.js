/**
 * getConnectedApps — does the "what am I connected to?" list know about a CLI
 * session the user created in their terminal?
 *
 * Before issue #82 it did not, and that produced two answers to one question:
 * the provider page asks checkApiUsable() and said "available", while the
 * integration grid and every isProviderConnected() check ask THIS function and
 * said "no". A user could be signed in, be able to run inference, and still be
 * shown a Connect button.
 *
 * The database is mocked because getConnectedApps only needs two SELECTs from
 * it, and importing the real module runs the entire schema boot as an import
 * side effect.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ENV_KEY_MAP from './envKeyMap.js';

const h = vi.hoisted(() => ({
  sessions: { sessions: [], connected: [], adoptable: [] },
  discoverThrows: false,
  apiKeyRows: [],
  oauthRows: [],
  dbThrows: false,
}));

vi.mock('../../models/database/index.js', () => ({
  default: {
    all: (sql, params, cb) => {
      if (h.dbThrows) return cb(new Error('database is locked'));
      if (/api_keys/.test(sql)) return cb(null, h.apiKeyRows);
      if (/oauth_tokens/.test(sql)) return cb(null, h.oauthRows);
      return cb(null, []);
    },
  },
}));

vi.mock('./sessionDiscovery.js', () => ({
  discoverSessions: () => {
    if (h.discoverThrows) throw new Error('a CLI manager exploded');
    return h.sessions;
  },
}));

vi.mock('../../routes/Middleware.js', () => ({ getUserTokenFromSession: () => null }));
vi.mock('./sessionTokenCache.js', () => ({ authHeader: () => ({}), getSessionToken: () => null }));

let AuthManager;

function cliSession(providerId, ownedByAgnt = false) {
  return { providerId, providerName: providerId, connected: true, ownedByAgnt };
}

function setSessions(...list) {
  h.sessions = { sessions: list, connected: list.filter((s) => s.connected), adoptable: [] };
}

beforeEach(async () => {
  vi.resetModules();
  h.sessions = { sessions: [], connected: [], adoptable: [] };
  h.discoverThrows = false;
  h.apiKeyRows = [];
  h.oauthRows = [];
  h.dbThrows = false;

  // Source 1 of getConnectedApps reads the REAL process.env through
  // ENV_KEY_MAP. On a developer machine that means every provider key they
  // happen to have exported shows up in the result, so these assertions passed
  // or failed depending on whose shell ran them — they failed here on a box
  // with OPENAI_API_KEY set, and would have passed in CI.
  //
  // Blank them all. Any test that wants an env-sourced provider stubs it back
  // in explicitly, which also documents what it is testing.
  for (const envVar of Object.values(ENV_KEY_MAP)) vi.stubEnv(envVar, '');

  ({ default: AuthManager } = await import('./AuthManager.js'));
  // Keep the remote lane out of it — these tests are about the local union.
  AuthManager.remoteUrl = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const idsFrom = (apps) => apps.map((a) => a.providerId).sort();

describe('a CLI session the user made in their terminal', () => {
  it('THE BUG: a discovered session now appears as connected', async () => {
    setSessions(cliSession('claude-code'));

    const apps = await AuthManager.getConnectedApps('user-1', null);

    expect(idsFrom(apps)).toContain('claude-code');
    expect(apps.find((a) => a.providerId === 'claude-code').connected).toBe(true);
  });

  it('lists every connected CLI provider, not just the first', async () => {
    setSessions(cliSession('claude-code'), cliSession('gemini-cli'), cliSession('cursor-cli'));

    expect(idsFrom(await AuthManager.getConnectedApps('user-1', null)))
      .toEqual(['claude-code', 'cursor-cli', 'gemini-cli']);
  });

  it('does not invent a connection for a provider reporting disconnected', async () => {
    // Anti-vacuity: without this, "adds what discovery returns" would pass
    // against an implementation that adds everything unconditionally.
    h.sessions = {
      sessions: [{ providerId: 'grok-build', connected: false, ownedByAgnt: false }],
      connected: [],
      adoptable: [],
    };

    expect(idsFrom(await AuthManager.getConnectedApps('user-1', null))).not.toContain('grok-build');
  });

  it('reports a session AGNT owns and one it merely discovered identically', async () => {
    // This list answers "can I use it?", not "who owns it?". Ownership gates
    // refresh and disconnect, and lives on the status payload instead.
    setSessions(cliSession('claude-code', true), cliSession('cursor-cli', false));

    expect(idsFrom(await AuthManager.getConnectedApps('user-1', null)))
      .toEqual(['claude-code', 'cursor-cli']);
  });

  it('does not duplicate a provider that is also stored locally', async () => {
    h.oauthRows = [{ provider_id: 'claude-code' }];
    setSessions(cliSession('claude-code'));

    const apps = await AuthManager.getConnectedApps('user-1', null);

    expect(apps.filter((a) => a.providerId === 'claude-code')).toHaveLength(1);
  });
});

describe('discovery must never cost the user their other integrations', () => {
  it('keeps saved API keys when discovery throws', async () => {
    h.apiKeyRows = [{ provider_id: 'openai' }, { provider_id: 'slack' }];
    h.discoverThrows = true;

    expect(idsFrom(await AuthManager.getConnectedApps('user-1', null))).toEqual(['openai', 'slack']);
  });

  it('still reports CLI sessions when the database lookups fail', async () => {
    // The inverse guarantee: the two local lanes are independent.
    h.dbThrows = true;
    setSessions(cliSession('claude-code'));

    expect(idsFrom(await AuthManager.getConnectedApps('user-1', null))).toEqual(['claude-code']);
  });

  it('returns an empty list, not a throw, when everything fails', async () => {
    h.dbThrows = true;
    h.discoverThrows = true;

    await expect(AuthManager.getConnectedApps('user-1', null)).resolves.toEqual([]);
  });
});

describe('existing sources still work', () => {
  it('merges env keys, stored keys, OAuth rows and CLI sessions', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-from-env');
    h.apiKeyRows = [{ provider_id: 'anthropic' }];
    h.oauthRows = [{ provider_id: 'github' }];
    setSessions(cliSession('claude-code'));

    expect(idsFrom(await AuthManager.getConnectedApps('user-1', null)))
      .toEqual(['anthropic', 'claude-code', 'github', 'openai']);
  });

  it('an env key alone still connects a provider with no CLI session', async () => {
    // Guards the blanking above from becoming "source 1 is switched off".
    vi.stubEnv('XAI_API_KEY', 'xai-from-env');

    expect(idsFrom(await AuthManager.getConnectedApps('user-1', null))).toEqual(['grokai']);
  });
});
