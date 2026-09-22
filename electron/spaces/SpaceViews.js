/**
 * One live web view per open team space, laid over the main window.
 *
 * The main window's own webContents IS the primary space and is left exactly as
 * it was: its connection, status page and deep-link handling do not change.
 * A team space is a full-window WebContentsView on top of it, with:
 *   - its own persistent session partition: its own cookies, storage, token and
 *     sockets. Nothing crosses between spaces because nothing is shared.
 *   - a restricted preload: window controls and space switching only. A team
 *     page is a remote origin and never gets this machine's files, dialogs or
 *     browser automation.
 *
 * Switching toggles visibility, so it is instant and keeps each space's state.
 * At most `maxLive` team views stay alive; the least recently used is closed,
 * which bounds memory whatever the number of teams.
 */
import { createHash } from 'crypto';
import { PRIMARY_SPACE_ID } from './SpaceRegistry.js';

export const partitionFor = spaceId => 'persist:space-' + createHash('sha256').update(spaceId).digest('hex').slice(0, 32);

export function spaceUrl(space, { projectId = null } = {}) {
  const url = new URL(space.url);
  url.searchParams.set('team', space.teamId);
  if (projectId) url.searchParams.set('workspace', projectId);
  return url.href;
}

export class SpaceViews {
  /**
   * @param {object} deps
   * @param {() => import('electron').BrowserWindow|null} deps.getWindow
   * @param {new (options: object) => any} deps.WebContentsView
   * @param {string} deps.preload  absolute path to the restricted space preload
   * @param {(view: any, space: object) => void} [deps.configure]  per-view hardening (popups, permissions, failure page)
   * @param {number} [deps.maxLive]
   */
  constructor({ getWindow, WebContentsView, preload, configure = () => {}, maxLive = 3 }) {
    Object.assign(this, { getWindow, WebContentsView, preload, configure, maxLive });
    this.views = new Map(); // spaceId -> { view, url, lastUsed }
    this.activeId = PRIMARY_SPACE_ID;
    this.clock = 0;
    this.resizeHooked = null;
  }

  /** Which space a renderer belongs to. Unknown senders are the primary window or its popups. */
  spaceIdFor(webContents) {
    for (const [id, entry] of this.views) if (entry.view.webContents === webContents) return id;
    return PRIMARY_SPACE_ID;
  }
  isSpaceSender(webContents) { return this.spaceIdFor(webContents) !== PRIMARY_SPACE_ID; }
  allWebContents() { return [...this.views.values()].map(entry => entry.view.webContents); }

  /** Show a space. `space` is null for primary. Loads (or reloads onto another project) as needed. */
  show(space, { projectId = null } = {}) {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return { ok: false, error: 'No window' };
    this.hookResize(window);
    if (!space) {
      for (const entry of this.views.values()) entry.view.setVisible(false);
      this.activeId = PRIMARY_SPACE_ID;
      window.webContents.focus();
      return { ok: true, activeId: this.activeId };
    }
    let entry = this.views.get(space.id);
    const url = spaceUrl(space, { projectId });
    if (!entry) {
      const view = new this.WebContentsView({
        webPreferences: { partition: partitionFor(space.id), preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
      });
      this.configure(view, space);
      entry = { view, url: null, lastUsed: 0 };
      this.views.set(space.id, entry);
      window.contentView.addChildView(view);
    }
    // Same space, no project requested: keep whatever page the user was on.
    if (entry.url === null || (projectId && entry.url !== url)) { entry.url = url; entry.view.webContents.loadURL(url); }
    entry.lastUsed = ++this.clock;
    for (const [id, other] of this.views) if (id !== space.id) other.view.setVisible(false);
    // Re-adding moves it to the top of the stack.
    window.contentView.removeChildView(entry.view);
    window.contentView.addChildView(entry.view);
    entry.view.setBounds(this.bounds(window));
    entry.view.setVisible(true);
    entry.view.webContents.focus();
    this.activeId = space.id;
    this.evict();
    return { ok: true, activeId: this.activeId };
  }

  /** Close a space's view (membership lost, or evicted). Its partition's data stays on disk for next time. */
  close(spaceId) {
    const entry = this.views.get(spaceId);
    if (!entry) return;
    this.views.delete(spaceId);
    const window = this.getWindow();
    if (window && !window.isDestroyed()) window.contentView.removeChildView(entry.view);
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
    if (this.activeId === spaceId) this.show(null);
  }

  /** The window is gone and took its child views with it. Forget them; the next show() rebuilds. */
  reset() {
    this.views.clear();
    this.activeId = PRIMARY_SPACE_ID;
    this.resizeHooked = null;
  }

  evict() {
    while (this.views.size > this.maxLive) {
      const [oldest] = [...this.views].filter(([id]) => id !== this.activeId).sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0] || [];
      if (!oldest) return;
      this.close(oldest);
    }
  }

  bounds(window) {
    const [width, height] = window.getContentSize();
    return { x: 0, y: 0, width, height };
  }

  hookResize(window) {
    if (this.resizeHooked === window) return;
    this.resizeHooked = window;
    const resize = () => { for (const entry of this.views.values()) entry.view.setBounds(this.bounds(window)); };
    window.on('resize', resize);
    window.on('maximize', resize);
    window.on('unmaximize', resize);
    window.on('enter-full-screen', resize);
    window.on('leave-full-screen', resize);
  }
}
