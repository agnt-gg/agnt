/**
 * A plugin package shared by several accounts on one computer can still be
 * updated from the marketplace, on the background updater's terms.
 *
 * Reported 2026-10-22: Atlas Cloud 1.1.8 (a fix) could not be installed. The
 * 2026-10-05 migration granted every pre-account package to every account in
 * the database (including test and blank rows), and this boundary refused any
 * change to a package another account also owns, so 95 packages could never
 * be updated by anyone. The background updater, which applies the same update
 * to every account, was allowed to; the Update button was not.
 */
import { describe, it, expect, vi } from 'vitest';

const owners = { 'atlas-cloud': ['me', 'other'], solo: ['me'] };
vi.mock('./PluginAccountStore.js', () => ({
  default: {
    ready: async () => {},
    owners: async (name) => owners[name] || [],
    assert: async (name, userId) => {
      if (!(owners[name] || []).includes(userId)) throw Object.assign(new Error('Plugin is not installed for this account'), { status: 404 });
    },
  },
}));
import { pluginAccountBoundary } from './pluginAccountRoutes.js';

async function boundary({ method = 'POST', path, body = {}, user = 'me' }) {
  const req = { method, path, body, user: { id: user } };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const next = vi.fn();
  await pluginAccountBoundary(req, res, next);
  return { req, res, next, status: res.status.mock.calls[0]?.[0], error: res.json.mock.calls[0]?.[0]?.error };
}

describe('updating a package other accounts also use', () => {
  it('a plain update goes through, marked as a shared-package update', async () => {
    const r = await boundary({ path: '/update/atlas-cloud' });
    expect(r.next).toHaveBeenCalledOnce();
    expect(r.req.sharedPackageUpdate).toBe(true);
  });

  it('approving new permissions for everyone from one account is refused', async () => {
    const r = await boundary({ path: '/update/atlas-cloud', body: { acceptedPermissions: true } });
    expect(r.next).not.toHaveBeenCalled();
    expect(r.status).toBe(409);
    expect(r.error).toMatch(/new permissions/);
  });

  it('every other change to shared code is still refused', async () => {
    for (const path of ['/update-policy/atlas-cloud', '/installed/atlas-cloud']) {
      const r = await boundary({ path });
      expect(r.next, path).not.toHaveBeenCalled();
      expect(r.status, path).toBe(409);
    }
  });

  it('a package this account alone uses is unchanged: no shared marker', async () => {
    const r = await boundary({ path: '/update/solo', body: { acceptedPermissions: true } });
    expect(r.next).toHaveBeenCalledOnce();
    expect(r.req.sharedPackageUpdate).toBeUndefined();
  });

  it('an account that does not have the plugin still cannot update it', async () => {
    const r = await boundary({ path: '/update/atlas-cloud', user: 'stranger' });
    expect(r.next).not.toHaveBeenCalled();
    expect(r.status).toBe(404);
  });
});
