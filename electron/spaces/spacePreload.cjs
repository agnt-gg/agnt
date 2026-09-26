/**
 * Preload for TEAM space views. Deliberately a small subset of preload.js.
 *
 * A team space is a remote origin shared with other people. It gets window
 * controls and space switching, and nothing that reaches this computer: no
 * file dialogs, no reveal/open of local paths, no browser automation bridge,
 * no connection or updater control. Renderer code already feature-detects
 * every one of those, so the team UI simply does not offer them.
 *
 * NO openExternalUrl. The renderer reads that bridge as "this is the desktop
 * app" and signs in through the loopback handoff, whose first call
 * (/api/auth/desktop/begin) the team's instance refuses with 403: it only
 * answers its own machine. A team view could therefore never sign in. Without
 * the bridge it takes the web sign-in (a popup in this view's own session) and
 * external links still reach the user's browser through hardenSpaceView.
 */
const { contextBridge, ipcRenderer } = require('electron');

const WINDOW_CHANNELS = ['minimize-window', 'maximize-window', 'close-window', 'open-external-url'];

contextBridge.exposeInMainWorld('electron', {
  isSpaceView: true,
  send: (channel, data) => { if (WINDOW_CHANNELS.includes(channel)) ipcRenderer.send(channel, data); },
  reportError: (payload) => ipcRenderer.send('diagnostics:client-error', payload),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  // The personal session, when this space was just switched to and shares it.
  // Synchronous so boot can adopt it before mount. Null in every other case.
  takeSessionHandoff: () => {
    try { return ipcRenderer.sendSync('spaces:take-session'); } catch { return null; }
  },
  spaces: {
    list: () => ipcRenderer.invoke('spaces:list'),
    switch: (id, options) => ipcRenderer.invoke('spaces:switch', id, options),
    syncTeams: (teams, options) => ipcRenderer.invoke('spaces:sync-teams', teams, options),
    reportUnread: (count) => ipcRenderer.send('spaces:report-unread', count),
    onChanged: (cb) => {
      const handler = (_evt, state) => cb(state);
      ipcRenderer.on('spaces:changed', handler);
      return () => ipcRenderer.removeListener('spaces:changed', handler);
    },
  },
});
