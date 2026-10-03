import { describe, it, expect, vi, beforeEach } from 'vitest';
const accounts = vi.hoisted(() => new Map());
vi.mock('../../models/UserModel.js', () => ({ default: {
  getPreferences: vi.fn(async id => ({ global: { ...(accounts.get(id) || {}) } })),
  updatePreferences: vi.fn(async (id, patch) => accounts.set(id, { ...(accounts.get(id) || {}), ...patch.global })),
} }));
import { LOCAL_PROVIDER_ACCESS_KEYS, isLocalProviderDisconnected, setLocalProviderDisconnected, assertLocalProviderAccess } from './localProviderAccess.js';
beforeEach(() => accounts.clear());
describe('account-scoped local provider disconnect', () => {
  it.each(Object.keys(LOCAL_PROVIDER_ACCESS_KEYS))('%s disconnect affects only the authenticated account and reconnect reverses it', async provider => {
    await setLocalProviderDisconnected('alice', provider, true);
    expect(await isLocalProviderDisconnected('alice', provider)).toBe(true);
    expect(await isLocalProviderDisconnected('bob', provider)).toBe(false);
    await expect(assertLocalProviderAccess('alice', provider)).rejects.toMatchObject({ code: 'PROVIDER_DISCONNECTED' });
    await expect(assertLocalProviderAccess('bob', provider)).resolves.toBeUndefined();
    await setLocalProviderDisconnected('alice', provider, false);
    await expect(assertLocalProviderAccess('alice', provider)).resolves.toBeUndefined();
  });
  it('display names and the codex scheme address the same opt-out as the registry key', async () => {
    await setLocalProviderDisconnected('alice', 'Claude-Code', true);
    expect(await isLocalProviderDisconnected('alice', 'claude-code')).toBe(true);
    await setLocalProviderDisconnected('alice', 'codex', true);
    expect(await isLocalProviderDisconnected('alice', 'openai-codex')).toBe(true);
  });

  it('refuses missing identity; never guesses the last active account', async () => {
    await expect(setLocalProviderDisconnected(null, 'openai-codex', true)).rejects.toThrow('account');
    await expect(assertLocalProviderAccess(null, 'openai-codex')).rejects.toThrow('account');
  });
  it('does not interfere with standard providers', async () => {
    await expect(assertLocalProviderAccess('alice', 'openai')).resolves.toBeUndefined();
  });
});
