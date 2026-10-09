import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiFetch } from '@/utils/apiFetch.js';
import { inspectPlugin, fetchPluginAssets, fetchUpdateStatus, requestUpdate, setUpdatePolicy, uninstallPlugin } from './pluginLifecycle.js';

vi.mock('@/utils/apiFetch.js', () => ({ apiFetch: vi.fn() }));
const reply = (body, { ok = true, badJson = false } = {}) => ({ ok, json: async () => { if (badJson) throw new SyntaxError('Unexpected token <'); return body; } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('pluginLifecycle', () => {
  it('encodes names and sends mutations as POST/DELETE with JSON bodies', async () => {
    apiFetch.mockResolvedValue(reply({ success: true }));
    await setUpdatePolicy('a b', 'pinned');
    await uninstallPlugin('a b');
    await requestUpdate('a b', { acceptedPermissions: true });
    expect(apiFetch.mock.calls[0][0]).toMatch(/\/plugins\/update-policy\/a%20b$/);
    expect(apiFetch.mock.calls[0][1]).toEqual({ method: 'POST', body: JSON.stringify({ policy: 'pinned' }) });
    expect(apiFetch.mock.calls[1][0]).toMatch(/\/plugins\/a%20b\?mode=clean$/);
    expect(apiFetch.mock.calls[1][1]).toEqual({ method: 'DELETE' });
    expect(apiFetch.mock.calls[2][1]).toEqual({ method: 'POST', body: JSON.stringify({ acceptedPermissions: true }) });
  });

  it('an update that asks for new access returns the diff instead of throwing', async () => {
    apiFetch.mockResolvedValue(reply({ success: false, requiresConsent: true, permissionDiff: { added: ['filesystem'] } }));
    await expect(requestUpdate('obsidian')).resolves.toMatchObject({ requiresConsent: true, permissionDiff: { added: ['filesystem'] } });
  });

  it('failures throw the server message, or a readable fallback', async () => {
    apiFetch.mockResolvedValueOnce(reply({ success: false, error: 'Plugin not installed' }, { ok: false }));
    await expect(uninstallPlugin('x')).rejects.toThrow('Plugin not installed');
    apiFetch.mockResolvedValueOnce(reply({}, { ok: false, badJson: true }));
    await expect(requestUpdate('x')).rejects.toThrow('Update failed');
    apiFetch.mockResolvedValueOnce(reply({ error: 'nope' }, { ok: false }));
    await expect(inspectPlugin('x')).rejects.toThrow('nope');
    apiFetch.mockResolvedValueOnce(reply({ success: false }));
    await expect(fetchPluginAssets('x')).rejects.toThrow('Unable to load installed contents.');
  });

  it('refuses an unknown update policy before calling the server', async () => {
    await expect(setUpdatePolicy('x', 'notify')).rejects.toThrow('Unknown update policy');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('update status: a missing endpoint or pass is null, not an error', async () => {
    apiFetch.mockResolvedValueOnce(reply({}, { ok: false, badJson: true }));
    await expect(fetchUpdateStatus()).resolves.toBeNull();
    apiFetch.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchUpdateStatus()).resolves.toBeNull();
    apiFetch.mockResolvedValueOnce(reply({ success: true, status: { blockedOnConsent: [] } }));
    await expect(fetchUpdateStatus()).resolves.toEqual({ blockedOnConsent: [] });
  });

  it('assets default to an empty list', async () => {
    apiFetch.mockResolvedValue(reply({ success: true }));
    await expect(fetchPluginAssets('x')).resolves.toEqual([]);
  });
});
