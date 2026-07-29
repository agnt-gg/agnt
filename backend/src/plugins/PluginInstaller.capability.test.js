import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';

import PluginInstaller from './PluginInstaller.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Download capabilities for paid marketplace packages.
 *
 * WHY THIS EXISTS
 * ---------------
 * api.agnt.gg now gates the plugin download route: a paid package answers 403
 * unless the URL carries a short-lived, per-user signature. The desktop app
 * could not satisfy that, and the reason is a wiring failure rather than a
 * logic one:
 *
 *   - the marketplace `installItem` endpoint DOES return a signed URL, but the
 *     frontend forwarded only `{ name, version }` to the local backend and
 *     dropped it;
 *   - the local backend then re-read the downloadUrl from the PUBLIC catalog,
 *     which is unsigned by design \u2014 a catalog served to everyone cannot carry a
 *     per-user capability;
 *   - so all THREE local paths (install, update, pre-install inspection) fetched
 *     an unsigned URL, and every one of them would have 403'd on a paid package.
 *
 * The catalog also carries no price field, so the client cannot know in advance
 * whether a capability is needed. fetchMarketplaceArchive therefore asks for one
 * only when the server actually refuses.
 *
 * Every test below distinguishes "works" from "works for the right reason" by
 * counting requests: a free download that quietly started asking the API for
 * permission would still pass a naive assertion.
 */
describe('PluginInstaller — download capabilities', () => {
  let tempDir;
  let tempFile;
  let calls;

  const ARCHIVE = Buffer.from('fake-tar-gz-bytes');
  const PLUGIN = {
    name: 'acme-plugin',
    downloadUrl: 'https://api.agnt.gg/marketplace/plugins/acme-plugin/download',
  };

  /** A fetch double that records every call and replies from a script. */
  function mockFetch(handlers) {
    return vi.fn(async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || 'GET', headers: options.headers || {} });
      for (const [pattern, respond] of handlers) {
        if (String(url).includes(pattern)) return respond(String(url));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
  }

  const ok = () => ({ ok: true, status: 200, statusText: 'OK', body: Readable.from([ARCHIVE]) });
  const status = (code, statusText, json) => ({
    ok: false,
    status: code,
    statusText,
    body: null,
    json: async () => json || {},
  });

  beforeEach(async () => {
    calls = [];
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-capability-'));
    tempFile = path.join(tempDir, 'archive.tar.gz');
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('free packages are unaffected', () => {
    it('downloads in a single request and never asks for a capability', async () => {
      vi.stubGlobal('fetch', mockFetch([['/download', ok]]));

      await PluginInstaller.fetchMarketplaceArchive(PLUGIN, tempFile, { authToken: 'Bearer tok' });

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(PLUGIN.downloadUrl);
      // The capability endpoint must not be consulted when nothing refused us:
      // an extra round trip on every free install would be a real regression.
      expect(calls.some((c) => c.url.includes('download-url'))).toBe(false);
      expect(await fs.readFile(tempFile)).toEqual(ARCHIVE);
    });

    it('works with no token at all', async () => {
      vi.stubGlobal('fetch', mockFetch([['/download', ok]]));
      await PluginInstaller.fetchMarketplaceArchive(PLUGIN, tempFile);
      expect(calls).toHaveLength(1);
    });
  });

  describe('paid packages with a token', () => {
    it('mints a signed link on 403 and retries exactly once', async () => {
      const signed = `${PLUGIN.downloadUrl}?uid=u1&exp=99999999999&sig=abc`;
      let downloadAttempts = 0;

      vi.stubGlobal(
        'fetch',
        mockFetch([
          ['download-url', async () => ({ ok: true, status: 200, json: async () => ({ downloadUrl: signed, signed: true }) })],
          [
            '/download',
            async (url) => {
              downloadAttempts++;
              return url.includes('sig=') ? ok() : status(403, 'Forbidden');
            },
          ],
        ])
      );

      await PluginInstaller.fetchMarketplaceArchive(PLUGIN, tempFile, { authToken: 'Bearer tok' });

      expect(downloadAttempts).toBe(2);
      expect(await fs.readFile(tempFile)).toEqual(ARCHIVE);

      const mint = calls.find((c) => c.url.includes('download-url'));
      expect(mint).toBeDefined();
      expect(mint.method).toBe('POST');
      expect(mint.headers.Authorization).toBe('Bearer tok');
    });

    it('normalises a bare token into a Bearer header', async () => {
      const signed = `${PLUGIN.downloadUrl}?sig=abc`;
      vi.stubGlobal(
        'fetch',
        mockFetch([
          ['download-url', async () => ({ ok: true, status: 200, json: async () => ({ downloadUrl: signed }) })],
          ['/download', async (url) => (url.includes('sig=') ? ok() : status(403, 'Forbidden'))],
        ])
      );

      await PluginInstaller.fetchMarketplaceArchive(PLUGIN, tempFile, { authToken: 'raw-token-no-scheme' });

      expect(calls.find((c) => c.url.includes('download-url')).headers.Authorization).toBe('Bearer raw-token-no-scheme');
    });

    it('does not retry forever when the capability is itself rejected', async () => {
      // A second 403 means the signed link was refused. Retrying again would
      // turn one clear failure into an unbounded loop against the API.
      let downloadAttempts = 0;
      vi.stubGlobal(
        'fetch',
        mockFetch([
          ['download-url', async () => ({ ok: true, status: 200, json: async () => ({ downloadUrl: `${PLUGIN.downloadUrl}?sig=stale` }) })],
          [
            '/download',
            async () => {
              downloadAttempts++;
              return status(403, 'Forbidden');
            },
          ],
        ])
      );

      await expect(PluginInstaller.fetchMarketplaceArchive(PLUGIN, tempFile, { authToken: 'tok' })).rejects.toThrow(/403/);
      expect(downloadAttempts).toBe(2);
    });

    it('derives the API origin from the download URL, so self-hosting works', async () => {
      const selfHosted = {
        name: 'acme-plugin',
        downloadUrl: 'https://marketplace.example.com/marketplace/plugins/acme-plugin/download',
      };
      vi.stubGlobal(
        'fetch',
        mockFetch([
          ['download-url', async () => ({ ok: true, status: 200, json: async () => ({ downloadUrl: `${selfHosted.downloadUrl}?sig=x` }) })],
          ['/download', async (url) => (url.includes('sig=') ? ok() : status(403, 'Forbidden'))],
        ])
      );

      await PluginInstaller.fetchMarketplaceArchive(selfHosted, tempFile, { authToken: 'tok' });

      const mint = calls.find((c) => c.url.includes('download-url'));
      expect(mint.url.startsWith('https://marketplace.example.com/')).toBe(true);
    });
  });

  describe('failures explain themselves', () => {
    it('a 403 with no token names the cause and the remedy', async () => {
      vi.stubGlobal('fetch', mockFetch([['/download', async () => status(403, 'Forbidden')]]));

      // The background update scheduler runs with no token by design, so this
      // is the message a user will actually be shown. "Download failed: 403"
      // would send them looking in the wrong place entirely.
      await expect(PluginInstaller.fetchMarketplaceArchive(PLUGIN, tempFile)).rejects.toThrow(/paid package/i);
      await expect(PluginInstaller.fetchMarketplaceArchive(PLUGIN, tempFile)).rejects.toThrow(/signed in/i);

      // And it must not have attempted a capability request without credentials.
      expect(calls.some((c) => c.url.includes('download-url'))).toBe(false);
    });

    it('402 from the capability endpoint is reported as "not purchased"', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch([
          ['download-url', async () => status(402, 'Payment Required', { error: 'Payment required', price: 9.99 })],
          ['/download', async () => status(403, 'Forbidden')],
        ])
      );

      await expect(PluginInstaller.fetchMarketplaceArchive(PLUGIN, tempFile, { authToken: 'tok' })).rejects.toThrow(
        /has not purchased/i
      );
    });

    it('401 from the capability endpoint is reported as an expired session', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch([
          ['download-url', async () => status(401, 'Unauthorized')],
          ['/download', async () => status(403, 'Forbidden')],
        ])
      );

      await expect(PluginInstaller.fetchMarketplaceArchive(PLUGIN, tempFile, { authToken: 'expired' })).rejects.toThrow(
        /session has expired/i
      );
    });

    it('a non-403 failure is passed through untouched', async () => {
      vi.stubGlobal('fetch', mockFetch([['/download', async () => status(500, 'Internal Server Error')]]));
      await expect(PluginInstaller.fetchMarketplaceArchive(PLUGIN, tempFile, { authToken: 'tok' })).rejects.toThrow(/500/);
      expect(calls.some((c) => c.url.includes('download-url'))).toBe(false);
    });

    it('a missing downloadUrl still fails early', async () => {
      await expect(PluginInstaller.fetchMarketplaceArchive({ name: 'x' }, tempFile)).rejects.toThrow(/No downloadUrl/);
    });
  });

  describe('local file:// records are untouched', () => {
    it('copies without any network access', async () => {
      const source = path.join(tempDir, 'local.tar.gz');
      await fs.writeFile(source, ARCHIVE);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('file:// records must never hit the network');
        })
      );

      const localsDir = path.resolve(__dirname, '../../plugins');
      const relative = path.relative(localsDir, source).split(path.sep).join('/');

      await PluginInstaller.fetchMarketplaceArchive({ name: 'local', downloadUrl: `file://${relative}` }, tempFile);
      expect(await fs.readFile(tempFile)).toEqual(ARCHIVE);
    });
  });

  /**
   * SOURCE CONTRACT.
   *
   * The original defect was that a correctly-minted capability was never
   * carried to the code that needed it. Behaviour tests on fetchMarketplaceArchive
   * cannot catch that: they pass whether or not any caller supplies a token.
   * These assertions pin the wiring itself.
   */
  describe('every caller threads the token (wiring)', () => {
    let installerSource;
    let routesSource;

    beforeEach(async () => {
      installerSource = await fs.readFile(path.join(__dirname, 'PluginInstaller.js'), 'utf-8');
      routesSource = await fs.readFile(path.join(__dirname, '../routes/PluginRoutes.js'), 'utf-8');
    });

    it('no call site fetches an archive without passing authToken', () => {
      const callSites = [...installerSource.matchAll(/this\.fetchMarketplaceArchive\([^)]*\)/g)].map((m) => m[0]);

      // Anti-vacuity: if this finds nothing, the assertion below is empty.
      expect(callSites.length).toBe(3);
      for (const site of callSites) {
        expect(site, `${site} does not forward a capability token`).toMatch(/authToken/);
      }
    });

    it('all three public entry points accept a token', () => {
      for (const signature of [
        /async installFromMarketplace\(pluginName, version = 'latest', \{ authToken/,
        /async updatePlugin\(pluginName, \{ acceptedPermissions = false, authToken/,
        /async inspectMarketplacePlugin\(pluginName, \{ authToken/,
      ]) {
        expect(installerSource).toMatch(signature);
      }
    });

    it('the routes forward the caller\'s Authorization header', () => {
      // Three routes, each of which must hand its own request's credential down.
      const forwards = [...routesSource.matchAll(/authToken: req\.headers\.authorization/g)];
      expect(forwards.length).toBe(3);
    });

    it('the background scheduler deliberately passes no token', async () => {
      // Unattended updates cannot authenticate on a user's behalf: there is no
      // request to take a credential from, and nothing persists one. So an
      // auto-update of a PAID package fails with the explanatory 403 message
      // above, by design.
      //
      // This is a recorded limitation rather than an oversight, and it is
      // asserted so that changing it is a deliberate act: the day a token is
      // persisted for background use, this test fails and forces that decision
      // to be made explicitly rather than drifting in.
      const schedulerSource = await fs.readFile(path.join(__dirname, 'UpdateScheduler.js'), 'utf-8');

      const updateCalls = [...schedulerSource.matchAll(/updatePlugin\([^)]*\)/g)].map((m) => m[0]);
      expect(updateCalls.length).toBeGreaterThan(0); // anti-vacuity
      for (const call of updateCalls) {
        expect(call, `${call} now carries a token — see the note above before changing this`).not.toMatch(/authToken/);
      }
    });
  });
});
