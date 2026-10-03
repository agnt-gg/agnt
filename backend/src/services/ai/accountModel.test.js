/**
 * A signed-in account that chose nothing runs on AGNT's own model, from every
 * resolver: chat turns, background work and the account helper. Reported as
 * "AGNT Model not connecting for free account by default".
 */
import { describe, it, expect, afterEach } from 'vitest';
import { rememberSessionToken, __resetSessionTokenCacheForTests } from '../auth/sessionTokenCache.js';
import { accountModelPair } from './accountModel.js';
import { resolveTurnProvider } from '../orchestrator/resolveTurnProvider.js';
import { resolveChain } from './ModelRouter.js';
import { createProviderHealth } from './providerHealth.js';

// An unsigned JWT-shaped token: the cache reads its expiry, nothing verifies it here.
const token = (sub) => ['e30', Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'sig'].join('.');

afterEach(() => __resetSessionTokenCacheForTests());

describe('accountModelPair', () => {
  it('is AGNT Flash for a signed-in account', () => {
    rememberSessionToken(token('alice'), 'alice');
    expect(accountModelPair('alice')).toEqual({ provider: 'agnt', model: 'agnt-flash' });
  });

  it('is nothing without that account’s own live session', () => {
    expect(accountModelPair('alice')).toBeNull();
    rememberSessionToken(token('bob'), 'bob');
    expect(accountModelPair('alice')).toBeNull();
    expect(accountModelPair(null)).toBeNull();
  });
});

describe('resolveTurnProvider account rung', () => {
  const account = async () => ({ provider: 'agnt', model: 'agnt-flash' });

  it('a chat turn with no default runs on AGNT before guessing from stored keys', async () => {
    let scanned = false;
    const result = await resolveTurnProvider({
      loadUserSettings: async () => ({ selectedProvider: null, selectedModel: null }),
      loadAccountModel: account,
      scanCredentials: async () => { scanned = true; return { provider: 'openai', model: 'x' }; },
    });
    expect(result).toEqual({ provider: 'agnt', model: 'agnt-flash', source: 'account' });
    expect(scanned).toBe(false);
  });

  it('never overrides a choice the user made, including their fallback chain', async () => {
    const chosen = await resolveTurnProvider({ loadUserSettings: async () => ({ selectedProvider: 'openai', selectedModel: 'gpt' }), loadAccountModel: account });
    expect(chosen.source).toBe('default');
    const chain = await resolveTurnProvider({
      loadUserSettings: async () => ({ fallbackEnabled: true, fallbackProviders: [{ provider: 'groq', model: 'llama' }] }),
      loadAccountModel: account,
    });
    expect(chain.source).toBe('fallback');
  });
});

describe('background work with no default', () => {
  const deps = (accountModel) => ({
    loadUserSettings: async () => ({ selectedProvider: null, selectedModel: null }),
    loadCustomProviders: async () => [],
    buildRoutedChain: async () => null,
    health: createProviderHealth(),
    accountModel,
  });

  it('routes to AGNT instead of throwing "No AI model is configured"', async () => {
    const { chain } = await resolveChain({ userId: 'alice', origin: 'goal_eval', routing: 'never' }, deps(() => ({ provider: 'agnt', model: 'agnt-flash' })));
    expect(chain.map((t) => `${t.provider}/${t.model}`)).toEqual(['agnt/agnt-flash']);
  });

  it('still reports nothing configured when there is no signed-in account', async () => {
    const { chain } = await resolveChain({ userId: 'alice', origin: 'goal_eval', routing: 'never' }, deps(() => null));
    expect(chain).toEqual([]);
  });
});
