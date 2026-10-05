import { describe, it, expect } from 'vitest';
import { studioCatalog, pluginContents, pluginConnections, installDisclosure } from './studioApps.js';

describe('Studio package catalog', () => {
  it('lists available packages without auth and merges installed metadata by package name', () => {
    const rows = studioCatalog([{ name: 'alpha', version: '2', tools: [] }], [{ name: 'alpha', displayName: 'Alpha', version: '1' }, { name: 'local-tool', tools: [{ type: 'calculate' }] }]);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.name === 'alpha')).toMatchObject({ installed: true, version: '2', displayName: 'Alpha' });
    expect(rows.find((row) => row.name === 'local-tool').installed).toBe(false);
  });
  it('keeps packages sharing one sign-in separate and detects packs from any non-tool asset', () => {
    const rows = studioCatalog([], [{ name: 'sheets', tools: [{ schema: { authProvider: 'google' } }] }, { name: 'docs', widgets: [{ slug: 'docs-board' }], tools: [{ schema: { authProvider: 'google' } }] }]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.name === 'docs').isPack).toBe(true);
  });
  it('distinguishes omitted inventories from explicitly empty groups', () => {
    const groups = pluginContents({ agents: [], tools: [{ type: 'search', schema: { title: 'Search the web' } }] });
    expect(groups.find((g) => g.key === 'agents')).toMatchObject({ known: true, items: [] });
    expect(groups.find((g) => g.key === 'skills').known).toBe(false);
    expect(groups.find((g) => g.key === 'tools').items[0].name).toBe('Search the web');
  });
  it('links manifest assets to installed IDs without duplication and excludes deprecated assets', () => {
    const groups = pluginContents({ widgets: [{ slug: 'board', name: 'Research board' }] }, [{ asset_type: 'widget', asset_slug: 'board', local_id: 'w1' }, { asset_type: 'skill', asset_slug: 'old', local_id: 's1', deprecated_at: '2026' }]);
    expect(groups.find((g) => g.key === 'widgets').items).toEqual([{ id: 'w1', name: 'Research board', description: '' }]);
    expect(groups.find((g) => g.key === 'skills').items).toEqual([]);
  });
  it('deduplicates declared auth, reflects health, and never guesses auth from tags', () => {
    const plugin = { tags: ['slack'], tools: [{ schema: { authProvider: 'GOOGLE', title: 'Docs' } }, { schema: { authProvider: 'google', title: 'Sheets' } }, { authProvider: 'notion', title: 'Save' }] };
    expect(pluginConnections(plugin, [{ id: 'google', name: 'Google' }], ['google'], [{ provider: 'google', status: 'error' }])).toEqual([
      { providerId: 'google', name: 'Google', icon: 'connect', known: true, status: 'reconnect', tools: ['Docs', 'Sheets'] },
      { providerId: 'notion', name: 'Notion', icon: 'connect', known: false, status: 'connect', tools: ['Save'] },
    ]);
  });
  it('tolerates empty or malformed catalog lists', () => {
    expect(studioCatalog(null, [null, {}, { name: 'pack', author: { name: 'Publisher' }, tools: 'bad' }])).toHaveLength(1);
    expect(studioCatalog([], [{ name: 'pack', author: { name: 'Publisher' } }])[0].authorName).toBe('Publisher');
  });
});

describe('Install disclosure', () => {
  it.each([{ success: false }, { success: true, integrityState: 'mismatch' }, { success: true, valid: false }])('blocks unavailable, mismatched or invalid inspection: %j', (report) => {
    expect(() => installDisclosure(report)).toThrow();
  });
  it('escapes metadata, discloses missing integrity and full-host execution', () => {
    const html = installDisclosure({ success: true, valid: true, trustTier: '<img src=x onerror=alert(1)>', detected: { '<script>': {} }, undeclared: ['<b>network</b>'] });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;b&gt;network&lt;/b&gt;');
    expect(html).toContain('No verified marketplace fingerprint');
    expect(html).toContain('full access');
  });
});
