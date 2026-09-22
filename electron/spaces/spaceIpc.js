/**
 * IPC for switching spaces, and the hardening every team view gets.
 *
 * Kept out of main.js so it can be tested with plain doubles. Every argument
 * that arrives from a renderer is untrusted: space ids must already be in the
 * registry, and team lists are re-validated by SpaceRegistry.
 */
import { PRIMARY_SPACE_ID } from './SpaceRegistry.js';

const TEAM_LIST_LIMIT = 50;

export function installSpaceIpc({ ipcMain, registry, views, primaryLabel, broadcast }) {
  const state = sender => ({
    activeId: views.activeId,
    selfId: sender ? views.spaceIdFor(sender) : undefined,
    spaces: [{ id: PRIMARY_SPACE_ID, kind: 'personal', label: primaryLabel() }, ...registry.list()],
  });
  const announce = () => broadcast('spaces:changed', state());

  ipcMain.handle('spaces:list', event => state(event.sender));

  ipcMain.handle('spaces:switch', (_event, id, options = {}) => {
    if (typeof id !== 'string' || !registry.has(id)) return { ok: false, error: 'Unknown space' };
    const projectId = typeof options?.projectId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(options.projectId) ? options.projectId : null;
    const result = views.show(id === PRIMARY_SPACE_ID ? null : registry.get(id), { projectId });
    if (result.ok) announce();
    return result;
  });

  ipcMain.handle('spaces:sync-teams', (_event, teams, options = {}) => {
    if (!Array.isArray(teams) || teams.length > TEAM_LIST_LIMIT) return { ok: false, error: 'Invalid team list' };
    const { changed, removed } = registry.syncTeams(teams, { replace: options?.replace === true });
    // Losing a team closes its view: a removed member must not keep a live session on screen.
    for (const id of removed) views.close(id);
    if (changed) announce();
    return { ok: true, changed };
  });

  return { announce, state };
}

/**
 * Hardening for one team view: its popups stay in its own partition with the
 * restricted preload, plain links open in the user's browser, only the named
 * permissions are granted, and an unreachable instance shows a way out.
 */
export function hardenSpaceView(view, space, { shell, preload, allowedPermissions, unavailablePage }) {
  const contents = view.webContents;
  const session = contents.session;
  session.setPermissionRequestHandler((_wc, permission, callback) => callback(allowedPermissions.includes(permission)));
  session.setPermissionCheckHandler((_wc, permission) => allowedPermissions.includes(permission));
  contents.setWindowOpenHandler(({ url, features }) => {
    const isHttp = /^https?:\/\//i.test(url);
    if (isHttp && features.includes('width=') && features.includes('height=')) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 600, height: 700, autoHideMenuBar: true, webPreferences: { session, preload, contextIsolation: true, nodeIntegration: false, sandbox: true } } };
    }
    if (isHttp) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => { if (!/^(https?|file):/i.test(url)) event.preventDefault(); });
  contents.on('did-fail-load', (_event, errorCode, _description, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || String(validatedURL).startsWith('file:')) return;
    contents.loadFile(unavailablePage, { query: { name: space.label, url: validatedURL } });
  });
}
