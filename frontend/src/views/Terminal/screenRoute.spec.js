// changeScreen's routing, extracted. These pin the behaviour it had inline.
import { describe, it, expect } from 'vitest';
import { screenRoute, normalizeScreen, isNavigation, SCREEN_ROUTES } from './screenRoute.js';

describe('screenRoute', () => {
  it('maps every known screen to its path, and refuses unknown ones', () => {
    for (const [screen, path] of Object.entries(SCREEN_ROUTES)) expect(screenRoute(screen).path).toBe(path);
    expect(screenRoute('NopeScreen')).toBeNull();
  });

  it('keeps the special query shapes', () => {
    expect(screenRoute('WorkflowForgeScreen', { workflowId: 'w1' }).query).toEqual({ id: 'w1' });
    expect(screenRoute('ToolForgeScreen', { toolId: 't1' }).query).toEqual({ 'tool-id': 't1' });
    expect(screenRoute('TracesScreen', { selectedExecutionId: 'e1' }).query).toEqual({ executionId: 'e1' });
    expect(screenRoute('ExperimentsScreen', { selectedInsight: { id: 'i1' } }).query).toEqual({ insightId: 'i1' });
  });

  it('carries the generic intents in the URL', () => {
    expect(
      screenRoute('AutonomyScreen', { select: { kind: 'schedule', id: 's1' }, section: 'schedules', status: 'on', newGoal: true }).query,
    ).toEqual({ select: 'schedule:s1', section: 'schedules', status: 'on', new: '1' });
    expect(screenRoute('AgentsScreen', { newAgent: true }).query).toEqual({ new: '1' });
  });

  // Shelves passed the clicked listing (or a bare `item` key) and this
  // dropped both, so every click landed on the Market home.
  it('Market opens the exact listing clicked: by listing, item key or select', () => {
    expect(screenRoute('MarketplaceScreen', { listing: { id: 'row-9', asset_id: 'agnt-usecase-triage' } }).query).toEqual({ item: 'agnt-usecase-triage' });
    expect(screenRoute('MarketplaceScreen', { listing: { id: 'row-9' } }).query).toEqual({ item: 'row-9' });
    expect(screenRoute('MarketplaceScreen', { item: 'asset-1' }).query).toEqual({ item: 'asset-1' });
    expect(screenRoute('MarketplaceScreen', { select: { kind: 'marketplace', id: 7 } }).query).toEqual({ item: '7' });
    expect(screenRoute('MarketplaceScreen', { listing: { id: 'r', asset_id: 'a' }, studio: true }).query).toEqual({ item: 'a', studio: '1' });
    // "Browse all" (no card) still opens the Market home.
    expect(screenRoute('MarketplaceScreen', { listing: undefined }).query).toEqual({});
    expect(screenRoute('MarketplaceScreen', {}).query).toEqual({});
    // `listing`/`item` mean nothing to other screens.
    expect(screenRoute('AgentsScreen', { listing: { id: 'x' }, item: 'y' }).query).toEqual({});
  });

  it('studio:true asks for the full Studio screen', () => {
    expect(screenRoute('AgentsScreen', { select: { kind: 'agent', id: 'a' }, studio: true }).query).toEqual({ select: 'agent:a', studio: '1' });
  });

  it('Agent Forge resolves to Agents (an agent, or the new-agent modal)', () => {
    expect(normalizeScreen('AgentForgeScreen', { agentId: 'a1' })).toEqual(['AgentsScreen', { agentId: 'a1', select: { kind: 'agent', id: 'a1' } }]);
    expect(normalizeScreen('AgentForgeScreen', {})).toEqual(['AgentsScreen', { newAgent: true }]);
    expect(normalizeScreen('ChatScreen', { x: 1 })).toEqual(['ChatScreen', { x: 1 }]);
  });
});

describe('isNavigation (when changeScreen pushes)', () => {
  it('pushes a different path, or any query', () => {
    expect(isNavigation(screenRoute('AgentsScreen'), '/chat')).toBe(true);
    expect(isNavigation(screenRoute('AgentsScreen', { select: { kind: 'agent', id: 'a' } }), '/agents')).toBe(true);
  });

  it('does not push a bare path that is already current', () => {
    expect(isNavigation(screenRoute('AgentsScreen'), '/agents')).toBe(false);
  });

  it('"+ New workflow" always pushes, so a stale ?id= is dropped (regression guard)', () => {
    const t = screenRoute('WorkflowForgeScreen', { workflowId: null });
    expect(t.query).toEqual({});
    expect(isNavigation(t, '/workflow-forge')).toBe(true);
  });
});
