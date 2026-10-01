/**
 * Which provider/model a chat turn runs on.
 *
 * THE BUG THIS EXISTS TO PREVENT
 * A turn that named no pair read the account default. When that default was
 * missing, the settings layer substituted a hardcoded vendor and retired
 * model the account might not even have, so the turn always failed before
 * the failover chain rescued it. With no default, the turn now runs on the
 * user's own fallback chain first.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveTurnProvider, firstFallbackTier } from './resolveTurnProvider.js';

const DEFAULT = { selectedProvider: 'Claude-Code', selectedModel: 'claude-opus-5-5' };
const FALLBACK = {
  fallbackEnabled: true,
  fallbackProviders: [{ provider: 'OpenAI-Codex', model: 'gpt-6-astra' }],
};

describe('resolveTurnProvider', () => {
  it('a full request pair wins and nothing else is consulted', async () => {
    const loadUserSettings = vi.fn();
    const result = await resolveTurnProvider({ requestProvider: 'groq', requestModel: 'llama', loadUserSettings });
    expect(result).toEqual({ provider: 'groq', model: 'llama', source: 'request' });
    expect(loadUserSettings).not.toHaveBeenCalled();
  });

  it("the conversation's saved pair beats the agent and the account default", async () => {
    const result = await resolveTurnProvider({
      conversationSettings: { provider: 'gemini-cli', model: 'gemini-4-pro' },
      loadAgent: async () => ({ provider: 'openai', model: 'gpt-6' }),
      loadUserSettings: async () => DEFAULT,
    });
    expect(result).toEqual({ provider: 'gemini-cli', model: 'gemini-4-pro', source: 'conversation' });
  });

  it("the agent's own pair beats the account default", async () => {
    const result = await resolveTurnProvider({
      loadAgent: async () => ({ provider: 'openai', model: 'gpt-6' }),
      loadUserSettings: async () => DEFAULT,
    });
    expect(result.source).toBe('agent');
  });

  it('the account default is used when nothing above names a pair', async () => {
    const result = await resolveTurnProvider({ loadUserSettings: async () => ({ ...DEFAULT, ...FALLBACK }) });
    expect(result).toEqual({ provider: 'Claude-Code', model: 'claude-opus-5-5', source: 'default' });
  });

  it('THE REPORTED BUG: no default goes straight to the fallback chain, never a vendor guess', async () => {
    const scanCredentials = vi.fn(async () => ({ provider: 'any-vendor', model: 'any-model' }));
    const result = await resolveTurnProvider({
      loadUserSettings: async () => ({ selectedProvider: null, selectedModel: null, ...FALLBACK }),
      scanCredentials,
    });
    expect(result).toEqual({ provider: 'openai-codex', model: 'gpt-6-astra', source: 'fallback' });
    expect(scanCredentials).not.toHaveBeenCalled();
  });

  it('a default provider with no model is not runnable and falls to the chain', async () => {
    const result = await resolveTurnProvider({
      loadUserSettings: async () => ({ selectedProvider: 'Claude-Code', selectedModel: null, ...FALLBACK }),
    });
    expect(result.source).toBe('fallback');
  });

  it("a provider-only request never borrows ANOTHER provider's model", async () => {
    // Default is Claude-Code; the request names OpenAI-Codex alone. The old
    // ladder completed it with claude-opus-5-5, an id OpenAI-Codex rejects.
    const result = await resolveTurnProvider({
      requestProvider: 'OpenAI-Codex',
      loadUserSettings: async () => DEFAULT,
    });
    expect(result.provider).toBe('OpenAI-Codex');
    expect(result.model).not.toBe('claude-opus-5-5');
    expect(result.source).toBe('request+catalog');
    expect(typeof result.model).toBe('string');
  });

  it('a provider-only request takes the fallback tier model when that tier is the same provider', async () => {
    const result = await resolveTurnProvider({
      requestProvider: 'openai-codex',
      loadUserSettings: async () => ({ selectedProvider: null, selectedModel: null, ...FALLBACK }),
    });
    expect(result).toEqual({ provider: 'openai-codex', model: 'gpt-6-astra', source: 'request+fallback' });
  });

  it('halves from different rungs are never mixed when the request named nothing', async () => {
    const result = await resolveTurnProvider({
      loadAgent: async () => ({ provider: 'openai', model: null }),
      loadUserSettings: async () => DEFAULT,
    });
    expect(result).toEqual({ provider: 'Claude-Code', model: 'claude-opus-5-5', source: 'default' });
  });

  it('a request that named half a pair is completed from the first rung that can', async () => {
    const result = await resolveTurnProvider({
      requestProvider: 'Claude-Code',
      loadUserSettings: async () => DEFAULT,
    });
    expect(result).toEqual({ provider: 'Claude-Code', model: 'claude-opus-5-5', source: 'request+default' });
  });

  it('the credential scan runs only when the chain is off or empty', async () => {
    const result = await resolveTurnProvider({
      loadUserSettings: async () => ({ selectedProvider: null, selectedModel: null, fallbackEnabled: false }),
      scanCredentials: async () => ({ provider: 'groq', model: 'llama' }),
    });
    expect(result.source).toBe('credentials');
  });

  it('a failing rung is skipped, not fatal', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await resolveTurnProvider({
      loadAgent: async () => { throw new Error('db locked'); },
      loadUserSettings: async () => DEFAULT,
    });
    expect(result.source).toBe('default');
    warn.mockRestore();
  });

  it('settings are read once for both the default and fallback rungs', async () => {
    const loadUserSettings = vi.fn(async () => ({ selectedProvider: null, selectedModel: null, ...FALLBACK }));
    await resolveTurnProvider({ loadUserSettings });
    expect(loadUserSettings).toHaveBeenCalledTimes(1);
  });

  it('nothing anywhere resolves to nulls so the caller can reject loudly', async () => {
    expect(await resolveTurnProvider({})).toEqual({ provider: null, model: null, source: null });
  });
});

describe('firstFallbackTier', () => {
  it('is null when failover is switched off, even with tiers configured', () => {
    expect(firstFallbackTier({ ...FALLBACK, fallbackEnabled: false })).toBeNull();
  });

  it('normalises a display name to the registry key', () => {
    expect(firstFallbackTier(FALLBACK)).toEqual({ provider: 'openai-codex', model: 'gpt-6-astra' });
  });

  it('skips a tier with no provider and resolves a missing model from the registry', () => {
    const tier = firstFallbackTier({
      fallbackEnabled: true,
      fallbackProviders: [{ provider: '  ' }, { provider: 'OpenAI', model: null }],
    });
    expect(tier.provider).toBe('openai');
    expect(typeof tier.model).toBe('string');
    expect(tier.model.length).toBeGreaterThan(0);
  });

  it('accepts the raw JSON column as well as a parsed array', () => {
    expect(firstFallbackTier({ fallbackEnabled: true, fallbackProviders: JSON.stringify(FALLBACK.fallbackProviders) }))
      .toEqual({ provider: 'openai-codex', model: 'gpt-6-astra' });
  });
});
