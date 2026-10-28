import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import PluginInstaller, { updateOriginRefusal } from './PluginInstaller.js';

/**
 * An installed plugin takes updates only from the publisher it came from.
 *
 * The marketplace catalogue is keyed by plugin name, and updates install
 * silently when they ask for no new permissions. So "a newer version exists
 * under this name" is not enough: the newer version has to come from the same
 * place as the installed one.
 *
 *   - A plugin that ships in the app's built-in catalogue is replaced only by
 *     AGNT's own (official) listing of it, for fresh installs and updates.
 *   - A plugin installed from the marketplace records its publisher, and only
 *     that publisher's listing can update it.
 */

const STRANGER = 'publisher-stranger';
const AUTHOR = 'publisher-author';
const AGNT = 'publisher-agnt';

function listing({ id, version, publisher, official = false }) {
  return {
    id: `listing-${id}-${publisher}`,
    asset_id: id,
    title: id,
    current_version: version,
    publisher_id: publisher,
    trust_tier: official ? 'official' : 'community',
    metadata: JSON.stringify({ downloadUrl: `https://api.agnt.gg/marketplace/plugins/${id}/download` }),
  };
}

describe('PluginInstaller — updates come from the installed copy\'s publisher', () => {
  let tempDir;
  let saved;
  let downloads;

  async function setUp({ bundled = [], remote = [], installed = [] }) {
    await fs.writeFile(PluginInstaller.marketplacePath, JSON.stringify({ plugins: bundled }));
    await fs.writeFile(PluginInstaller.registryPath, JSON.stringify({ plugins: installed }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (String(url).includes('/marketplace/items')) return { ok: true, status: 200, json: async () => ({ items: remote }) };
        if (String(url).includes('/download')) {
          downloads++;
          return { ok: false, status: 500, statusText: 'test: download must not be reached' };
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );
  }

  beforeEach(async () => {
    downloads = 0;
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-publisher-pin-'));
    saved = { marketplacePath: PluginInstaller.marketplacePath, registryPath: PluginInstaller.registryPath };
    PluginInstaller.marketplacePath = path.join(tempDir, 'marketplace.json');
    PluginInstaller.registryPath = path.join(tempDir, 'registry.json');
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    Object.assign(PluginInstaller, saved);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('the catalogue', () => {
    it('keeps the bundled copy when a stranger lists a newer version under its name', async () => {
      await setUp({
        bundled: [{ name: 'gmail-plugin', version: '1.1.0', downloadUrl: 'file://marketplace-default/gmail-plugin.agnt' }],
        remote: [listing({ id: 'gmail-plugin', version: '9.9.9', publisher: STRANGER })],
      });
      const { plugins } = await PluginInstaller.getMarketplaceRegistry();
      const gmail = plugins.find((p) => p.name === 'gmail-plugin');
      expect(gmail.source).toBe('local');
      expect(gmail.version).toBe('1.1.0');
    });

    it('takes AGNT\'s official listing of a bundled plugin', async () => {
      await setUp({
        bundled: [{ name: 'gmail-plugin', version: '1.1.0', downloadUrl: 'file://marketplace-default/gmail-plugin.agnt' }],
        remote: [listing({ id: 'gmail-plugin', version: '1.2.0', publisher: AGNT, official: true })],
      });
      const gmail = (await PluginInstaller.getMarketplaceRegistry()).plugins.find((p) => p.name === 'gmail-plugin');
      expect(gmail.source).toBe('remote');
      expect(gmail.version).toBe('1.2.0');
      expect(gmail.publisherId).toBe(AGNT);
    });

    it('lists marketplace-only plugins with their publisher', async () => {
      await setUp({ remote: [listing({ id: 'acme-plugin', version: '1.0.0', publisher: AUTHOR })] });
      const acme = (await PluginInstaller.getMarketplaceRegistry()).plugins.find((p) => p.name === 'acme-plugin');
      expect(acme.publisherId).toBe(AUTHOR);
    });
  });

  describe('checkForUpdates', () => {
    it('offers no update to a bundled install from a stranger\'s newer listing', async () => {
      await setUp({
        bundled: [{ name: 'gmail-plugin', version: '1.1.0', downloadUrl: 'file://marketplace-default/gmail-plugin.agnt' }],
        remote: [listing({ id: 'gmail-plugin', version: '9.9.9', publisher: STRANGER })],
        installed: [{ name: 'gmail-plugin', version: '1.1.0', trustTier: 'official' }],
      });
      const { updates } = await PluginInstaller.checkForUpdates();
      expect(updates.find((u) => u.name === 'gmail-plugin').updateAvailable).toBe(false);
    });

    it('refuses an official install an update from a non-official listing once it has left the bundle', async () => {
      // sentinel left the built-in catalogue; installs taken from the old bundle remain.
      await setUp({
        remote: [listing({ id: 'sentinel', version: '2.0.0', publisher: STRANGER })],
        installed: [{ name: 'sentinel', version: '1.0.0', trustTier: 'official' }],
      });
      const update = (await PluginInstaller.checkForUpdates()).updates.find((u) => u.name === 'sentinel');
      expect(update.updateAvailable).toBe(false);
      expect(update.status).toBe('publisher-changed');
    });

    it('offers the official install AGNT\'s own newer listing', async () => {
      await setUp({
        remote: [listing({ id: 'sentinel', version: '2.0.0', publisher: AGNT, official: true })],
        installed: [{ name: 'sentinel', version: '1.0.0', trustTier: 'official' }],
      });
      const update = (await PluginInstaller.checkForUpdates()).updates.find((u) => u.name === 'sentinel');
      expect(update.updateAvailable).toBe(true);
    });

    it('pins a marketplace install to the publisher it recorded', async () => {
      await setUp({
        remote: [listing({ id: 'acme-plugin', version: '2.0.0', publisher: STRANGER })],
        installed: [{ name: 'acme-plugin', version: '1.0.0', publisherId: AUTHOR, trustTier: 'community' }],
      });
      const update = (await PluginInstaller.checkForUpdates()).updates.find((u) => u.name === 'acme-plugin');
      expect(update.updateAvailable).toBe(false);
      expect(update.status).toBe('publisher-changed');
    });

    it('offers the same publisher\'s newer version', async () => {
      await setUp({
        remote: [listing({ id: 'acme-plugin', version: '2.0.0', publisher: AUTHOR })],
        installed: [{ name: 'acme-plugin', version: '1.0.0', publisherId: AUTHOR, trustTier: 'community' }],
      });
      const update = (await PluginInstaller.checkForUpdates()).updates.find((u) => u.name === 'acme-plugin');
      expect(update.updateAvailable).toBe(true);
    });
  });

  describe('updatePlugin', () => {
    it('refuses before downloading anything when the publisher differs', async () => {
      await setUp({
        remote: [listing({ id: 'acme-plugin', version: '2.0.0', publisher: STRANGER })],
        installed: [{ name: 'acme-plugin', version: '1.0.0', publisherId: AUTHOR, trustTier: 'community' }],
      });
      const result = await PluginInstaller.updatePlugin('acme-plugin');
      expect(result.success).toBe(false);
      expect(result.publisherChanged).toBe(true);
      expect(downloads).toBe(0);
      const registry = JSON.parse(await fs.readFile(PluginInstaller.registryPath, 'utf-8'));
      expect(registry.plugins[0]).toMatchObject({ version: '1.0.0', publisherId: AUTHOR });
    });
  });

  describe('updateOriginRefusal', () => {
    const official = { trustTier: 'official' };
    it.each([
      ['recorded publisher, same publisher', { publisherId: AUTHOR }, { publisherId: AUTHOR }, false],
      ['recorded publisher, different publisher', { publisherId: AUTHOR }, { publisherId: STRANGER }, true],
      ['recorded publisher, record without one', { publisherId: AUTHOR }, {}, true],
      ['official install, official record', official, { trustTier: 'official', publisherId: AGNT }, false],
      ['official install, community record', official, { trustTier: 'community', publisherId: STRANGER }, true],
      ['official install, bundled record', official, { source: 'local' }, false],
      ['older install with nothing recorded', { trustTier: 'community' }, { publisherId: STRANGER }, false],
    ])('%s', (_label, installed, record, refused) => {
      expect(Boolean(updateOriginRefusal(installed, record))).toBe(refused);
    });
  });
});
