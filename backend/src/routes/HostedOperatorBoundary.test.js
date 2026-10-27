import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHostedOperatorBoundary } from './HostedOperatorBoundary.js';

// Reported on a hosted instance: every artifact preview and "Open original" answered
// {"error":"Authentication required","reason":"missing"} while the Files page listed the file.
// The browser loads those URLs itself and sends the media cookie, never a header.
const OWNER = 'owner-1';
let previous;
beforeEach(() => { previous = { ...process.env }; process.env.AGNT_TENANT_SLUG = 'bravo'; process.env.AGNT_TENANT_OWNER = OWNER; });
afterEach(() => { process.env = previous; });

function run(boundary, req) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ next: false, status: this.statusCode, body }); } };
    boundary(req, res, () => resolve({ next: true }));
  });
}
const asOwner = (req, _res, next) => { req.user = { id: OWNER }; next(); };
const request = (method, url) => ({ method, originalUrl: url, path: url.replace(/^\/api/, ''), headers: {} });

describe('hosted operator boundary', () => {
  it('authenticates a browser media load with the media guard, not the header-only one', async () => {
    const header = vi.fn((_req, res) => res.status(401).json({ reason: 'missing' }));
    const media = vi.fn(asOwner);
    const boundary = createHostedOperatorBoundary(header, { request: vi.fn() }, media);
    for (const url of ['/api/local-preview/app/data/projects/x/index.html', '/api/local-file/app/data/projects/x/a.png', '/api/filesystem/raw?path=a.png']) {
      expect(await run(boundary, request('GET', url)), url).toEqual({ next: true });
    }
    expect(header).not.toHaveBeenCalled();
    expect(media).toHaveBeenCalledTimes(3);
  });

  it('keeps mutating and non-media machine APIs header-authenticated', async () => {
    const header = vi.fn(asOwner);
    const media = vi.fn(asOwner);
    const boundary = createHostedOperatorBoundary(header, { request: vi.fn() }, media);
    for (const [method, url] of [['POST', '/api/plugins/install'], ['POST', '/api/filesystem/file'], ['GET', '/api/filesystem/list'], ['DELETE', '/api/local-file/x']]) {
      await run(boundary, request(method, url));
    }
    expect(header).toHaveBeenCalledTimes(4);
    expect(media).not.toHaveBeenCalled();
  });

  it('a member reads the plugin list without being an administrator', async () => {
    // Measured on bravo 2026-10-27: a member's app got "/plugins/installed returned 403".
    const cloud = { request: vi.fn(async () => [{ tenantSlug: 'bravo', role: 'member', id: 't1' }]), access: vi.fn(async () => ({})) };
    const asMember = (req, _res, next) => { req.user = { id: 'member-2' }; next(); };
    const boundary = createHostedOperatorBoundary(asMember, cloud);
    for (const url of ['/api/plugins/installed', '/api/plugins/installed/blog-generator', '/api/plugins/marketplace', '/api/plugins/tools', '/api/plugins/updates', '/api/plugins/update-status']) {
      expect(await run(boundary, request('GET', url)), url).toEqual({ next: true });
    }
    expect(cloud.request).not.toHaveBeenCalled();
  });

  it('plugin administration and plugin source stay administrator-only for a member', async () => {
    const cloud = { request: vi.fn(async () => [{ tenantSlug: 'bravo', role: 'member', id: 't1' }]), access: vi.fn(async () => ({})) };
    const asMember = (req, _res, next) => { req.user = { id: 'member-2' }; next(); };
    const boundary = createHostedOperatorBoundary(asMember, cloud);
    for (const [method, url] of [['POST', '/api/plugins/install-file'], ['POST', '/api/plugins/install-github'], ['POST', '/api/plugins/update/blog-generator'], ['DELETE', '/api/plugins/installed/blog-generator'], ['GET', '/api/plugins/installed/blog-generator/source'], ['GET', '/api/plugins/installed/blog-generator/package'], ['GET', '/api/plugins/inspect/blog-generator']]) {
      expect(await run(boundary, request(method, url)), `${method} ${url}`).toMatchObject({ next: false, status: 403 });
    }
  });

  it('a member reaches the account check to switch on an installed plugin (POST /plugins/install only)', async () => {
    // The account boundary marks it activation-only; the install route then reuses the
    // exact package already on disk or refuses with admin_install_required.
    const cloud = { request: vi.fn(async () => [{ tenantSlug: 'bravo', role: 'member', id: 't1' }]), access: vi.fn(async () => ({})) };
    const asMember = (req, _res, next) => { req.user = { id: 'member-2' }; next(); };
    const boundary = createHostedOperatorBoundary(asMember, cloud);
    expect(await run(boundary, request('POST', '/api/plugins/install'))).toEqual({ next: true });
    expect(await run(boundary, request('GET', '/api/plugins/install'))).toMatchObject({ next: false, status: 403 });
  });

  it('a non-owner media load is checked with the cookie credential it arrived with', async () => {
    const cloud = { request: vi.fn(async () => [{ tenantSlug: 'bravo', role: 'admin', id: 't1' }]), access: vi.fn(async () => ({})) };
    const media = (req, _res, next) => { req.user = { id: 'admin-2' }; next(); };
    const boundary = createHostedOperatorBoundary(vi.fn(), cloud, media);
    const req = { ...request('GET', '/api/local-file/a.png'), headers: { cookie: 'agnt_media_token=cookie-token' } };
    expect(await run(boundary, req)).toEqual({ next: true });
    expect(cloud.request).toHaveBeenCalledWith('Bearer cookie-token', '');
  });
});
