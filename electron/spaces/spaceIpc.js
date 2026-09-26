/**
 * IPC for switching spaces, and the hardening every team view gets.
 *
 * Kept out of main.js so it can be tested with plain doubles. Every argument
 * that arrives from a renderer is untrusted: space ids must already be in the
 * registry, and team lists are re-validated by SpaceRegistry.
 */
import { PRIMARY_SPACE_ID } from './SpaceRegistry.js';

const TEAM_LIST_LIMIT = 50;

/** How long a parked session waits for the team view to boot and take it. */
export const HANDOFF_TTL_MS = 60_000;

const looksLikeSessionToken = value =>
  typeof value === 'string' && value.length < 8192 && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(value);

/**
 * @param {object} deps
 * @param {(sender: any) => boolean} [deps.isPrimarySender]  is this the personal window itself?
 *   Only it may mark a team as sharing the personal session. Defaults to "no", so a
 *   caller that does not wire it gets the safe behaviour.
 * @param {() => Promise<string|null>} [deps.readPrimarySession]  the personal window's
 *   current session token, or null when it is signed out.
 */
export function installSpaceIpc({ ipcMain, registry, views, primaryLabel, broadcast, isPrimarySender = () => false, readPrimarySession = async () => null, now = Date.now }) {
  // Unread counts, reported by each space's own renderer about ITSELF. A space can never set
  // another space's count: the id comes from the sender, not the message.
  const unread = new Map();
  const state = sender => ({
    activeId: views.activeId,
    selfId: sender ? views.spaceIdFor(sender) : undefined,
    spaces: [{ id: PRIMARY_SPACE_ID, kind: 'personal', label: primaryLabel() }, ...registry.list()].map(space => ({ ...space, unread: unread.get(space.id) || 0 })),
  });
  const announce = () => broadcast('spaces:changed', state());

  ipcMain.on('spaces:report-unread', (event, count) => {
    const id = views.spaceIdFor(event.sender);
    const value = Number.isInteger(count) && count >= 0 ? Math.min(count, 9999) : 0;
    if ((unread.get(id) || 0) === value) return;
    unread.set(id, value);
    announce();
  });

  ipcMain.handle('spaces:list', event => state(event.sender));

  // SWITCHING KEEPS YOU AS YOU.
  //
  // A team view is its own session partition, so it used to start signed out
  // and ask for a second sign-in, as the same person, on the same issuer. The
  // personal session is parked here for that one space and taken by its page at
  // boot (see spaces:take-session). Parked rather than pushed so the page can
  // adopt it before anything mounts, and single-use with a short life so a
  // later reload cannot pick up a session the personal window has since ended.
  const parked = new Map(); // spaceId -> { token, until }

  ipcMain.handle('spaces:switch', async (_event, id, options = {}) => {
    if (typeof id !== 'string' || !registry.has(id)) return { ok: false, error: 'Unknown space' };
    const projectId = typeof options?.projectId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(options.projectId) ? options.projectId : null;
    const space = id === PRIMARY_SPACE_ID ? null : registry.get(id);
    if (space?.sharesIdentity) {
      let token = null;
      try { token = await readPrimarySession(); } catch (error) { console.warn('[spaces] could not read the personal session:', error?.message || error); }
      if (looksLikeSessionToken(token)) parked.set(space.id, { token, until: now() + HANDOFF_TTL_MS });
      else parked.delete(space.id);
    }
    const result = views.show(space, { projectId });
    if (result.ok) announce();
    return result;
  });

  // Synchronous on purpose: the page asks from its preload-exposed bridge at
  // module scope, before mount, where it cannot await. Every condition is
  // re-checked at release, not at parking, because this is the moment the
  // token leaves the main process:
  //   - the asker must BE that space's view (not the personal window, not a
  //     popup, not another team);
  //   - the space must still share identity;
  //   - the page must still be on the space's own origin. A team page can
  //     navigate itself anywhere https; a view that has wandered off must not
  //     be handed the session on its next load.
  ipcMain.on('spaces:take-session', event => {
    event.returnValue = null;
    const id = views.spaceIdFor(event.sender);
    const entry = parked.get(id);
    if (!entry) return;
    parked.delete(id);
    const space = registry.get(id);
    if (!space?.sharesIdentity || entry.until < now()) return;
    let origin = null;
    try { origin = new URL(event.sender.getURL()).origin; } catch { return; }
    if (origin !== new URL(space.url).origin) return;
    event.returnValue = entry.token;
  });

  ipcMain.handle('spaces:sync-teams', (event, teams, options = {}) => {
    if (!Array.isArray(teams) || teams.length > TEAM_LIST_LIMIT) return { ok: false, error: 'Invalid team list' };
    const trusted = isPrimarySender(event?.sender) === true;
    const { changed, removed } = registry.syncTeams(teams, { replace: options?.replace === true, trusted });
    // Losing a team closes its view: a removed member must not keep a live session on screen.
    for (const id of removed) { views.close(id); unread.delete(id); parked.delete(id); }
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
