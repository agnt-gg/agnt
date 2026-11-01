import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import PluginInstaller from './PluginInstaller.js';

/**
 * Every install starts with the Google suite and nothing else: the catalog entries marked
 * installByDefault go in once, through the normal (verified) marketplace install, and a plugin
 * the user removes stays removed. All other AGNT plugins live on the marketplace.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const GOOGLE = ['gmail-plugin', 'google-calendar-plugin', 'google-docs-plugin', 'google-drive-plugin', 'google-meet-plugin', 'google-sheets-plugin', 'google-slides-plugin'];

describe('default plugins', () => {
  let tempDir, saved, installs;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-defaults-'));
    saved = { marketplacePath: PluginInstaller.marketplacePath, registryPath: PluginInstaller.registryPath, pluginsDir: PluginInstaller.pluginsDir, installFromMarketplace: PluginInstaller.installFromMarketplace };
    PluginInstaller.marketplacePath = path.join(tempDir, 'marketplace.json');
    PluginInstaller.registryPath = path.join(tempDir, 'registry.json');
    PluginInstaller.pluginsDir = path.join(tempDir, 'installed');
    installs = [];
    PluginInstaller.installFromMarketplace = vi.fn(async (name) => {
      installs.push(name);
      await fs.mkdir(path.join(PluginInstaller.pluginsDir, name), { recursive: true });
      await fs.writeFile(path.join(PluginInstaller.pluginsDir, name, 'manifest.json'), '{}');
      return { success: true };
    });
    await fs.writeFile(PluginInstaller.marketplacePath, JSON.stringify({ plugins: [
      { name: 'gmail-plugin', installByDefault: true }, { name: 'google-drive-plugin', installByDefault: true }, { name: 'calculator-plugin' },
    ] }));
  });
  afterEach(async () => {
    Object.assign(PluginInstaller, saved);
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const registry = async () => JSON.parse(await fs.readFile(PluginInstaller.registryPath, 'utf8'));

  it('installs only the entries marked installByDefault, once', async () => {
    expect(await PluginInstaller.installCatalogDefaults()).toEqual({ installed: ['gmail-plugin', 'google-drive-plugin'], failed: [] });
    expect((await registry()).defaultsSeeded).toEqual(['gmail-plugin', 'google-drive-plugin']);
    // A second start does nothing, even if the user has since deleted the folder by hand.
    await fs.rm(path.join(PluginInstaller.pluginsDir, 'gmail-plugin'), { recursive: true });
    expect(await PluginInstaller.installCatalogDefaults()).toEqual({ installed: [], failed: [] });
    expect(installs).toEqual(['gmail-plugin', 'google-drive-plugin']);
  });

  it('never brings back one the user uninstalled; one already installed is just recorded', async () => {
    await fs.writeFile(PluginInstaller.registryPath, JSON.stringify({ plugins: [], userUninstalled: ['gmail-plugin'] }));
    await fs.mkdir(path.join(PluginInstaller.pluginsDir, 'google-drive-plugin'), { recursive: true });
    await fs.writeFile(path.join(PluginInstaller.pluginsDir, 'google-drive-plugin', 'manifest.json'), '{}');
    expect(await PluginInstaller.installCatalogDefaults()).toEqual({ installed: [], failed: [] });
    expect(installs).toEqual([]);
    expect((await registry()).defaultsSeeded).toEqual(['google-drive-plugin']);
  });

  it('a failed install is retried next start, not marked done', async () => {
    PluginInstaller.installFromMarketplace = vi.fn(async () => ({ success: false, error: 'offline' }));
    expect((await PluginInstaller.installCatalogDefaults()).failed).toEqual(['gmail-plugin', 'google-drive-plugin']);
    expect(fsSync.existsSync(PluginInstaller.registryPath)).toBe(false);
  });

  it('the shipped catalog: exactly the Google suite installs by default, and each has its bundled archive', () => {
    const plugins = path.join(here, '..', '..', 'plugins');
    const catalog = JSON.parse(fsSync.readFileSync(path.join(plugins, 'marketplace.json'), 'utf8')).plugins;
    expect(catalog.filter((p) => p.installByDefault).map((p) => p.name).sort()).toEqual(GOOGLE);
    for (const p of catalog) expect(fsSync.existsSync(path.join(plugins, 'marketplace-default', p.name + '.agnt')), p.name).toBe(true);
    // Everything the app ships besides the defaults is only there until AGNT holds its marketplace id.
    expect(catalog.filter((p) => !p.installByDefault).map((p) => p.name).sort()).toEqual(['calculator-plugin', 'chucknorris-joke-plugin']);
  });
});
