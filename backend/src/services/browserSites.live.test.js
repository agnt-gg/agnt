/**
 * LIVE gate for Settings › Browser: reading and forgetting a site's cookies in
 * a REAL Chromium (hidden, temporary profile). Skips when none is installed.
 *
 * The thing only a real browser can judge: that a host-only cookie and a
 * domain cookie are both really deleted (they are addressed differently), and
 * that another site's cookies survive.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ensureFallbackSurface, closeFallbackSurfaceGracefully, installedBrowsers,
} from '../tools/library/browserEngines/browserFallbackSurface.js';
import { CdpConnection } from './cdpConnection.js';
import { readSites, forgetSite } from './browserSites.js';

const haveBrowser = installedBrowsers().length > 0;
let cdpUrl;

beforeAll(async () => {
  if (!haveBrowser) return;
  cdpUrl = await ensureFallbackSurface({ hidden: true, log: () => {} });
  // The first cookie call waits for the cookie store to load (browserSites.js);
  // pay that here, where a slow cold start is not the thing under test.
  await readSites(cdpUrl);
}, 120000);

afterAll(async () => {
  if (haveBrowser) await closeFallbackSurfaceGracefully();
}, 20000);

async function plant(cookies) {
  const connection = await new CdpConnection(cdpUrl).connect({ timeoutMs: 10000 });
  try {
    // The first cookie call on a fresh profile waits for the store to load (browserSites.js).
    await connection.send('Storage.setCookies', { cookies }, undefined, { timeoutMs: 30000 });
  } finally {
    connection.close();
  }
}

describe.skipIf(!haveBrowser)('signed-in sites, in a real browser', () => {
  it('lists sites without values, and signing out removes host-only AND domain cookies of that site only', async () => {
    const inAnHour = Math.floor(Date.now() / 1000) + 3600;
    await plant([
      { name: 'sid', value: 'secret-domain', domain: '.example.test', path: '/', secure: true, expires: inAnHour },
      { name: 'host', value: 'secret-host', url: 'https://app.example.test/', secure: true, expires: inAnHour },
      { name: 'keep', value: 'secret-other', domain: '.other.test', path: '/', expires: inAnHour },
    ]);

    const before = await readSites(cdpUrl);
    expect(before.find((s) => s.site === 'example.test')).toMatchObject({ cookies: 2, session: false });
    expect(before.find((s) => s.site === 'other.test')).toMatchObject({ cookies: 1 });
    expect(JSON.stringify(before)).not.toMatch(/secret/);

    expect(await forgetSite(cdpUrl, 'example.test')).toEqual({ removed: 2, remaining: 0 });

    const after = await readSites(cdpUrl);
    expect(after.find((s) => s.site === 'example.test')).toBeUndefined();
    expect(after.find((s) => s.site === 'other.test')).toMatchObject({ cookies: 1 });
  }, 60000);
});
