import { describe, it, expect } from 'vitest';
import { focusedLocation, routeFor, selected, LIBRARY_TAB_SCREENS } from './focusedRoutes.js';
import { screenRoute } from '@/views/Terminal/screenRoute.js';
import { SECTION_ROUTES } from '@/canvas/sections.js';

const via = (screen, opts) => focusedLocation(screen, screenRoute(screen, opts).query);

describe('focusedLocation: every Library kind has a Focused page', () => {
  it.each([
    ['AgentsScreen', 'agent', 'agents'],
    ['WorkflowsScreen', 'workflow', 'workflows'],
    ['ToolsScreen', 'tool', 'tools'],
    ['SkillsScreen', 'skill', 'skills'],
    ['WidgetManagerScreen', 'widget', 'widgets'],
  ])('%s, list and item', (screen, kind, tab) => {
    expect(via(screen, {})).toMatchObject({ page: 'library', tab, item: null });
    expect(via(screen, { select: { kind, id: 'x1' } })).toMatchObject({ page: 'library', tab, item: 'x1' });
  });

  it('regression: a workflow opened from anywhere stays in Focused (it used to open Studio\'s page)', () => {
    expect(via('WorkflowForgeScreen', { workflowId: 'w9' })).toMatchObject({ page: 'library', tab: 'workflows', item: 'w9' });
    expect(via('ToolForgeScreen', { toolId: 't9' })).toMatchObject({ page: 'library', tab: 'tools', item: 't9' });
  });

  it('a forge with nothing to open is Studio\'s (the blank canvas)', () => {
    expect(via('WorkflowForgeScreen', { workflowId: null })).toBeNull();
    expect(via('ToolForgeScreen', {})).toBeNull();
  });

  it('files and folders', () => {
    expect(via('ArtifactsScreen', { select: { kind: 'artifact', id: 'reports/q3.md' } })).toMatchObject({ tab: 'files', item: 'reports/q3.md', dir: '' });
    expect(via('ArtifactsScreen', { select: { kind: 'dir', id: 'reports' } })).toMatchObject({ tab: 'files', item: null, dir: 'reports' });
  });

  it('plugins, scheduled, memory, settings', () => {
    expect(via('ConnectorsScreen', { select: { kind: 'provider', id: 'slack' } })).toEqual({ page: 'plugins', item: 'slack' });
    expect(via('ConnectorsScreen', { section: 'providers' })).toEqual({ page: 'plugins', item: null });
    expect(via('PluginsScreen', {})).toEqual({ page: 'plugins', item: null });
    expect(via('AutonomyScreen', { section: 'schedules' })).toEqual({ page: 'scheduled', item: null, isNew: false });
    expect(via('AutonomyScreen', { select: { kind: 'schedule', id: 's1' } })).toMatchObject({ page: 'scheduled', item: 's1' });
    expect(via('MemoryScreen', { newGoal: true })).toEqual({ page: 'memory', item: null, isNew: true });
    expect(via('SettingsScreen', { section: 'billing' })).toEqual({ page: 'settings' });
  });

  it('Market has its own Focused storefront, including item deep links', () => {
    expect(focusedLocation('MarketplaceScreen')).toEqual({ page: 'market', item: null });
    expect(focusedLocation('MarketplaceScreen', { item: 'asset-1' })).toEqual({ page: 'market', item: 'asset-1' });
    expect(focusedLocation('MarketplaceScreen', { studio: '1' })).toBeNull();
  });

  it('Autonomy\'s approvals and limits stay Studio\'s', () => {
    expect(via('AutonomyScreen', {})).toBeNull();
    expect(via('AutonomyScreen', { section: 'approvals' })).toBeNull();
  });

  it('?studio=1 always gets the Studio screen', () => {
    expect(via('AgentsScreen', { select: { kind: 'agent', id: 'a' }, studio: true })).toBeNull();
  });

  it('Chat and Studio-only screens are not Focused pages', () => {
    for (const s of ['ChatScreen', 'GoalsScreen', 'TracesScreen', 'DashboardScreen', 'WorkspaceScreen']) {
      expect(focusedLocation(s, {}), s).toBeNull();
    }
  });
});

describe('routeFor is the inverse of focusedLocation', () => {
  const locations = [
    { page: 'library', tab: 'agents', item: null },
    { page: 'library', tab: 'agents', item: 'a1' },
    { page: 'library', tab: 'workflows', item: 'w 1' },
    { page: 'library', tab: 'tools', item: 't1' },
    { page: 'library', tab: 'skills', item: 'fs-x' },
    { page: 'library', tab: 'widgets', item: null },
    { page: 'library', tab: 'files', item: 'a/b.md', dir: '' },
    { page: 'library', tab: 'files', item: null, dir: 'a/b' },
    { page: 'plugins', item: 'slack' },
    { page: 'plugins', item: null },
    { page: 'scheduled', item: 's1', isNew: false },
    { page: 'scheduled', item: null, isNew: true },
    { page: 'memory', item: 'm1', isNew: false },
    { page: 'memory', item: null, isNew: true },
    { page: 'settings' },
    { page: 'market', item: null },
    { page: 'market', item: 'asset-1' },
  ];
  it.each(locations.map((l) => [JSON.stringify(l), l]))('%s', (_, loc) => {
    const [screen, opts] = routeFor(loc);
    expect(focusedLocation(screen, screenRoute(screen, opts).query)).toMatchObject(loc);
  });

  it('every library tab screen exists in the app\'s routes', () => {
    for (const screen of Object.values(LIBRARY_TAB_SCREENS)) expect(screenRoute(screen)).not.toBeNull();
  });

  it('every rail screen is either a Focused page or knowingly Studio\'s', () => {
    // A new screen added to the rail must be decided here, not forgotten.
    // Forges are listed bare: their blank build canvas is Studio's, while an
    // existing workflow/tool opens in Focused (tested above).
    const studioOnly = new Set([
      'ChatScreen', 'WorkspaceScreen', 'DashboardScreen', 'GoalsScreen', 'TracesScreen',
      'LearningScreen', 'ExperimentsScreen', 'AutonomyScreen', 'WorkflowForgeScreen', 'ToolForgeScreen', 'WidgetForgeScreen',
    ]);
    for (const screen of SECTION_ROUTES) {
      if (studioOnly.has(screen)) continue;
      expect(focusedLocation(screen, {}), `${screen} has no Focused page and is not listed as Studio-only`).not.toBeNull();
    }
  });
});

it('selected() reads only its own kind', () => {
  expect(selected({ select: 'agent:a:b' }, 'agent')).toBe('a:b');
  expect(selected({ select: 'agent:' }, 'agent')).toBeNull();
  expect(selected({ select: 'tool:x' }, 'agent')).toBeNull();
  expect(selected({}, 'agent')).toBeNull();
});
