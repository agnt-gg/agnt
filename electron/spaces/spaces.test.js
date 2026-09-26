import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SpaceRegistry, validateTeam, isIdentityOrigin, PRIMARY_SPACE_ID } from './SpaceRegistry.js';
import { SpaceViews, partitionFor, spaceUrl } from './SpaceViews.js';
import { installSpaceIpc, hardenSpaceView, HANDOFF_TTL_MS } from './spaceIpc.js';

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-spaces-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const acme = { id: 'acme', name: 'Acme Ops', tenantUrl: 'https://acme.agnt.gg/some/path?x=1' };

describe('the team view preload', () => {
  // The renderer reads openExternalUrl as "desktop app" and signs in through the
  // loopback handoff, which a hosted team instance refuses with 403, so a team
  // view that had it could never sign in.
  it('exposes no system-browser bridge, so a team view signs in the web way', async () => {
    const exposed = {};
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const Module = require('module');
    const originalLoad = Module._load;
    Module._load = function (request, ...rest) {
      if (request === 'electron') return { contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } }, ipcRenderer: { send() {}, sendSync() { return null; }, invoke() {}, on() {}, removeListener() {} } };
      return originalLoad.call(this, request, ...rest);
    };
    try {
      delete require.cache[require.resolve('./spacePreload.cjs')];
      require('./spacePreload.cjs');
    } finally {
      Module._load = originalLoad;
    }
    expect(exposed.electron.isSpaceView).toBe(true);
    expect(exposed.electron.openExternalUrl).toBeUndefined();
    expect(typeof exposed.electron.spaces.switch).toBe('function');
    expect(typeof exposed.electron.takeSessionHandoff).toBe('function');
  });
});

describe('which teams share the personal session', () => {
  const local = { id: 'dev', name: 'Dev', tenantUrl: 'http://localhost:4000' };
  const shares = registry => Object.fromEntries(registry.list().map(s => [s.id, s.sharesIdentity]));

  it('only AGNT-hosted https instances qualify', () => {
    expect(isIdentityOrigin('https://acme.t1.agnt.gg')).toBe(true);
    expect(isIdentityOrigin('https://acme.agnt.gg')).toBe(true);
    expect(isIdentityOrigin('http://acme.agnt.gg')).toBe(false);
    expect(isIdentityOrigin('https://agnt.gg.evil.example')).toBe(false);
    expect(isIdentityOrigin('https://evilagnt.gg')).toBe(false);
    expect(isIdentityOrigin('http://localhost:4000')).toBe(false);
    expect(isIdentityOrigin('not a url')).toBe(false);
  });

  it('the personal window can grant it; a team view never can', () => {
    const registry = new SpaceRegistry(dir);
    registry.syncTeams([acme, local], { trusted: true });
    expect(shares(registry)).toEqual({ 'team:acme': true, 'team:dev': false });

    // Anything running inside a team page could register its own tenant.
    registry.syncTeams([{ id: 'evil', name: 'Evil', tenantUrl: 'https://evil.t1.agnt.gg' }]);
    expect(shares(registry)['team:evil']).toBe(false);
  });

  it('a team view may keep it on an unchanged team but loses it by re-pointing one', () => {
    const registry = new SpaceRegistry(dir);
    registry.syncTeams([acme], { trusted: true });
    registry.syncTeams([acme], { replace: true });
    expect(shares(registry)['team:acme']).toBe(true);
    registry.syncTeams([{ ...acme, tenantUrl: 'https://attacker.t1.agnt.gg' }]);
    expect(shares(registry)['team:acme']).toBe(false);
  });

  it('survives a restart, and a hand-edited file cannot grant it', () => {
    new SpaceRegistry(dir).syncTeams([acme], { trusted: true });
    expect(shares(new SpaceRegistry(dir))['team:acme']).toBe(true);
    fs.writeFileSync(path.join(dir, 'spaces.json'), JSON.stringify({ spaces: [{ teamId: 'dev', label: 'Dev', url: 'http://localhost:4000', sharesIdentity: true }] }));
    expect(shares(new SpaceRegistry(dir))).toEqual({ 'team:dev': false });
  });
});

describe('switching keeps the same user', () => {
  const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJl';
  function setup({ session = JWT } = {}) {
    const handlers = {};
    const ipcMain = { handle: (c, fn) => { handlers[c] = fn; }, on: (c, fn) => { handlers[c] = fn; } };
    const registry = new SpaceRegistry(dir);
    const primary = { name: 'primary' };
    const page = (spaceId, url) => ({ spaceId, getURL: () => url });
    const acmeView = page('team:acme', 'https://acme.agnt.gg/?team=acme');
    const views = { activeId: PRIMARY_SPACE_ID, show: vi.fn(s => ({ ok: true, activeId: s ? s.id : PRIMARY_SPACE_ID })), close: vi.fn(), spaceIdFor: s => s?.spaceId || PRIMARY_SPACE_ID };
    const clock = { t: 1_000 };
    const readPrimarySession = vi.fn(async () => session);
    installSpaceIpc({ ipcMain, registry, views, primaryLabel: () => 'Personal', broadcast: vi.fn(), isPrimarySender: s => s === primary, readPrimarySession, now: () => clock.t });
    const call = (sender, channel, ...args) => handlers[channel]({ sender }, ...args);
    const take = sender => { const event = { sender }; handlers['spaces:take-session'](event); return event.returnValue; };
    return { call, take, primary, page, acmeView, clock, readPrimarySession };
  }

  it('hands the personal session to the team page it switched to, exactly once', async () => {
    const { call, take, primary, acmeView } = setup();
    await call(primary, 'spaces:sync-teams', [acme], { replace: true });
    await call(primary, 'spaces:switch', 'team:acme');
    expect(take(acmeView)).toBe(JWT);
    // A reload later must not pick up a session the personal window may have ended since.
    expect(take(acmeView)).toBeNull();
  });

  it('gives nothing to the personal window, another team, or a page that left the team origin', async () => {
    const { call, take, primary, page } = setup();
    await call(primary, 'spaces:sync-teams', [acme, { id: 'beta', name: 'Beta', tenantUrl: 'https://beta.agnt.gg' }], { replace: true });
    await call(primary, 'spaces:switch', 'team:acme');
    expect(take(primary)).toBeNull();
    expect(take(page('team:beta', 'https://beta.agnt.gg/'))).toBeNull();
    expect(take(page('team:acme', 'https://phish.example/login'))).toBeNull();
    // The failed attempt spent it; the real page cannot now be tricked into a second one either.
    expect(take(page('team:acme', 'https://acme.agnt.gg/'))).toBeNull();
  });

  it('never reads the personal session for a team a team view registered', async () => {
    const { call, take, page, readPrimarySession } = setup();
    const acmeView = page('team:acme', 'https://acme.agnt.gg/');
    await call(acmeView, 'spaces:sync-teams', [{ id: 'evil', name: 'Evil', tenantUrl: 'https://evil.t1.agnt.gg' }]);
    await call(acmeView, 'spaces:switch', 'team:evil');
    expect(readPrimarySession).not.toHaveBeenCalled();
    expect(take(page('team:evil', 'https://evil.t1.agnt.gg/'))).toBeNull();
  });

  it('expires if the page does not take it in time, and parks nothing when signed out', async () => {
    const { call, take, primary, acmeView, clock } = setup();
    await call(primary, 'spaces:sync-teams', [acme], { replace: true });
    await call(primary, 'spaces:switch', 'team:acme');
    clock.t += HANDOFF_TTL_MS + 1;
    expect(take(acmeView)).toBeNull();

    const signedOut = setup({ session: null });
    await signedOut.call(signedOut.primary, 'spaces:sync-teams', [acme], { replace: true });
    await signedOut.call(signedOut.primary, 'spaces:switch', 'team:acme');
    expect(signedOut.take(signedOut.acmeView)).toBeNull();
  });

  it('still switches when the personal session cannot be read', async () => {
    const { call, take, primary, acmeView, readPrimarySession } = setup();
    readPrimarySession.mockRejectedValueOnce(new Error('renderer gone'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await call(primary, 'spaces:sync-teams', [acme], { replace: true });
    expect(await call(primary, 'spaces:switch', 'team:acme')).toMatchObject({ ok: true });
    expect(take(acmeView)).toBeNull();
    warn.mockRestore();
  });
});

describe('SpaceRegistry', () => {
  it('accepts only https instance origins with sane ids and names', () => {
    expect(validateTeam(acme)).toEqual({ id: 'team:acme', kind: 'team', teamId: 'acme', label: 'Acme Ops', url: 'https://acme.agnt.gg' });
    expect(validateTeam({ ...acme, tenantUrl: 'http://acme.agnt.gg' })).toBeNull();
    expect(validateTeam({ ...acme, tenantUrl: 'http://localhost:4000' })).not.toBeNull();
    expect(validateTeam({ ...acme, tenantUrl: 'file:///etc/passwd' })).toBeNull();
    expect(validateTeam({ ...acme, tenantUrl: 'javascript:alert(1)' })).toBeNull();
    expect(validateTeam({ ...acme, id: '../x' })).toBeNull();
    expect(validateTeam({ ...acme, name: '' })).toBeNull();
    expect(validateTeam(null)).toBeNull();
  });

  it('persists, re-validates on read, and removes teams the user no longer belongs to', () => {
    const registry = new SpaceRegistry(dir);
    registry.syncTeams([acme, { id: 'beta', name: 'Beta', tenantUrl: 'https://beta.agnt.gg' }]);
    expect(new SpaceRegistry(dir).list().map(s => s.id)).toEqual(['team:acme', 'team:beta']);
    const { removed } = registry.syncTeams([acme], { replace: true });
    expect(removed).toEqual(['team:beta']);
    expect(registry.has(PRIMARY_SPACE_ID)).toBe(true);
    expect(registry.has('team:beta')).toBe(false);
    // A hand-edited file cannot smuggle in a plaintext origin.
    fs.writeFileSync(path.join(dir, 'spaces.json'), JSON.stringify({ spaces: [{ teamId: 'evil', label: 'Evil', url: 'http://evil.example' }] }));
    expect(new SpaceRegistry(dir).list()).toEqual([]);
  });

  it('survives a corrupt file', () => {
    fs.writeFileSync(path.join(dir, 'spaces.json'), '{not json');
    expect(new SpaceRegistry(dir).list()).toEqual([]);
  });
});

function fakeElectron() {
  const created = [];
  class WebContentsView {
    constructor(options) {
      this.options = options; this.visible = true; this.bounds = null;
      this.webContents = { loadURL: vi.fn(), focus: vi.fn(), close: vi.fn(), isDestroyed: () => false, send: vi.fn() };
      created.push(this);
    }
    setVisible(value) { this.visible = value; }
    setBounds(value) { this.bounds = value; }
  }
  const children = [];
  const window = {
    isDestroyed: () => false, getContentSize: () => [1200, 800], on: vi.fn(),
    webContents: { focus: vi.fn() },
    contentView: { addChildView: v => children.push(v), removeChildView: v => { const i = children.indexOf(v); if (i >= 0) children.splice(i, 1); } },
  };
  return { WebContentsView, window, created, children };
}
const team = id => validateTeam({ id, name: id, tenantUrl: 'https://' + id + '.agnt.gg' });

describe('SpaceViews', () => {
  it('gives every space its own partition and the restricted preload', () => {
    const { WebContentsView, window, created } = fakeElectron();
    const views = new SpaceViews({ getWindow: () => window, WebContentsView, preload: '/restricted.cjs' });
    views.show(team('a')); views.show(team('b'));
    expect(created).toHaveLength(2);
    expect(created[0].options.webPreferences).toMatchObject({ preload: '/restricted.cjs', contextIsolation: true, nodeIntegration: false, sandbox: true });
    expect(created[0].options.webPreferences.partition).toBe(partitionFor('team:a'));
    expect(created[0].options.webPreferences.partition).not.toBe(created[1].options.webPreferences.partition);
    expect(partitionFor('team:a')).toMatch(/^persist:space-[0-9a-f]{32}$/);
  });

  it('switching keeps each space loaded and shows exactly one; primary hides them all', () => {
    const { WebContentsView, window, created, children } = fakeElectron();
    const views = new SpaceViews({ getWindow: () => window, WebContentsView, preload: 'p' });
    views.show(team('a')); views.show(team('b')); views.show(team('a'));
    expect(created).toHaveLength(2);
    expect(created[0].webContents.loadURL).toHaveBeenCalledTimes(1);
    expect(created.map(v => v.visible)).toEqual([true, false]);
    expect(children.at(-1)).toBe(created[0]);
    expect(created[0].bounds).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
    views.show(null);
    expect(created.every(v => !v.visible)).toBe(true);
    expect(views.activeId).toBe(PRIMARY_SPACE_ID);
  });

  it('opening a specific project reloads onto it; plain re-opening does not', () => {
    const { WebContentsView, window, created } = fakeElectron();
    const views = new SpaceViews({ getWindow: () => window, WebContentsView, preload: 'p' });
    views.show(team('a'));
    views.show(team('a'), { projectId: 'p2' });
    expect(created[0].webContents.loadURL).toHaveBeenLastCalledWith(spaceUrl(team('a'), { projectId: 'p2' }));
    views.show(team('a'));
    expect(created[0].webContents.loadURL).toHaveBeenCalledTimes(2);
  });

  it('bounds memory: the least recently used background space is closed, never the active one', () => {
    const { WebContentsView, window, created } = fakeElectron();
    const views = new SpaceViews({ getWindow: () => window, WebContentsView, preload: 'p', maxLive: 2 });
    views.show(team('a')); views.show(team('b')); views.show(team('a')); views.show(team('c'));
    expect(created[1].webContents.close).toHaveBeenCalled();
    expect([...views.views.keys()].sort()).toEqual(['team:a', 'team:c']);
    expect(views.activeId).toBe('team:c');
  });

  it('knows which renderer belongs to a team space', () => {
    const { WebContentsView, window, created } = fakeElectron();
    const views = new SpaceViews({ getWindow: () => window, WebContentsView, preload: 'p' });
    views.show(team('a'));
    expect(views.isSpaceSender(created[0].webContents)).toBe(true);
    expect(views.isSpaceSender(window.webContents)).toBe(false);
  });
});

describe('space IPC', () => {
  function setup() {
    const handlers = {};
    const ipcMain = { handle: (channel, fn) => { handlers[channel] = fn; }, on: (channel, fn) => { handlers[channel] = fn; } };
    const registry = new SpaceRegistry(dir);
    const teamSender = { team: true };
    const views = { activeId: PRIMARY_SPACE_ID, show: vi.fn((space) => ({ ok: true, activeId: space ? space.id : PRIMARY_SPACE_ID })), close: vi.fn(), spaceIdFor: sender => (sender === teamSender ? 'team:acme' : PRIMARY_SPACE_ID) };
    const broadcast = vi.fn();
    installSpaceIpc({ ipcMain, registry, views, primaryLabel: () => 'Personal', broadcast });
    const invoke = (channel, ...args) => handlers[channel]({ sender: {} }, ...args);
    const send = (sender, channel, ...args) => handlers[channel]({ sender }, ...args);
    return { invoke, send, teamSender, views, broadcast, registry };
  }

  it('lists Personal first, then teams', async () => {
    const { invoke } = setup();
    await invoke('spaces:sync-teams', [acme]);
    expect((await invoke('spaces:list')).spaces.map(s => s.label)).toEqual(['Personal', 'Acme Ops']);
  });

  it('only switches to known spaces and only passes well-formed project ids', async () => {
    const { invoke, views } = setup();
    expect(await invoke('spaces:switch', 'team:unknown')).toMatchObject({ ok: false });
    expect(await invoke('spaces:switch', { id: 'primary' })).toMatchObject({ ok: false });
    await invoke('spaces:sync-teams', [acme]);
    await invoke('spaces:switch', 'team:acme', { projectId: '../../etc' });
    expect(views.show).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'team:acme' }), { projectId: null });
    await invoke('spaces:switch', 'team:acme', { projectId: 'p-1' });
    expect(views.show).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'team:acme' }), { projectId: 'p-1' });
    await invoke('spaces:switch', 'primary');
    expect(views.show).toHaveBeenLastCalledWith(null, { projectId: null });
  });

  it('closes the view of a team the user was removed from, and rejects oversized lists', async () => {
    const { invoke, views } = setup();
    await invoke('spaces:sync-teams', [acme]);
    await invoke('spaces:sync-teams', [], { replace: true });
    expect(views.close).toHaveBeenCalledWith('team:acme');
    expect(await invoke('spaces:sync-teams', Array.from({ length: 51 }, (_, i) => ({ ...acme, id: 't' + i })))).toMatchObject({ ok: false });
    expect(await invoke('spaces:sync-teams', 'nope')).toMatchObject({ ok: false });
  });
});

describe('unread across spaces', () => {
  it('each space reports only its own count, bounded, and the list carries it', async () => {
    const handlers = {};
    const ipcMain = { handle: (c, fn) => { handlers[c] = fn; }, on: (c, fn) => { handlers[c] = fn; } };
    const teamSender = {};
    const registry = new SpaceRegistry(dir);
    registry.syncTeams([acme]);
    const broadcast = vi.fn();
    installSpaceIpc({ ipcMain, registry, views: { activeId: PRIMARY_SPACE_ID, spaceIdFor: s => (s === teamSender ? 'team:acme' : PRIMARY_SPACE_ID) }, primaryLabel: () => 'Personal', broadcast });
    handlers['spaces:report-unread']({ sender: teamSender }, 3);
    handlers['spaces:report-unread']({ sender: {} }, 99999);
    handlers['spaces:report-unread']({ sender: {} }, 'lots');
    const state = await handlers['spaces:list']({ sender: {} });
    expect(Object.fromEntries(state.spaces.map(s => [s.id, s.unread]))).toEqual({ primary: 0, 'team:acme': 3 });
    expect(broadcast).toHaveBeenCalledWith('spaces:changed', expect.anything());
  });
});

describe('team view hardening', () => {
  it('keeps popups in the team session with the restricted preload, and sends plain links to the browser', () => {
    const listeners = {};
    const session = { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() };
    let openHandler;
    const view = { webContents: { session, setWindowOpenHandler: fn => { openHandler = fn; }, on: (event, fn) => { listeners[event] = fn; }, loadFile: vi.fn() } };
    const shell = { openExternal: vi.fn() };
    hardenSpaceView(view, { label: 'Acme' }, { shell, preload: '/restricted.cjs', allowedPermissions: ['clipboard-read'], unavailablePage: '/unavailable.html' });
    const popup = openHandler({ url: 'https://agnt.gg/login', features: 'width=600,height=700' });
    expect(popup.action).toBe('allow');
    expect(popup.overrideBrowserWindowOptions.webPreferences).toMatchObject({ session, preload: '/restricted.cjs', sandbox: true });
    expect(openHandler({ url: 'https://example.com', features: '' })).toEqual({ action: 'deny' });
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com');
    expect(openHandler({ url: 'file:///C:/secret', features: 'width=1,height=1' })).toEqual({ action: 'deny' });
    const check = session.setPermissionCheckHandler.mock.calls[0][0];
    expect(check(null, 'clipboard-read')).toBe(true);
    expect(check(null, 'geolocation')).toBe(false);
    listeners['did-fail-load']({}, -105, 'NAME_NOT_RESOLVED', 'https://acme.agnt.gg/?team=acme', true);
    expect(view.webContents.loadFile).toHaveBeenCalledWith('/unavailable.html', { query: { name: 'Acme', url: 'https://acme.agnt.gg/?team=acme' } });
  });
});
