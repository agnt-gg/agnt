/**
 * Background work (generators, evals, experiments, tools, workflow nodes)
 * runs on the account's own AI, and says so plainly when there is none.
 *
 * THE BUG THIS EXISTS TO PREVENT
 * Each of these services carried its own hardcoded vendor fallback. On an
 * account without that vendor every call failed, and the failure read as a
 * provider error instead of what it was: nothing configured.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const settingsByUser = new Map();
vi.mock('../../models/UserModel.js', () => ({
  default: { getUserSettings: vi.fn(async (userId) => settingsByUser.get(userId) ?? null) },
}));

const { resolveAccountAi, resolveAccountImageProvider, NoAiConfiguredError } = await import('./accountAi.js');

beforeEach(() => settingsByUser.clear());

describe('resolveAccountAi', () => {
  it('uses the account default', async () => {
    settingsByUser.set('u', { selectedProvider: 'Claude-Code', selectedModel: 'claude-opus-5-5' });
    expect(await resolveAccountAi('u')).toMatchObject({ provider: 'Claude-Code', model: 'claude-opus-5-5', source: 'default' });
  });

  it('a pair the caller names wins', async () => {
    settingsByUser.set('u', { selectedProvider: 'Claude-Code', selectedModel: 'claude-opus-5-5' });
    expect(await resolveAccountAi('u', { provider: 'groq', model: 'm' })).toMatchObject({ provider: 'groq', model: 'm' });
  });

  it('no default: the fallback chain', async () => {
    settingsByUser.set('u', {
      selectedProvider: null, selectedModel: null, fallbackEnabled: true,
      fallbackProviders: [{ provider: 'OpenAI-Codex', model: 'gpt-6-astra' }],
    });
    expect(await resolveAccountAi('u')).toMatchObject({ provider: 'openai-codex', model: 'gpt-6-astra', source: 'fallback' });
  });

  it('nothing configured: a clear error, never a guessed vendor', async () => {
    settingsByUser.set('u', { selectedProvider: null, selectedModel: null, fallbackEnabled: false });
    await expect(resolveAccountAi('u')).rejects.toBeInstanceOf(NoAiConfiguredError);
    await expect(resolveAccountAi(null)).rejects.toThrow(/No AI model is configured/);
  });
});

describe('resolveAccountImageProvider', () => {
  it('skips a default that cannot make images and takes the first tier that can', async () => {
    settingsByUser.set('u', {
      selectedProvider: 'Claude-Code', selectedModel: 'claude-opus-5-5', fallbackEnabled: true,
      fallbackProviders: [{ provider: 'OpenAI', model: null }],
    });
    expect(await resolveAccountImageProvider('u')).toBe('openai');
  });

  it('is null when none of the account providers can make images', async () => {
    settingsByUser.set('u', { selectedProvider: 'Claude-Code', selectedModel: 'claude-opus-5-5', fallbackEnabled: false });
    expect(await resolveAccountImageProvider('u')).toBeNull();
  });
});
