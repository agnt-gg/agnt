import { describe, it, expect } from 'vitest';
import { createRouter, createMemoryHistory } from 'vue-router';
import { pluginRouteRecords, canonicalPluginQuery } from './pluginRoutes.js';
import { screenRoute } from '@/views/Terminal/screenRoute.js';
import { focusedLocation, routeFor } from '@/views/Focused/focusedRoutes.js';
import { ALL_SECTIONS } from '@/canvas/sections.js';
import { appsDirectory } from '@/mobile/sectionDirectories.js';
import { FOCUSED_PAGES } from '@/views/Focused/focusedModel.js';

function router() { return createRouter({ history: createMemoryHistory(), routes: pluginRouteRecords({ render: () => null }) }); }

describe('Canonical Plugins and Plugin Forge routes', () => {
  it('catalog and builder resolve to their existing screens in both modes', async () => {
    const r = router();
    await r.push('/plugins');
    expect(r.currentRoute.value.meta).toMatchObject({ requiresAuth: true, terminalScreen: 'ConnectorsScreen' });
    expect(focusedLocation(r.currentRoute.value.meta.terminalScreen)).toMatchObject({ page: 'connectors', item: null });
    await r.push('/plugin-forge');
    expect(r.currentRoute.value.meta).toMatchObject({ requiresAuth: true, terminalScreen: 'PluginsScreen' });
    expect(focusedLocation(r.currentRoute.value.meta.terminalScreen)).toBeNull();
  });
  it.each(['/apps', '/connectors'])('redirects %s without losing selection, section, OAuth params or hash', async path => {
    const r = router();
    const query = { select: 'app:research & notes', section: 'oauth', code: 'test-code', state: 'test-state', studio: '1' };
    await r.push({ path, query, hash: '#accounts' });
    expect(r.currentRoute.value.path).toBe('/plugins');
    expect(r.currentRoute.value.query).toEqual({ ...query, select: 'plugin:research & notes' });
    expect(r.currentRoute.value.hash).toBe('#accounts');
  });
  it('preserves named-route compatibility and canonical provider links', async () => {
    const r = router();
    await r.push({ name: 'TerminalConnectors', query: { select: 'provider:google' } });
    expect(r.currentRoute.value.path).toBe('/plugins');
    expect(focusedLocation(r.currentRoute.value.meta.terminalScreen, r.currentRoute.value.query)).toEqual({ page: 'connectors', item: 'google' });
    expect(r.resolve({ name: 'TerminalPlugins' }).path).toBe('/plugins');
    expect(r.resolve({ name: 'TerminalPluginForge' }).path).toBe('/plugin-forge');
  });
  it('shell-generated plugin links use /plugins?select=plugin and forge links use /plugin-forge', async () => {
    const r = router();
    const [screen, options] = routeFor({ page: 'connectors', item: 'app:proofkit' });
    const target = screenRoute(screen, options);
    expect(target).toMatchObject({ path: '/plugins', query: { select: 'plugin:proofkit' } });
    await r.push(target);
    expect(focusedLocation(r.currentRoute.value.meta.terminalScreen, r.currentRoute.value.query)).toMatchObject({ item: 'app:proofkit' });
    expect(screenRoute('PluginsScreen')).toMatchObject({ path: '/plugin-forge' });
  });
  it('does not mutate query objects or rewrite unrelated selection kinds', () => {
    const query = { select: ['app:one', 'app:two'], flag: ['a', 'b'] };
    expect(canonicalPluginQuery(query)).toEqual({ ...query, select: 'plugin:one' });
    expect(query.select).toEqual(['app:one', 'app:two']);
    expect(canonicalPluginQuery({ select: 'agent:one' })).toEqual({ select: 'agent:one' });
  });
});

describe('Plugin terminology across navigation surfaces', () => {
  it('shares Plugin labels while keeping saved navigation IDs stable', () => {
    const section = ALL_SECTIONS.find(s => s.id === 'apps');
    expect(section.label).toBe('Plugins');
    expect(section.screens.map(s => s.label)).toEqual(['PLUGINS', 'PLUGIN FORGE']);
    expect(appsDirectory[0].label).toBe('Plugins');
    expect(appsDirectory[0].items.find(i => i.id === 'apps').label).toBe('Plugins');
    expect(appsDirectory[0].items.find(i => i.id === 'plugins')).toBeUndefined();
    expect(FOCUSED_PAGES.connectors.title).toBe('Plugins');
  });
});
