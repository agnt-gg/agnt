import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./searchSources.js', () => ({ searchRequest: vi.fn() }));
import { searchRequest } from './searchSources.js';
import { runJumpAction } from './jumpActions.js';

function ctx() {
  return {
    store: { dispatch: vi.fn() },
    router: { push: vi.fn() },
    navigate: vi.fn(),
    onError: vi.fn(),
  };
}

describe('runJumpAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inspect: selects in the inspector AND navigates with the same select intent', () => {
    const c = ctx();
    expect(runJumpAction({ type: 'inspect', kind: 'agent', id: 'a1', screen: 'AgentsScreen' }, c)).toBe(true);
    expect(c.store.dispatch).toHaveBeenCalledWith('shell/inspect', { kind: 'agent', id: 'a1', screen: 'AgentsScreen' });
    expect(c.navigate).toHaveBeenCalledWith('AgentsScreen', { select: { kind: 'agent', id: 'a1' } });
  });

  it('screen: navigates with its opts (or none)', () => {
    const c = ctx();
    runJumpAction({ type: 'screen', screen: 'ToolsScreen', opts: { select: { kind: 'tool', id: 't' } } }, c);
    runJumpAction({ type: 'screen', screen: 'SettingsScreen' }, c);
    expect(c.navigate.mock.calls).toEqual([
      ['ToolsScreen', { select: { kind: 'tool', id: 't' } }],
      ['SettingsScreen', {}],
    ]);
  });

  it.each(['chat', 'output'])('%s: opens the saved conversation by content-id', (type) => {
    const c = ctx();
    runJumpAction({ type, id: 'o9' }, c);
    expect(c.router.push).toHaveBeenCalledWith({ path: '/chat', query: { 'content-id': 'o9' } });
  });

  it('conversation: resolves the output id first, then opens it', async () => {
    searchRequest.mockResolvedValueOnce({ output: { id: 'o5' } });
    const c = ctx();
    runJumpAction({ type: 'conversation', id: 'conv 1' }, c);
    await Promise.resolve();
    await Promise.resolve();
    expect(searchRequest.mock.calls[0][0]).toBe('/content-outputs/by-conversation/conv%201');
    expect(c.router.push).toHaveBeenCalledWith({ path: '/chat', query: { 'content-id': 'o5' } });
    expect(c.onError).not.toHaveBeenCalled();
  });

  it('conversation: a missing output reports through onError instead of navigating', async () => {
    searchRequest.mockResolvedValueOnce({});
    const c = ctx();
    runJumpAction({ type: 'conversation', id: 'x' }, c);
    await new Promise((r) => setTimeout(r, 0));
    expect(c.router.push).not.toHaveBeenCalled();
    expect(c.onError).toHaveBeenCalledWith('Conversation not available');
  });

  it('store: deep-links the marketplace by asset id', () => {
    const c = ctx();
    runJumpAction({ type: 'store', assetId: 'asset-1' }, c);
    expect(c.router.push).toHaveBeenCalledWith({ path: '/marketplace', query: { item: 'asset-1' } });
  });

  it('teams navigates to Settings and custom pages still dispatch their event', () => {
    const seen = [];
    const on = (e) => seen.push([e.type, e.detail ?? null]);
    window.addEventListener('agnt:open-team-workspace', on);
    window.addEventListener('agnt:open-page', on);
    const c = ctx();
    runJumpAction({ type: 'teams' }, c);
    expect(c.navigate).toHaveBeenCalledWith('SettingsScreen', { section: 'members' });
    runJumpAction({ type: 'page', id: 'p1' }, ctx());
    window.removeEventListener('agnt:open-team-workspace', on);
    window.removeEventListener('agnt:open-page', on);
    expect(seen).toEqual([
      ['agnt:open-page', { pageId: 'p1' }],
    ]);
  });

  it('unknown or missing actions are reported as unhandled, not thrown', () => {
    expect(runJumpAction({ type: 'nope' }, ctx())).toBe(false);
    expect(runJumpAction(null, ctx())).toBe(false);
  });
});
