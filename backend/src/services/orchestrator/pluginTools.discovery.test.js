/**
 * An installed plugin is visible to discover_tools — the REAL handler.
 *
 * Reported 2026-10-20 from AGNT One: "Use Atlas Cloud to do something". The
 * account had Atlas Cloud installed (atlas_image, atlas_video, atlas_upload,
 * atlas_chat), every chat turn's own surface listed all 222 plugin tools, and
 * yet discover_tools browse showed 8 registry tools and loading "installed"
 * returned the same 9. The model concluded "no dedicated Atlas tool is
 * installed" and worked around it.
 *
 * Cause: since plugins became per-account (2026-10-05), getAvailableToolSchemas
 * keeps a plugin tool only when the caller names a user who owns it. The chat
 * surface passed the user; discover_tools did not, so to discovery every
 * plugin looked uninstalled.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => { process.env.AGNT_DISABLE_EXTERNAL_POLLING = 'true'; });
vi.mock('node-fetch', () => ({ default: vi.fn(() => { throw new Error('Unexpected network call'); }) }));
vi.mock('../MCPToolService.js', () => ({ default: { getSchemas: vi.fn(async () => []) } }));
vi.mock('../../models/CustomToolModel.js', () => ({ default: { findAllByUserId: vi.fn(async () => []) } }));
vi.mock('../../plugins/PluginAccountStore.js', () => {
  const owned = { 'user-1': [{ plugin_name: 'atlas-cloud', installed_at: '2026-10-20 22:10:00' }] };
  return {
    default: {
      names: vi.fn(async (userId) => (owned[userId] || []).map((r) => r.plugin_name)),
      installs: vi.fn(async (userId) => owned[userId] || []),
    },
  };
});

import { TOOLS } from './tools.js';
import toolRegistry from './toolRegistry.js';
import PluginManager from '../../plugins/PluginManager.js';

const fn = (name) => ({ type: 'function', function: { name, description: `${name} does a thing.`, parameters: { type: 'object', properties: {} } } });
const ATLAS_TOOLS = ['atlas_image', 'atlas_video', 'atlas_upload', 'atlas_chat'];
const discover = (args, context) => TOOLS.discover_tools.execute(args, 'Bearer test', context).then(JSON.parse);

beforeEach(() => {
  vi.spyOn(toolRegistry, 'ensureInitialized').mockResolvedValue();
  vi.spyOn(toolRegistry, 'getOpenApiSchemas').mockReturnValue([]);
  vi.spyOn(toolRegistry, 'getAllPluginTools').mockReturnValue(
    ATLAS_TOOLS.map((name) => ({ type: name.replace(/_/g, '-'), pluginName: 'atlas-cloud', openApiSchema: fn(name), isPlugin: true })),
  );
  vi.spyOn(PluginManager, 'getPlugin').mockImplementation((name) => (name === 'atlas-cloud' ? { name, displayName: 'Atlas Cloud' } : undefined));
});

describe('discover_tools sees the plugins this account installed', () => {
  it('browse lists the plugin by name, with its tools and the category that loads it', async () => {
    const out = await discover({ operation: 'browse' }, { userId: 'user-1' });
    const plugins = out.categories.find((c) => c.name === 'plugins');
    expect(plugins, JSON.stringify(out.categories.map((c) => c.name))).toBeTruthy();
    expect(plugins.plugins).toEqual([
      { category: 'plugin:atlas-cloud', title: 'Atlas Cloud', tools: ATLAS_TOOLS, status: 'available' },
    ]);
    const installed = out.categories.find((c) => c.name === 'installed');
    expect(installed.tools).toEqual(expect.arrayContaining(ATLAS_TOOLS));
  });

  it('load accepts one plugin by its category, and reports its tools', async () => {
    const context = { userId: 'user-1' };
    const out = await discover({ operation: 'load', categories: ['plugin:atlas-cloud'] }, context);
    expect(out.success, out.error).toBe(true);
    expect(out.loaded_tools).toEqual(expect.arrayContaining(ATLAS_TOOLS));
    expect(context._requestedToolCategories.has('plugin:atlas-cloud')).toBe(true);
  });

  it('loading "installed" includes plugin tools', async () => {
    const out = await discover({ operation: 'load', categories: ['installed'] }, { userId: 'user-1' });
    expect(out.loaded_tools).toEqual(expect.arrayContaining(ATLAS_TOOLS));
  });

  it('a plugin this account did not install is neither listed nor loadable', async () => {
    const browse = await discover({ operation: 'browse' }, { userId: 'user-2' });
    expect(browse.categories.find((c) => c.name === 'plugins')).toBeUndefined();
    expect(JSON.stringify(browse)).not.toMatch(/atlas_/);
    const load = await discover({ operation: 'load', categories: ['plugin:atlas-cloud'] }, { userId: 'user-2' });
    expect(load.success).toBe(false);
    expect(load.error).toMatch(/plugin:atlas-cloud/);
  });

  it('the channel ceiling still bounds a plugin load', async () => {
    const context = { userId: 'user-1', _toolCeiling: new Set(['atlas_image']) };
    const out = await discover({ operation: 'load', categories: ['plugin:atlas-cloud'] }, context);
    expect(out.loaded_tools).toEqual(['atlas_image']);
  });
});
