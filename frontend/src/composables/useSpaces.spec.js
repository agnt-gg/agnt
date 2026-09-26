/**
 * Switching spaces in a plain browser, where there is no desktop host.
 *
 * Measured 2026-09-26: from goku (a personal instance) the user switched to the
 * bravo team, then back to "Personal", then chatted. openPersonal only removed
 * `?team` and stayed on bravo, so the chat was saved on bravo's server and
 * listed in bravo's team view. Personal must go back to the instance the user
 * came from.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const tenantRequest = vi.fn();
vi.mock('@/utils/teamClient.js', () => ({ tenantRequest: (...args) => tenantRequest(...args) }));

const { acceptableHome, homeOrigin, openPersonal, openTeam } = await import('./useSpaces.js');
const { resolveTeamScope } = await import('@/utils/teamScopeTransport.js');

const assign = vi.fn();
function visit(href) {
  const url = new URL(href);
  vi.stubGlobal('location', { href: url.href, origin: url.origin, search: url.search, assign });
  window.location = globalThis.location;
}
const pageAt = href => ({ location: { href }, sessionStorage: window.sessionStorage });

beforeEach(() => {
  sessionStorage.clear();
  assign.mockReset();
  tenantRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  delete window.electron;
});
afterEach(() => vi.unstubAllGlobals());

describe('where Personal may go', () => {
  it('a sibling instance on the same fleet domain, over https', () => {
    const bravo = pageAt('https://bravo.t1.agnt.gg/chat');
    expect(acceptableHome('https://goku.t1.agnt.gg', bravo)).toBe('https://goku.t1.agnt.gg');
    expect(acceptableHome('https://goku.t1.agnt.gg/some/path?x=1', bravo)).toBe('https://goku.t1.agnt.gg');
  });

  it('nowhere a crafted link could point it', () => {
    const bravo = pageAt('https://bravo.t1.agnt.gg/');
    for (const bad of [
      'https://evil.example', 'https://goku.t1.agnt.gg.evil.example', 'https://t1.agnt.gg', 'https://a.b.t1.agnt.gg',
      'http://goku.t1.agnt.gg', 'javascript:alert(1)', 'https://bravo.t1.agnt.gg', '', null, 'not a url',
    ]) expect(acceptableHome(bad, bravo), String(bad)).toBeNull();
  });

  it('loopback development goes only to loopback', () => {
    expect(acceptableHome('http://localhost:3334', pageAt('http://localhost:3333/'))).toBe('http://localhost:3334');
    expect(acceptableHome('https://goku.t1.agnt.gg', pageAt('http://localhost:3333/'))).toBeNull();
  });
});

describe('the round trip goku -> bravo team -> Personal', () => {
  it('records home on the way out, and Personal goes back to it', async () => {
    visit('https://goku.t1.agnt.gg/chat');
    await openTeam({ id: 'bravo-team', name: 'bravo', tenantUrl: 'https://bravo.t1.agnt.gg' });
    const target = new URL(assign.mock.calls[0][0]);
    expect(target.origin).toBe('https://bravo.t1.agnt.gg');
    expect(target.searchParams.get('team')).toBe('bravo-team');
    expect(target.searchParams.get('home')).toBe('https://goku.t1.agnt.gg');

    // bravo boots: the scope transport records scope and home before the router drops the query.
    sessionStorage.clear(); assign.mockReset();
    visit(target.href);
    resolveTeamScope(window);
    visit('https://bravo.t1.agnt.gg/chat');
    expect(homeOrigin()).toBe('https://goku.t1.agnt.gg');

    await openPersonal();
    expect(assign).toHaveBeenCalledWith('https://goku.t1.agnt.gg/');
    expect(sessionStorage.getItem('agnt.teamScope')).toBeNull();
    expect(tenantRequest).not.toHaveBeenCalled();
  });

  it('team to team keeps the original home', async () => {
    visit('https://bravo.t1.agnt.gg/?team=bravo-team&home=https%3A%2F%2Fgoku.t1.agnt.gg');
    resolveTeamScope(window);
    await openTeam({ id: 'delta-team', name: 'delta', tenantUrl: 'https://delta.t1.agnt.gg' });
    expect(new URL(assign.mock.calls[0][0]).searchParams.get('home')).toBe('https://goku.t1.agnt.gg');
  });

  it('a crafted home is ignored, and Personal falls back to the instance you own', async () => {
    visit('https://bravo.t1.agnt.gg/?team=bravo-team&home=https%3A%2F%2Fevil.example');
    resolveTeamScope(window);
    tenantRequest.mockResolvedValue({ tenants: [
      { slug: 'bravo', url: 'https://bravo.t1.agnt.gg', isOwner: false, status: 'active' },
      { slug: 'goku', url: 'https://goku.t1.agnt.gg', isOwner: true, status: 'active' },
    ] });
    await openPersonal();
    expect(assign).toHaveBeenCalledWith('https://goku.t1.agnt.gg/');
  });

  it('with no instance of your own, Personal is your space on this one, as before', async () => {
    visit('https://bravo.t1.agnt.gg/chat?team=bravo-team');
    resolveTeamScope(window);
    tenantRequest.mockResolvedValue({ tenants: [{ slug: 'bravo', url: 'https://bravo.t1.agnt.gg', isOwner: true, status: 'active' }] });
    await openPersonal();
    expect(assign).toHaveBeenCalledWith('https://bravo.t1.agnt.gg/chat');
  });

  it('an unreachable control plane still leaves a way to Personal', async () => {
    visit('https://bravo.t1.agnt.gg/chat?team=bravo-team');
    resolveTeamScope(window);
    tenantRequest.mockRejectedValue(new Error('offline'));
    await openPersonal();
    expect(assign).toHaveBeenCalledWith('https://bravo.t1.agnt.gg/chat');
  });

  it('already home: nothing happens', async () => {
    visit('https://goku.t1.agnt.gg/chat');
    await openPersonal();
    expect(assign).not.toHaveBeenCalled();
    expect(tenantRequest).not.toHaveBeenCalled();
  });
});
