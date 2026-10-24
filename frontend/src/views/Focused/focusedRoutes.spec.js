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

  // 2026-10-23: a workflow is built on the canvas (the Forge, with Annie's chat on its left).
  it('a workflow opens on the canvas; a tool opens in Focused', () => {
    expect(via('WorkflowForgeScreen', { workflowId: 'w9' })).toBeNull();
    expect(routeFor({ page: 'library', tab: 'workflows', item: 'w9' })).toEqual(['WorkflowForgeScreen', { workflowId: 'w9' }]);
    expect(routeFor({ page: 'library', tab: 'workflows', item: null, isNew: true })).toEqual(['WorkflowForgeScreen', { workflowId: null }]);
    expect(via('ToolForgeScreen', { toolId: 't9' })).toMatchObject({ page: 'library', tab: 'tools', item: 't9' });
  });

  // "New X" in Focused used to seed the chat, and /agents?new=1 landed on the
  // list. Creating opens Focused's own blank editor, from any entry point.
  it('New on every Library kind opens Focused\'s blank editor, never the chat', () => {
    for (const [screen, tab] of [['AgentsScreen', 'agents'], ['WorkflowsScreen', 'workflows'], ['ToolsScreen', 'tools'], ['SkillsScreen', 'skills'], ['WidgetManagerScreen', 'widgets']]) {
      expect(via(screen, { newAgent: true }), screen).toEqual({ page: 'library', tab, item: null, isNew: true });
      expect(via(screen, {}), screen).toEqual({ page: 'library', tab, item: null });
    }
  });

  it('a bare forge is "New workflow" / "New tool", in Focused', () => {
    expect(via('WorkflowForgeScreen', { workflowId: null })).toBeNull();
    expect(via('ToolForgeScreen', {})).toEqual({ page: 'library', tab: 'tools', item: null, isNew: true });
    // "Open the full editor" still reaches Studio's canvas.
    expect(focusedLocation('WorkflowForgeScreen', { studio: '1' })).toBeNull();
  });

  it('files and folders', () => {
    expect(via('ArtifactsScreen', { select: { kind: 'artifact', id: 'reports/q3.md' } })).toMatchObject({ tab: 'files', item: 'reports/q3.md', dir: '' });
    expect(via('ArtifactsScreen', { select: { kind: 'dir', id: 'reports' } })).toMatchObject({ tab: 'files', item: null, dir: 'reports' });
  });

  it('connectors, scheduled, memory, settings', () => {
    expect(via('ConnectorsScreen', { select: { kind: 'provider', id: 'slack' } })).toEqual({ page: 'connectors', item: 'slack' });
    // "Which model" is Settings in both shells, never an app.
    expect(via('ConnectorsScreen', { section: 'providers' })).toEqual({ page: 'settings' });
    expect(via('ConnectorsScreen', {})).toEqual({ page: 'connectors', item: null });
    // An app with no sign-in of its own is addressed by its appCards id.
    expect(via('ConnectorsScreen', { select: { kind: 'app', id: 'figma-bridge' } })).toEqual({ page: 'connectors', item: 'app:figma-bridge' });
    expect(via('AutonomyScreen', { section: 'schedules' })).toEqual({ page: 'scheduled', item: null, isNew: false });
    expect(via('AutonomyScreen', { select: { kind: 'schedule', id: 's1' } })).toMatchObject({ page: 'scheduled', item: 's1' });
    expect(via('MemoryScreen', { newGoal: true })).toEqual({ page: 'memory', item: null, isNew: true });
    expect(via('SettingsScreen', { section: 'billing' })).toEqual({ page: 'settings' });
  });

  it('Plugins uses the canonical catalog route; Plugin Forge remains the full builder', () => {
    expect(screenRoute('ConnectorsScreen').path).toBe('/plugins');
    expect(via('ConnectorsScreen', { select: { kind: 'plugin', id: 'figma-bridge' } })).toEqual({ page: 'connectors', item: 'app:figma-bridge' });
    const [screen, options] = routeFor({ page: 'connectors', item: 'app:figma-bridge' });
    expect(screenRoute(screen, options)).toMatchObject({ path: '/plugins', query: { select: 'plugin:figma-bridge' } });
    expect(screenRoute('PluginsScreen').path).toBe('/plugin-forge');
    expect(via('PluginsScreen', {})).toBeNull();
    expect(via('PluginsScreen', { select: { kind: 'plugin', id: 'figma-bridge' } })).toBeNull();
  });

  // 2026-10-23: no Market page; its listings are sections of Library and Apps.
  it('Market: a listing opens; the bare Market lands on the Library', () => {
    expect(focusedLocation('MarketplaceScreen')).toEqual({ page: 'library', tab: 'agents', item: null });
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
    for (const s of ['ChatScreen', 'GoalsScreen', 'DashboardScreen', 'WorkspaceScreen']) {
      expect(focusedLocation(s, {}), s).toBeNull();
    }
  });

  it('Traces is Activity, and a run opens as its own Activity page', () => {
    expect(focusedLocation('TracesScreen', {})).toEqual({ page: 'activity', item: null });
    expect(focusedLocation('TracesScreen', { executionId: 'agent-x1' })).toEqual({ page: 'activity', item: 'agent-x1' });
  });
});

describe('routeFor is the inverse of focusedLocation', () => {
  const locations = [
    { page: 'library', tab: 'agents', item: null },
    { page: 'library', tab: 'agents', item: 'a1' },
    { page: 'library', tab: 'tools', item: 't1' },
    { page: 'library', tab: 'skills', item: 'fs-x' },
    { page: 'library', tab: 'widgets', item: null },
    { page: 'library', tab: 'files', item: 'a/b.md', dir: '' },
    { page: 'library', tab: 'files', item: null, dir: 'a/b' },
    { page: 'connectors', item: 'slack' },
    { page: 'connectors', item: 'app:figma-bridge' },
    { page: 'connectors', item: null },
    { page: 'library', tab: 'agents', item: null, isNew: true },
    { page: 'library', tab: 'widgets', item: null, isNew: true },
    { page: 'scheduled', item: 's1', isNew: false },
    { page: 'scheduled', item: null, isNew: true },
    { page: 'memory', item: 'm1', isNew: false },
    { page: 'memory', item: null, isNew: true },
    { page: 'settings' },
    { page: 'activity', item: null },
    { page: 'activity', item: 'agent-a 1' },
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
      'LearningScreen', 'ExperimentsScreen', 'AutonomyScreen', 'WorkflowForgeScreen', 'ToolForgeScreen', 'WidgetForgeScreen', 'PluginsScreen',
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

describe('Vault routing', () => {
  it.each(['oauth', 'vault', 'api-keys'])('keeps %s connections inside Focused mode', (section) => {
    expect(focusedLocation('ConnectorsScreen', { section })).toEqual({ page: 'connectors', tab: 'vault', item: null });
  });
  it('the direct Vault tab round-trips through the shared route', () => {
    const [screen, options] = routeFor({ page: 'connectors', tab: 'vault' });
    expect(via(screen, options)).toEqual({ page: 'connectors', tab: 'vault', item: null });
  });
});

describe('Apps tabs for Studio\'s Email Inbox, Webhooks and MCP (2026-10-23)', () => {
  it('their old section links land on the tab, and the tab routes back to a section', () => {
    expect(focusedLocation('ConnectorsScreen', { section: 'email-server' })).toEqual({ page: 'connectors', tab: 'triggers', item: null });
    expect(focusedLocation('ConnectorsScreen', { section: 'webhooks' })).toEqual({ page: 'connectors', tab: 'triggers', item: null });
    expect(focusedLocation('ConnectorsScreen', { section: 'mcp-servers' })).toEqual({ page: 'connectors', tab: 'mcp', item: null });
    expect(routeFor({ page: 'connectors', tab: 'mcp' })).toEqual(['ConnectorsScreen', { section: 'mcp-servers' }]);
    expect(routeFor({ page: 'connectors', tab: 'triggers' })).toEqual(['ConnectorsScreen', { section: 'webhooks' }]);
  });
});
