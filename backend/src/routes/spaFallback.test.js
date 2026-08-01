/**
 * The SPA fallback used to answer EVERY non-/api miss with index.html. That is
 * how a deleted chunk hash became a 200 OK text/html response, which the
 * browser refuses to run as a module and Vue renders as nothing at all.
 */

import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import { createSpaFallback } from './spaFallback.js';
import { isStaticAssetRequest } from '../utils/staticAssetRequest.js';

const DIST = path.join('/srv', 'frontend', 'dist');

function invoke(reqPath) {
  const res = {
    statusCode: null,
    body: null,
    sentFile: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    sendFile(file) {
      this.sentFile = file;
      return this;
    },
  };
  createSpaFallback({ frontendDistPath: DIST })({ path: reqPath }, res);
  return res;
}

describe('SPA fallback', () => {
  it('serves the app shell for real client-side routes', () => {
    for (const route of ['/settings', '/chat', '/workflow-forge', '/', '/traces/abc-123']) {
      const res = invoke(route);
      expect(res.sentFile, route).toBe(path.join(DIST, 'index.html'));
      expect(res.statusCode, route).toBeNull();
    }
  });

  it('404s a build artefact that no longer exists instead of serving HTML', () => {
    // The exact shape of the bug: a hash the running renderer still holds,
    // deleted by a rebuild.
    const res = invoke('/assets/js/Settings.B4rtEn8e.js');

    expect(res.statusCode).toBe(404);
    expect(res.sentFile).toBeNull();
    expect(res.body).toMatchObject({ error: 'Asset not found' });
  });

  it('404s every asset class a build emits, not just JS', () => {
    const artefacts = [
      '/assets/css/index.DEAAfVF5.css',
      '/assets/js/vendor-vue.CQb7z4lT.js',
      '/assets/png/logo.Ab3dEf12.png',
      '/assets/woff2/inter.C1d2E3f4.woff2',
      '/js/libs/highlight.js',
      '/images/agnt-logo.png',
      '/vendor/fontawesome/css/all.min.css',
    ];
    for (const artefact of artefacts) {
      expect(invoke(artefact).statusCode, artefact).toBe(404);
    }
  });

  it('still 404s API misses as JSON', () => {
    const res = invoke('/api/does-not-exist');
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ error: 'API endpoint not found' });
    expect(res.sentFile).toBeNull();
  });

  it('never sends a file and a status together', () => {
    const res = invoke('/agents');
    expect(res.sentFile).not.toBeNull();
    expect(res.body).toBeNull();
  });
});

describe('isStaticAssetRequest', () => {
  it('treats everything under /assets/ as a build artefact', () => {
    expect(isStaticAssetRequest('/assets/js/x.AAAAAAAA.js')).toBe(true);
    expect(isStaticAssetRequest('/assets/icons/some-icon.svg')).toBe(true);
    // Even an extensionless path there cannot be a route.
    expect(isStaticAssetRequest('/assets/weird')).toBe(true);
  });

  it('leaves extensionless routes to the SPA', () => {
    for (const route of ['/settings', '/', '/widget-forge', '/traces/1']) {
      expect(isStaticAssetRequest(route), route).toBe(false);
    }
  });

  it('leaves .html to the SPA — that is a document, not an artefact', () => {
    expect(isStaticAssetRequest('/index.html')).toBe(false);
    expect(isStaticAssetRequest('/lite/index.html')).toBe(false);
  });

  it('does not mistake a dotfile segment for an extension', () => {
    expect(isStaticAssetRequest('/.well-known')).toBe(false);
  });

  it('is case-insensitive about extensions', () => {
    expect(isStaticAssetRequest('/images/LOGO.PNG')).toBe(true);
  });

  it('rejects non-string input rather than throwing', () => {
    expect(isStaticAssetRequest(undefined)).toBe(false);
    expect(isStaticAssetRequest('')).toBe(false);
  });
});

describe('server.js uses the shared fallback', () => {
  it('has no second, divergent copy of the catch-all', async () => {
    const fs = await import('fs');
    const url = await import('url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const server = fs.readFileSync(path.join(here, '..', '..', 'server.js'), 'utf8');

    // If someone reintroduces a bare sendFile(index.html) catch-all, the asset
    // guard is bypassed and this regression returns silently.
    const bareFallbacks = server.match(/res\.sendFile\([^)]*index\.html/g) || [];
    expect(bareFallbacks, 'server.js should delegate to createSpaFallback').toHaveLength(0);
    expect(server).toMatch(/createSpaFallback/);
  });
});
